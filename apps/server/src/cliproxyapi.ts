import { newId, normalizeCpaPrefs, normEmail, parseConnectionString, pickQuotaAccount, prefFor, QUOTA_ASSET_TYPES, type CpaPref, type QuotaAccount } from "@fangcun/core";
import { HttpError, type Store } from "./store";

/**
 * CLIProxyAPI (read-only). Each connection is one CLIProxyAPI instance with the 方寸 plugin; the user pastes the
 * connection string from the plugin's panel. The feed token lives only in the cliproxyapi_connections table:
 * never sent to the browser, never in API responses (to sessions or tokens), never in backups or exports, never logged.
 * The only request this module makes is GET <url><feedPath> with the token in a header.
 */
interface Row {
  id: string; name: string; note: string; url: string; feed_path: string; token: string; created_at: string;
  snapshot: string | null; fetched_at: string | null; last_error: string | null;
}

/** What callers may see about a connection: no token. */
export interface PublicConnection {
  id: string; name: string; note: string; url: string; createdAt: string;
  fetchedAt: string | null; lastError: string | null; accounts: number;
}

export const FEED_PATH_RE = /^\/v0\/resource\/plugins\/[A-Za-z0-9._-]+\/feed$/;

export class CliproxyService {
  private timer: NodeJS.Timeout | null = null;
  private inflight = new Map<string, Promise<void>>();

  constructor(private store: Store, private fetchImpl: typeof fetch = fetch, private intervalMs = 10 * 60_000) {}

