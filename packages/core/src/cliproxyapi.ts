/**
 * CLIProxyAPI (read-only): the 方寸 plugin inside a CLIProxyAPI instance serves a quota feed behind a feed token
 * of its own. The user copies a connection string from the plugin's panel and pastes it into 方寸; one 方寸 can
 * hold several connections (one per CLIProxyAPI instance), each with its own name and note.
 */
import type { Asset } from "./types";

export const CLIPROXYAPI_PREFIX = "fangcun-cliproxyapi:";

export interface CliproxyConnectionParts { url: string; feedPath: string; token: string }

/** Parse a pasted connection string. Throws with a short reason; never echoes the token. */
export function parseConnectionString(raw: string): CliproxyConnectionParts {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s.startsWith(CLIPROXYAPI_PREFIX)) throw new Error("不是方寸插件的连接串（应以 fangcun-cliproxyapi: 开头）");
  let doc: { v?: number; u?: string; p?: string; t?: string };
  try {
    const b64 = s.slice(CLIPROXYAPI_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    doc = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { throw new Error("连接串不完整，请重新复制"); }
  if (doc.v !== 1) throw new Error("连接串版本不受支持，请升级方寸");
  const url = String(doc.u ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(url)) throw new Error("连接串里的地址无效");
  const feedPath = String(doc.p ?? "/v0/resource/plugins/fangcun/feed").trim();
  if (!/^\/v0\/resource\/plugins\/[A-Za-z0-9._-]+\/feed$/.test(feedPath)) throw new Error("连接串里的接口路径无效");
  const token = String(doc.t ?? "").trim();
  if (!/^fcq_[A-Za-z0-9_-]{40,}$/.test(token)) throw new Error("连接串里的令牌无效");
  return { url, feedPath, token };
}

/** Build one (tests, demo). */
export function buildConnectionString(p: CliproxyConnectionParts): string {
  const json = JSON.stringify({ v: 1, u: p.url, p: p.feedPath, t: p.token });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return CLIPROXYAPI_PREFIX + b64;
}

export interface QuotaWindow { key: string; group?: string; window: string; usedPct: number; resetAt?: string }
export type QuotaStatus = "ok" | "limited" | "cooling" | "disabled" | "expired" | "error";
/** One account as the feed gives it, plus which connection (by the user's name) it came from. No secrets. */
export interface QuotaAccount {
  id: string; provider: string; email?: string; label?: string; note?: string; plan?: string;
  status: QuotaStatus | string; message?: string; windows: QuotaWindow[]; observedAt?: string;
  connectionId: string; connectionName: string;
}

/** The feed's email, normalised; when the feed has none, an email found in its label. */
function feedEmail(raw: Record<string, unknown>): string | undefined {
  const e = typeof raw.email === "string" ? normEmail(raw.email).slice(0, 200) : "";
  if (e) return e;
  return emailsIn(typeof raw.label === "string" ? raw.label : "")[0];
}

/** Keep only the known, non-secret fields of a feed account. */
export function pickQuotaAccount(raw: Record<string, unknown>, connectionId: string, connectionName: string): QuotaAccount | null {
  const s = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);
  const id = s(raw.id, 100);
  const provider = s(raw.provider, 40)?.toLowerCase();
  if (!id || !provider) return null;
  const windows = (Array.isArray(raw.windows) ? raw.windows : []).slice(0, 40).map((w: Record<string, unknown>) => ({
    key: s(w?.key, 120) ?? "", ...(s(w?.group, 60) ? { group: s(w.group, 60) } : {}), window: s(w?.window, 40) ?? "",
    usedPct: Math.max(0, Math.min(100, Number(w?.usedPct) || 0)), ...(s(w?.resetAt, 40) ? { resetAt: s(w.resetAt, 40) } : {}),
  })).filter((w) => w.key);
  return {
    id, provider, email: feedEmail(raw), label: s(raw.label, 120), note: s(raw.note), plan: s(raw.plan, 40),
    status: s(raw.status, 20) ?? "error", message: s(raw.message), windows, observedAt: s(raw.observedAt, 40), connectionId, connectionName,
  };
}

export const WINDOW_LABEL: Record<string, string> = { "5h": "5 小时", day: "每天", week: "每周", month: "每月" };
export const windowLabel = (w: QuotaWindow) => `${w.group ? `${w.group} · ` : ""}${WINDOW_LABEL[w.window] ?? w.window}`;
export const PROVIDER_LABEL: Record<string, string> = { codex: "Codex", antigravity: "Antigravity" };
export const QUOTA_STATUS_LABEL: Record<string, string> = { ok: "可用", limited: "已用完", cooling: "冷却中", disabled: "已停用", expired: "凭证失效", error: "读取失败" };

