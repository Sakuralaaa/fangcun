import { cleanSecret } from "./secrets";
import {
  mergeAtollDomains, pickAtollDomain, pickAtollProject, pickAtollServer,
  type AtollProject, type AtollSnapshot,
} from "@fangcun/core";
import { HttpError, type Store } from "./store";

/**
 * Read-only Atoll client. Only GET requests to these paths under <url>/api/v1 can leave this module:
 *   /auth/me   /servers   /projects   /projects/{id}   /domains
 * Anything else (another method, another path, a query string, an encoded or dotted segment) throws
 * before a socket is opened. No exec, env, logs, events or write endpoint is reachable from here.
 */
const ALLOWED_PATHS: RegExp[] = [
  /^\/auth\/me$/,
  /^\/servers$/,
  /^\/projects$/,
  /^\/projects\/[A-Za-z0-9_-]{1,100}$/,
  /^\/domains$/,
];

export function assertAtollAllowed(method: string, path: string): void {
  if (method !== "GET") throw new Error(`blocked Atoll request ${method} ${path}: only GET is allowed`);
  if (!ALLOWED_PATHS.some((re) => re.test(path))) throw new Error(`blocked Atoll request GET ${path}: path not on the read-only list`);
}

/** Permissions a key may hold to be used: only `read`. */
export function isReadOnlyMe(me: { auth?: string; scope?: string; permissions?: string[] }): boolean {
  const perms = Array.isArray(me.permissions) ? me.permissions : null;
  if (perms && perms.length) return perms.every((p) => p === "read");
  return me.scope === "read";
}

export interface AtollKeyCheck {
  /** true = verified read-only, false = key holds more than read (refused), null = could not tell. */
  readOnly: boolean | null;
  permissions?: string[];
  projectScoped?: boolean;
  checkedAt: string;
}

export interface AtollState {
  lastSync?: string;
  lastError?: string;
  key?: AtollKeyCheck;
}

const META_SNAPSHOT = "atoll_snapshot";
const META_LAST_SYNC = "atoll_last_sync";

export class AtollService {
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<AtollSnapshot> | null = null;
  state: AtollState = {};

  constructor(private store: Store, private apiKey = cleanSecret(process.env.ATOLL_API_KEY).value, private fetchImpl: typeof fetch = fetch) {}

  get hasKey() { return Boolean(this.apiKey); }

  private base(): string {
    const raw = this.store.settings().atoll.url.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
    if (!raw) throw new HttpError(400, "还没有填写 Atoll 面板地址");
    if (!/^https?:\/\//i.test(raw)) throw new HttpError(400, "Atoll 面板地址需要以 http:// 或 https:// 开头");
    if (!this.apiKey) throw new HttpError(400, "服务端没有设置环境变量 ATOLL_API_KEY");
    return `${raw}/api/v1`;
  }

  /** The single exit point: GET only, whitelisted paths only. */
  async get<T>(path: string): Promise<T> {
    assertAtollAllowed("GET", path);
    const res = await this.fetchImpl(this.base() + path, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
    });
    if (res.status === 401) throw new HttpError(502, "Atoll 拒绝了 API Key（令牌无效、已过期或已吊销）");
    if (res.status === 403) throw new HttpError(502, `Atoll 拒绝访问 ${path}（令牌权限或项目范围不够）`);
    if (!res.ok) throw new HttpError(502, `Atoll 返回 ${res.status}（${path}）`);
    return (await res.json()) as T;
  }

  /** GET /auth/me: is this key read-only? Refuses keys that can do more than read. */
  async checkKey(): Promise<AtollKeyCheck> {
    const checkedAt = new Date().toISOString();
    let me: { auth?: string; scope?: string; permissions?: string[]; projects?: string[] };
    try {
      me = await this.get("/auth/me");
    } catch (e) {
      if (e instanceof HttpError && /拒绝了 API Key/.test(e.message)) throw e;
      // Older Atoll or a token that cannot read /auth/me: we cannot tell, the settings page reminds to use a read key.
      this.state.key = { readOnly: null, checkedAt };
      return this.state.key;
    }
    const check: AtollKeyCheck = { readOnly: isReadOnlyMe(me), permissions: me.permissions ?? (me.scope ? [me.scope] : []), projectScoped: Boolean(me.projects?.length), checkedAt };
    this.state.key = check;
    return check;
  }

  snapshot(): AtollSnapshot | null {
    const raw = this.store.meta(META_SNAPSHOT);
    if (!raw) return null;
    try { return JSON.parse(raw) as AtollSnapshot; } catch { return null; }
  }

  lastSync(): string | null { return this.state.lastSync ?? this.store.meta(META_LAST_SYNC) ?? null; }

  /** Pull servers / projects / services / domains. Only the snapshot is stored (meta table); assets are never touched. */
  async sync(): Promise<AtollSnapshot> {
    this.inflight ??= (async () => {
      try {
        const key = await this.checkKey();
        if (key.readOnly === false) {
          throw new HttpError(400, `这个 API Key 不是只读的（权限：${(key.permissions ?? []).join("、") || "未知"}）。方寸拒绝使用它，请在 Atoll 里另建一个只有 read 权限的令牌。`);
        }
        const [servers, projects, domains] = await Promise.all([
          this.get<Record<string, unknown>[]>("/servers"),
          this.get<Record<string, unknown>[]>("/projects"),
          this.get<Record<string, unknown>[]>("/domains").catch(() => [] as Record<string, unknown>[]),
        ]);
        let list: AtollProject[] = (Array.isArray(projects) ? projects : []).map(pickAtollProject).filter((p) => p.id);
        // Older panels list projects without services: fetch each one's detail.
        const raw = Array.isArray(projects) ? projects : [];
        const bare = list.filter((_, i) => !Array.isArray(raw[i]?.services));
        if (bare.length) {
          const details = await Promise.all(bare.map((p) => this.get<Record<string, unknown>>(`/projects/${encodeURIComponent(p.id)}`).then(pickAtollProject).catch(() => p)));
          const byId = new Map(details.map((p) => [p.id, p]));
          list = list.map((p) => byId.get(p.id) ?? p);
        }
        const snap: AtollSnapshot = {
          syncedAt: new Date().toISOString(),
          servers: (Array.isArray(servers) ? servers : []).map(pickAtollServer).filter((s) => s.id),
          projects: mergeAtollDomains(list, (Array.isArray(domains) ? domains : []).map(pickAtollDomain)),
        };
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

  start() {
    this.stop();
    const s = this.store.settings().atoll;
    if (!s.enabled || !s.url || !this.apiKey) return;
    const tick = () => { this.sync().catch(() => {}); };
    tick();
    this.timer = setInterval(tick, Math.max(5, s.intervalMin) * 60_000);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
