import { newId, parseConnectionString, pickQuotaAccount, type QuotaAccount } from "@fangcun/core";
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
