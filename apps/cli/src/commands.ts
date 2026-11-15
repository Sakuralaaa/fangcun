import {
  CARD_STATUS_LABEL, compareAssets, CYCLES, daysUntil, dueLabel, money, perCycle, todayIso, TYPE_LABEL,
  type Asset, type AssetType, type Cycle,
} from "@fangcun/core";
import { enc, type Client } from "./client";

/** Shared operations used by both the CLI and the MCP server. Return plain JSON. */
export const ops = {
  async list(c: Client, f: { type?: string; tag?: string; q?: string; due?: number; deleted?: boolean; starred?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (f.type) qs.set("type", f.type);
    if (f.starred) qs.set("starred", "1");
    if (f.tag) qs.set("tag", f.tag);
    if (f.q) qs.set("q", f.q);
    if (f.deleted) qs.set("deleted", "1");
    const r = await c.get(`/api/assets?${qs}`);
    let assets: Asset[] = r.assets;
    if (f.due !== undefined) assets = assets.filter((a) => daysUntil(a.expiresAt, r.today) <= f.due!);
    return assets.sort((a, b) => compareAssets(a, b, r.today));
  },
  /** 关注 / 置顶. 取消关注 also 取消置顶; 置顶 also 关注 (the server keeps them consistent). */
  focus: (c: Client, id: string, f: { starred?: boolean; pinned?: boolean }) => c.post(`/api/assets/${enc(id)}/focus`, f),
  show: async (c: Client, id: string) => (await c.get(`/api/assets/${enc(id)}`)).asset as Asset,
  create: (c: Client, input: Partial<Asset>) => c.post("/api/assets", input),
  update: (c: Client, id: string, patch: Partial<Asset>) => c.patch(`/api/assets/${enc(id)}`, patch),
  remove: (c: Client, id: string) => c.del(`/api/assets/${enc(id)}`),
  tag: (c: Client, id: string, add: string[], remove: string[]) => c.post(`/api/assets/${enc(id)}/tags`, { add, remove }),
  link: (c: Client, id: string, to: string[], unlink = false) => c.post(`/api/assets/${enc(id)}/link`, { to, unlink }),
  renew: (c: Client, id: string, o: { amount?: number; note?: string } = {}) => c.post(`/api/assets/${enc(id)}/renew`, o),
  doctor: async (c: Client) => (await c.get("/api/doctor")).issues,
  log: async (c: Client, o: { assetId?: string; limit?: number } = {}) =>
    (await c.get(`/api/audit?limit=${o.limit ?? 30}${o.assetId ? `&assetId=${enc(o.assetId)}` : ""}`)).entries,
  undo: (c: Client, id: number) => c.post(`/api/audit/${id}/undo`),
  plans: async (c: Client) => (await c.get("/api/changesets?status=pending")).changesets,
  importText: (c: Client, text: string, kind: "csv" | "json") => c.request("POST", "/api/import", text, { contentType: kind === "csv" ? "text/csv" : "application/json" }),
};

// ---------- parsing helpers ----------
/** `key=value` pairs → asset patch. Dotted keys go into sub-objects (payment.last4=1234). */
export function parseSets(pairs: string[]): Partial<Asset> {
  const out: Record<string, any> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 1) throw new Error(`无法解析 ${p}，用 字段=值`);
    const key = p.slice(0, i).trim();
    const raw = p.slice(i + 1);
    const value = coerce(key, raw);
    const parts = key.split(".");
    let o = out;
    for (const k of parts.slice(0, -1)) o = o[k] ??= {};
    o[parts.at(-1)!] = value;
  }
  return out as Partial<Asset>;
}

function coerce(key: string, raw: string): unknown {
  const k = key.split(".").at(-1)!;
  if (["price", "seats", "trafficResetDay"].includes(k)) return Number(raw);
  if (["autoRenew", "hasTotp", "starred", "pinned"].includes(k)) return /^(1|true|yes|是|on)$/i.test(raw);
  if (["tags", "related"].includes(k)) return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (["expiresAt", "purchasedAt", "accountId"].includes(k) && (raw === "" || raw === "null")) return null;
  return raw;
}

const typeAlias: Record<string, AssetType> = { sub: "subscription", card: "payment", doc: "document", vps: "server" };
export const normType = (t?: string) => (t ? (typeAlias[t] ?? t) as AssetType : undefined);
export const isCycle = (c: string): c is Cycle => (CYCLES as readonly string[]).includes(c);

