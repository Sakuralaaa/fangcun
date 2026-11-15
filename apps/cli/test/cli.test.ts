import { describe, expect, it } from "vitest";
import { Client } from "../src/client";
import { parseSets } from "../src/commands";
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
