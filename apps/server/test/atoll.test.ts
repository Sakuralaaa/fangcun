import { describe, expect, it } from "vitest";
import { assertAtollAllowed, AtollService, isReadOnlyMe } from "../src/atoll";
import { openDb } from "../src/db";
import { Store } from "../src/store";

describe("Atoll read-only whitelist", () => {
  it("allows only the GET paths 方寸 needs", () => {
    for (const p of ["/auth/me", "/servers", "/projects", "/projects/prj_01HX-abc", "/domains"]) expect(() => assertAtollAllowed("GET", p)).not.toThrow();
  });
  it("refuses every other method", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get"]) expect(() => assertAtollAllowed(m, "/servers")).toThrow(/only GET/);
  });
  it("refuses exec, env, logs, events, writes and path tricks", () => {
    const bad = [
      "/services/s1/exec", "/services/s1/env", "/services/s1/logs", "/events", "/tokens", "/settings", "/servers/x",
      "/projects/p1/services", "/projects/../tokens", "/projects/p1%2F..%2Ftokens", "/projects/p1?reveal=1", "/domains?x=1",
      "/auth/me/", "//servers", "/servers/", "/projects/", "/confirmations", "/settings/backup/password", "",
    ];
    for (const p of bad) expect(() => assertAtollAllowed("GET", p), p).toThrow(/not on the read-only list/);
  });
  it("reads the key's permissions from /auth/me", () => {
    expect(isReadOnlyMe({ auth: "token", scope: "read", permissions: ["read"] })).toBe(true);
    expect(isReadOnlyMe({ auth: "token", scope: "deploy", permissions: ["read", "deploy"] })).toBe(false);
    expect(isReadOnlyMe({ auth: "token", scope: "read", permissions: ["read", "exec"] })).toBe(false);
    expect(isReadOnlyMe({ auth: "token", scope: "admin" })).toBe(false);
  });
});

function setup(me: unknown, opts: { meStatus?: number } = {}) {
  const store = new Store(openDb(":memory:"));
  const s = store.settings();
  store.saveSettings({ ...s, atoll: { ...s.atoll, url: "https://atoll.example/api/v1/" } });
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}${u.search}`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer atl_pat_test");
    expect(init.body).toBeUndefined();
    switch (u.pathname) {
      case "/api/v1/auth/me": return opts.meStatus ? new Response("{}", { status: opts.meStatus }) : Response.json(me);
      case "/api/v1/servers": return Response.json([{ id: "A", name: "hk", status: "online", public_ipv4: "192.0.2.11", agent_version: "x", geo: { ip: "1" } }]);
      case "/api/v1/projects": return Response.json([{ id: "p1", name: "shop", server_id: "A", services: [{ id: "s1", name: "api", kind: "image", image: "x:1", status: "running", env: [{ key: "TOKEN", value: "SECRET" }] }] }, { id: "p2", name: "old", server_id: "A" }]);
      case "/api/v1/projects/p2": return Response.json({ id: "p2", name: "old", server_id: "A", services: [{ id: "s2", name: "web", kind: "image", image: "y:2", status: "stopped" }] });
      case "/api/v1/domains": return Response.json([{ id: "d1", service_id: "s1", hostname: "API.example.com", status: "active", proxied: true }]);
    }
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  return { store, calls, atoll: new AtollService(store, "atl_pat_test", fetchImpl) };
}

describe("AtollService.sync", () => {
  it("pulls a snapshot with GET only and stores just the whitelisted fields", async () => {
    const { atoll, calls, store } = setup({ auth: "token", scope: "read", permissions: ["read"] });
    const snap = await atoll.sync();
    expect(calls.every((c) => c.startsWith("GET /api/v1/"))).toBe(true);
    expect(calls.sort()).toEqual(["GET /api/v1/auth/me", "GET /api/v1/domains", "GET /api/v1/projects", "GET /api/v1/projects/p2", "GET /api/v1/servers"]);
    expect(snap.projects.map((p) => p.services.map((s) => s.name))).toEqual([["api"], ["web"]]);
    expect(snap.projects[0].services[0].domains[0].hostname).toBe("api.example.com");
    expect(atoll.state.key?.readOnly).toBe(true);
    const stored = store.meta("atoll_snapshot")!;
    expect(stored).not.toContain("SECRET");
    expect(stored).not.toContain("agent_version");
    expect(store.list()).toEqual([]); // assets are never touched
  });

  it("refuses a key that can do more than read, before reading any data", async () => {
    const { atoll, calls } = setup({ auth: "token", scope: "deploy", permissions: ["read", "deploy"] });
    await expect(atoll.sync()).rejects.toThrow(/不是只读/);
    expect(calls).toEqual(["GET /api/v1/auth/me"]);
    expect(atoll.snapshot()).toBeNull();
  });

  it("goes on with a reminder when /auth/me cannot be read", async () => {
    const { atoll } = setup(null, { meStatus: 404 });
    await atoll.sync();
    expect(atoll.state.key?.readOnly).toBeNull();
  });

  it("the client itself refuses non-whitelisted paths before any request", async () => {
    const { atoll, calls } = setup({ permissions: ["read"] });
    await expect(atoll.get("/services/s1/exec")).rejects.toThrow(/blocked/);
    await expect(atoll.get("/services/s1/env")).rejects.toThrow(/blocked/);
    expect(calls).toEqual([]);
  });
});
