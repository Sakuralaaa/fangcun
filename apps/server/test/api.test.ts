import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBackup } from "@fangcun/core";
import { createApp } from "../src/app";
import { totpAt } from "../src/auth";
import { BackupService } from "../src/backup";
import { migrate, openDb } from "../src/db";
import { assertAllowed, KomariService } from "../src/komari";
import { Store } from "../src/store";

const dir = mkdtempSync(join(tmpdir(), "fangcun-test-"));
const store = new Store(openDb(":memory:"));

// Fake Komari 1.2.5: records every request so the test can prove only read endpoints were called.
const calls: string[] = [];
let komariPrice = 20;
const fakeFetch = (async (url: string, init: RequestInit) => {
  const u = new URL(url);
  const body = init.body ? JSON.parse(String(init.body)) : null;
  calls.push(`${init.method} ${u.pathname}${body ? ` ${body.method}` : ""}`);
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  if (u.pathname === "/api/admin/client/list") {
    return Response.json([
      { uuid: "node-1", token: "SECRET-AGENT-TOKEN", name: "hk-api-02", cpu_cores: 4, cpu_name: "EPYC", os: "Ubuntu 24.04", ipv4: "192.0.2.11", region: "香港", mem_total: 8 * 1024 ** 3, disk_total: 80 * 1024 ** 3, price: komariPrice, billing_cycle: 30, currency: "$", expired_at: "2026-11-22T00:00:00+08:00", auto_renewal: false, traffic_limit: 1024 ** 4, traffic_limit_type: "sum", version: "1.5.11", tags: "" },
      { uuid: "node-2", token: "X", name: "la-lab", price: 36, billing_cycle: 365, currency: "$", expired_at: "2027-03-14T00:00:00Z" },
    ]);
  }
  if (u.pathname === "/api/rpc2" && body.method === "common:getNodesLatestStatus") {
    return Response.json({ jsonrpc: "2.0", id: 1, result: { "node-1": { client: "node-1", cpu: 12.5, ram: 1e9, ram_total: 8e9, disk: 1e10, disk_total: 8e10, net_in: 1000, net_out: 500, net_total_up: 10, net_total_down: 20, connections: 5, connections_udp: 1, online: true, uptime: 3600 } } });
  }
  if (u.pathname === "/api/rpc2" && body.method === "common:getRecords") {
    expect(body.params).toMatchObject({ type: "ping", hours: 1 });
    const now = Date.now();
    const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    return Response.json({ jsonrpc: "2.0", id: 1, result: { count: 5, tasks: [{ id: 3, name: "CN 联通" }, { id: 4, name: "其他" }], records: [
      { task_id: 3, client: "node-1", time: at(50), value: 40 }, { task_id: 3, client: "node-1", time: at(30), value: -1 },
      { task_id: 3, client: "node-1", time: at(10), value: 60 }, { task_id: 3, client: "node-1", time: at(1), value: 50 },
      { task_id: 4, client: "node-1", time: at(5), value: 900 },
    ] } });
  }
  if (u.pathname === "/api/rpc2" && body.method === "common:getVersion") return Response.json({ jsonrpc: "2.0", id: 1, result: { version: "1.2.5", hash: "e446bee" } });
  return new Response("nope", { status: 404 });
}) as unknown as typeof fetch;

const komari = new KomariService(store, "test-key", fakeFetch);
const backup = new BackupService(store, dir, join(dir, "backups"));
const app = createApp({ store, komari, backup, secureCookie: false });

let cookie = "";
const call = async (method: string, path: string, opts: { body?: unknown; token?: string; raw?: Uint8Array } = {}) => {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (cookie) { headers.Cookie = cookie; headers["X-Fangcun"] = "1"; }
  let body: BodyInit | undefined;
  if (opts.raw) { body = opts.raw as BodyInit; headers["Content-Type"] = "application/octet-stream"; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["Content-Type"] = "application/json"; }
  const res = await app.request(path, { method, headers, body });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.startsWith("fc_session=")) cookie = setCookie.split(";")[0];
  return res;
};
const json = async (p: Promise<Response>) => { const r = await p; return { status: r.status, data: (await r.json()) as any }; };

const tokens: Record<string, string> = {};

