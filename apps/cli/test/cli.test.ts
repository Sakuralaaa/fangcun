import { describe, expect, it } from "vitest";
import { Client } from "../src/client";
import { assetRows, focusMark, ops, parseSets, writeResult } from "../src/commands";
import { handle, TOOLS } from "../src/mcp";

const fake = (responses: Record<string, unknown>, seen: string[] = []) =>
  new Client({ url: "http://fc.test", token: "fc_test" }, (async (url: string, init: RequestInit) => {
    seen.push(`${init.method} ${url.replace("http://fc.test", "")}`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fc_test");
    const key = Object.keys(responses).find((k) => url.includes(k));
    return Response.json(key ? responses[key] : { error: "nope" }, { status: key ? 200 : 404 });
  }) as unknown as typeof fetch);

describe("CLI", () => {
  it("parses --set key=value into a patch", () => {
    expect(parseSets(["price=12", "tags=a,b", "payment.last4=4242", "autoRenew=yes", "expiresAt="])).toEqual({
      price: 12, tags: ["a", "b"], payment: { last4: "4242" }, autoRenew: true, expiresAt: null,
    });
  });
});

describe("MCP", () => {
  it("initialize / tools/list / tools/call", async () => {
    const seen: string[] = [];
    const c = fake({ "/api/assets?": { today: "2026-11-15", assets: [{ id: "b", expiresAt: "2027-01-01" }, { id: "a", expiresAt: "2026-11-20" }] } }, seen);
    const init = (await handle(c, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as any;
    expect(init.result.serverInfo.name).toBe("fangcun");
    expect(await handle(c, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list = (await handle(c, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as any;
    expect(list.result.tools.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name));
    const call = (await handle(c, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_assets", arguments: { type: "payment" } } })) as any;
    expect(JSON.parse(call.result.content[0].text).map((a: any) => a.id)).toEqual(["a", "b"]);
    expect(seen[0]).toBe("GET /api/assets?type=payment");
    const bad = (await handle(c, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_asset", arguments: { id: "zz" } } })) as any;
    expect(bad.result.isError).toBe(true);
  });
});

describe("关注 / 置顶", () => {
  it("--set starred / pinned are booleans", () => {
    expect(parseSets(["starred=yes", "pinned=0"])).toEqual({ starred: true, pinned: false });
  });

  it("list: starred filter, pinned first; table marks ★ and ★↑", async () => {
    const seen: string[] = [];
    const c = fake({ "/api/assets?": { today: "2026-11-15", assets: [
      { id: "soon", name: "soon", type: "domain", price: 0, currency: "USD", cycle: "year", expiresAt: "2026-11-20", starred: true, pinned: false },
      { id: "pin", name: "pin", type: "domain", price: 0, currency: "USD", cycle: "year", expiresAt: "2027-11-20", starred: true, pinned: true },
    ] } }, seen);
    const list = await ops.list(c, { starred: true });
    expect(seen[0]).toBe("GET /api/assets?starred=1");
    expect(list.map((a) => a.id)).toEqual(["pin", "soon"]);
    const out = assetRows(list, "2026-11-15");
    expect(out.split("\n")[1].startsWith("★↑")).toBe(true);
    expect(out.split("\n")[2].startsWith("★ ")).toBe(true);
    expect(focusMark({ starred: false, pinned: false })).toBe("");
  });

  it("MCP set_focus posts one asset to /focus; list_assets starred_only", async () => {
    const seen: string[] = [];
    const bodies: unknown[] = [];
    const c = new Client({ url: "http://fc.test", token: "fc_test" }, (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url.replace("http://fc.test", "")}`);
      if (init.body) bodies.push(JSON.parse(String(init.body)));
      if (url.includes("/focus")) return Response.json({ status: "pending", changeset: { id: "cs_1", summary: "置顶「hk」" } }, { status: 202 });
      return Response.json({ today: "2026-11-15", assets: [] });
    }) as unknown as typeof fetch);
    const r = (await handle(c, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "set_focus", arguments: { id: "hk", pinned: true } } })) as any;
    expect(r.result.isError).toBeUndefined();
    expect(JSON.parse(r.result.content[0].text).status).toBe("pending"); // 可写令牌 → change plan, as with every write
    expect(seen[0]).toBe("POST /api/assets/hk/focus");
    expect(bodies[0]).toEqual({ pinned: true });
    await handle(c, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_assets", arguments: { starred_only: true } } });
    expect(seen[1]).toBe("GET /api/assets?starred=1");
    expect(writeResult({ status: "pending", changeset: { id: "cs_1", summary: "置顶「hk」" } })).toContain("变更计划");
  });
});
