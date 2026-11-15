import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig { url: string; token: string }

export const configPath = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "fangcun", "config.json");

export function loadConfig(): CliConfig {
  let file: Partial<CliConfig> = {};
  const p = configPath();
  if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8"));
  return {
    url: (process.env.FANGCUN_URL ?? file.url ?? "http://localhost:8080").replace(/\/+$/, ""),
    token: process.env.FANGCUN_TOKEN ?? file.token ?? "",
  };
}

export function saveConfig(c: Partial<CliConfig>) {
  const p = configPath();
  const cur = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...cur, ...c }, null, 2), { mode: 0o600 });
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

/** Thin HTTP client for the 方寸 server API, authenticated with an access token. */
export class Client {
  constructor(public cfg: CliConfig, private fetchImpl: typeof fetch = fetch) {}

  async request(method: string, path: string, body?: unknown, opts: { raw?: boolean; contentType?: string } = {}): Promise<any> {
    if (!this.cfg.token) throw new ApiError(401, "没有配置访问令牌：fangcun config --url <地址> --token <令牌>，或设置 FANGCUN_TOKEN");
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cfg.token}` };
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) { payload = body as BodyInit; headers["Content-Type"] = opts.contentType ?? "application/octet-stream"; }
    else if (typeof body === "string") { payload = body; headers["Content-Type"] = opts.contentType ?? "text/plain"; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
    let res: Response;
    try {
      res = await this.fetchImpl(this.cfg.url + path, { method, headers, body: payload });
    } catch (e) {
      throw new ApiError(0, `连不上 ${this.cfg.url}：${(e as Error).message}`);
    }
    if (opts.raw && res.ok) return new Uint8Array(await res.arrayBuffer());
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) throw new ApiError(res.status, (data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`), data);
    return data;
  }
  get(path: string) { return this.request("GET", path); }
  post(path: string, body?: unknown) { return this.request("POST", path, body ?? {}); }
  patch(path: string, body: unknown) { return this.request("PATCH", path, body); }
  del(path: string) { return this.request("DELETE", path); }
}

export const enc = encodeURIComponent;
