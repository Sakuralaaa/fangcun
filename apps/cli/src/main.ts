import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { APP_VERSION, readBackup, previewRestore, SCOPE_LABEL, TYPE_LABEL, type Asset, type AssetType } from "@fangcun/core";
import { ApiError, Client, configPath, loadConfig, saveConfig } from "./client";
import { assetDetail, assetRows, isCycle, normType, ops, parseSets, table, writeResult } from "./commands";
import { runMcp } from "./mcp";

const HELP = `方寸 Fangcun CLI ${APP_VERSION}

用法: fangcun <命令> [参数] [--json]

连接
  config --url <地址> --token <令牌>   保存连接信息（也可用 FANGCUN_URL / FANGCUN_TOKEN）
  whoami                               查看当前令牌与权限

查询（只读令牌即可）
  ls [--type server] [--tag x] [--due 30]   列出资产，按到期排序
  show <id|名称>                       查看一项
  search <关键词>                      搜索名称、IP、标签、末四位…
  doctor                               检查缺字段、重复、过期未处理、无关联
  log [--asset <id>] [--limit 30]      操作日志
  plans                                待审批的变更计划
  export [--format json|csv|ics] [--type server] [-o 文件]

修改（可写令牌生成变更计划；完全权限令牌直接写入）
  add --type <类型> --name <名称> [--price 5 --currency USD --cycle month --expires 2027-01-01
      --provider x --tags a,b --note x --set key=value ...]
  edit <id> --set price=12 --set payment.status=frozen ...
  tag <id> +标签 -标签
  link <id> <其他id...> [--unlink]
  renew <id> [--amount 24] [--note 手动续费]
  rm <id>                              删除到回收站（30 天内可恢复）
  import <file.csv|file.json>
  undo <日志编号>

备份（需要完全权限令牌）
  backup [-o 文件.fangcun]
  restore <文件.fangcun> --dry-run | --mode merge|replace

AI 代理
  mcp                                  以 stdio MCP server 运行（Codex / Claude Code 可直接挂载）

类型: ${Object.entries(TYPE_LABEL).map(([k, v]) => `${k}(${v})`).join(" ")}
`;

