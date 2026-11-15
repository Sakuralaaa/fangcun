import { KOMARI_GROUP_LABEL, SCOPE_LABEL, TYPE_LABEL, type KomariFieldGroup, type Settings as S, type TokenScope } from "@fangcun/core";
import clsx from "clsx";
import { Check, Copy, Download, Lock, RefreshCw, RotateCcw, ShieldCheck, Trash2, Undo2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "../data/types";
import { api, download, get, post } from "../lib/api";
import { useData } from "../lib/store";
import { AtollBadge } from "./Atoll";
import { CloudflareSettings } from "./Cloudflare";
import { Button, Card, Empty, Field, KomariBadge, ScrollRow, Select, TextInput, Toggle, TypeIcon } from "./ui";

export const SETTINGS_TABS: [string, string][] = [
  ["general", "常规"], ["security", "登录与两步验证"], ["komari", "Komari 探针"], ["atoll", "Atoll 面板"], ["cloudflare", "Cloudflare"], ["tokens", "访问令牌"],
  ["plans", "变更审批"], ["log", "操作日志"], ["trash", "回收站"], ["backup", "备份与导出"], ["about", "关于"],
];

export function Settings({ tab = "general", onTab }: { tab?: string; onTab: (t: string) => void }) {
  const current = SETTINGS_TABS.some(([k]) => k === tab) ? tab : "general";
  return (
    <main className="flex min-w-0 flex-1 max-md:flex-col">
      <aside className="w-[200px] shrink-0 border-r border-line bg-panel px-3 py-5 max-md:hidden lg:w-[220px]">
        <h2 className="mb-3 px-2 text-[17px] font-bold">设置</h2>
        {SETTINGS_TABS.map(([k, n]) => (
          <button key={k} onClick={() => onTab(k)} className={clsx("flex h-9 w-full items-center rounded-sm px-2.5 text-left text-[13px] whitespace-nowrap", k === current ? "bg-sel font-semibold text-accent" : "text-muted hover:bg-field")}>{n}</button>
        ))}
      </aside>
      <div className="shrink-0 border-b border-line bg-panel pt-3 md:hidden">
        <h2 className="px-4 text-[17px] font-bold">设置</h2>
        <ScrollRow className="mt-2 gap-1 px-3" activeKey={current}>
          {SETTINGS_TABS.map(([k, n]) => (
            <button key={k} onClick={() => onTab(k)} aria-current={k === current ? "true" : undefined}
              className={clsx("relative h-10 shrink-0 px-2.5 text-[13px] whitespace-nowrap", k === current ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-muted")}>{n}</button>
          ))}
        </ScrollRow>
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-8 py-7 max-md:px-4 max-md:py-4">
          {current === "general" && <General />}
          {current === "security" && <Security />}
          {current === "komari" && <Komari />}
          {current === "atoll" && <AtollSettings />}
          {current === "cloudflare" && <CloudflareSettings onSelect={(id) => { location.hash = `#/assets/${id}`; }} />}
          {current === "tokens" && <Tokens />}
          {current === "plans" && <Plans />}
          {current === "log" && <Log />}
          {current === "trash" && <Trash />}
          {current === "backup" && <Backup />}
          {current === "about" && <About />}
        </div>
      </div>
    </main>
  );
}

function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-[13px] text-muted">{sub}</p>}
    </div>
  );
}

const demoOnly = (demo: boolean) => demo && <p className="rounded-sm bg-field px-3 py-2 text-xs text-subtle">演示模式：这里的操作不会连接服务端。</p>;

// ---------------- 常规 ----------------
function General() {
  const { settings, saveSettings, toast, demo, reload } = useData();
  const [d, setD] = useState<S["display"]>(settings.display);
  const toText = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join("\n");
  const [rates, setRates] = useState(toText(settings.display.rates));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD(settings.display); setRates(toText(settings.display.rates)); }, [settings.display]);
  const save = async (patch: Partial<S["display"]> = {}) => {
    const r: Record<string, number> = {};
    for (const line of rates.split("\n")) {
      const [k, v] = line.split("=").map((s) => s.trim());
      if (k && Number(v) > 0) r[k.toUpperCase()] = Number(v);
    }
    const next = { ...d, ...patch, currency: (patch.currency ?? d.currency).toUpperCase(), rates: r };
    try { await saveSettings({ ...settings, display: next }); toast("已保存"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const refresh = async () => {
    if (demo) return;
    setBusy(true);
    try { await post("/api/settings/rates/refresh"); await reload(); toast("汇率已更新"); } catch (e) { toast((e as Error).message, "err"); }
    setBusy(false);
  };
  const auto = d.autoRates;
  const when = settings.display.ratesUpdatedAt ? new Date(settings.display.ratesUpdatedAt).toLocaleString("zh-CN", { hour12: false }) : null;
  return (
    <>
      <Title sub="价格一律按实付手填，不做换算。汇率只用于总览里的「约」合计。">常规</Title>
      {demoOnly(demo)}
      <Card title="合计用的币种与汇率">
        <div className="grid gap-4 @lg:grid-cols-[200px_1fr]">
          <div className="space-y-4">
            <Field label="合计币种"><TextInput value={d.currency} onChange={(v) => setD({ ...d, currency: v })} mono /></Field>
            <Field label="自动更新汇率" hint="每 6 小时从欧洲央行参考汇率（Frankfurter）拉取，缺的币种用 open.er-api 补">
              <Toggle on={auto} onChange={(v) => { setD({ ...d, autoRates: v }); void save({ autoRates: v }); }} />
            </Field>
          </div>
          <Field label="汇率" hint={auto ? (when ? `1 ${settings.display.currency} 等于多少单位 · ${when} 更新 · ${settings.display.ratesSource ?? ""}` : "还没拉取过，点右下角「立即更新」") : "每行 币种=多少单位等于 1 个合计币种（手动维护）"}>
            <textarea value={rates} readOnly={auto} onChange={(e) => setRates(e.target.value)} rows={7} className={clsx("w-full rounded-sm border border-line bg-field px-3 py-2 font-mono text-[12.5px] outline-none", auto && "text-muted")} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {auto && <Button icon={<RefreshCw size={14} className={clsx(busy && "animate-spin")} />} onClick={refresh} disabled={busy || demo}>立即更新</Button>}
          <Button variant="primary" onClick={() => save()}>保存</Button>
        </div>
      </Card>
    </>
  );
}

// ---------------- 登录与两步验证 ----------------
function Security() {
  const { me, setMe, toast, demo } = useData();
  const [pw, setPw] = useState({ old: "", password: "" });
  const [setup, setSetup] = useState<{ secret: string; svg: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const changePw = async () => {
    try { await post("/api/auth/password", pw); setPw({ old: "", password: "" }); toast("密码已修改，其他设备上的登录已退出"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const begin = async () => { try { setSetup(await post("/api/auth/2fa/begin")); } catch (e) { toast((e as Error).message, "err"); } };
  const enable = async () => {
    try { await post("/api/auth/2fa/enable", { code }); setSetup(null); setCode(""); setMe(me && { ...me, totpEnabled: true }); toast("两步验证已开启"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const disable = async () => {
    const c = prompt("输入验证器里的 6 位动态码以关闭两步验证");
    if (!c) return;
    try { await post("/api/auth/2fa/disable", { code: c }); setMe(me && { ...me, totpEnabled: false }); toast("两步验证已关闭"); } catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <>
      <Title sub="单用户：只有你自己的管理员账号。">登录与两步验证</Title>
      {demoOnly(demo)}
      <Card title="两步验证（TOTP）" extra={me?.totpEnabled ? <span className="flex items-center gap-1.5 text-ok"><ShieldCheck size={13} />已开启</span> : "未开启"}>
        <p className="text-[13px] leading-relaxed text-muted">开启后登录需要动态码；在网页里备份、导出、恢复和调整自动备份设置前也要再输一次动态码（10 分钟内有效）。</p>
        {!me?.totpEnabled && !setup && <div className="mt-3"><Button variant="primary" onClick={begin} disabled={demo}>绑定验证器</Button></div>}
        {setup && (
          <div className="mt-4 grid gap-5 @lg:grid-cols-[180px_1fr]">
            <div className="w-full max-w-[180px] rounded-sm border border-line bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: setup.svg }} />
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted">用验证器 App 扫码，或手动输入密钥：</p>
              <code className="rounded-sm bg-field px-3 py-2 font-mono text-[12.5px] break-all">{setup.secret}</code>
              <Field label="输入 App 显示的 6 位动态码"><TextInput value={code} onChange={setCode} inputMode="numeric" maxLength={6} mono /></Field>
              <div><Button variant="primary" onClick={enable} disabled={code.length !== 6}>验证并开启</Button></div>
            </div>
          </div>
        )}
        {me?.totpEnabled && <div className="mt-3"><Button variant="danger" onClick={disable}>关闭两步验证</Button></div>}
      </Card>
      <Card title="修改密码">
        <div className="grid gap-3 @lg:grid-cols-2">
          <Field label="当前密码"><TextInput type="password" value={pw.old} onChange={(v) => setPw({ ...pw, old: v })} /></Field>
          <Field label="新密码" hint="至少 10 位"><TextInput type="password" value={pw.password} onChange={(v) => setPw({ ...pw, password: v })} /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" onClick={changePw} disabled={demo || !pw.old || pw.password.length < 10}>修改</Button></div>
      </Card>
    </>
  );
}

// ---------------- Komari ----------------
interface KNode { uuid: string; name?: string; region?: string; version?: string; os?: string; assetId: string | null; assetName: string | null; overridden: number }

function Komari() {
  const { settings, saveSettings, komari, reload, assets, toast, demo } = useData();
  const [url, setUrl] = useState(settings.komari.url);
  const [nodes, setNodes] = useState<KNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const k = settings.komari;
  useEffect(() => setUrl(settings.komari.url), [settings.komari.url]);

  const loadNodes = useCallback(async (fresh = false) => {
    if (demo) {
      setNodes(assets.filter((a) => a.komari).map((a) => ({ uuid: a.komari!.uuid, name: a.name, region: a.details.find((d) => d.label === "地区")?.value, version: a.komari!.agentVersion, assetId: a.id, assetName: a.name, overridden: Object.keys(a.komari!.overridden ?? {}).length })));
      return;
    }
    if (!settings.komari.url) return;
    try { setNodes((await get<{ nodes: KNode[] }>(`/api/komari/nodes${fresh ? "?fresh=1" : ""}`)).nodes); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, [demo, settings.komari.url, assets]);
  useEffect(() => { loadNodes(); }, [loadNodes]);

  const saveField = async (patch: Partial<S["komari"]>) => {
    try { await saveSettings({ ...settings, komari: { ...k, ...patch } }); } catch (e) { toast((e as Error).message, "err"); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await post<{ updated: number; nodes: number }>("/api/komari/sync");
      toast(`同步完成：${r.nodes} 个节点，${r.updated} 项资产有变化`);
      await reload(); await loadNodes(true);
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(false);
  };
  const bind = async (uuid: string, assetId: string) => {
    try {
      const r = await post<{ status: string; message?: string }>("/api/komari/bind", { uuid, ...(assetId === "__new" ? {} : { assetId }) });
      if (r.status === "pending") toast(r.message ?? "已生成变更计划");
      await reload(); await loadNodes();
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const unbind = async (assetId: string) => {
    try { await post("/api/komari/unbind", { assetId }); await reload(); await loadNodes(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const unboundServers = assets.filter((a) => a.type === "server" && !a.komari);
  const connected = Boolean(komari?.url && komari.hasKey && !err && !komari.lastError);

  return (
    <>
      <Title sub="只读同步服务器信息。方寸不会写回探针，也不会使用终端或执行命令。">Komari 探针 <KomariBadge /></Title>
      <Card title="连接" extra={connected ? <span className="flex items-center gap-1.5 text-ok"><span className="size-1.5 rounded-full bg-ok" />已连接{komari?.version ? ` · 服务端 ${komari.version}` : ""}</span> : <span className="text-warn">{komari?.lastError || err || (komari?.hasKey ? "未连接" : "缺少 API Key")}</span>}>
        <div className="grid gap-3 @lg:grid-cols-2">
          <Field label="探针地址">
            <div className="flex gap-2"><TextInput value={url} onChange={setUrl} mono placeholder="https://probe.example.com" /><Button onClick={() => saveField({ url: url.trim() })} disabled={url === k.url}>保存</Button></div>
          </Field>
          <Field label="API Key">
            <span className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-line bg-field px-3 text-[13px] text-subtle"><Lock size={13} className="shrink-0" /><span className="truncate">{komari?.hasKey ? "由服务端环境变量 KOMARI_API_KEY 提供" : "请在服务端设置环境变量 KOMARI_API_KEY"}</span></span>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="whitespace-nowrap text-muted" title="价格、到期、配置、IP 等台账字段，这些很少变">台账字段同步</span>
          <div className="w-36 shrink-0"><Select value={String(k.intervalMin)} onChange={(v) => saveField({ intervalMin: Number(v) })} options={[["5", "每 5 分钟"], ["15", "每 15 分钟"], ["30", "每 30 分钟"], ["60", "每小时"], ["360", "每 6 小时"], ["1440", "每天"]]} /></div>
          <span className="min-w-0 truncate text-xs text-subtle @max-lg:basis-full @max-lg:order-last">{komari?.lastSync ? `上次 ${new Date(komari.lastSync).toLocaleString("zh-CN", { hour12: false })}` : "还没同步过"}{komari?.nodes != null ? `，${komari.nodes} 个节点` : ""}</span>
          <div className="flex-1" />
          <Button icon={<RefreshCw size={14} className={clsx(busy && "animate-spin")} />} onClick={sync} disabled={demo || busy || !k.url}>立即同步</Button>
        </div>
        <p className="mt-3 text-xs [overflow-wrap:anywhere] text-subtle">这里只管价格、到期、配置这些台账字段。CPU、内存、流量、网速等运行状态是另外实时拉的：总览、服务器页、详情页打开时每 10 秒刷新，没人看时服务端每 5 分钟缓存一次。只会请求 GET /api/admin/client/list，以及 rpc2 的 common:getNodesLatestStatus、common:getRecords（仅延迟记录，每分钟最多一次）。</p>
      </Card>

      <Card title="以 Komari 为准的字段" extra="关掉的字段只在方寸里维护">
        <div className="grid gap-x-6 @lg:grid-cols-2">
          {(Object.keys(KOMARI_GROUP_LABEL) as KomariFieldGroup[]).map((g) => (
            <div key={g} className="flex h-11 items-center gap-3 border-b border-line text-[13px]">
              <span className="min-w-0 flex-1 truncate">{KOMARI_GROUP_LABEL[g][0]}<span className="ml-2 font-mono text-[11px] text-subtle">{KOMARI_GROUP_LABEL[g][1]}</span></span>
              <Toggle on={k.fields[g]} onChange={(v) => saveField({ fields: { ...k.fields, [g]: v } })} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">你在方寸里手动改过的值会标「已手动修改」，之后同步不会覆盖；探针那边的值变了会提示，可一键恢复。流量重置日在资产编辑里手填。</p>
      </Card>

      <Card title="节点绑定" extra={nodes ? `${nodes.filter((n) => n.assetId).length}/${nodes.length} 已绑定` : undefined} flush scroll className="max-h-[480px]">
        <div className={clsx("grid h-9 shrink-0 items-center gap-3 border-b border-line px-4 text-xs whitespace-nowrap text-subtle", NODE_COLS)}>
          <span>Komari 节点</span><span className="@max-xl:hidden">地区</span><span className="@max-xl:hidden">客户端</span><span>方寸资产</span><span className="text-right">状态</span>
        </div>
        {!nodes ? <Empty>{k.url ? (err ?? "读取中…") : "先填写探针地址"}</Empty> : nodes.map((n) => (
          <div key={n.uuid} className={clsx("grid h-12 shrink-0 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0", NODE_COLS)}>
            <span className="truncate font-mono text-[12.5px]" title={n.uuid}>{n.name || n.uuid.slice(0, 8)}</span>
            <span className="truncate text-muted @max-xl:hidden">{n.region || "—"}</span>
            <span className="whitespace-nowrap text-muted tnum @max-xl:hidden">{n.version || "—"}</span>
            {n.assetId ? (
              <span className="flex min-w-0 items-center gap-1.5"><Check size={14} className="shrink-0 text-ok" /><span className="truncate">{n.assetName}</span>
                {!demo && <button onClick={() => unbind(n.assetId!)} className="ml-1 shrink-0 text-xs whitespace-nowrap text-subtle hover:text-crit">解绑</button>}</span>
            ) : (
              <Select value="" onChange={(v) => v && bind(n.uuid, v)} className="h-8 w-[90%]" options={[["", "选择要绑定的资产…"], ["__new", "＋ 新建服务器资产"], ...unboundServers.map((a) => [a.id, a.name] as [string, string])]} />
            )}
            <span className={clsx("text-right text-xs whitespace-nowrap", n.overridden ? "text-warn" : "text-subtle")}>{n.assetId ? (n.overridden ? `${n.overridden} 项手改` : "已同步") : "未绑定"}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

/** Komari 节点 · 地区 · 客户端 · 方寸资产 · 状态; 地区 and 客户端 drop out when narrow. */
const NODE_COLS = "grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_64px] @xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.5fr)_80px]";

// ---------------- Atoll ----------------
function AtollSettings() {
  const { settings, saveSettings, atoll, atollSnap, atollView, reloadAtoll, assets, toast, demo } = useData();
  const [url, setUrl] = useState(settings.atoll.url);
  const [busy, setBusy] = useState(false);
  const s = settings.atoll;
  useEffect(() => setUrl(settings.atoll.url), [settings.atoll.url]);
  const saveField = async (patch: Partial<S["atoll"]>) => {
    try { await saveSettings({ ...settings, atoll: { ...s, ...patch } }); await reloadAtoll(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await post<{ servers: number; projects: number }>("/api/atoll/sync");
      toast(`同步完成：${r.servers} 台服务器，${r.projects} 个项目`);
    } catch (e) { toast((e as Error).message, "err"); }
    await reloadAtoll().catch(() => {});
    setBusy(false);
  };
  const key = atoll?.key;
  const notReadOnly = key?.readOnly === false;
  const connected = Boolean(s.enabled && atoll?.hasKey && s.url && !atoll?.lastError && atoll?.lastSync);
  const status = !s.enabled ? <span className="text-subtle">已关闭</span>
    : connected ? <span className="flex items-center gap-1.5 text-ok"><span className="size-1.5 rounded-full bg-ok" />已连接{key?.readOnly ? " · 只读令牌" : ""}</span>
    : <span className="max-w-[360px] truncate text-muted" title={atoll?.lastError ?? undefined}>{atoll?.lastError || (!atoll?.hasKey ? "缺少 API Key" : !s.url ? "未填写地址" : "还没同步过")}</span>;
  const servers = assets.filter((a) => a.type === "server");
  const matched = servers.filter((a) => atollView.match.get(a.id)?.serverId && atollView.match.get(a.id)?.via !== "manual-missing");

  return (
    <>
      <Title sub="只读读取 Atoll 的服务器、项目、服务和域名，和方寸里的 VPS、域名对上号。方寸不会改动 Atoll，也不会改你手填的资产数据。">Atoll 面板 <AtollBadge /></Title>
      {demoOnly(demo)}
      <Card title="连接" extra={status}>
        <div className="grid gap-3 @lg:grid-cols-2">
          <Field label="面板地址">
            <div className="flex gap-2"><TextInput value={url} onChange={setUrl} mono placeholder="https://atoll.example.com" /><Button onClick={() => saveField({ url: url.trim() })} disabled={url === s.url}>保存</Button></div>
          </Field>
          <Field label="API Key">
            <span className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-line bg-field px-3 text-[13px] text-subtle"><Lock size={13} className="shrink-0" /><span className="truncate">{atoll?.hasKey ? "已由环境变量 ATOLL_API_KEY 提供" : "未设置（服务端环境变量 ATOLL_API_KEY）"}</span></span>
          </Field>
        </div>
        {notReadOnly && (
          <p className="mt-3 rounded-sm border border-line bg-field px-3 py-2 text-[13px] text-ink">
            这个 key 不是只读（权限：{(key?.permissions ?? []).join("、")}），方寸已拒绝使用。请在 Atoll 里另建一个只勾「只读」的令牌，替换 ATOLL_API_KEY 后重启方寸。
          </p>
        )}
        {key?.readOnly === null && <p className="mt-3 text-xs text-subtle">没能从 Atoll 读到这个 key 的权限（面板版本较旧？），请自行确认它是只读（read）令牌。</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="whitespace-nowrap text-muted">启用</span>
          <Toggle on={s.enabled} onChange={(v) => saveField({ enabled: v })} />
          <span className="whitespace-nowrap text-muted @lg:ml-3">同步间隔</span>
          <div className="w-32 shrink-0"><Select value={String(s.intervalMin)} onChange={(v) => saveField({ intervalMin: Number(v) })} options={[["5", "每 5 分钟"], ["15", "每 15 分钟"], ["30", "每 30 分钟"], ["60", "每小时"]]} /></div>
          <span className="min-w-0 truncate text-xs text-subtle @max-lg:basis-full @max-lg:order-last">{atoll?.lastSync ? `上次 ${new Date(atoll.lastSync).toLocaleString("zh-CN", { hour12: false })}` : "还没同步过"}{atoll?.projects != null ? `，${atoll.projects} 个项目` : ""}{atoll?.servers != null ? `、${atoll.servers} 台服务器` : ""}</span>
          <div className="flex-1" />
          <Button icon={<RefreshCw size={14} className={clsx(busy && "animate-spin")} />} onClick={sync} disabled={demo || busy || !s.url || !s.enabled}>立即同步</Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed [overflow-wrap:anywhere] text-subtle">
          API Key 只从服务端环境变量读取，不存数据库、不发给浏览器。在 Atoll 面板左侧「连接」→「API 令牌」→「创建令牌」，权限选「只读」（read）。
          方寸只会请求 GET /auth/me、/servers、/projects、/projects/&#123;id&#125;、/domains，代码里拒绝任何其他请求，不会执行命令、查看变量或日志。
        </p>
      </Card>

      <Card title="怎么对上号" extra={atollSnap ? `${matched.length}/${servers.length} 台 VPS 已关联` : undefined}>
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-muted">
          <li><b className="font-semibold text-ink">VPS ↔ Atoll 服务器</b>：Atoll 上报的公网 IPv4 / IPv6 等于资产「详细信息」里任一 IP（IPv4、IPv6、公网 IP 等，含 Komari 同步来的）。对不上时在 VPS 详情的「Atoll 上的项目」里手动选，手动优先。</li>
          <li><b className="font-semibold text-ink">服务域名 ↔ 域名资产</b>：按后缀匹配，取最长的那个（blog.example.com → example.com）。</li>
          <li>关联只是即时算出来的视图，不写进资产的「关联」，也不改任何手填数据。</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------- 访问令牌 ----------------
interface Tok { id: string; name: string; prefix: string; scope: TokenScope; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }
const SCOPE_HINT: Record<TokenScope, string> = {
  read: "查询、导出、doctor",
  write: "所有写操作先生成变更计划，你在「变更审批」里批准后才落库",
  full: "直接写入（含删除到回收站、改 Komari 绑定、备份恢复），仍记日志、可撤销",
};

function Tokens() {
  const { toast, demo } = useData();
  const [list, setList] = useState<Tok[]>([]);
  const [form, setForm] = useState<{ name: string; scope: TokenScope; days: string }>({ name: "", scope: "read", days: "90" });
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(async () => { if (!demo) setList((await get<{ tokens: Tok[] }>("/api/tokens")).tokens); }, [demo]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const create = async () => {
    try {
      const r = await post<{ token: string }>("/api/tokens", { name: form.name, scope: form.scope, expiresInDays: Number(form.days) || null });
      setCreated(r.token); setForm({ ...form, name: "" }); load();
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const revoke = async (t: Tok) => {
    if (!confirm(`吊销令牌「${t.name}」？使用它的 CLI / AI 代理会立即失去访问权限。`)) return;
    await api("DELETE", `/api/tokens/${t.id}`).catch((e) => toast(e.message, "err"));
    load();
  };
  return (
    <>
      <Title sub="给 fangcun CLI 或 AI 代理（Codex、Claude Code 通过 fangcun mcp）用。令牌永远看不到密码类字段，也不能管理令牌或批准计划。">访问令牌</Title>
      {demoOnly(demo)}
      <Card title="新建令牌">
        <div className="grid grid-cols-2 items-end gap-3 @xl:grid-cols-[1.3fr_1fr_0.8fr_auto]">
          <Field label="名称"><TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Claude Code" /></Field>
          <Field label="权限"><Select value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} options={(["read", "write", "full"] as TokenScope[]).map((s) => [s, SCOPE_LABEL[s]] as [TokenScope, string])} /></Field>
          <Field label="有效期"><Select value={form.days} onChange={(v) => setForm({ ...form, days: v })} options={[["7", "7 天"], ["30", "30 天"], ["90", "90 天"], ["365", "1 年"], ["0", "永不过期"]]} /></Field>
          <Button variant="primary" onClick={create} disabled={demo || !form.name.trim()}>生成</Button>
        </div>
        <p className="mt-2 text-xs text-subtle">{SCOPE_HINT[form.scope]}</p>
        {created && (
          <div className="mt-3 rounded-sm border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13px]">
            <div className="mb-1.5 text-xs text-warn">只显示这一次，请立即复制保存</div>
            <div className="flex items-center gap-2"><code className="flex-1 font-mono text-[12.5px] break-all">{created}</code>
              <Button icon={<Copy size={13} />} onClick={() => { navigator.clipboard?.writeText(created); toast("已复制"); }}>复制</Button></div>
            <div className="mt-2 font-mono text-[11.5px] text-muted">fangcun config --url {location.origin} --token {created.slice(0, 9)}…</div>
          </div>
        )}
      </Card>
      <Card title="令牌" extra={`${list.filter((t) => !t.revokedAt).length} 个有效`} flush>
        {list.length ? list.map((t) => {
          const expired = t.expiresAt && t.expiresAt < new Date().toISOString();
          return (
            <div key={t.id} className={clsx("flex h-12 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0", (t.revokedAt || expired) && "opacity-50")}>
              <span className="w-40 truncate font-medium">{t.name}</span>
              <span className="w-28 font-mono text-[12px] text-subtle">{t.prefix}…</span>
              <span className={clsx("rounded-[5px] px-1.5 py-px text-[11px]", t.scope === "full" ? "bg-warn-soft text-warn" : "bg-field text-muted")}>{SCOPE_LABEL[t.scope]}</span>
              <span className="flex-1 truncate text-xs text-subtle">{t.revokedAt ? "已吊销" : expired ? "已过期" : t.expiresAt ? `${t.expiresAt.slice(0, 10)} 过期` : "永不过期"}{t.lastUsedAt ? ` · 最近使用 ${t.lastUsedAt.slice(0, 16).replace("T", " ")}` : " · 未使用"}</span>
              {!t.revokedAt && <Button variant="ghost" className="h-7 px-2 text-xs text-crit" onClick={() => revoke(t)}>吊销</Button>}
            </div>
          );
        }) : <Empty>还没有令牌</Empty>}
      </Card>
    </>
  );
}

// ---------------- 变更审批 ----------------
interface Plan { id: string; createdAt: string; actor: string; summary: string; status: string; ops: { op: string; id: string; name: string; type: Asset["type"]; changes: { field: string; before: unknown; after: unknown }[] }[] }
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Plans() {
  const { toast, reload, demo } = useData();
  const [list, setList] = useState<Plan[]>([]);
  const load = useCallback(async () => { if (!demo) setList((await get<{ changesets: Plan[] }>("/api/changesets")).changesets); }, [demo]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const decide = async (p: Plan, ok: boolean) => {
    try { await post(`/api/changesets/${p.id}/${ok ? "approve" : "reject"}`); toast(ok ? "已批准并写入" : "已驳回"); await reload(); }
    catch (e) { toast((e as Error).message, "err"); }
    load();
  };
  const pending = list.filter((p) => p.status === "pending");
  return (
    <>
      <Title sub="「可写」令牌提交的改动会停在这里，批准后才写入；冲突的计划不会覆盖你之后的修改。">变更审批</Title>
      {demoOnly(demo)}
      {!pending.length && <Card><p className="text-[13px] text-subtle">没有待审批的计划。</p></Card>}
      {pending.map((p) => (
        <Card key={p.id} title={p.summary} extra={<span>{p.actor} · {new Date(p.createdAt).toLocaleString()}</span>}>
          <div className="flex flex-col gap-3">
            {p.ops.map((o, i) => (
              <div key={i} className="rounded-sm border border-line">
                <div className="flex h-10 items-center gap-2.5 border-b border-line px-3 text-[13px]">
                  <TypeIcon type={o.type} size="sm" /><span className="font-medium">{o.name}</span>
                  <span className={clsx("rounded-[5px] px-1.5 py-px text-[11px]", o.op === "put" && !o.changes.some((c) => c.field === "id") ? "bg-field text-muted" : "bg-warn-soft text-warn")}>
                    {o.op === "delete" ? "删除到回收站" : o.op === "purge" ? "永久删除" : o.changes.some((c) => c.field === "id") ? "新建" : "修改"}
                  </span>
                </div>
                {o.changes.filter((c) => c.field !== "id").slice(0, 12).map((c) => (
                  <div key={c.field} className="grid grid-cols-[120px_1fr_1fr] gap-3 border-b border-line px-3 py-1.5 text-xs last:border-0">
                    <span className="font-mono text-subtle">{c.field}</span>
                    <span className="truncate text-crit line-through decoration-crit/40" title={show(c.before)}>{show(c.before)}</span>
                    <span className="truncate text-ok" title={show(c.after)}>{show(c.after)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex justify-end gap-2"><Button icon={<X size={14} />} onClick={() => decide(p, false)}>驳回</Button><Button variant="primary" icon={<Check size={14} />} onClick={() => decide(p, true)}>批准</Button></div>
          </div>
        </Card>
      ))}
      {list.some((p) => p.status !== "pending") && (
        <Card title="历史" flush scroll className="max-h-[360px]">
          {list.filter((p) => p.status !== "pending").map((p) => (
            <div key={p.id} className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0">
              <span className={clsx("w-14 text-xs", p.status === "applied" ? "text-ok" : p.status === "conflict" ? "text-warn" : "text-subtle")}>{{ applied: "已批准", rejected: "已驳回", conflict: "冲突" }[p.status] ?? p.status}</span>
              <span className="flex-1 truncate">{p.summary}</span><span className="text-xs text-subtle">{p.actor}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

// ---------------- 操作日志 ----------------
interface Entry { id: number; at: string; actor: string; action: string; assetId: string | null; summary: string; undoneBy: number | null; changes?: string[] }
function Log() {
  const { toast, reload, demo } = useData();
  const [list, setList] = useState<Entry[]>([]);
  const load = useCallback(async () => { if (!demo) setList((await get<{ entries: Entry[] }>("/api/audit?limit=200")).entries); }, [demo]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const undo = async (e: Entry) => {
    try { await post(`/api/audit/${e.id}/undo`); toast("已撤销"); await reload(); } catch (err) { toast((err as Error).message, "err"); }
    load();
  };
  return (
    <>
      <Title sub="所有写入都会记在这里（包括 CLI、AI 代理和 Komari 同步），可以逐条撤销。">操作日志</Title>
      {demoOnly(demo)}
      <Card flush>
        {list.length ? list.map((e) => (
          <div key={e.id} className={clsx("flex min-h-11 items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0", e.undoneBy && "opacity-55")}>
            <span className="w-12 text-xs text-subtle tnum">#{e.id}</span>
            <span className="w-32 text-xs text-subtle tnum">{new Date(e.at).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="w-32 truncate text-xs text-muted">{e.actor}</span>
            <span className="flex-1 truncate">{e.summary}{e.undoneBy ? <span className="text-xs text-subtle">（已被 #{e.undoneBy} 撤销）</span> : null}</span>
            {e.assetId && !e.undoneBy && <button onClick={() => undo(e)} title="撤销" className="flex items-center gap-1 text-xs text-subtle hover:text-ink"><Undo2 size={13} />撤销</button>}
          </div>
        )) : <Empty>还没有记录</Empty>}
      </Card>
    </>
  );
}

// ---------------- 回收站 ----------------
function Trash() {
  const { toast, reload, demo } = useData();
  const [list, setList] = useState<Asset[]>([]);
  const load = useCallback(async () => { if (!demo) setList((await get<{ assets: Asset[] }>("/api/assets?deleted=1")).assets); }, [demo]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const restore = async (a: Asset) => { try { await post(`/api/assets/${a.id}/restore`); toast(`已恢复「${a.name}」`); await reload(); } catch (e) { toast((e as Error).message, "err"); } load(); };
  const purge = async (a: Asset) => {
    if (!confirm(`永久删除「${a.name}」？操作日志里仍可撤销。`)) return;
    try { await api("DELETE", `/api/trash/${a.id}`); } catch (e) { toast((e as Error).message, "err"); }
    load();
  };
  const left = (a: Asset) => Math.max(0, 30 - Math.floor((Date.now() - Date.parse(a.deletedAt!)) / 86_400_000));
  return (
    <>
      <Title sub="删除的资产在这里保留 30 天，之后自动永久删除。">回收站</Title>
      {demoOnly(demo)}
      <Card flush>
        {list.length ? list.map((a) => (
          <div key={a.id} className="flex h-12 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0">
            <TypeIcon type={a.type} size="sm" />
            <span className="flex-1 truncate font-medium">{a.name}<span className="ml-2 text-xs font-normal text-subtle">{TYPE_LABEL[a.type]}</span></span>
            <span className="text-xs text-subtle">{left(a)} 天后永久删除</span>
            <Button variant="ghost" className="h-7 px-2 text-xs" icon={<RotateCcw size={13} />} onClick={() => restore(a)}>恢复</Button>
            <button onClick={() => purge(a)} className="text-subtle hover:text-crit" title="永久删除"><Trash2 size={14} /></button>
          </div>
        )) : <Empty>回收站是空的</Empty>}
      </Card>
    </>
  );
}

// ---------------- 备份与导出 ----------------
interface Preview { manifest: { createdAt: string; schemaVersion: number; appVersion: string; counts: { assets: number; audit: number; attachments: number } }; preview: { added: { id: string; name: string }[]; conflicts: { id: string; name: string; fields: string[]; incomingNewer: boolean }[]; same: number; missing: { id: string; name: string }[] } }
interface BStatus { dir: string; lastOk: string | null; lastError: string | null; files: { name: string; size: number; at: string; kind: string }[] }

function Backup() {
  const { settings, saveSettings, toast, reload, demo, me } = useData();
  const [st, setSt] = useState<BStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [keep, setKeep] = useState(String(settings.backup.keep));
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { if (!demo) setSt(await get<BStatus>("/api/backup/status")); }, [demo]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const guard = (fn: () => Promise<unknown>) => async () => { if (demo) return toast("演示模式不支持"); try { await fn(); } catch (e) { toast((e as Error).message, "err"); } };
  const choose = async (f: File) => {
    setFile(f); setPv(null);
    try { setPv(await api<Preview>("POST", "/api/backup/preview", f)); } catch (e) { toast((e as Error).message, "err"); setFile(null); }
  };
  const restore = guard(async () => {
    if (!file) return;
    if (mode === "replace" && !confirm("整库替换会用备份覆盖当前全部数据（替换前会自动快照一份）。继续？")) return;
    const r = await api<{ applied: number; snapshot: string | null }>("POST", `/api/backup/restore?mode=${mode}`, file);
    toast(`${mode === "replace" ? "整库替换" : "合并"}完成：${r.applied} 项${r.snapshot ? `，替换前快照 ${r.snapshot}` : ""}`);
    setFile(null); setPv(null); await reload(); load();
  });

  return (
    <>
      <Title sub={`完整备份是 .fangcun 文件（zip：manifest、数据、附件、操作日志，带校验和）。${me?.totpEnabled ? "网页端每次操作前需要输入动态码。" : "建议先开启两步验证。"}`}>备份与导出</Title>
      {demoOnly(demo)}
      <Card title="完整备份">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Download size={14} />} onClick={guard(() => download("/api/backup/download", `fangcun-${new Date().toISOString().slice(0, 10)}.fangcun`))}>下载完整备份</Button>
          <Button icon={<Upload size={14} />} onClick={() => input.current?.click()} disabled={demo}>从备份恢复…</Button>
          <input ref={input} type="file" accept=".fangcun,.zip" hidden onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
        </div>
        {file && pv && (
          <div className="mt-4 rounded-sm border border-line">
            <div className="border-b border-line px-4 py-2.5 text-[13px]">
              <b>{file.name}</b><span className="ml-2 text-xs text-subtle">{new Date(pv.manifest.createdAt).toLocaleString()} · schema {pv.manifest.schemaVersion} · {pv.manifest.counts.assets} 项 · {pv.manifest.counts.attachments} 个附件 · 校验通过</span>
            </div>
            <div className="grid grid-cols-4 divide-x divide-line border-b border-line text-center">
              {[["新增", pv.preview.added.length], ["冲突", pv.preview.conflicts.length], ["相同", pv.preview.same], ["仅当前库有", pv.preview.missing.length]].map(([l, n]) => (
                <div key={l as string} className="py-2.5"><div className="text-[20px] font-bold tnum">{n}</div><div className="text-xs text-subtle">{l}</div></div>
              ))}
            </div>
            {pv.preview.conflicts.length > 0 && (
              <div className="max-h-40 overflow-y-auto border-b border-line px-4 py-2 text-xs">
                {pv.preview.conflicts.map((c) => <div key={c.id} className="py-0.5"><b>{c.name}</b> <span className="text-subtle">{c.fields.join("、")}{c.incomingNewer ? " · 备份较新" : " · 当前较新"}</span></div>)}
              </div>
            )}
            <div className="flex items-center gap-4 px-4 py-3 text-[13px]">
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />合并（新增 + 冲突取较新的一方）</label>
              <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />整库替换（先自动快照）</label>
              <div className="flex-1" />
              <Button onClick={() => { setFile(null); setPv(null); }}>取消</Button>
              <Button variant="primary" onClick={restore}>开始恢复</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="可读导出" extra="不含任何密码">
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download size={14} />} onClick={guard(() => download("/api/export/json", "fangcun.json"))}>JSON</Button>
          <Button icon={<Download size={14} />} onClick={guard(() => download("/api/export/csv", "fangcun-csv.zip"))}>CSV（按类型分表）</Button>
          <Button icon={<Download size={14} />} onClick={guard(() => download("/api/export/ics", "fangcun-renewals.ics"))}>续费日历 ICS</Button>
        </div>
      </Card>

      <Card title="自动备份" extra={st?.lastError ? <span className="text-crit">上次失败</span> : st?.lastOk ? `上次 ${new Date(st.lastOk).toLocaleString()}` : undefined}>
        <div className="flex items-end gap-3">
          <Field label="保留最近" hint="份"><TextInput value={keep} onChange={setKeep} inputMode="numeric" className="w-24" /></Field>
          <Button onClick={guard(() => saveSettings({ ...settings, backup: { ...settings.backup, keep: Number(keep) || 30 } }))} disabled={Number(keep) === settings.backup.keep}>保存</Button>
          <span className="pb-2 text-xs text-subtle">每天 {settings.backup.hour}:00 后自动备份一次到服务端目录 <code className="font-mono">{st?.dir ?? "/data/backups"}</code></span>
          <div className="flex-1" />
          <Button onClick={guard(async () => { const r = await post<{ name: string }>("/api/backup/run"); toast(`已生成 ${r.name}`); load(); })}>立即备份</Button>
        </div>
        {st?.lastError && <p className="mt-3 rounded-sm bg-crit-soft px-3 py-2 text-xs text-crit">{st.lastError}</p>}
        {st && st.files.length > 0 && (
          <div className="mt-4 max-h-60 overflow-y-auto rounded-sm border border-line">
            {st.files.map((f) => (
              <div key={f.name} className="flex h-9 items-center gap-3 border-b border-line px-3 text-[12.5px] last:border-0">
                <span className="flex-1 truncate font-mono">{f.name}</span>
                <span className="text-xs text-subtle tnum">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={guard(() => download(`/api/backup/files/${f.name}`, f.name))} className="text-subtle hover:text-ink"><Download size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function About() {
  const [h, setH] = useState<{ version: string } | null>(null);
  useEffect(() => { get<{ version: string }>("/api/health").then(setH).catch(() => {}); }, []);
  return (
    <>
      <Title>关于方寸</Title>
      <Card>
        <p className="text-[13px] leading-relaxed text-muted">方寸是个人资产台账：服务器、域名、证书、订阅、邮箱、号码、支付卡、账号和文档的到期与费用，一处管理。只读接入 Komari 探针、Atoll 面板和 Cloudflare，不做任何远程操作。</p>
        <div className="mt-3 text-xs text-subtle">版本 {h?.version ?? "0.1.0"} · MIT License</div>
        <div className="mt-3 text-xs text-subtle">路线图：v0.2 端到端加密密码保险库 · 桌面版 · 手机 App · AI 额度插件</div>
      </Card>
    </>
  );
}
