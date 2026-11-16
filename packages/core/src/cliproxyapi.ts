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
    id, provider, email: s(raw.email)?.toLowerCase(), label: s(raw.label, 120), note: s(raw.note), plan: s(raw.plan, 40),
    status: s(raw.status, 20) ?? "error", message: s(raw.message), windows, observedAt: s(raw.observedAt, 40), connectionId, connectionName,
  };
}

export const WINDOW_LABEL: Record<string, string> = { "5h": "5 小时", day: "每天", week: "每周", month: "每月" };
export const windowLabel = (w: QuotaWindow) => `${w.group ? `${w.group} · ` : ""}${WINDOW_LABEL[w.window] ?? w.window}`;
export const PROVIDER_LABEL: Record<string, string> = { codex: "Codex", antigravity: "Antigravity" };
export const QUOTA_STATUS_LABEL: Record<string, string> = { ok: "可用", limited: "已用完", cooling: "冷却中", disabled: "已停用", expired: "凭证失效", error: "读取失败" };

/** Manual binding stored on a subscription asset: an account by provider + email, optionally to one team member. */
export interface QuotaBind { provider: string; email: string; member?: string }

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Emails an asset stands for: team owner and members, the linked login account, and 详细信息 rows holding an email. */
export function assetEmails(a: Asset, all: Asset[] = []): string[] {
  const out = new Set<string>();
  const add = (v?: string | null) => { const e = (v ?? "").trim().toLowerCase(); if (isEmail(e)) out.add(e); };
  add(a.team?.owner);
  for (const w of a.team?.workspaces ?? []) for (const m of w.members) add(m.email);
  if (a.accountId) add(all.find((x) => x.id === a.accountId)?.account?.username);
  for (const d of a.details) add(d.value);
  if (a.type === "account") add(a.account?.username);
  if (a.type === "mail") add(a.name);
  return [...out];
}

/** Accounts linked to an asset: by email automatically, plus the manual binds. */
export function quotaForAsset(a: Asset, accounts: QuotaAccount[], all: Asset[] = []): QuotaAccount[] {
  if (a.type !== "subscription" && a.type !== "account" && a.type !== "mail") return [];
  const emails = new Set(assetEmails(a, all));
  const binds = (a.quotaBinds ?? []).map((b) => `${b.provider}|${b.email.toLowerCase()}`);
  return accounts.filter((x) => (x.email && emails.has(x.email)) || binds.includes(`${x.provider}|${x.email ?? ""}`));
}

/** Per team-member email: the accounts for that member (auto by email, or bound with `member`). */
export function quotaForMembers(a: Asset, accounts: QuotaAccount[]): Map<string, QuotaAccount[]> {
  const out = new Map<string, QuotaAccount[]>();
  for (const w of a.team?.workspaces ?? []) for (const m of w.members) {
    const e = m.email.toLowerCase();
    const bound = (a.quotaBinds ?? []).filter((b) => b.member?.toLowerCase() === e).map((b) => `${b.provider}|${b.email.toLowerCase()}`);
    const hit = accounts.filter((x) => x.email === e || bound.includes(`${x.provider}|${x.email ?? ""}`));
    if (hit.length) out.set(e, hit);
  }
  return out;
}

export function normalizeQuotaBinds(v: unknown): QuotaBind[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: QuotaBind[] = [];
  for (const b of v.slice(0, 50)) {
    const provider = String(b?.provider ?? "").trim().toLowerCase().slice(0, 40);
    const email = String(b?.email ?? "").trim().toLowerCase().slice(0, 200);
    if (!provider || !email) continue;
    const member = String(b?.member ?? "").trim().toLowerCase().slice(0, 200);
    out.push({ provider, email, ...(member ? { member } : {}) });
  }
  return out.length ? out : undefined;
}