beforeAll(async () => {
  expect((await json(call("GET", "/api/auth/state"))).data.needsSetup).toBe(true);
  const r = await call("POST", "/api/auth/setup", { body: { username: "sak", password: "correct-horse-battery" } });
  expect(r.status).toBe(200);
  for (const scope of ["read", "write", "full"]) {
    const t = await json(call("POST", "/api/tokens", { body: { name: `t-${scope}`, scope } }));
    tokens[scope] = t.data.token;
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("登录", () => {
  it("rejects anonymous and wrong password; setup only once", async () => {
    const saved = cookie; cookie = "";
    expect((await call("GET", "/api/assets")).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { body: { username: "sak", password: "nope-nope-nope" } })).status).toBe(401);
    expect((await call("POST", "/api/auth/setup", { body: { username: "x", password: "0123456789ab" } })).status).toBe(409);
    expect((await call("POST", "/api/auth/login", { body: { username: "sak", password: "correct-horse-battery" } })).status).toBe(200);
    expect(cookie).not.toBe(saved);
  });
  it("cookie writes need the X-Fangcun header", async () => {
    const res = await app.request("/api/assets", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(403);
  });
});

describe("令牌权限", () => {
  it("只读 can read but not write or back up", async () => {
    expect((await call("GET", "/api/assets", { token: tokens.read })).status).toBe(200);
    expect((await call("POST", "/api/assets", { token: tokens.read, body: { type: "domain", name: "x.dev" } })).status).toBe(403);
    expect((await call("GET", "/api/backup/download", { token: tokens.read })).status).toBe(403);
    expect((await call("GET", "/api/tokens", { token: tokens.full })).status).toBe(403); // tokens never manage tokens
  });

  it("可写 creates a change plan that lands only after approval", async () => {
    const r = await json(call("POST", "/api/assets", { token: tokens.write, body: { id: "dom1", type: "domain", name: "example.dev", price: 12, currency: "USD", cycle: "year", expiresAt: "2027-06-11" } }));
    expect(r.status).toBe(202);
    expect(store.get("dom1")).toBeUndefined();
    expect((await call("POST", `/api/changesets/${r.data.changeset.id}/approve`, { token: tokens.full })).status).toBe(403);
    const ok = await json(call("POST", `/api/changesets/${r.data.changeset.id}/approve`));
    expect(ok.data.status).toBe("applied");
    expect(store.get("dom1")?.name).toBe("example.dev");
    expect(store.auditList({ assetId: "dom1" })[0].actor).toContain("批准");
  });

  it("完全权限 writes directly; delete goes to trash; undo restores", async () => {
    const r = await json(call("POST", "/api/assets", { token: tokens.full, body: { id: "card1", type: "payment", name: "U 卡", price: 1, currency: "USD", cycle: "month", payment: { issuer: "平台", network: "Visa", last4: "4242", cardExpiry: "2028-09", status: "active" } } }));
    expect(r.status).toBe(200);
    expect(store.get("card1")?.expiresAt).toBe("2028-09-30");
    const del = await json(call("DELETE", "/api/assets/card1", { token: tokens.full }));
    expect(store.get("card1")?.deletedAt).toBeTruthy();
    expect((await json(call("GET", "/api/assets?deleted=1"))).data.assets.map((a: any) => a.id)).toContain("card1");
    const undo = await json(call("POST", `/api/audit/${del.data.auditIds[0]}/undo`, { token: tokens.full }));
    expect(undo.data.status).toBe("applied");
    expect(store.get("card1")?.deletedAt).toBeNull();
    expect((await call("POST", `/api/audit/${del.data.auditIds[0]}/undo`, { token: tokens.full })).status).toBe(409);
  });

  it("refuses a full card number", async () => {
    const r = await json(call("POST", "/api/assets", { token: tokens.full, body: { type: "payment", name: "x", payment: { issuer: "a", last4: "4111111111111111", status: "active" } } }));
    expect(r.status).toBe(400);
  });

  it("renew + link + revoked tokens stop working", async () => {
    const r = await json(call("POST", "/api/assets/dom1/renew", { token: tokens.full }));
    expect(r.data.assets[0].expiresAt).toBe("2028-06-11");
    await call("POST", "/api/assets/dom1/link", { token: tokens.full, body: { to: ["card1"] } });
    expect(store.get("card1")?.related).toContain("dom1");
    const list = await json(call("GET", "/api/tokens"));
    const id = list.data.tokens.find((t: any) => t.name === "t-read").id;
    await call("DELETE", `/api/tokens/${id}`);
    expect((await call("GET", "/api/assets", { token: tokens.read })).status).toBe(401);
  });
});

describe("Komari（只读）", () => {
  it("only ever calls the two read endpoints", () => {
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "admin:editClient" })).toThrow(/blocked/);
    expect(() => assertAllowed({ method: "GET", path: "/api/admin/client/x/token" as never })).toThrow(/blocked/);
  });

  it("ping records: only common:getRecords with type ping and read-only params", () => {
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords", params: { type: "ping", hours: 1, maxCount: 20000 } })).not.toThrow();
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords", params: { type: "load", hours: 1 } })).toThrow(/blocked/);
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords", params: { type: "ping", hours: 9999 } })).toThrow(/blocked/);
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords", params: { type: "ping", sql: "x" } })).toThrow(/blocked/);
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getRecords" })).toThrow(/blocked/);
    // the parameterless read methods stay parameterless
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "common:getNodesLatestStatus", params: { uuid: "x" } })).toThrow(/blocked/);
    expect(() => assertAllowed({ method: "POST", path: "/api/rpc2", rpc: "admin:getRecords", params: { type: "ping" } })).toThrow(/blocked/);
  });

  it("bind, sync, override, restore, status", async () => {
    await call("PUT", "/api/settings", { body: { komari: { url: "https://probe.example", intervalMin: 30 } } });
    const nodes = await json(call("GET", "/api/komari/nodes"));
    expect(nodes.data.nodes).toHaveLength(2);
    expect(JSON.stringify(nodes.data)).not.toContain("SECRET-AGENT-TOKEN");
    const bound = await json(call("POST", "/api/komari/bind", { body: { uuid: "node-1" } }));
    const id = bound.data.assets[0].id;
    expect(bound.data.assets[0]).toMatchObject({ name: "hk-api-02", price: 20, expiresAt: "2026-11-22" });
    expect(JSON.stringify(store.get(id))).not.toContain("SECRET-AGENT-TOKEN");

    await call("PATCH", `/api/assets/${id}`, { body: { price: 24 } });
    expect(store.get(id)!.komari!.overridden!.price).toEqual({ komari: 20 });
    komariPrice = 22;
    await call("POST", "/api/komari/sync");
    expect(store.get(id)!.price).toBe(24);
    expect(store.get(id)!.komari!.overridden!.price).toEqual({ komari: 22, changed: true });
    await call("POST", `/api/assets/${id}/komari/restore`, { body: { key: "price" } });
    expect(store.get(id)!.price).toBe(22);

    const st = await json(call("GET", "/api/komari/status"));
    expect(st.data.nodes["node-1"]).toMatchObject({ online: true, cpu: 12.5, trafficType: "sum", trafficLimit: 1024 ** 4, cores: 4, os: "Ubuntu 24.04", region: "香港" });
    expect(st.data.ping).toBe("ok");
    // the task with most samples wins; one of its four samples was lost
    expect(st.data.nodes["node-1"].ping).toMatchObject({ task: "CN 联通", latest: 50, avg: 50, loss: 25 });
    expect(st.data.nodes["node-1"].ping.buckets).toHaveLength(24);
    expect(calls.every((c) => ["GET /api/admin/client/list", "POST /api/rpc2 common:getNodesLatestStatus", "POST /api/rpc2 common:getVersion", "POST /api/rpc2 common:getRecords"].includes(c))).toBe(true);
  });
});

