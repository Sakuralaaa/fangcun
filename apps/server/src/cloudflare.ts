import {
  CF_SECTIONS, isWritePermission, pickCfAccount, pickCfBucket, pickCfPages, pickCfRecord, pickCfRegistration, pickCfTunnel, pickCfWorker, pickCfZone,
  tokenPermissionNames, tunnelHostnames, tunnelOriginIps,
  type CfAccount, type CfDnsRecord, type CfPagesProject, type CfR2Bucket, type CfRegistration, type CfSection, type CfSectionState, type CfSnapshot,
  type CfTunnel, type CfWorker, type CfZone,
} from "@fangcun/core";
import { HttpError, type Store } from "./store";

/**
 * Read-only Cloudflare client. Only GET requests to the paths below (under https://api.cloudflare.com/client/v4)
 * can leave this module, each with its own short list of query keys and value shapes. Anything else — another
 * method, another path, an unknown or repeated query key, an encoded or dotted segment, a fragment — throws
 * before a socket is opened. No write endpoint, no DNS edit, no cache purge, no token management is reachable.
 */
export const CF_API = "https://api.cloudflare.com/client/v4";

const HEX32 = "[0-9a-f]{32}";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE = /^[1-9]\d{0,3}$/;
const PER_PAGE = /^[1-9]\d{0,3}$/;
const CURSOR = /^[A-Za-z0-9_\-.=+/]{0,256}$/;
type Rule = { path: RegExp; query: Record<string, RegExp> };
const paged = { page: PAGE, per_page: PER_PAGE };
const ALLOWED: Rule[] = [
  { path: /^\/user\/tokens\/verify$/, query: {} },
  { path: new RegExp(`^/user/tokens/${HEX32}$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/tokens/verify$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/tokens/${HEX32}$`), query: {} },
  { path: /^\/accounts$/, query: paged },
  { path: /^\/zones$/, query: paged },
  { path: new RegExp(`^/zones/${HEX32}/dns_records$`), query: paged },
  { path: new RegExp(`^/accounts/${HEX32}/registrar/registrations$`), query: { cursor: CURSOR, per_page: PER_PAGE } },
  { path: new RegExp(`^/accounts/${HEX32}/registrar/domains$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/cfd_tunnel$`), query: { ...paged, is_deleted: /^false$/ } },
  { path: new RegExp(`^/accounts/${HEX32}/cfd_tunnel/${UUID}/configurations$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/cfd_tunnel/${UUID}/connections$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/workers/scripts$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/workers/domains$`), query: {} },
  { path: new RegExp(`^/accounts/${HEX32}/pages/projects$`), query: { page: PAGE } },
  { path: new RegExp(`^/accounts/${HEX32}/r2/buckets$`), query: { cursor: CURSOR, per_page: PER_PAGE } },
];

