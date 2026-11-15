import {
  applyKomari, assetFromClient, mapStatus, stableJson, summarizePing,
  type Asset, type KomariClient, type KomariPingRecords, type KomariRecord, type NodePing, type NodeStatus, type Op, type PingState,
} from "@fangcun/core";
import { tx } from "./db";
import { HttpError, type Store } from "./store";

/**
 * Read-only Komari client. Only these requests can leave this module:
 *   GET  /api/admin/client/list
 *   POST /api/rpc2  common:getNodesLatestStatus · common:getVersion
 *   POST /api/rpc2  common:getRecords, and only with type "ping" (latency history; read-only query)
 * Anything else throws before a socket is opened. No write, exec or terminal endpoint is reachable.
 */
const ALLOWED_RPC = new Set(["common:getNodesLatestStatus", "common:getVersion"]);
/** rpc methods that take params, with the only params shape each may be called with. */
const PARAM_RPC: Record<string, (p: Record<string, unknown>) => boolean> = {
  "common:getRecords": (p) =>
    p.type === "ping" &&
    Object.keys(p).every((k) => ["type", "hours", "uuid", "task_id", "maxCount"].includes(k)) &&
    (p.hours === undefined || (Number.isInteger(p.hours) && (p.hours as number) >= 1 && (p.hours as number) <= 24)),
};
type Endpoint = { method: "GET"; path: "/api/admin/client/list" } | { method: "POST"; path: "/api/rpc2"; rpc: string; params?: Record<string, unknown> };

export function assertAllowed(e: Endpoint): void {
  if (e.method === "GET" && e.path === "/api/admin/client/list") return;
  if (e.method === "POST" && e.path === "/api/rpc2") {
    const p = e.params ?? {};
    if (ALLOWED_RPC.has(e.rpc) && !Object.keys(p).length) return;
    if (PARAM_RPC[e.rpc]?.(p)) return;
  }
  throw new Error(`blocked Komari request ${e.method} ${e.path} ${"rpc" in e ? e.rpc : ""}`);
}

/** Thrown for a JSON-RPC error answer (e.g. method not found on an older Komari). */
class RpcError extends HttpError {
  constructor(message: string, public code?: number) { super(502, message); }
}

export interface KomariState {
  configured: boolean;
  url: string;
  hasKey: boolean;
  version?: string;
  lastSync?: string;
  lastError?: string;
  nodes?: number;
  ping?: PingState;
}

export class KomariService {
  private clients: { at: number; list: KomariClient[] } | null = null;
  private statusCache: { at: number; nodes: Record<string, NodeStatus> } | null = null;
  private inflight: Promise<Record<string, NodeStatus>> | null = null;
  private history = new Map<string, { sum: number[]; up: number[]; down: number[] }>();
  private pingCache: { at: number; state: PingState; nodes: Record<string, NodePing> } | null = null;
  private timers: NodeJS.Timeout[] = [];
  state: KomariState = { configured: false, url: "", hasKey: false };

  constructor(private store: Store, private apiKey = process.env.KOMARI_API_KEY ?? "", private fetchImpl: typeof fetch = fetch) {}