describe("备份", () => {
  it("2FA step-up gates backup when enabled", async () => {
    const b = await json(call("POST", "/api/auth/2fa/begin"));
    const code = totpAt(b.data.secret, Math.floor(Date.now() / 30_000));
    expect((await call("POST", "/api/auth/2fa/enable", { body: { code } })).status).toBe(200);
    // enabling counts as a fresh verification; force it stale
    store.db.prepare("UPDATE sessions SET stepup_at = NULL").run();
    const denied = await json(call("GET", "/api/backup/download"));
    expect(denied.data.needStepUp).toBe(true);
    expect((await call("POST", "/api/auth/step-up", { body: { code: totpAt(b.data.secret, Math.floor(Date.now() / 30_000)) } })).status).toBe(200);
    expect((await call("GET", "/api/backup/download")).status).toBe(200);
  });

  it("round trip: download → change → preview → replace (with snapshot) → merge", async () => {
    const res = await call("GET", "/api/backup/download", { token: tokens.full });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const b = await readBackup(bytes);
    expect(b.data.assets.map((a) => a.id)).toEqual(expect.arrayContaining(["dom1", "card1"]));
    expect(b.audit.length).toBeGreaterThan(3);

    await call("PATCH", "/api/assets/dom1", { token: tokens.full, body: { price: 99 } });
    await call("POST", "/api/assets", { token: tokens.full, body: { id: "tmp", type: "mail", name: "a@b.example", price: 0, currency: "USD", cycle: "year" } });
    const pv = await json(call("POST", "/api/backup/preview", { token: tokens.full, raw: bytes }));
    expect(pv.data.preview.conflicts.map((c: any) => c.id)).toContain("dom1");
    expect(pv.data.preview.missing.map((c: any) => c.id)).toContain("tmp");

    const rr = await json(call("POST", "/api/backup/restore?mode=replace", { token: tokens.full, raw: bytes }));
    expect(rr.data.snapshot).toMatch(/^pre-restore-/);
    expect(store.get("dom1")!.price).toBe(12);
    expect(store.get("tmp")).toBeUndefined();
    expect(backup.files().some((f) => f.kind === "pre-restore")).toBe(true);

    const mg = await json(call("POST", "/api/backup/restore?mode=merge", { token: tokens.full, raw: bytes }));
    expect(mg.data.applied).toBe(0);
  });

  it("daily auto backup keeps N files", async () => {
    const s = (await json(call("GET", "/api/settings"))).data.settings;
    expect(s.backup.keep).toBe(30);
    expect(await backup.runDaily(true)).toMatch(/^auto-/);
    expect(backup.status().lastOk).toBeTruthy();
  });

  it("exports CSV / ICS / JSON", async () => {
    const csv = await (await call("GET", "/api/export/csv?type=payment", { token: tokens.full })).text();
    expect(csv).toContain("cardLast4");
    expect(csv).toContain("4242");
    const ics = await (await call("GET", "/api/export/ics", { token: tokens.full })).text();
    expect(ics).toContain("BEGIN:VEVENT");
  });
});