  private rows(): Row[] { return this.store.db.prepare("SELECT * FROM cliproxyapi_connections ORDER BY created_at").all() as unknown as Row[]; }
  private row(id: string): Row {
    const r = this.store.db.prepare("SELECT * FROM cliproxyapi_connections WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!r) throw new HttpError(404, "连接不存在");
    return r;
  }

  private pub(r: Row): PublicConnection {
    let n = 0;
    try { n = r.snapshot ? (JSON.parse(r.snapshot).accounts ?? []).length : 0; } catch { /* */ }
    return { id: r.id, name: r.name, note: r.note, url: r.url, createdAt: r.created_at, fetchedAt: r.fetched_at, lastError: r.last_error, accounts: n };
  }

  list(): PublicConnection[] { return this.rows().map((r) => this.pub(r)); }

  /** Every account from every connection, tagged with the connection's id and name. */
  accounts(): QuotaAccount[] {
    const out: QuotaAccount[] = [];
    for (const r of this.rows()) {
      if (!r.snapshot) continue;
      try {
        for (const a of JSON.parse(r.snapshot).accounts ?? []) { const p = pickQuotaAccount(a, r.id, r.name); if (p) out.push(p); }
      } catch { /* */ }
    }
    return out;
  }

  private clean(name: unknown, note: unknown) {
    const n = String(name ?? "").trim().slice(0, 60);
    if (!n) throw new HttpError(400, "给这个连接起个名字");
    return { name: n, note: String(note ?? "").trim().slice(0, 500) };
  }

  private parse(conn: unknown) {
    try { return parseConnectionString(String(conn ?? "")); } catch (e) { throw new HttpError(400, (e as Error).message); }
  }

  async add(input: { name?: string; note?: string; connection?: string }): Promise<PublicConnection> {
    const { name, note } = this.clean(input.name, input.note);
    const c = this.parse(input.connection);
    const id = newId("cpx");
    this.store.db.prepare("INSERT INTO cliproxyapi_connections (id, name, note, url, feed_path, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, note, c.url, c.feedPath, c.token, new Date().toISOString());
    await this.refresh(id).catch(() => {});
    return this.pub(this.row(id));
  }

  async update(id: string, input: { name?: string; note?: string; connection?: string }): Promise<PublicConnection> {
    const cur = this.row(id);
    const { name, note } = this.clean(input.name ?? cur.name, input.note ?? cur.note);
    this.store.db.prepare("UPDATE cliproxyapi_connections SET name = ?, note = ? WHERE id = ?").run(name, note, id);
    if (input.connection) {
      const c = this.parse(input.connection);
      this.store.db.prepare("UPDATE cliproxyapi_connections SET url = ?, feed_path = ?, token = ?, snapshot = NULL, fetched_at = NULL, last_error = NULL WHERE id = ?").run(c.url, c.feedPath, c.token, id);
      await this.refresh(id).catch(() => {});
    }
    return this.pub(this.row(id));
  }

  remove(id: string) {
    this.row(id);
    this.store.db.prepare("DELETE FROM cliproxyapi_connections WHERE id = ?").run(id);
    this.store.db.prepare("DELETE FROM cliproxyapi_accounts WHERE connection_id = ?").run(id);
  }

  // ---------- 关注 / 手动绑定 (stored in 方寸 only; nothing is written to CLIProxyAPI) ----------

  prefs(): CpaPref[] { return readCpaPrefs(this.store); }
  private writePref(p: CpaPref) { writeCpaPref(this.store, p); }

  /** Star / bind one account the feed currently lists. assetId null clears the bind. */
  setPref(connectionId: string, accountId: string, patch: { starred?: unknown; assetId?: unknown; member?: unknown }): { pref: CpaPref; account: QuotaAccount } {
    this.row(connectionId);
    const acc = this.accounts().find((a) => a.connectionId === connectionId && a.id === accountId);
    if (!acc) throw new HttpError(404, "这个连接里没有该账号（先刷新一次）");
    const cur = prefFor(acc, this.prefs());
    const next: CpaPref = { connectionId, accountId, provider: acc.provider, ...(acc.email ? { email: acc.email } : {}), starred: cur?.starred ?? false, assetId: cur?.assetId ?? null, member: cur?.member ?? null };
    if (patch.starred !== undefined) {
      if (typeof patch.starred !== "boolean") throw new HttpError(400, "starred 需要是 true / false");
      next.starred = patch.starred;
    }
    if (patch.assetId !== undefined) {
      if (patch.assetId === null || patch.assetId === "") { next.assetId = null; next.member = null; }
      else {
        const a = this.store.get(String(patch.assetId));
        if (!a || a.deletedAt) throw new HttpError(404, "资产不存在");
        if (!(QUOTA_ASSET_TYPES as readonly string[]).includes(a.type)) throw new HttpError(400, "只能绑定到订阅、账号或邮箱资产");
        next.assetId = a.id;
        const m = patch.member ? normEmail(patch.member) : "";
        if (m && !(a.team?.workspaces ?? []).some((w) => w.members.some((x) => normEmail(x.email) === m))) throw new HttpError(400, "该资产的团队里没有这个成员");
        next.member = m || null;
      }
    }
    // an older row found by provider + email (the feed id changed): move it to the current id
    if (cur && cur.accountId !== accountId) this.store.db.prepare("DELETE FROM cliproxyapi_accounts WHERE connection_id = ? AND account_id = ?").run(cur.connectionId, cur.accountId);
    this.writePref(next);
    return { pref: next, account: acc };
  }

  /** The single exit point: GET the feed of one connection. */
  async fetchFeed(r: Pick<Row, "url" | "feed_path" | "token">, force = false): Promise<{ accounts: unknown[] }> {
    if (!FEED_PATH_RE.test(r.feed_path)) throw new HttpError(400, "接口路径无效");
    const res = await this.fetchImpl(r.url + r.feed_path + (force ? "?refresh=1" : ""), {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${r.token}`, Accept: "application/json" },
    });
    if (res.status === 401) throw new HttpError(502, "CLIProxyAPI 拒绝了连接串（令牌已重新生成？请重新复制）");
    if (res.status === 404) throw new HttpError(502, "CLIProxyAPI 上找不到方寸插件（没装或没启用）");
    if (!res.ok) throw new HttpError(502, `CLIProxyAPI 返回 ${res.status}`);
    const doc = (await res.json()) as { v?: number; accounts?: unknown[] };
    if (doc?.v !== 1 || !Array.isArray(doc.accounts)) throw new HttpError(502, "CLIProxyAPI 返回的内容不认识，请升级插件或方寸");
    return { accounts: doc.accounts };
  }

  /** Test a pasted string without saving it. */
  async test(conn: string) {
    const c = this.parse(conn);
    const doc = await this.fetchFeed({ url: c.url, feed_path: c.feedPath, token: c.token }).catch((e) => {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `连不上 ${c.url}（${(e as Error).message}）`);
    });
    return { accounts: doc.accounts.length };
  }

  refresh(id: string, force = false): Promise<void> {
    const running = this.inflight.get(id);
    if (running) return running;
    const p = (async () => {
      const r = this.row(id);
      try {
        const doc = await this.fetchFeed(r, force);
        // keep only the known fields; anything else the feed sends is dropped here
        const accounts = doc.accounts.map((a) => pickQuotaAccount(a as Record<string, unknown>, r.id, r.name)).filter(Boolean)
          .map((a) => { const { connectionId: _c, connectionName: _n, ...rest } = a!; return rest; });
        this.store.db.prepare("UPDATE cliproxyapi_connections SET snapshot = ?, fetched_at = ?, last_error = NULL WHERE id = ?")
          .run(JSON.stringify({ accounts }), new Date().toISOString(), id);
      } catch (e) {
        const msg = e instanceof HttpError ? e.message : `连不上 ${r.url}（${(e as Error).message}）`;
        this.store.db.prepare("UPDATE cliproxyapi_connections SET last_error = ? WHERE id = ?").run(msg, id);
        throw new HttpError(502, msg);
      } finally { this.inflight.delete(id); }
    })();
    this.inflight.set(id, p);
    return p;
  }

  async refreshAll(force = false) {
    await Promise.allSettled(this.rows().map((r) => this.refresh(r.id, force)));
  }

  start() {
    this.stop();
    const tick = () => { this.refreshAll().catch(() => {}); };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

// ---------- 关注 / 手动绑定 rows (also read and written by backups) ----------

export function readCpaPrefs(store: Store): CpaPref[] {
  const names = new Map((store.db.prepare("SELECT id, name FROM cliproxyapi_connections").all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const rows = store.db.prepare("SELECT * FROM cliproxyapi_accounts ORDER BY connection_id, account_id").all() as unknown as
    { connection_id: string; account_id: string; provider: string; email: string; starred: number; asset_id: string | null; member: string | null }[];
  return rows.map((r) => ({
    connectionId: r.connection_id, accountId: r.account_id, provider: r.provider, ...(r.email ? { email: r.email } : {}),
    starred: Boolean(r.starred), assetId: r.asset_id, member: r.member, ...(names.has(r.connection_id) ? { connectionName: names.get(r.connection_id) } : {}),
  }));
}

export function writeCpaPref(store: Store, p: CpaPref) {
  if (!p.starred && !p.assetId) {
    store.db.prepare("DELETE FROM cliproxyapi_accounts WHERE connection_id = ? AND account_id = ?").run(p.connectionId, p.accountId);
    return;
  }
  store.db.prepare(`INSERT INTO cliproxyapi_accounts (connection_id, account_id, provider, email, starred, asset_id, member, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, account_id) DO UPDATE SET provider = excluded.provider, email = excluded.email, starred = excluded.starred,
    asset_id = excluded.asset_id, member = excluded.member, updated_at = excluded.updated_at`)
    .run(p.connectionId, p.accountId, p.provider, p.email ?? "", p.starred ? 1 : 0, p.assetId ?? null, p.member ?? null, new Date().toISOString());
}

/** Restore prefs from a backup. Connections are matched by id, else by name; rows for unknown connections are kept as-is. */
export function importCpaPrefs(store: Store, raw: unknown, mode: "merge" | "replace"): number {
  const list = normalizeCpaPrefs(raw);
  const conns = store.db.prepare("SELECT id, name FROM cliproxyapi_connections").all() as { id: string; name: string }[];
  const ids = new Set(conns.map((r) => r.id));
  const byName = new Map(conns.map((r) => [r.name, r.id]));
  if (mode === "replace") store.db.exec("DELETE FROM cliproxyapi_accounts");
  for (const p of list) {
    const connectionId = ids.has(p.connectionId) ? p.connectionId : (p.connectionName && byName.get(p.connectionName)) || p.connectionId;
    writeCpaPref(store, { ...p, connectionId });
  }
  return list.length;
}