  private base(): string {
    const url = this.store.settings().komari.url.trim().replace(/\/+$/, "");
    this.state.url = url;
    this.state.hasKey = Boolean(this.apiKey);
    this.state.configured = Boolean(url && this.apiKey);
    if (!url) throw new HttpError(400, "还没有填写 Komari 探针地址");
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, "探针地址需要以 http:// 或 https:// 开头");
    if (!this.apiKey) throw new HttpError(400, "服务端没有设置环境变量 KOMARI_API_KEY");
    return url;
  }

  private async call<T>(e: Endpoint): Promise<T> {
    assertAllowed(e);
    const url = this.base() + e.path;
    const res = await this.fetchImpl(url, {
      method: e.method,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", ...(e.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(e.method === "POST" ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: e.rpc, params: e.params ?? {} }) } : {}),
    });
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Komari 拒绝了 API Key（需要管理员权限的 API Key）");
    if (!res.ok) throw new HttpError(502, `Komari 返回 ${res.status}`);
    const body = (await res.json()) as unknown;
    if (e.method === "POST") {
      const r = body as { result?: T; error?: { message?: string; code?: number } };
      if (r.error) throw new RpcError(`Komari: ${r.error.message ?? "rpc error"}`, r.error.code);
      return r.result as T;
    }
    return body as T;
  }

  async listClients(maxAgeMs = 60_000): Promise<KomariClient[]> {
    if (this.clients && Date.now() - this.clients.at < maxAgeMs) return this.clients.list;
    const raw = await this.call<KomariClient[] | { data?: KomariClient[] }>({ method: "GET", path: "/api/admin/client/list" });
    const arr = Array.isArray(raw) ? raw : raw.data ?? [];
    // The admin list includes each agent's token: drop it immediately, it is never stored or forwarded.
    const list = arr.map(({ token: _t, ...c }) => c as KomariClient);
    this.clients = { at: Date.now(), list };
    this.state.nodes = list.length;
    return list;
  }

  async version(): Promise<string | undefined> {
    try {
      const v = await this.call<{ version?: string; hash?: string }>({ method: "POST", path: "/api/rpc2", rpc: "common:getVersion" });
      this.state.version = [v?.version, v?.hash ? `(${v.hash.slice(0, 7)})` : ""].filter(Boolean).join(" ");
    } catch { /* optional */ }
    return this.state.version;
  }

  /**
   * Last hour of ping results for all nodes, one rpc call, cached for a minute.
   * A failure (older Komari without the method, timeout) only hides the latency row; it never fails the status.
   */
  async ping(maxAgeMs = 60_000): Promise<{ state: PingState; nodes: Record<string, NodePing> }> {
    const c = this.pingCache;
    // An unsupported server is asked again only every 10 minutes.
    if (c && Date.now() - c.at < (c.state === "unavailable" ? Math.max(maxAgeMs, 10 * 60_000) : maxAgeMs)) return c;
    const to = Date.now();
    let next: { at: number; state: PingState; nodes: Record<string, NodePing> };
    try {
      const res = await this.call<KomariPingRecords>({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords", params: { type: "ping", hours: 1, maxCount: 20000 } });
      const nodes = summarizePing(res, to - 3_600_000, to);
      next = { at: to, state: Object.keys(nodes).length ? "ok" : "empty", nodes };
    } catch {
      next = { at: to, state: "unavailable", nodes: c?.state === "ok" ? c.nodes : {} };
    }
    this.pingCache = next;
    this.state.ping = next.state;
    return next;
  }

  /** Latest status of every node. Served from cache unless older than maxAgeMs; concurrent callers share one request. */
  async status(maxAgeMs = 8_000): Promise<{ at: string; nodes: Record<string, NodeStatus>; ping: PingState | null }> {
    if (this.statusCache && Date.now() - this.statusCache.at < maxAgeMs) return { at: new Date(this.statusCache.at).toISOString(), nodes: this.statusCache.nodes, ping: this.pingCache?.state ?? null };
    this.inflight ??= (async () => {
      try {
        const [records, clients, ping] = await Promise.all([
          this.call<Record<string, KomariRecord>>({ method: "POST", path: "/api/rpc2", rpc: "common:getNodesLatestStatus" }),
          this.listClients(10 * 60_000).catch(() => [] as KomariClient[]),
          this.ping().catch(() => null),
        ]);
        const byId = new Map(clients.map((c) => [c.uuid, c]));
        const nodes: Record<string, NodeStatus> = {};
        for (const [uuid, r] of Object.entries(records ?? {})) {
          const h = this.history.get(uuid) ?? { sum: [], up: [], down: [] };
          const up = Number(r.net_out ?? 0), down = Number(r.net_in ?? 0);
          h.sum.push(up + down); h.up.push(up); h.down.push(down);
          for (const k of ["sum", "up", "down"] as const) while (h[k].length > 24) h[k].shift();
          this.history.set(uuid, h);
          const n = mapStatus(uuid, r, byId.get(uuid), [...h.sum], { up: [...h.up], down: [...h.down] });
          const p = ping?.nodes[uuid];
          nodes[uuid] = p ? { ...n, ping: p } : n;
        }
        this.statusCache = { at: Date.now(), nodes };
        this.state.lastError = undefined;
        return nodes;
      } catch (e) {
        this.state.lastError = (e as Error).message;
        throw e;
      } finally {
        this.inflight = null;
      }
    })();
    const nodes = await this.inflight;
    return { at: new Date(this.statusCache?.at ?? Date.now()).toISOString(), nodes, ping: this.pingCache?.state ?? null };
  }

  /** Pull node info and update every bound asset. Writes go through the audit log as 「Komari 同步」. */
  async sync(): Promise<{ updated: string[]; unbound: KomariClient[]; nodes: number }> {
    const clients = await this.listClients(0);
    const settings = this.store.settings().komari;
    const now = new Date().toISOString();
    const byId = new Map(clients.map((c) => [c.uuid, c]));
    const ops: Op[] = [];
    const updated: string[] = [];
    const bound = new Set<string>();
    for (const a of this.store.list()) {
      if (!a.komari) continue;
      bound.add(a.komari.uuid);
      const c = byId.get(a.komari.uuid);
      if (!c) continue;
      const { asset, changed } = applyKomari(a, c, settings, now);
      if (stableJson(asset) !== stableJson(a)) {
        ops.push({ op: "put", id: a.id, before: a, after: asset });
        if (changed.length) updated.push(a.id);
      }
    }
    if (ops.length) {
      tx(this.store.db, () => {
        // Only real field changes are worth an audit line; timestamp-only refreshes are written quietly.
        const real = ops.filter((o) => updated.includes(o.id));
        const quiet = ops.filter((o) => !updated.includes(o.id));
        if (real.length) this.store.applyOps("Komari 同步", real, "komari-sync", "Komari 同步", null);
        for (const o of quiet) if (o.op === "put") this.store.db.prepare("UPDATE assets SET data = ? WHERE id = ?").run(JSON.stringify({ ...o.after, updatedAt: o.before!.updatedAt }), o.id);
      });
    }
    this.state.lastSync = now;
    this.store.setMeta("komari_last_sync", now);
    return { updated, unbound: clients.filter((c) => !bound.has(c.uuid)), nodes: clients.length };
  }

  /** Assets for a bind request: either an existing server gets the uuid, or a new one is created from the node. */
  async bindOp(uuid: string, assetId?: string): Promise<{ op: Op; asset: Asset }> {
    const clients = await this.listClients();
    const c = clients.find((x) => x.uuid === uuid);
    if (!c) throw new HttpError(404, `Komari 里没有节点 ${uuid}`);
    const taken = this.store.list().find((a) => a.komari?.uuid === uuid);
    if (taken && taken.id !== assetId) throw new HttpError(409, `节点已绑定到「${taken.name}」`);
    const settings = this.store.settings().komari;
    if (assetId) {
      const before = this.store.mustGet(assetId);
      const linked = { ...before, komari: { uuid, fields: {}, overridden: {}, trafficResetDay: before.komari?.trafficResetDay } } as Asset;
      const { asset } = applyKomari(linked, c, settings, new Date().toISOString());
      return { op: { op: "put", id: assetId, before, after: asset }, asset };
    }
    const op = this.store.createOp(assetFromClient(c, settings));
    const after = (op as { after: Asset }).after;
    after.komari = { ...after.komari!, syncedAt: new Date().toISOString() };
    return { op, asset: after };
  }

  start() {
    this.stop();
    const tick = () => { this.status(0).catch(() => {}); };
    const syncTick = () => { this.sync().catch((e) => { this.state.lastError = (e as Error).message; }); };
    if (!this.store.settings().komari.url || !this.apiKey) return;
    syncTick();
    this.version().catch(() => {});
    this.timers.push(setInterval(tick, 5 * 60_000));
    const every = Math.max(5, this.store.settings().komari.intervalMin) * 60_000;
    this.timers.push(setInterval(syncTick, every));
    for (const t of this.timers) t.unref();
  }
  stop() { this.timers.forEach(clearInterval); this.timers = []; }
  resetCache() { this.clients = null; this.statusCache = null; this.pingCache = null; }
}