// ---------- human output ----------
const width = (s: string) => [...s].reduce((n, ch) => n + (/[\u1100-\uFFFF]/.test(ch) ? 2 : 1), 0);
const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - width(s)));
const trunc = (s: string, w: number) => {
  let out = "";
  for (const ch of s) { if (width(out + ch) > w - 1) return out + "…"; out += ch; }
  return out;
};

export function table(rows: string[][], header: string[]): string {
  const all = [header, ...rows];
  const ws = header.map((_, i) => Math.min(36, Math.max(...all.map((r) => width(r[i] ?? "")))));
  return all.map((r, j) => {
    const line = r.map((cell, i) => pad(trunc(cell ?? "", ws[i] + 1), ws[i])).join("  ").trimEnd();
    return j === 0 ? `\x1b[2m${line}\x1b[0m` : line;
  }).join("\n");
}

export function assetRows(assets: Asset[], today = todayIso()): string {
  if (!assets.length) return "（没有资产）";
  return table(assets.map((a) => [
    focusMark(a), a.id, TYPE_LABEL[a.type] ?? a.type, a.name, a.provider ?? "", perCycle(a),
    a.expiresAt ?? "—", dueLabel(a.expiresAt, today),
  ]), ["", "ID", "类型", "名称", "服务商", "费用", "到期", "剩余"]);
}

/** ★ = 关注, ★↑ = 置顶 (pinned implies starred). */
export const focusMark = (a: Pick<Asset, "starred" | "pinned">) => (a.pinned ? "★↑" : a.starred ? "★" : "");

export function assetDetail(a: Asset, today = todayIso()): string {
  const lines: [string, string][] = [
    ["ID", a.id], ["关注", a.pinned ? "已关注 · 置顶" : a.starred ? "已关注" : ""], ["类型", TYPE_LABEL[a.type]], ["名称", a.name], ["说明", a.subtitle ?? ""], ["服务商", a.provider ?? ""],
    ["费用", perCycle(a) + (a.region ? ` · ${a.region}` : "") + (a.discount ? ` · ${a.discount}` : "")],
    ["到期", a.expiresAt ? `${a.expiresAt}（${dueLabel(a.expiresAt, today)}）${a.autoRenew ? " · 自动续费" : ""}` : "长期"],
    ["购入", a.purchasedAt ?? ""], ["标签", a.tags.map((t) => `#${t}`).join(" ")], ["关联", a.related.join(", ")],
  ];
  if (a.payment) lines.push(["卡片", `${a.payment.issuer} · ${a.payment.network ?? ""} ···· ${a.payment.last4} · 有效期 ${a.payment.cardExpiry ?? "—"} · ${CARD_STATUS_LABEL[a.payment.status]}`], ["账单地区", a.payment.billingRegion ?? ""], ["手续费", a.payment.fees ?? ""]);
  if (a.phone) lines.push(["号码", [a.phone.number, a.phone.carrier, a.phone.country, a.phone.purpose].filter(Boolean).join(" · ")]);
  if (a.account) lines.push(["账号", `${a.account.username}${a.account.site ? ` @ ${a.account.site}` : ""}`]);
  if (a.komari) lines.push(["Komari", `${a.komari.uuid}${Object.keys(a.komari.overridden ?? {}).length ? ` · 已手动修改：${Object.keys(a.komari.overridden!).join("、")}` : ""}`]);
  for (const d of a.details) lines.push([d.label, d.value]);
  for (const w of a.team?.workspaces ?? []) lines.push([`空间 ${w.name}`, `${money(w.price, w.currency)} · ${w.members.length}/${w.seats} 席 · ${w.expiresAt ?? "—"} 到期`]);
  if (a.note) lines.push(["备注", a.note]);
  if (a.renewals.length) lines.push(["续费记录", a.renewals.slice(0, 5).map((r) => `${r.date} ${money(r.amount, r.currency ?? a.currency)} ${r.note}`).join("\n          ")]);
  return lines.filter(([, v]) => v).map(([k, v]) => `${pad(k, 8)}  ${v}`).join("\n");
}

/** Message for a write result: applied or parked as a plan. */
export function writeResult(r: any): string {
  if (r?.status === "pending") return `已生成变更计划 ${r.changeset.id}：${r.changeset.summary}\n在网页「设置 → 变更审批」里批准后才会落库。`;
  if (r?.status === "unchanged") return "没有变化";
  if (r?.status === "applied") return `已写入 ${r.assets.length} 项${r.auditIds?.length ? `（日志 #${r.auditIds.join(", #")}，可用 fangcun undo 撤销）` : ""}`;
  return JSON.stringify(r);
}
