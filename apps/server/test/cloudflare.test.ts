import { describe, expect, it } from "vitest";
import { assertCloudflareAllowed, CloudflareService } from "../src/cloudflare";
import { cleanId, cleanSecret, cloudflareTokenHint } from "../src/secrets";
import { openDb } from "../src/db";
import { Store } from "../src/store";

const ACC = "0123456789abcdef0123456789abcdef";
const ZONE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ZONE2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOK = "cccccccccccccccccccccccccccccccc";
const TUN = "c1744f8b-faa1-48a4-9e5c-02ac921467fa";

describe("Cloudflare read-only whitelist", () => {
  it("allows only the GET paths and query keys 方寸 needs", () => {
    const good = [
      "/user/tokens/verify", `/user/tokens/${TOK}`, `/accounts/${ACC}/tokens/verify`, `/accounts/${ACC}/tokens/${TOK}`,
      "/accounts?page=1&per_page=50", "/zones?page=2&per_page=50", `/zones/${ZONE}/dns_records?page=1&per_page=500`,
      `/accounts/${ACC}/registrar/registrations?per_page=50`, `/accounts/${ACC}/registrar/registrations?cursor=eyJpZCI6MX0=&per_page=50`,
      `/accounts/${ACC}/registrar/domains`, `/accounts/${ACC}/cfd_tunnel?page=1&per_page=100&is_deleted=false`,
      `/accounts/${ACC}/cfd_tunnel/${TUN}/configurations`, `/accounts/${ACC}/cfd_tunnel/${TUN}/connections`,
      `/accounts/${ACC}/workers/scripts`, `/accounts/${ACC}/workers/domains`, `/accounts/${ACC}/pages/projects?page=3`,
      `/accounts/${ACC}/r2/buckets?per_page=1000`,
    ];
    for (const p of good) expect(() => assertCloudflareAllowed("GET", p), p).not.toThrow();
  });
  it("refuses every other method", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]) expect(() => assertCloudflareAllowed(m, "/zones")).toThrow(/only GET/);
  });
  it("refuses writes, other endpoints, odd queries and path tricks", () => {
    const bad = [
      `/zones/${ZONE}/purge_cache`, `/zones/${ZONE}/dns_records/123`, `/zones/${ZONE}/dns_records/export`, `/zones/${ZONE}/settings`,
      "/user/tokens", `/user/tokens/${TOK}/value`, "/user/tokens/permission_groups", `/accounts/${ACC}/tokens`,
      `/accounts/${ACC}/workers/scripts/edge`, `/accounts/${ACC}/workers/scripts/edge/content`, `/accounts/${ACC}/r2/buckets/assets`,
      `/accounts/${ACC}/cfd_tunnel/${TUN}/token`, `/accounts/${ACC}/cfd_tunnel/${TUN}`, `/accounts/${ACC}/registrar/domain-check`,
      `/accounts/${ACC}/pages/projects/docs/deployments`, `/accounts/${ACC}/secrets_store/stores`, "/accounts/short/workers/scripts",
      "/zones/../user/tokens", `/zones/${ZONE}%2F..%2Fpurge_cache/dns_records`, "//zones", "/zones/", "",
      "/zones?name=example.com", "/zones?page=1&page=2", "/zones?page=0", "/zones?page=1&per_page=50&match=all", "/zones?", "/zones?page",
      `/zones/${ZONE}/dns_records?type=TXT`, `/accounts/${ACC}/cfd_tunnel?is_deleted=true`, `/accounts/${ACC}/registrar/registrations?cursor=a%26b`,
      "/zones?page=1#x", "/zones?page=1?x=2", `/accounts/${ACC}/workers/scripts?tags=a`,
    ];
    for (const p of bad) expect(() => assertCloudflareAllowed("GET", p), p).toThrow(/not on the read-only list/);
  });
});

type Opts = { rawToken?: string; expectToken?: string; perms?: string[] | null; verify?: "user" | "account" | "invalid"; deny?: RegExp[]; registrarLegacy?: boolean; accountId?: string };
const env = (result: unknown, info?: object) => Response.json({ success: true, errors: [], messages: [], result, ...(info ? { result_info: info } : {}) });
const err = (status: number, code: number) => Response.json({ success: false, errors: [{ code, message: "Unauthorized to access requested resource" }], result: null }, { status });

