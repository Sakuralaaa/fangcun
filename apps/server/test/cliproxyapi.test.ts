import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildConnectionString, readBackup } from "@fangcun/core";
import { createApp } from "../src/app";
import { BackupService } from "../src/backup";
import { CliproxyService } from "../src/cliproxyapi";
import { openDb } from "../src/db";
import { KomariService } from "../src/komari";
import { Store } from "../src/store";

const TOKEN = "fcq_" + "A".repeat(43);
const conn = buildConnectionString({ url: "https://cpa.example.com", feedPath: "/v0/resource/plugins/fangcun/feed", token: TOKEN });
const requests: { url: string; auth: string; method: string }[] = [];
const fakeFetch = (async (url: string, init: RequestInit) => {
  const auth = (init.headers as Record<string, string>).Authorization;
  requests.push({ url, auth, method: String(init.method) });
  if (auth !== `Bearer ${TOKEN}`) return new Response("{}", { status: 401 });
  return Response.json({ v: 1, accounts: [
    { id: "a1", provider: "codex", email: "Dev@Example.com", plan: "plus", status: "ok", access_token: "LEAKED-SECRET", windows: [{ key: "5h", window: "5h", usedPct: 62, resetAt: "2026-11-15T07:00:00Z" }] },
    { id: "a2", provider: "antigravity", email: "ag@example.com", status: "ok", windows: [] },
  ] });
}) as unknown as typeof fetch;

const dir = mkdtempSync(join(tmpdir(), "fangcun-cpx-"));
const store = new Store(openDb(":memory:"));
const cliproxy = new CliproxyService(store, fakeFetch);
const backup = new BackupService(store, dir, join(dir, "backups"));
const app = createApp({ store, komari: new KomariService(store, "", fakeFetch), backup, cliproxy, secureCookie: false });

let cookie = "";
const call = async (method: string, path: string, opts: { body?: unknown; token?: string } = {}) => {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (cookie) { headers.Cookie = cookie; headers["X-Fangcun"] = "1"; }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc?.startsWith("fc_session=")) cookie = sc.split(";")[0];
  return res;
};
const tokens: Record<string, string> = {};

beforeAll(async () => {
  await call("POST", "/api/auth/setup", { body: { username: "sak", password: "correct-horse-battery" } });
  for (const scope of ["read", "full"]) tokens[scope] = ((await (await call("POST", "/api/tokens", { body: { name: scope, scope } })).json()) as { token: string }).token;
});