/** Manual binding stored on a subscription asset (v0.1.9): an account by provider + email, optionally to one team member. */
export interface QuotaBind { provider: string; email: string; member?: string }

/**
 * 方寸's own settings for one CLIProxyAPI account (never written back to CLIProxyAPI): 关注, and a manual bind to an
 * asset (optionally one team member). Keyed by connection + the feed's account id; provider and email are kept so the
 * setting survives an id change, and connectionName lets a backup find the connection again on another install.
 */
export interface CpaPref {
  connectionId: string; accountId: string; provider: string; email?: string;
  starred: boolean; assetId?: string | null; member?: string | null; connectionName?: string;
}

/** Linkable asset types: the ones that stand for a login. */
export const QUOTA_ASSET_TYPES = ["subscription", "account", "mail"] as const;
const linkable = (a: Asset) => (QUOTA_ASSET_TYPES as readonly string[]).includes(a.type) && !a.deletedAt;

/** One email, normalised: full-width forms folded (NFKC), every space / zero-width char dropped, mailto: cut, lower case. */
export const normEmail = (v: unknown): string =>
  String(v ?? "").normalize("NFKC").replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, "").replace(/^mailto:/i, "").toLowerCase();

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** Every email inside a free text ("主号 a@b.com（Team）", "a@b.com / c@d.com"). */
export function emailsIn(v: unknown): string[] {
  const s = String(v ?? "").normalize("NFKC").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
  return [...s.matchAll(EMAIL_RE)].map((m) => normEmail(m[0]));
}

export const accountKey = (a: { connectionId: string; id: string }) => `${a.connectionId}/${a.id}`;

/** The pref for an account: by id, else by provider + email in the same connection when exactly one pref fits. */
export function prefFor(acc: QuotaAccount, prefs: CpaPref[] = []): CpaPref | undefined {
  const exact = prefs.find((p) => p.connectionId === acc.connectionId && p.accountId === acc.id);
  if (exact || !acc.email) return exact;
  const e = normEmail(acc.email);
  const loose = prefs.filter((p) => p.connectionId === acc.connectionId && p.provider === acc.provider && p.email && normEmail(p.email) === e);
  return loose.length === 1 ? loose[0] : undefined;
}

/** Emails an asset stands for by itself: name, subtitle, login username, 详细信息, team owner and members. */
function ownEmails(a: Asset): Set<string> {
  const out = new Set<string>();
  const add = (v?: string | null) => { for (const e of emailsIn(v)) out.add(e); };
  add(a.name); add(a.subtitle); add(a.account?.username);
  for (const d of a.details) add(d.value);
  add(a.team?.owner);
  for (const w of a.team?.workspaces ?? []) for (const m of w.members) add(m.email);
  return out;
}

/** Emails an asset stands for: its own, plus those of the login account (accountId) and related account / mail assets. */
export function assetEmails(a: Asset, all: Asset[] = []): string[] {
  const out = ownEmails(a);
  const linked = new Set([a.accountId, ...a.related].filter(Boolean) as string[]);
  for (const x of all) if (x.id !== a.id && linked.has(x.id) && (x.type === "account" || x.type === "mail") && !x.deletedAt) for (const e of ownEmails(x)) out.add(e);
  return [...out];
}

const memberEmails = (a: Asset) => new Set((a.team?.workspaces ?? []).flatMap((w) => w.members.map((m) => normEmail(m.email))));

/** Per asset list: each linkable asset's emails and team-member emails, computed once. */
const indexCache = new WeakMap<Asset[], Map<string, { own: Set<string>; emails: Set<string>; members: Set<string> }>>();
function emailIndex(assets: Asset[]) {
  let idx = indexCache.get(assets);
  if (!idx) {
    idx = new Map();
    for (const a of assets) if (linkable(a)) idx.set(a.id, { own: ownEmails(a), emails: new Set(assetEmails(a, assets)), members: memberEmails(a) });
    indexCache.set(assets, idx);
  }
  return idx;
}

/**
 * How an account reaches an asset: bound by hand, a team member's email, an email of the asset itself, or the email of
 * the asset's login account (accountId / a related account or mail asset).
 */
export interface QuotaLink { assetId: string; member?: string; via: "bind" | "member" | "email" | "login" }