export function assertCloudflareAllowed(method: string, pathAndQuery: string): void {
  if (method !== "GET") throw new Error(`blocked Cloudflare request ${method} ${pathAndQuery}: only GET is allowed`);
  const bad = () => new Error(`blocked Cloudflare request GET ${pathAndQuery}: not on the read-only list`);
  if (/[#%\\\s]/.test(pathAndQuery)) throw bad();
  const parts = pathAndQuery.split("?");
  if (parts.length > 2) throw bad();
  const [path, qs] = parts;
  const rule = ALLOWED.find((r) => r.path.test(path));
  if (!rule) throw bad();
  if (qs === undefined) return;
  if (!qs) throw bad();
  const seen = new Set<string>();
  for (const pair of qs.split("&")) {
    const i = pair.indexOf("=");
    if (i <= 0) throw bad();
    const k = pair.slice(0, i);
    const v = pair.slice(i + 1);
    if (seen.has(k) || !Object.hasOwn(rule.query, k) || !rule.query[k].test(v)) throw bad();
    seen.add(k);
  }
}

/** A Cloudflare API failure: HTTP status plus the `errors[].code` values from the envelope. */
export class CfError extends Error {
  constructor(public status: number, public codes: number[], message: string) { super(message); }
  /** The token lacks the permission for this endpoint. */
  get unauthorized() { return this.status === 403 || this.codes.some((c) => c === 9109 || c === 10000 || c === 10001); }
  get missing() { return this.status === 404 || this.status === 405 || this.status === 410; }
}

export interface CfTokenCheck {
  /** user = /user/tokens/verify; account = account-owned token verified under CLOUDFLARE_ACCOUNT_ID. */
  kind: "user" | "account";
  status: string;
  expiresOn?: string | null;
  /** true = every permission is a Read one; false = it holds Edit/Write (refused); null = could not read its permissions. */
  readOnly: boolean | null;
  permissions?: string[];
  checkedAt: string;
}

export interface CfState { lastSync?: string; lastAttempt?: number; lastError?: string; token?: CfTokenCheck }

const META_SNAPSHOT = "cloudflare_snapshot";
const META_LAST_SYNC = "cloudflare_last_sync";
/** Background refresh at most every 10 minutes; a manual sync at most once a minute. */
export const CF_AUTO_INTERVAL_MS = 10 * 60_000;
export const CF_MANUAL_GAP_MS = 60_000;
const MAX_ZONES = 500;
const MAX_PAGES = 40;
const MAX_TUNNELS = 100;

type Envelope<T> = { success?: boolean; result?: T; result_info?: { page?: number; total_pages?: number; per_page?: number; count?: number; total_count?: number; cursor?: string }; errors?: { code?: number; message?: string }[] };

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export class CloudflareService {
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<CfSnapshot> | null = null;
  state: CfState = {};

  constructor(
    private store: Store,
    private token = process.env.CLOUDFLARE_API_TOKEN ?? "",
    private accountId = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim().toLowerCase(),
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get hasToken() { return Boolean(this.token); }
  get hasAccountId() { return Boolean(this.accountId); }

  /** The single exit point: GET only, whitelisted paths and query keys only. Never logs the token. */
  async get<T>(pathAndQuery: string): Promise<Envelope<T>> {
    assertCloudflareAllowed("GET", pathAndQuery);
    if (!this.token) throw new HttpError(400, "服务端没有设置环境变量 CLOUDFLARE_API_TOKEN");
    const res = await this.fetchImpl(CF_API + pathAndQuery, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    let body: Envelope<T> = {};
    try { body = (await res.json()) as Envelope<T>; } catch { /* not JSON */ }
    const codes = (body.errors ?? []).map((e) => Number(e.code)).filter((n) => Number.isFinite(n));
    if (!res.ok || body.success === false) {
      const msg = (body.errors ?? []).map((e) => String(e.message ?? "").slice(0, 160)).filter(Boolean).join("；");
      throw new CfError(res.status, codes, `Cloudflare 返回 ${res.status}${msg ? `：${msg}` : ""}（${pathAndQuery.split("?")[0]}）`);
    }
    return body;
  }

  /** Page-numbered lists (`page` / `per_page`, `result_info.total_pages`). */
  async pages<T>(path: string, perPage?: number, extra = ""): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = [`page=${page}`, ...(perPage ? [`per_page=${perPage}`] : []), ...(extra ? [extra] : [])].join("&");
      const r = await this.get<T[]>(`${path}?${q}`);
      const list = Array.isArray(r.result) ? r.result : [];
      out.push(...list);
      const ri = r.result_info ?? {};
      const total = ri.total_pages ?? (ri.total_count && ri.per_page ? Math.ceil(ri.total_count / ri.per_page) : undefined);
      if (total ? page >= total : !list.length || (perPage ? list.length < perPage : true)) break;
    }
    return out;
  }

  /** Cursor lists (`cursor` in result_info; empty = last page). `pick` takes the items out of `result`. */
  async cursors<T>(path: string, perPage: number, pick: (result: unknown) => T[]): Promise<T[]> {
    const out: T[] = [];
    let cursor = "";
    for (let i = 0; i < MAX_PAGES; i++) {
      const r = await this.get<unknown>(`${path}?${cursor ? `cursor=${cursor}&` : ""}per_page=${perPage}`);
      out.push(...pick(r.result));
      const next = r.result_info?.cursor ?? "";
      if (!next || next === cursor || !/^[A-Za-z0-9_\-.=+/]{1,256}$/.test(next)) break;
      cursor = next;
    }
    return out;
  }

  /** Verify the token, then read its permission groups when the token may read them. */
  async checkToken(): Promise<CfTokenCheck> {
    const checkedAt = new Date().toISOString();
    let kind: CfTokenCheck["kind"] = "user";
    let v: { id?: string; status?: string; expires_on?: string };
    try {
      v = (await this.get<typeof v>("/user/tokens/verify")).result ?? {};
    } catch (e) {
      if (!(e instanceof CfError) || !this.accountId) throw this.invalid(e);
      // Account-owned tokens (cfat_…) only verify under their account.
      try { v = (await this.get<typeof v>(`/accounts/${this.accountId}/tokens/verify`)).result ?? {}; kind = "account"; }
      catch (e2) { throw this.invalid(e2); }
    }
    if (v.status && v.status !== "active") throw new HttpError(400, `Cloudflare 令牌当前状态是 ${v.status}（不是 active），请在 Cloudflare 里检查或换一个令牌`);
    const check: CfTokenCheck = { kind, status: v.status ?? "active", expiresOn: v.expires_on ?? null, readOnly: null, checkedAt };
    const id = String(v.id ?? "").toLowerCase();
    if (/^[0-9a-f]{32}$/.test(id)) {
      try {
        const t = await this.get<unknown>(kind === "account" ? `/accounts/${this.accountId}/tokens/${id}` : `/user/tokens/${id}`);
        const names = tokenPermissionNames(t.result);
        if (names.length) { check.permissions = names; check.readOnly = !names.some(isWritePermission); }
      } catch { /* the token may not read itself (needs API Tokens Read): say so in settings */ }
    }
    this.state.token = check;
    return check;
  }

  private invalid(e: unknown): Error {
    if (e instanceof HttpError) return e;
    if (e instanceof CfError) return new HttpError(400, `Cloudflare 令牌无效、已过期或已吊销（${e.status}）。请检查 CLOUDFLARE_API_TOKEN${this.accountId ? "" : "；账户令牌（cfat_ 开头）还需要设置 CLOUDFLARE_ACCOUNT_ID"}`);
    return new HttpError(502, `连不上 Cloudflare：${(e as Error).message}`);
  }

  snapshot(): CfSnapshot | null {
    const raw = this.store.meta(META_SNAPSHOT);
    if (!raw) return null;
    try { return JSON.parse(raw) as CfSnapshot; } catch { return null; }
  }
  lastSync(): string | null { return this.state.lastSync ?? this.store.meta(META_LAST_SYNC) ?? null; }

  /** Pull everything once. Only the snapshot is stored (meta table); assets are never touched. */
  async sync(opts: { manual?: boolean } = {}): Promise<CfSnapshot> {
    if (this.inflight) return this.inflight;
    const since = Date.now() - (this.state.lastAttempt ?? 0);
    if (opts.manual && since < CF_MANUAL_GAP_MS) throw new HttpError(429, `刚同步过，请 ${Math.ceil((CF_MANUAL_GAP_MS - since) / 1000)} 秒后再试`);
    this.state.lastAttempt = Date.now();
    this.inflight = (async () => {
      try {
        const tok = await this.checkToken();
        if (tok.readOnly === false) {
          const w = (tok.permissions ?? []).filter(isWritePermission);
          throw new HttpError(400, `这个 Cloudflare 令牌不是只读的（含 ${w.join("、")}）。方寸拒绝使用它，请另建一个只勾「Read」权限的令牌，替换 CLOUDFLARE_API_TOKEN 后重启方寸。`);
        }
        const snap = await this.pull();
        this.store.setMeta(META_SNAPSHOT, JSON.stringify(snap));
        this.store.setMeta(META_LAST_SYNC, snap.syncedAt);
        this.state.lastSync = snap.syncedAt;
        this.state.lastError = undefined;
        return snap;
      } catch (e) {
        this.state.lastError = (e as Error).message;
        throw e;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private async pull(): Promise<CfSnapshot> {
    const sections = Object.fromEntries(CF_SECTIONS.map((k) => [k, { state: "skipped" } as CfSectionState])) as Record<CfSection, CfSectionState>;
    const fail = (e: unknown): CfSectionState => (e instanceof CfError && e.unauthorized ? { state: "unauthorized", message: "令牌没有这项读取权限" } : { state: "error", message: (e as Error).message.slice(0, 200) });
    /** Fold per-account outcomes into one section state. */
    const fold = (key: CfSection, results: CfSectionState[]) => {
      if (!results.length) return;
      const ok = results.filter((r) => r.state === "ok").length;
      if (ok === results.length) sections[key] = { state: "ok" };
      else if (ok) sections[key] = { state: "ok", message: `${results.length - ok}/${results.length} 个账户读取失败` };
      else sections[key] = results.find((r) => r.state === "unauthorized") ?? results[0];
    };

    // accounts
    let accounts: CfAccount[] = [];
    try {
      accounts = (await this.pages<Record<string, unknown>>("/accounts", 50)).map(pickCfAccount).filter((a) => a.id);
      sections.accounts = { state: "ok" };
    } catch (e) { sections.accounts = fail(e); }

    // zones (also tell which accounts exist when /accounts is not readable)
    let zones: CfZone[] = [];
    try {
      zones = (await this.pages<Record<string, unknown>>("/zones", 50)).map(pickCfZone).filter((z) => z.id && z.name).slice(0, MAX_ZONES);
      sections.zones = { state: "ok" };
    } catch (e) { sections.zones = fail(e); }
    if (this.accountId) {
      zones = zones.filter((z) => !z.accountId || z.accountId === this.accountId);
      const named = accounts.find((a) => a.id === this.accountId);
      accounts = [named ?? { id: this.accountId, name: "" }];
    } else if (!accounts.length) {
      const seen = new Map<string, CfAccount>();
      for (const z of zones) if (z.accountId && !seen.has(z.accountId)) seen.set(z.accountId, { id: z.accountId, name: "" });
      accounts = [...seen.values()];
    }
    accounts = accounts.filter((a) => /^[0-9a-f]{32}$/.test(a.id)).slice(0, 10);

    // DNS (A / AAAA / CNAME only)
    const records: CfDnsRecord[] = [];
    if (zones.length) {
      const results = await mapLimit(zones, 4, async (z): Promise<CfSectionState> => {
        try {
          const list = await this.pages<Record<string, unknown>>(`/zones/${z.id}/dns_records`, 500);
          for (const r of list) { const x = pickCfRecord(r, z.id); if (x) records.push(x); }
          return { state: "ok" };
        } catch (e) { return fail(e); }
      });
      const ok = results.filter((r) => r.state === "ok").length;
      sections.dns = ok === results.length ? { state: "ok" } : ok ? { state: "ok", message: `${results.length - ok}/${results.length} 个 zone 读不到 DNS` } : results.find((r) => r.state === "unauthorized") ?? results[0];
    }

    // per-account services; each endpoint degrades on its own
    const registrations: CfRegistration[] = [];
    const tunnels: CfTunnel[] = [];
    const workers: CfWorker[] = [];
    const pages: CfPagesProject[] = [];
    const r2: CfR2Bucket[] = [];
    const per: Record<"registrar" | "tunnels" | "workers" | "pages" | "r2", CfSectionState[]> = { registrar: [], tunnels: [], workers: [], pages: [], r2: [] };
    for (const acc of accounts) {
      const a = acc.id;
      await Promise.all([
        (async () => {
          try {
            let list: Record<string, unknown>[];
            try { list = await this.cursors(`/accounts/${a}/registrar/registrations`, 50, (r) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])); }
            catch (e) {
              if (!(e instanceof CfError && e.missing)) throw e;
              list = (await this.get<Record<string, unknown>[]>(`/accounts/${a}/registrar/domains`)).result ?? []; // legacy list
            }
            registrations.push(...list.map((x) => pickCfRegistration(x, a)).filter((x) => x.name));
            per.registrar.push({ state: "ok" });
          } catch (e) { per.registrar.push(fail(e)); }
        })(),
        (async () => {
          try {
            const list = (await this.pages<Record<string, unknown>>(`/accounts/${a}/cfd_tunnel`, 100, "is_deleted=false")).map((x) => pickCfTunnel(x, a))
              .filter((t) => /^[0-9a-f-]{36}$/.test(t.id)).slice(0, MAX_TUNNELS);
            await mapLimit(list, 4, async (t) => {
              try { t.hostnames = tunnelHostnames((await this.get<unknown>(`/accounts/${a}/cfd_tunnel/${t.id}/configurations`)).result); } catch { /* locally managed */ }
              try { const c = tunnelOriginIps((await this.get<unknown>(`/accounts/${a}/cfd_tunnel/${t.id}/connections`)).result); t.originIps = c.ips; t.connections = c.connections; } catch { /* not readable */ }
            });
            tunnels.push(...list);
            per.tunnels.push({ state: "ok" });
          } catch (e) { per.tunnels.push(fail(e)); }
        })(),
        (async () => {
          try {
            const list = ((await this.get<Record<string, unknown>[]>(`/accounts/${a}/workers/scripts`)).result ?? []).map((x) => pickCfWorker(x, a)).filter((w) => w.name);
            try {
              const doms = (await this.get<Record<string, unknown>[]>(`/accounts/${a}/workers/domains`)).result ?? [];
              for (const d of doms) {
                const w = list.find((x) => x.name === String(d.service ?? ""));
                const h = String(d.hostname ?? "").trim().toLowerCase();
                if (w && h && !w.domains.includes(h)) w.domains.push(h);
              }
            } catch { /* custom domains unreadable: keep the scripts */ }
            workers.push(...list);
            per.workers.push({ state: "ok" });
          } catch (e) { per.workers.push(fail(e)); }
        })(),
        (async () => {
          try {
            pages.push(...(await this.pages<Record<string, unknown>>(`/accounts/${a}/pages/projects`)).map((x) => pickCfPages(x, a)).filter((p) => p.name));
            per.pages.push({ state: "ok" });
          } catch (e) { per.pages.push(fail(e)); }
        })(),
        (async () => {
          try {
            const pick = (r: unknown) => { const b = (r as { buckets?: unknown })?.buckets; return Array.isArray(b) ? (b as Record<string, unknown>[]) : []; };
            r2.push(...(await this.cursors(`/accounts/${a}/r2/buckets`, 1000, pick)).map((x) => pickCfBucket(x, a)).filter((b) => b.name));
            per.r2.push({ state: "ok" });
          } catch (e) { per.r2.push(fail(e)); }
        })(),
      ]);
    }
    if (!accounts.length) {
      for (const k of ["registrar", "tunnels", "workers", "pages", "r2"] as const) sections[k] = { state: "skipped", message: "读不到账户：勾选 Account Settings Read，或设置 CLOUDFLARE_ACCOUNT_ID" };
    } else for (const k of ["registrar", "tunnels", "workers", "pages", "r2"] as const) fold(k, per[k]);

    return { syncedAt: new Date().toISOString(), accounts, zones, records, registrations, tunnels, workers, pages, r2, sections };
  }

  start() {
    this.stop();
    if (!this.store.settings().cloudflare.enabled || !this.token) return;
    const tick = () => {
      const last = Date.parse(this.lastSync() ?? "") || 0;
      if (Date.now() - Math.max(last, this.state.lastAttempt ?? 0) < CF_AUTO_INTERVAL_MS - 5_000) return;
      this.sync().catch(() => {});
    };
    tick();
    this.timer = setInterval(tick, CF_AUTO_INTERVAL_MS);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