describe("CLIProxyAPI connections", () => {
  it("rejects bad strings and only admins (web) add connections", async () => {
    expect((await call("POST", "/api/cliproxyapi/connections", { body: { name: "x", connection: "hello" } })).status).toBe(400);
    expect((await call("POST", "/api/cliproxyapi/connections", { body: { name: "x", connection: conn }, token: tokens.full })).status).toBe(403);
  });

  it("adds named connections, reads the feed with the token in a header only, matches by email", async () => {
    const r = await call("POST", "/api/cliproxyapi/connections", { body: { name: "家里 NAS", note: "个人", connection: conn } });
    expect(r.status).toBe(200);
    const r2 = await call("POST", "/api/cliproxyapi/connections", { body: { name: "香港机", note: "", connection: conn } });
    expect(r2.status).toBe(200);
    expect(requests.every((q) => q.method === "GET" && !q.url.includes(TOKEN) && q.url.startsWith("https://cpa.example.com/v0/resource/plugins/fangcun/feed"))).toBe(true);
    const d = (await (await call("GET", "/api/cliproxyapi", { token: tokens.read })).json()) as any;
    expect(d.connections.map((c: any) => c.name)).toEqual(["家里 NAS", "香港机"]);
    expect(d.accounts).toHaveLength(4);
    expect(d.accounts[0]).toMatchObject({ email: "dev@example.com", connectionName: "家里 NAS", windows: [{ usedPct: 62 }] });
  });

  it("never lets the feed token or unknown feed fields out: API (session and tokens), backup, export", async () => {
    const bodies = [
      await (await call("GET", "/api/cliproxyapi")).text(),
      await (await call("GET", "/api/cliproxyapi", { token: tokens.read })).text(),
      await (await call("POST", "/api/cliproxyapi/refresh", { token: tokens.full })).text(),
      await (await call("GET", "/api/settings", { token: tokens.read })).text(),
      await (await call("GET", "/api/export/json", { token: tokens.full })).text(),
    ];
    for (const b of bodies) { expect(b).not.toContain(TOKEN); expect(b).not.toContain("LEAKED-SECRET"); }
    const snapshotRaw = (store.db.prepare("SELECT snapshot FROM cliproxyapi_connections").all() as { snapshot: string }[]).map((r) => r.snapshot).join();
    expect(snapshotRaw).not.toContain("LEAKED-SECRET");
    const b = await readBackup(await backup.build());
    const all = JSON.stringify(b.data) + JSON.stringify(b.audit);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("cpa.example.com");
  });

  it("stars and binds accounts in 方寸 only: GET only to CLIProxyAPI, audit, permissions, validation", async () => {
    const n = requests.length;
    const id = cliproxy.list()[0].id;
    expect((await call("POST", "/api/assets", { body: { id: "plus", type: "subscription", name: "ChatGPT Plus", price: 20, currency: "USD", cycle: "month" } })).status).toBe(200);
    expect((await call("POST", "/api/assets", { body: { id: "srv", type: "server", name: "hk", price: 5, currency: "USD", cycle: "month" } })).status).toBe(200);
    expect((await call("PUT", `/api/cliproxyapi/accounts/${id}/a1`, { body: { starred: true }, token: tokens.read })).status).toBe(403);
    expect((await call("PUT", `/api/cliproxyapi/accounts/${id}/nope`, { body: { starred: true } })).status).toBe(404);
    expect((await call("PUT", `/api/cliproxyapi/accounts/${id}/a1`, { body: { assetId: "srv" } })).status).toBe(400);
    expect((await call("PUT", `/api/cliproxyapi/accounts/${id}/a1`, { body: { assetId: "plus", member: "x@y.com" } })).status).toBe(400);
    let r = (await (await call("PUT", `/api/cliproxyapi/accounts/${id}/a1`, { body: { starred: true } })).json()) as any;
    expect(r.prefs).toEqual([{ connectionId: id, accountId: "a1", provider: "codex", email: "dev@example.com", starred: true, assetId: null, member: null, connectionName: "家里 NAS" }]);
    r = (await (await call("PUT", `/api/cliproxyapi/accounts/${id}/a2`, { body: { assetId: "plus" }, token: tokens.full })).json()) as any;
    expect(r.prefs.find((p: any) => p.accountId === "a2")).toMatchObject({ starred: false, assetId: "plus" });
    const d = (await (await call("GET", "/api/cliproxyapi", { token: tokens.read })).json()) as any;
    expect(d.prefs).toHaveLength(2);
    expect(requests.slice(n)).toEqual([]);
    expect(store.db.prepare("SELECT summary FROM audit WHERE action = 'cliproxyapi-account'").all().map((x: any) => x.summary)).toEqual([
      "CLIProxyAPI 账号 dev@example.com：关注", "CLIProxyAPI 账号 ag@example.com：绑定到「ChatGPT Plus」"]);
    // unstar + unbind removes the row
    await call("PUT", `/api/cliproxyapi/accounts/${id}/a2`, { body: { assetId: null } });
    expect(cliproxy.prefs().map((p) => p.accountId)).toEqual(["a1"]);
    await call("PUT", `/api/cliproxyapi/accounts/${id}/a2`, { body: { assetId: "plus" } });
  });

  it("backups and the JSON export carry 关注 / binds (no token, no address); restore finds the connection by name", async () => {
    const id = cliproxy.list()[0].id;
    const bytes = await backup.build();
    const b = await readBackup(bytes);
    expect(b.data.cliproxyapi?.map((p) => [p.accountId, p.starred, p.assetId, p.connectionName])).toEqual([["a1", true, null, "家里 NAS"], ["a2", false, "plus", "家里 NAS"]]);
    const exp = await (await call("GET", "/api/export/json", { token: tokens.full })).text();
    expect(exp).toContain('"cliproxyapi"');
    expect(exp).not.toContain(TOKEN);
    // the connection got a new id (re-added): replace restore maps the rows by name
    store.db.prepare("UPDATE cliproxyapi_connections SET id = 'cpx_new' WHERE id = ?").run(id);
    store.db.exec("DELETE FROM cliproxyapi_accounts");
    await backup.restore(bytes, "replace", "sak");
    expect(cliproxy.prefs().map((p) => `${p.connectionId}/${p.accountId}`)).toEqual(["cpx_new/a1", "cpx_new/a2"]);
    store.db.prepare("UPDATE cliproxyapi_connections SET id = ? WHERE id = 'cpx_new'").run(id);
    store.db.prepare("UPDATE cliproxyapi_accounts SET connection_id = ? WHERE connection_id = 'cpx_new'").run(id);
  });

  it("a rotated token shows as an error on that connection", async () => {
    const id = cliproxy.list()[0].id;
    store.db.prepare("UPDATE cliproxyapi_connections SET token = ? WHERE id = ?").run("fcq_" + "B".repeat(43), id);
    expect((await call("POST", `/api/cliproxyapi/refresh?id=${id}`)).status).toBe(502);
    expect(cliproxy.list()[0].lastError).toContain("拒绝");
  });

  it("deletes a connection", async () => {
    const id = cliproxy.list()[1].id;
    expect((await call("DELETE", `/api/cliproxyapi/connections/${id}`)).status).toBe(200);
    expect(cliproxy.list()).toHaveLength(1);
    const left = cliproxy.list()[0].id;
    expect((await call("DELETE", `/api/cliproxyapi/connections/${left}`)).status).toBe(200);
    expect(cliproxy.prefs()).toEqual([]);
  });
});