async function main(argv: string[]) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      json: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
      url: { type: "string" }, token: { type: "string" },
      type: { type: "string" }, tag: { type: "string" }, due: { type: "string" }, deleted: { type: "boolean" },
      name: { type: "string" }, subtitle: { type: "string" }, provider: { type: "string" }, price: { type: "string" },
      currency: { type: "string" }, cycle: { type: "string" }, expires: { type: "string" }, purchased: { type: "string" },
      tags: { type: "string" }, note: { type: "string" }, region: { type: "string" }, discount: { type: "string" },
      "auto-renew": { type: "boolean" }, set: { type: "string", multiple: true }, amount: { type: "string" },
      unlink: { type: "boolean" }, format: { type: "string" }, output: { type: "string", short: "o" },
      "dry-run": { type: "boolean" }, mode: { type: "string" }, asset: { type: "string" }, limit: { type: "string" },
      prefer: { type: "string" },
    },
  });
  const [cmd, ...args] = positionals;
  const json = Boolean(o.json);
  const out = (human: string, data: unknown) => console.log(json ? JSON.stringify(data, null, 2) : human);
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);

  if (o.version) return console.log(APP_VERSION);
  if (!cmd || o.help || cmd === "help") return console.log(HELP);

  if (cmd === "config") {
    if (str("url") || str("token")) saveConfig({ ...(str("url") ? { url: str("url") } : {}), ...(str("token") ? { token: str("token") } : {}) });
    const c = loadConfig();
    return out(`配置文件 ${configPath()}\n服务端 ${c.url}\n令牌   ${c.token ? c.token.slice(0, 9) + "…" : "（未设置）"}`, { url: c.url, hasToken: Boolean(c.token) });
  }

  const client = new Client(loadConfig());
  if (cmd === "mcp") return runMcp(client);

  switch (cmd) {
    case "whoami": {
      const s = await client.get("/api/auth/state");
      return out(s.token ? `令牌「${s.token.name}」· ${SCOPE_LABEL[s.token.scope as "read"]} · 服务端 ${s.version}` : "未识别的令牌", s);
    }
    case "ls": case "list": {
      const list = await ops.list(client, { type: normType(str("type")), tag: str("tag"), due: str("due") ? Number(str("due")) : undefined, deleted: Boolean(o.deleted) });
      return out(assetRows(list), list);
    }
    case "search": {
      const list = await ops.list(client, { q: args.join(" "), type: normType(str("type")) });
      return out(assetRows(list), list);
    }
    case "show": {
      need(args[0], "show <id|名称>");
      const a = await ops.show(client, args[0]);
      return out(assetDetail(a), a);
    }
    case "add": {
      const type = normType(str("type"));
      if (!type || !TYPE_LABEL[type as AssetType]) throw new Error(`--type 需要是：${Object.keys(TYPE_LABEL).join(" / ")}`);
      need(str("name"), "add --type <类型> --name <名称>");
      const input: Partial<Asset> = { type, name: str("name"), ...fieldsFromFlags(o as Record<string, unknown>), ...parseSets((o.set as string[]) ?? []) };
      const r = await ops.create(client, input);
      return out(writeResult(r), r);
    }
    case "edit": {
      need(args[0], "edit <id> --set 字段=值");
      const patch = { ...fieldsFromFlags(o as Record<string, unknown>), ...(str("name") ? { name: str("name") } : {}), ...parseSets((o.set as string[]) ?? []) };
      if (!Object.keys(patch).length) throw new Error("没有要改的字段，用 --set 字段=值");
      if (patch.payment || patch.phone || patch.account) {
        const cur = await ops.show(client, args[0]);
        for (const k of ["payment", "phone", "account"] as const) if (patch[k]) (patch as any)[k] = { ...cur[k], ...patch[k] };
      }
      const r = await ops.update(client, args[0], patch);
      return out(writeResult(r), r);
    }
    case "tag": {
      need(args[0], "tag <id> +标签 -标签");
      const add = args.slice(1).filter((t) => !t.startsWith("-")).map((t) => t.replace(/^\+/, ""));
      const remove = args.slice(1).filter((t) => t.startsWith("-")).map((t) => t.slice(1));
      const r = await ops.tag(client, args[0], add, remove);
      return out(writeResult(r), r);
    }
    case "link": {
      need(args[1], "link <id> <其他id...>");
      const r = await ops.link(client, args[0], args.slice(1), Boolean(o.unlink));
      return out(writeResult(r), r);
    }
    case "renew": {
      need(args[0], "renew <id>");
      const r = await ops.renew(client, args[0], { ...(str("amount") ? { amount: Number(str("amount")) } : {}), ...(str("note") ? { note: str("note") } : {}) });
      return out(writeResult(r), r);
    }
    case "rm": case "delete": {
      need(args[0], "rm <id>");
      const r = await ops.remove(client, args[0]);
      return out(writeResult(r), r);
    }
    case "import": {
      need(args[0], "import <file.csv|file.json>");
      const text = readFileSync(args[0], "utf8");
      const r = await ops.importText(client, text, args[0].toLowerCase().endsWith(".csv") ? "csv" : "json");
      return out(writeResult(r), r);
    }
    case "export": {
      const fmt = str("format") ?? "json";
      const type = normType(str("type"));
      const bytes = await client.request("GET", `/api/export/${fmt}${type ? `?type=${type}` : ""}`, undefined, { raw: true });
      const file = str("output") ?? `fangcun-export.${fmt === "csv" && !type ? "zip" : fmt}`;
      if (file === "-") return process.stdout.write(bytes);
      writeFileSync(file, bytes);
      return out(`已导出到 ${file}`, { file, bytes: bytes.length });
    }
    case "doctor": {
      const issues = await ops.doctor(client);
      const mark = { error: "✗", warn: "!", info: "·" } as const;
      return out(issues.length ? table(issues.map((i: any) => [mark[i.level as "warn"], i.assetId, i.name, i.message]), ["", "ID", "名称", "问题"]) : "一切正常", issues);
    }
    case "log": {
      const entries = await ops.log(client, { assetId: str("asset"), limit: str("limit") ? Number(str("limit")) : undefined });
      return out(table(entries.map((e: any) => [`#${e.id}`, e.at.slice(0, 16).replace("T", " "), e.actor, e.summary + (e.undoneBy ? `（已被 #${e.undoneBy} 撤销）` : "")]), ["编号", "时间 (UTC)", "操作者", "内容"]), entries);
    }
    case "undo": {
      need(args[0], "undo <日志编号>");
      const r = await ops.undo(client, Number(args[0].replace("#", "")));
      return out(writeResult(r), r);
    }
    case "plans": {
      const list = await ops.plans(client);
      return out(list.length ? table(list.map((p: any) => [p.id, p.createdAt.slice(0, 16).replace("T", " "), p.actor, p.summary]), ["计划", "时间 (UTC)", "提交者", "内容"]) : "没有待审批的计划", list);
    }
    case "backup": {
      const bytes = await client.request("GET", "/api/backup/download", undefined, { raw: true });
      const file = str("output") ?? `fangcun-${new Date().toISOString().slice(0, 10)}.fangcun`;
      writeFileSync(file, bytes);
      const b = await readBackup(bytes);
      return out(`已保存 ${file}（${b.manifest.counts.assets} 项资产，${b.manifest.counts.audit} 条日志，校验通过）`, { file, manifest: b.manifest });
    }
    case "restore": {
      need(args[0], "restore <文件.fangcun> --dry-run");
      const bytes = new Uint8Array(readFileSync(args[0]));
      if (o["dry-run"] || !str("mode")) {
        const local = await readBackup(bytes); // verifies checksums locally first
        const r = await client.request("POST", "/api/backup/preview", bytes);
        const p = r.preview;
        const human = [
          `备份时间 ${local.manifest.createdAt} · schema ${local.manifest.schemaVersion} · ${local.manifest.counts.assets} 项`,
          `新增 ${p.added.length} · 冲突 ${p.conflicts.length} · 相同 ${p.same} · 当前有而备份没有 ${p.missing.length}`,
          ...p.conflicts.slice(0, 20).map((x: any) => `  冲突 ${x.id} ${x.name}：${x.fields.join("、")}${x.incomingNewer ? "（备份较新）" : ""}`),
          o["dry-run"] ? "（预演，未做任何改动。用 --mode merge 或 --mode replace 执行）" : "需要指定 --mode merge 或 --mode replace",
        ].join("\n");
        return out(human, r);
      }
      const mode = str("mode") === "replace" ? "replace" : "merge";
      const r = await client.request("POST", `/api/backup/restore?mode=${mode}${str("prefer") ? `&prefer=${str("prefer")}` : ""}`, bytes);
      return out(`已${mode === "replace" ? "整库替换" : "合并"}：${r.applied} 项${r.snapshot ? `；替换前快照 ${r.snapshot}` : ""}`, r);
    }
    default:
      throw new Error(`未知命令 ${cmd}，运行 fangcun help 查看用法`);
  }
}

