import { describe, expect, it } from "vitest";
import * as req from "../src";
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

describe("v0.1.10 linking: what v0.1.9 missed", () => {
  const feed = [acc("me@example.com"), acc("team1@example.com"), acc("owner@example.com"), acc("alt@example.com", "antigravity")];
  it("normalises emails: case, inner / full-width spaces, zero-width, full-width @, mailto", () => {
    const { normEmail, emailsIn } = req;
    expect(normEmail(" Me @Example.com\u200b")).toBe("me@example.com");
    expect(normEmail("mailto:ME＠EXAMPLE.COM")).toBe("me@example.com");
    expect(emailsIn("主号 Me@Example.com（Team）/ alt@example.com")).toEqual(["me@example.com", "alt@example.com"]);
  });
  it("an account asset named by its email (username empty) links", () => {
    const a = normalizeAsset({ id: "a", type: "account", name: "Me@Example.com", account: { username: "" } } as Asset);
    expect(quotaForAsset(a, feed, [a]).map((x) => x.email)).toEqual(["me@example.com"]);
  });
  it("a subscription's own login username, a detail holding more than the email, and a related account asset all link", () => {
    const login = normalizeAsset({ id: "acc", type: "account", name: "Google", account: { username: "alt@example.com" } } as Asset);
    const s1 = normalizeAsset({ id: "s1", type: "subscription", name: "Plus", account: { username: "ME@example.com " } } as Asset);
    const s2 = normalizeAsset({ id: "s2", type: "subscription", name: "Pro", details: [{ label: "账号", value: "主号 me@example.com（个人）" }] } as Asset);
    const s3 = normalizeAsset({ id: "s3", type: "subscription", name: "AG", related: ["acc"] } as Asset);
    const all = [login, s1, s2, s3];
    expect(quotaForAsset(s1, feed, all).map((x) => x.email)).toEqual(["me@example.com"]);
    expect(quotaForAsset(s2, feed, all).map((x) => x.email)).toEqual(["me@example.com"]);
    expect(quotaForAsset(s3, feed, all).map((x) => `${x.provider}:${x.email}`)).toEqual(["antigravity:alt@example.com"]);
    // the asset holding the email comes before the ones reaching it through their login
    expect(req.linksForAccount(feed[3], all)).toEqual([{ assetId: "acc", via: "email" }, { assetId: "s3", via: "login" }]);
  });
  it("a team's owner links to the team; members link per member; each account lists every asset it reaches", () => {
    const team = normalizeAsset({ id: "t", type: "subscription", name: "Team", team: { owner: "Owner@Example.com", workspaces: [{ id: "w", name: "w", seats: 2, price: 1, currency: "USD", cycle: "month",
      members: [{ email: " Team1@example.com", role: "member" }] }] } } as Asset);
    const sub = normalizeAsset({ id: "acct", type: "account", name: "子号", account: { username: "team1@example.com" } } as Asset);
    const all = [team, sub];
    expect(quotaForAsset(team, feed, all).map((x) => x.email)).toEqual(["team1@example.com", "owner@example.com"]);
    expect(quotaForMembers(team, feed).get("team1@example.com")?.[0].email).toBe("team1@example.com");
    expect(req.linksForAccount(feed[1], all)).toEqual([{ assetId: "t", member: "team1@example.com", via: "member" }, { assetId: "acct", via: "email" }]);
  });
  it("feed accounts without an email take one from the label", () => {
    expect(req.pickQuotaAccount({ id: "x", provider: "Codex", label: "Work Box@Example.com", windows: [] }, "c", "c")?.email).toBe("box@example.com");
  });
  it("a manual bind (pref) links an account with no matching email, also to one member; prefs survive an id change", () => {
    const team = normalizeAsset({ id: "t", type: "subscription", name: "Team", team: { owner: "", workspaces: [{ id: "w", name: "w", seats: 2, price: 1, currency: "USD", cycle: "month",
      members: [{ email: "b@x.com", role: "member" }] }] } } as Asset);
    const other = acc("other@example.com");
    const prefs = req.normalizeCpaPrefs([{ connectionId: "家里", accountId: "old-id", provider: "codex", email: "OTHER@example.com", starred: true, assetId: "t", member: "B@x.com" },
      { connectionId: "家里", accountId: "nothing", provider: "codex", starred: false }]);
    expect(prefs).toHaveLength(1);
    expect(req.prefFor(other, prefs)?.starred).toBe(true);
    expect(quotaForAsset(team, [other], [team], prefs)).toHaveLength(1);
    expect(quotaForMembers(team, [other], prefs).get("b@x.com")?.[0].email).toBe("other@example.com");
    expect(req.linksForAccount(other, [team], prefs)).toEqual([{ assetId: "t", member: "b@x.com", via: "bind" }]);
  });
  it("deleted and non-login assets never link", () => {
    const gone = normalizeAsset({ id: "g", type: "account", name: "me@example.com", deletedAt: "2026-01-01T00:00:00Z" } as Asset);
    const card = normalizeAsset({ id: "p", type: "payment", name: "me@example.com", payment: { issuer: "x", last4: "1234" } } as Asset);
    expect(req.linksForAccount(feed[0], [gone, card])).toEqual([]);
  });
});