function setup(o: Opts = {}) {
  const store = new Store(openDb(":memory:"));
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/client\/v4/, "");
    const q = u.searchParams;
    calls.push(`${init.method} ${p}${u.search}`);
    expect(u.origin).toBe("https://api.cloudflare.com");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${o.expectToken ?? "cf-test-token"}`);
    expect(init.body).toBeUndefined();
    if (o.deny?.some((re) => re.test(p))) return err(403, 9109);
    if (p === "/user/tokens/verify") return o.verify === "account" || o.verify === "invalid" ? err(401, 1000) : env({ id: TOK, status: "active" });
    if (p === `/accounts/${ACC}/tokens/verify`) return o.verify === "invalid" ? err(401, 1000) : env({ id: TOK, status: "active" });
    if (p === `/user/tokens/${TOK}` || p === `/accounts/${ACC}/tokens/${TOK}`) {
      if (o.perms === null) return err(403, 9109);
      return env({ id: TOK, policies: [{ effect: "allow", permission_groups: (o.perms ?? ["Zone Read", "DNS Read"]).map((name, i) => ({ id: String(i), name })) }] });
    }
    if (p === "/accounts") return env([{ id: ACC, name: "sak", settings: { secret: "x" } }], { page: 1, total_pages: 1 });
    if (p === "/zones") {
      const page = Number(q.get("page"));
      const z = page === 1 ? { id: ZONE, name: "example.com", status: "active", account: { id: ACC, name: "sak" }, name_servers: ["ada.ns.cloudflare.com"], owner: { email: "me@x" } }
        : { id: ZONE2, name: "other.dev", status: "pending", account: { id: ACC, name: "sak" }, name_servers: [] };
      return env([z], { page, per_page: 50, total_pages: 2, total_count: 2 });
    }
    if (p === `/zones/${ZONE}/dns_records`) {
      const page = Number(q.get("page"));
      return env(page === 1
        ? [{ type: "A", name: "example.com", content: "192.0.2.10", proxied: true }, { type: "TXT", name: "example.com", content: "v=spf1 SECRET-TXT" }]
        : [{ type: "CNAME", name: "bi.example.com", content: `${TUN}.cfargotunnel.com`, proxied: true }], { page, total_pages: 2 });
    }
    if (p === `/zones/${ZONE2}/dns_records`) return env([], { page: 1, total_pages: 0 });
    if (p === `/accounts/${ACC}/registrar/registrations`) {
      if (o.registrarLegacy) return err(404, 7003);
      return q.get("cursor") ? env([{ domain_name: "other.dev", expires_at: "2028-01-01T00:00:00Z", auto_renew: false, locked: true }], { cursor: "" })
        : env([{ domain_name: "example.com", expires_at: "2027-12-03T00:00:00Z", auto_renew: true, locked: true }], { cursor: "next1" });
    }
    if (p === `/accounts/${ACC}/registrar/domains`) return env([{ name: "example.com", expires_at: "2027-12-03T00:00:00Z", auto_renew: true, locked: false }]);
    if (p === `/accounts/${ACC}/cfd_tunnel`) return env([{ id: TUN, name: "sg-data", status: "healthy", credentials_file: { TunnelSecret: "SECRET-TUN" } }], { page: 1, total_pages: 1 });
    if (p === `/accounts/${ACC}/cfd_tunnel/${TUN}/configurations`) return env({ config: { ingress: [{ hostname: "bi.example.com", service: "http://localhost:3000" }, { service: "http_status:404" }] } });
    if (p === `/accounts/${ACC}/cfd_tunnel/${TUN}/connections`) return env([{ id: "c", conns: [{ origin_ip: "198.51.100.7", colo_name: "SIN" }] }]);
    if (p === `/accounts/${ACC}/workers/scripts`) return env([{ id: "edge", modified_on: "2026-10-01T00:00:00Z" }]);
    if (p === `/accounts/${ACC}/workers/domains`) return env([{ id: "w", hostname: "edge.example.com", service: "edge", zone_name: "example.com" }]);
    if (p === `/accounts/${ACC}/pages/projects`) return env([{ name: "docs", subdomain: "docs.pages.dev", domains: ["docs.other.dev"] }], { page: 1, total_pages: 1 });
    if (p === `/accounts/${ACC}/r2/buckets`) return env({ buckets: [{ name: "assets", location: "APAC", creation_date: "2026-01-02T00:00:00Z" }] }, { cursor: "" });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  return { store, calls, cf: new CloudflareService(store, o.rawToken ?? "cf-test-token", o.accountId ?? "", fetchImpl) };
}

describe("CloudflareService.sync", () => {
  it("pulls a snapshot with GET only, follows page and cursor pagination, keeps only picked fields", async () => {
    const { cf, calls, store } = setup();
    const snap = await cf.sync();
    expect(calls.every((c) => c.startsWith("GET /"))).toBe(true);
    expect(calls).toContain("GET /zones?page=2&per_page=50");
    expect(calls).toContain(`GET /zones/${ZONE}/dns_records?page=2&per_page=500`);
    expect(calls).toContain(`GET /accounts/${ACC}/registrar/registrations?cursor=next1&per_page=50`);
    expect(snap.zones.map((z) => z.name)).toEqual(["example.com", "other.dev"]);
    expect(snap.records.map((r) => `${r.type} ${r.name}`)).toEqual(["A example.com", "CNAME bi.example.com"]);
    expect(snap.registrations.map((r) => r.name)).toEqual(["example.com", "other.dev"]);
    expect(snap.tunnels[0]).toMatchObject({ name: "sg-data", hostnames: ["bi.example.com"], originIps: ["198.51.100.7"], connections: 1 });
    expect(snap.workers[0]).toMatchObject({ name: "edge", domains: ["edge.example.com"] });
    expect(snap.pages[0].domains).toEqual(["docs.other.dev"]);
    expect(snap.r2[0]).toMatchObject({ name: "assets", location: "APAC" });
    expect(Object.values(snap.sections).every((s) => s.state === "ok")).toBe(true);
    expect(cf.state.token).toMatchObject({ kind: "user", readOnly: true, permissions: ["Zone Read", "DNS Read"] });
    const stored = store.meta("cloudflare_snapshot")!;
    for (const secret of ["cf-test-token", "SECRET-TXT", "SECRET-TUN", "me@x", "settings"]) expect(stored).not.toContain(secret);
    expect(store.list()).toEqual([]); // assets are never touched
  });

  it("refuses a token holding any Edit / Write permission before reading data", async () => {
    const { cf, calls } = setup({ perms: ["Zone Read", "DNS Write"] });
    await expect(cf.sync()).rejects.toThrow(/不是只读.*DNS Write/);
    expect(calls).toEqual(["GET /user/tokens/verify", `GET /user/tokens/${TOK}`]);
    expect(cf.snapshot()).toBeNull();
  });

  it("goes on with readOnly = null when the token cannot read its own permissions", async () => {
    const { cf } = setup({ perms: null });
    await cf.sync();
    expect(cf.state.token?.readOnly).toBeNull();
  });

  it("rejects an invalid token, and verifies an account token under CLOUDFLARE_ACCOUNT_ID", async () => {
    await expect(setup({ verify: "invalid" }).cf.sync()).rejects.toThrow(/令牌无效/);
    const { cf, calls } = setup({ verify: "account", accountId: ACC });
    await cf.sync();
    expect(cf.state.token).toMatchObject({ kind: "account", readOnly: true });
    expect(calls).toContain(`GET /accounts/${ACC}/tokens/${TOK}`);
  });

  it("degrades one endpoint to 未授权 without touching the others", async () => {
    const { cf } = setup({ deny: [/\/r2\/buckets$/, /\/cfd_tunnel$/, /^\/accounts$/] });
    const snap = await cf.sync();
    expect(snap.sections.r2.state).toBe("unauthorized");
    expect(snap.sections.tunnels.state).toBe("unauthorized");
    expect(snap.sections.accounts.state).toBe("unauthorized");
    expect(snap.accounts.map((a) => a.id)).toEqual([ACC]); // learnt from the zones instead
    expect(snap.sections.workers.state).toBe("ok");
    expect(snap.sections.registrar.state).toBe("ok");
    expect(snap.zones).toHaveLength(2);
  });

  it("falls back to the legacy Registrar list when the new one is missing", async () => {
    const { cf, calls } = setup({ registrarLegacy: true });
    const snap = await cf.sync();
    expect(calls).toContain(`GET /accounts/${ACC}/registrar/domains`);
    expect(snap.registrations).toEqual([{ name: "example.com", accountId: ACC, status: undefined, expiresAt: "2027-12-03", autoRenew: true, locked: false }]);
  });

  it("throttles manual syncs and the client refuses non-whitelisted requests before any fetch", async () => {
    const { cf, calls } = setup();
    await cf.sync({ manual: true });
    await expect(cf.sync({ manual: true })).rejects.toThrow(/刚同步过/);
    const n = calls.length;
    await expect(cf.get(`/zones/${ZONE}/purge_cache`)).rejects.toThrow(/blocked/);
    await expect(cf.get("/zones?name=x")).rejects.toThrow(/blocked/);
    expect(calls.length).toBe(n);
  });
});

describe("环境变量里的密钥清洗与 401 诊断", () => {
  it("strips whitespace, newlines, wrapping quotes and a pasted Bearer prefix", () => {
    expect(cleanSecret("  abc123\n").value).toBe("abc123");
    expect(cleanSecret('"abc123"').value).toBe("abc123");
    expect(cleanSecret("'abc123'").value).toBe("abc123");
    expect(cleanSecret(' "Bearer abc123" \r\n')).toEqual({ value: "abc123", stripped: ["首尾空白/换行", "包裹的引号", "Bearer 前缀"] });
    expect(cleanSecret("bearer   abc").value).toBe("abc");
    expect(cleanSecret('"abc').value).toBe('"abc'); // unpaired quote is left alone
    expect(cleanSecret(undefined).value).toBe("");
    expect(cleanId(' "0123ABCD" ')).toBe("0123abcd");
  });

  it("the Cloudflare client sends the cleaned token (docker-compose list form keeps the quotes)", async () => {
    const { cf } = setup({ rawToken: '"Bearer cf-test-token"\n' });
    await expect(cf.sync()).resolves.toBeTruthy();
  });

  it("token hint shows at most five characters", () => {
    const acc = "cfat_" + "x".repeat(48);
    expect(cloudflareTokenHint(acc)).toMatchObject({ prefix: "cfat_", kind: "account", odd: null });
    expect(cloudflareTokenHint("cfut_" + "y".repeat(48)).kind).toBe("user");
    expect(cloudflareTokenHint("A".repeat(40)).kind).toBe("legacy");
    expect(cloudflareTokenHint("short").odd).toMatch(/长度只有 5/);
    expect(cloudflareTokenHint("abc def ghi jkl mno pqr stu vwx yz").odd).toMatch(/空白/);
  });

  it("401 message: kind from the prefix, never more than 5 characters, cfat_ needs the account id, IP filter, recreate the container", async () => {
    const tok = "cfat_SECRETPART0123456789abcdefghijklmnopqrstuv";
    const { cf } = setup({ rawToken: `"${tok}"`, expectToken: tok, verify: "invalid" });
    const msg = await cf.sync().then(() => "", (e: Error) => e.message);
    expect(msg).toContain("401");
    expect(msg).toContain("cfat_…（账户令牌");
    expect(msg).not.toContain("cfat_S");
    expect(msg).not.toContain("SECRETPART");
    expect(msg).toContain("包裹的引号");
    expect(msg).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(msg).toContain("客户端 IP 地址筛选");
    expect(msg).toContain("--force-recreate");
    const withAcc = setup({ rawToken: tok, expectToken: tok, verify: "invalid", accountId: ACC });
    const msg2 = await withAcc.cf.sync().then(() => "", (e: Error) => e.message);
    expect(msg2).not.toContain("必须同时设置 CLOUDFLARE_ACCOUNT_ID");
    expect(msg2).not.toContain("已自动去掉");
  });

  it("a read-all token (Browser Run Read …) is accepted as read-only", async () => {
    const { cf } = setup({ perms: ["Browser Run Read", "Workers Scripts Read", "Zone Read", "DNS Read", "Zero Trust Report"] });
    await cf.sync();
    expect(cf.state.token).toMatchObject({ readOnly: true });
  });
});