function need(v: unknown, usage: string): asserts v {
  if (!v) throw new Error(`用法：fangcun ${usage}`);
}

function fieldsFromFlags(o: Record<string, unknown>): Partial<Asset> {
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const out: Partial<Asset> = {};
  if (s("subtitle")) out.subtitle = s("subtitle");
  if (s("provider")) out.provider = s("provider");
  if (s("price")) out.price = Number(s("price"));
  if (s("currency")) out.currency = s("currency")!.toUpperCase();
  if (s("cycle")) { if (!isCycle(s("cycle")!)) throw new Error("--cycle 需要是 month / quarter / halfyear / year / 2year / 3year / once"); out.cycle = s("cycle") as Asset["cycle"]; }
  if (s("expires")) out.expiresAt = s("expires");
  if (s("purchased")) out.purchasedAt = s("purchased");
  if (s("tags")) out.tags = s("tags")!.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  if (s("note")) out.note = s("note");
  if (s("region")) out.region = s("region");
  if (s("discount")) out.discount = s("discount");
  if (o["auto-renew"] !== undefined) out.autoRenew = Boolean(o["auto-renew"]);
  return out;
}

export async function run(argv: string[]) {
  try {
    await main(argv);
  } catch (e) {
    const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
    if (argv.includes("--json")) console.log(JSON.stringify({ error: msg }));
    else console.error(`错误：${msg}`);
    process.exitCode = 1;
  }
}

export { previewRestore };