/** Every asset one account links to: manual binds first, then team seats, the asset's own emails, its login's emails. */
export function linksForAccount(acc: QuotaAccount, assets: Asset[], prefs: CpaPref[] = []): QuotaLink[] {
  const out: QuotaLink[] = [];
  const seen = new Set<string>();
  const push = (l: QuotaLink) => { if (!seen.has(l.assetId)) { seen.add(l.assetId); out.push(l); } };
  const p = prefFor(acc, prefs);
  if (p?.assetId && assets.some((x) => x.id === p.assetId && linkable(x))) push({ assetId: p.assetId, ...(p.member ? { member: p.member } : {}), via: "bind" });
  const e = acc.email ? normEmail(acc.email) : "";
  const idx = emailIndex(assets);
  const later: QuotaLink[] = [];
  for (const a of assets) {
    if (!linkable(a)) continue;
    const legacy = (a.quotaBinds ?? []).find((b) => b.provider === acc.provider && normEmail(b.email) === e);
    if (e && legacy) { push({ assetId: a.id, ...(legacy.member ? { member: legacy.member } : {}), via: "bind" }); continue; }
    if (!e) continue;
    const ix = idx.get(a.id);
    if (ix?.members.has(e)) { push({ assetId: a.id, member: e, via: "member" }); continue; }
    if (ix?.own.has(e)) push({ assetId: a.id, via: "email" });
    else if (ix?.emails.has(e)) later.push({ assetId: a.id, via: "login" });
  }
  for (const l of later) push(l);
  return out;
}

/** Accounts linked to an asset: by email automatically, plus the manual binds. */
export function quotaForAsset(a: Asset, accounts: QuotaAccount[], all: Asset[] = [], prefs: CpaPref[] = []): QuotaAccount[] {
  if (!linkable(a)) return [];
  const pool = all.some((x) => x.id === a.id) ? all : [...all, a];
  return accounts.filter((x) => linksForAccount(x, pool, prefs).some((l) => l.assetId === a.id));
}

/** Per team-member email (normalised): the accounts for that member, by email or bound to that member. */
export function quotaForMembers(a: Asset, accounts: QuotaAccount[], prefs: CpaPref[] = []): Map<string, QuotaAccount[]> {
  const out = new Map<string, QuotaAccount[]>();
  for (const w of a.team?.workspaces ?? []) for (const m of w.members) {
    const e = normEmail(m.email);
    const hit = accounts.filter((x) => {
      const p = prefFor(x, prefs);
      if (p?.assetId === a.id && p.member) return normEmail(p.member) === e;
      if ((a.quotaBinds ?? []).some((b) => b.member && normEmail(b.member) === e && b.provider === x.provider && normEmail(b.email) === normEmail(x.email))) return true;
      return Boolean(x.email) && normEmail(x.email) === e;
    });
    if (hit.length) out.set(e, hit);
  }
  return out;
}

/** Validate prefs from a backup or an API body. Only rows that carry something (关注 or a bind) are kept. */
export function normalizeCpaPrefs(v: unknown): CpaPref[] {
  if (!Array.isArray(v)) return [];
  const s = (x: unknown, n: number) => String(x ?? "").trim().slice(0, n);
  const out: CpaPref[] = [];
  for (const r of v.slice(0, 5000)) {
    const connectionId = s(r?.connectionId, 100), accountId = s(r?.accountId, 100), provider = s(r?.provider, 40).toLowerCase();
    if (!connectionId || !accountId) continue;
    const assetId = s(r?.assetId, 64) || null;
    const member = assetId ? normEmail(r?.member).slice(0, 200) || null : null;
    const starred = Boolean(r?.starred);
    if (!starred && !assetId) continue;
    const email = normEmail(r?.email).slice(0, 200);
    const connectionName = s(r?.connectionName, 60);
    out.push({ connectionId, accountId, provider, ...(email ? { email } : {}), starred, assetId, member, ...(connectionName ? { connectionName } : {}) });
  }
  return out;
}

export function normalizeQuotaBinds(v: unknown): QuotaBind[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: QuotaBind[] = [];
  for (const b of v.slice(0, 50)) {
    const provider = String(b?.provider ?? "").trim().toLowerCase().slice(0, 40);
    const email = normEmail(b?.email).slice(0, 200);
    if (!provider || !email) continue;
    const member = normEmail(b?.member).slice(0, 200);
    out.push({ provider, email, ...(member ? { member } : {}) });
  }
  return out.length ? out : undefined;
}
