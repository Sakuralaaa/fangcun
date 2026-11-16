import { describe, expect, it } from "vitest";
import { buildConnectionString, normalizeAsset, parseConnectionString, quotaForAsset, quotaForMembers, type Asset, type QuotaAccount } from "../src";

const T = "fcq_" + "x".repeat(43);

describe("connection string", () => {
  it("round-trips and tolerates whitespace / line breaks", () => {
    const s = buildConnectionString({ url: "https://cpa.example.com", feedPath: "/v0/resource/plugins/fangcun/feed", token: T });
    expect(parseConnectionString(`  ${s.slice(0, 30)}\n${s.slice(30)} `)).toEqual({ url: "https://cpa.example.com", feedPath: "/v0/resource/plugins/fangcun/feed", token: T });
  });
  it("rejects junk without echoing the token", () => {
    expect(() => parseConnectionString("abc")).toThrow(/fangcun-cliproxyapi/);
    expect(() => parseConnectionString("fangcun-cliproxyapi:!!!")).toThrow();
    const bad = (o: object) => () => parseConnectionString("fangcun-cliproxyapi:" + Buffer.from(JSON.stringify(o)).toString("base64url"));
    expect(bad({ v: 2, u: "https://a.b", t: T })).toThrow(/版本/);
    expect(bad({ v: 1, u: "ftp://a.b", t: T })).toThrow(/地址/);
    expect(bad({ v: 1, u: "https://a.b", p: "/v0/management/x", t: T })).toThrow(/路径/);
    try { bad({ v: 1, u: "https://a.b", t: "fcq_short" })(); } catch (e) { expect((e as Error).message).not.toContain("fcq_short"); }
  });
});

const acc = (email: string, provider = "codex", conn = "家里"): QuotaAccount => ({ id: email, provider, email, status: "ok", windows: [], connectionId: conn, connectionName: conn });

describe("matching", () => {
  const login = normalizeAsset({ id: "acc", type: "account", name: "AI 账号", account: { username: "Me@Example.com" } } as Asset);
  const sub = normalizeAsset({ id: "s", type: "subscription", name: "Pro", accountId: "acc", details: [{ label: "备用", value: "alt@example.com" }] } as Asset);
  const list = [acc("me@example.com"), acc("me@example.com", "antigravity", "香港"), acc("alt@example.com"), acc("other@example.com")];
  it("links by the login account and detail emails, case-insensitive, from every connection", () => {
    expect(quotaForAsset(sub, list, [login, sub]).map((a) => `${a.provider}:${a.email}:${a.connectionName}`)).toEqual(["codex:me@example.com:家里", "antigravity:me@example.com:香港", "codex:alt@example.com:家里"]);
  });
  it("manual binds add accounts; a server asset never links", () => {
    const bound = normalizeAsset({ ...sub, quotaBinds: [{ provider: "Codex", email: "OTHER@example.com" }] } as Asset);
    expect(quotaForAsset(bound, list, [login]).map((a) => a.email)).toContain("other@example.com");
    expect(quotaForAsset(normalizeAsset({ id: "v", type: "server", name: "v", details: [{ label: "x", value: "me@example.com" }] } as Asset), list)).toEqual([]);
  });
  it("team members get their own account, by email or by a member bind", () => {
    const team = normalizeAsset({ id: "t", type: "subscription", name: "Team", quotaBinds: [{ provider: "codex", email: "other@example.com", member: "b@x.com" }],
      team: { owner: "o@x.com", workspaces: [{ id: "w", name: "w", seats: 3, price: 1, currency: "USD", cycle: "month", members: [{ email: "Me@example.com", role: "member" }, { email: "b@x.com", role: "member" }] }] } } as Asset);
    const m = quotaForMembers(team, list);
    expect(m.get("me@example.com")?.length).toBe(2);
    expect(m.get("b@x.com")?.[0].email).toBe("other@example.com");
  });
});