describe("关注 / 置顶", () => {
  it("database migration gives existing assets starred = pinned = false", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO assets (id, type, name, data, updated_at) VALUES (?, ?, ?, ?, ?)").run("old", "domain", "old.dev",
      JSON.stringify({ id: "old", type: "domain", name: "old.dev", price: 1, currency: "USD", cycle: "year", tags: [], details: [], related: [], renewals: [], autoRenew: false, updatedAt: "t" }), "t");
    db.prepare("DELETE FROM _migrations WHERE version >= 2").run(); // pretend this library was created by v0.1.5
    expect(migrate(db)).toBe(2);
    expect(new Store(db).get("old")).toMatchObject({ starred: false, pinned: false, name: "old.dev" });
  });

  it("star / pin through /focus, permissions follow the token, list filter works", async () => {
    await call("POST", "/api/assets", { token: tokens.full, body: { id: "f1", type: "domain", name: "focus.dev", price: 10, currency: "USD", cycle: "year", expiresAt: "2027-02-01" } });
    expect(store.get("f1")).toMatchObject({ starred: false, pinned: false });
    // 可写 token: a change plan, nothing lands yet
    const plan = await json(call("POST", "/api/assets/f1/focus", { token: tokens.write, body: { starred: true } }));
    expect(plan.status).toBe(202);
    expect(store.get("f1")!.starred).toBe(false);
    // signed-in user / 完全权限: direct; 置顶 implies 关注
    const pin = await json(call("POST", "/api/assets/f1/focus", { token: tokens.full, body: { pinned: true } }));
    expect(pin.data.assets[0]).toMatchObject({ starred: true, pinned: true });
    expect(store.auditList({ assetId: "f1" })[0].summary).toBe("置顶「focus.dev」");
    const starredOnly = await json(call("GET", "/api/assets?starred=1", { token: tokens.full }));
    expect(starredOnly.data.assets.map((a: any) => a.id)).toEqual(["f1"]);
    // 取消关注 clears 置顶 too
    const off = await json(call("POST", "/api/assets/f1/focus", { body: { starred: false } }));
    expect(off.data.assets[0]).toMatchObject({ starred: false, pinned: false });
    expect(store.auditList({ assetId: "f1" })[0].summary).toBe("取消关注「focus.dev」");
    // PATCH keeps the same rule
    await call("PATCH", "/api/assets/f1", { body: { pinned: true } });
    await call("PATCH", "/api/assets/f1", { body: { starred: false } });
    expect(store.get("f1")).toMatchObject({ starred: false, pinned: false });
    expect((await call("POST", "/api/assets/f1/focus", { body: {} })).status).toBe(400);
    expect((await json(call("POST", "/api/assets/f1/focus", { body: { starred: false } }))).data.status).toBe("unchanged");
  });

  it("Komari sync keeps 关注 / 置顶", async () => {
    const id = store.list().find((a) => a.komari?.uuid === "node-1")!.id;
    await call("POST", `/api/assets/${id}/focus`, { body: { pinned: true } });
    komariPrice = 31;
    await call("POST", "/api/komari/sync");
    const after = store.get(id)!;
    expect(after.komari!.fields!.price).toBe(31);
    expect(after).toMatchObject({ starred: true, pinned: true });
  });

  it("export and backup carry the fields", async () => {
    await call("POST", "/api/assets/dom1/focus", { body: { starred: true } });
    const csv = await (await call("GET", "/api/export/csv?type=domain", { token: tokens.full })).text();
    expect(csv.split("\r\n")[0]).toContain("starred,pinned");
    const b = await readBackup(new Uint8Array(await (await call("GET", "/api/backup/download", { token: tokens.full })).arrayBuffer()));
    expect(b.manifest.schemaVersion).toBe(3);
    expect(b.data.assets.find((a) => a.id === "dom1")).toMatchObject({ starred: true, pinned: false });
  });
});
