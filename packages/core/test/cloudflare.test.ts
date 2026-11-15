import { describe, expect, it } from "vitest";
import {
  buildAtollView, buildCloudflareView, checkHost, expectedForAtollHost, isWritePermission, pickCfRecord, pickCfRegistration, tokenPermissionNames,
  tunnelHostnames, tunnelIdOf, tunnelOriginIps, zoneForHost, zoneToAssetInput,
  type Asset, type AtollSnapshot, type CfSnapshot, type CfZone,
} from "../src";

const T = "Sun 2026-11-15 12:00 AM UTC (UTC+00:00)";
const mk = (s: Partial<Asset> & Pick<Asset, "id" | "type" | "name">): Asset => ({
  price: 0, currency: "USD", cycle: "year", autoRenew: false, tags: [], details: [], related: [], renewals: [], createdAt: T, updatedAt: T, ...s,
});
const zone = (id: string, name: string): CfZone => ({ id, name, status: "active", paused: false, accountId: "acc", nameServers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"] });
const TUN = "c1744f8b-faa1-48a4-9e5c-02ac921467fa";
const ok = { state: "ok" as const };

const snap: CfSnapshot = {
  syncedAt: T,
  accounts: [{ id: "acc", name: "sak" }],
  zones: [zone("z1", "example.com"), zone("z2", "other.dev"), zone("z3", "lab.example.com")],
  records: [
    { zoneId: "z1", name: "example.com", type: "A", content: "192.0.2.10", proxied: true },
    { zoneId: "z1", name: "www.example.com", type: "CNAME", content: "example.com", proxied: true },
    { zoneId: "z1", name: "api.example.com", type: "A", content: "192.0.2.11", proxied: true },
    { zoneId: "z1", name: "admin.example.com", type: "A", content: "192.0.2.10", proxied: false },
    { zoneId: "z1", name: "bi.example.com", type: "CNAME", content: `${TUN}.cfargotunnel.com`, proxied: true },
    { zoneId: "z1", name: "dup.example.com", type: "A", content: "198.51.100.50", proxied: false },
    { zoneId: "z1", name: "ext.example.com", type: "CNAME", content: "target.vendor.example", proxied: false },
  ],
  registrations: [{ name: "example.com", accountId: "acc", expiresAt: "2027-12-03", autoRenew: true, locked: true }],
  tunnels: [{ id: TUN, name: "sg-data", status: "healthy", accountId: "acc", hostnames: ["bi.example.com"], originIps: ["198.51.100.7"], connections: 4 }],
  workers: [{ name: "edge", accountId: "acc", domains: ["edge.example.com"] }],
  pages: [{ name: "docs", accountId: "acc", subdomain: "docs.pages.dev", domains: ["docs.other.dev"] }],
  r2: [{ name: "assets", accountId: "acc", location: "APAC" }],
  sections: { accounts: ok, zones: ok, dns: ok, registrar: ok, tunnels: ok, workers: ok, pages: ok, r2: ok },
};

const assets = [
  mk({ id: "d", type: "domain", name: "example.com", expiresAt: "2026-12-03", autoRenew: false }),
  mk({ id: "hk1", type: "server", name: "hk1", details: [{ label: "IPv4", value: "192.0.2.10" }] }),
  mk({ id: "hk2", type: "server", name: "hk2", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
  mk({ id: "sg", type: "server", name: "sg", details: [{ label: "IPv4", value: "198.51.100.7" }] }),
  mk({ id: "x1", type: "server", name: "x1", details: [{ label: "IPv4", value: "198.51.100.50" }] }),
  mk({ id: "x2", type: "server", name: "x2", details: [{ label: "公网 IP", value: "198.51.100.50" }] }),
];

describe("Cloudflare token permissions", () => {
  it("treats any Edit / Write group as not read-only", () => {
    expect(["Zone Read", "DNS Read", "Account Settings Read", "Cloudflare Tunnel Read", "Workers R2 Storage Read"].some(isWritePermission)).toBe(false);
    for (const n of ["DNS Write", "Zone Edit", "Cloudflare Pages Edit", "Cache Purge", "Access: Apps Revoke", "AI Gateway Run"]) expect(isWritePermission(n), n).toBe(true);
  });
  it("collects the allowed permission group names of a token", () => {
    const t = { policies: [
      { effect: "allow", permission_groups: [{ id: "1", name: "Zone Read" }, { id: "2", name: "DNS Read" }] },
      { effect: "deny", permission_groups: [{ id: "3", name: "DNS Write" }] },
      { effect: "allow", permission_groups: [{ id: "2", name: "DNS Read" }] },
    ] };
    expect(tokenPermissionNames(t)).toEqual(["Zone Read", "DNS Read"]);
    expect(tokenPermissionNames(null)).toEqual([]);
  });
});

describe("Cloudflare picking", () => {
  it("keeps only A / AAAA / CNAME records and lowercases names", () => {
    expect(pickCfRecord({ type: "TXT", name: "x.com", content: "v=spf1" }, "z")).toBeNull();
    expect(pickCfRecord({ type: "MX", name: "x.com", content: "mx.x.com" }, "z")).toBeNull();
    expect(pickCfRecord({ type: "CNAME", name: "WWW.X.com.", content: "X.com.", proxied: true, ttl: 1, comment: "secret" }, "z"))
      .toEqual({ zoneId: "z", name: "www.x.com", type: "CNAME", content: "x.com", proxied: true, ttl: 1 });
  });
  it("reads both the new and the legacy Registrar shapes", () => {
    expect(pickCfRegistration({ domain_name: "a.com", expires_at: "2027-01-15T10:00:00Z", auto_renew: true, locked: true, status: "active" }, "acc"))
      .toEqual({ name: "a.com", accountId: "acc", status: "active", expiresAt: "2027-01-15", autoRenew: true, locked: true });
    expect(pickCfRegistration({ name: "b.com", expires_at: "2028-03-20T00:00:00Z", auto_renew: false }, "acc").expiresAt).toBe("2028-03-20");
  });
  it("reads tunnel hostnames and connection origin IPs", () => {
    expect(tunnelHostnames({ config: { ingress: [{ hostname: "A.example.com", service: "http://localhost:80" }, { service: "http_status:404" }] } })).toEqual(["a.example.com"]);
    expect(tunnelOriginIps([{ conns: [{ origin_ip: "198.51.100.7" }, { origin_ip: "198.51.100.7" }] }, { conns: [{ origin_ip: "bad" }] }])).toEqual({ ips: ["198.51.100.7"], connections: 3 });
    expect(tunnelIdOf(`${TUN}.cfargotunnel.com`)).toBe(TUN);
    expect(tunnelIdOf("example.com")).toBeNull();
  });
  it("finds the zone by longest suffix", () => {
    expect(zoneForHost("a.lab.example.com", snap.zones)?.id).toBe("z3");
    expect(zoneForHost("api.example.com", snap.zones)?.id).toBe("z1");
    expect(zoneForHost("nope.net", snap.zones)).toBeNull();
  });
});

describe("buildCloudflareView", () => {
  const v = buildCloudflareView(assets, snap);

  it("pairs a zone and its registration with the domain asset and only suggests differing values", () => {
    const d = v.byDomain.get("d")!;
    expect(d.zone?.id).toBe("z1");
    expect(d.registration?.expiresAt).toBe("2027-12-03");
    expect(d.suggestions).toEqual([
      { field: "expiresAt", label: "到期日", cf: "2027-12-03", current: "2026-12-03" },
      { field: "autoRenew", label: "自动续费", cf: true, current: false },
    ]);
    const same = buildCloudflareView([mk({ id: "d", type: "domain", name: "example.com", expiresAt: "2027-12-03", autoRenew: true })], snap);
    expect(same.byDomain.get("d")!.suggestions).toEqual([]);
  });

  it("lists zones without a domain asset as importable (a subzone of an asset is covered)", () => {
    expect(v.importable.map((z) => z.name)).toEqual(["other.dev"]);
    const input = zoneToAssetInput(snap.zones[0], snap.registrations[0]);
    expect(input).toMatchObject({ type: "domain", name: "example.com", provider: "Cloudflare", expiresAt: "2027-12-03", autoRenew: true });
    expect(zoneToAssetInput(snap.zones[1], null)).toMatchObject({ expiresAt: null, autoRenew: false, subtitle: "Cloudflare 托管 DNS" });
  });

  it("links A records to the one VPS with that IP and never guesses between two", () => {
    const t = (n: string) => v.records.find((r) => r.name === n)!.target;
    expect(t("api.example.com")).toEqual({ kind: "server", assetId: "hk2", ip: "192.0.2.11" });
    expect(t("dup.example.com")).toEqual({ kind: "ambiguous", ip: "198.51.100.50", candidates: ["x1", "x2"] });
    expect(t("ext.example.com")).toEqual({ kind: "host", host: "target.vendor.example" });
  });

  it("links CNAME → tunnel → server through the connection origin IP", () => {
    expect(v.records.find((r) => r.name === "bi.example.com")!.target).toEqual({ kind: "tunnel", tunnelId: TUN, tunnelName: "sg-data", serverAssetId: "sg" });
    expect(v.tunnels[0].match).toEqual({ assetId: "sg", ip: "198.51.100.7" });
    expect(v.byServer.get("sg")!.map((r) => r.name)).toEqual(["bi.example.com"]);
    expect(v.byServer.get("hk1")!.map((r) => r.name)).toEqual(["example.com", "admin.example.com"]);
  });

  it("shows Workers / Pages / R2 as services with custom domains tied to domain assets", () => {
    expect(v.services.map((s) => `${s.kind}:${s.name}`)).toEqual(["worker:edge", "pages:docs", "r2:assets"]);
    expect(v.services[0].domains).toEqual([{ hostname: "edge.example.com", domainAssetId: "d" }]);
    expect(v.services[1].domains[0].domainAssetId).toBeNull();
  });

  it("is empty without a snapshot and never changes the assets", () => {
    const before = JSON.stringify(assets);
    const e = buildCloudflareView(assets, null);
    expect(e.on).toBe(false);
    expect(e.byDomain.size).toBe(0);
    expect(JSON.stringify(assets)).toBe(before);
  });
});

describe("checkHost (Atoll hostname ↔ Cloudflare)", () => {
  const v = buildCloudflareView(assets, snap);
  const at = (ips: string[], serverAssetId: string | null) => ({ ips, serverAssetId });

  it("agrees when the record points at the project's server (following CNAMEs)", () => {
    expect(checkHost(v, "api.example.com", at(["192.0.2.11"], "hk2")).issues).toEqual([]);
    const www = checkHost(v, "www.example.com", at(["192.0.2.10"], "hk1"));
    expect(www.final?.name).toBe("example.com");
    expect(www.issues).toEqual([]);
  });
  it("flags a record pointing at another IP", () => {
    expect(checkHost(v, "admin.example.com", at(["192.0.2.11"], "hk2")).issues).toEqual([{ level: "warn", text: "记录指向 192.0.2.10，不是项目所在服务器" }]);
  });
  it("flags a hostname with no record, and stays neutral outside Cloudflare zones", () => {
    expect(checkHost(v, "status.example.com", at(["192.0.2.11"], "hk2")).issues[0].level).toBe("warn");
    expect(checkHost(v, "cdn.example.net", at([], null)).issues).toEqual([{ level: "info", text: "不在 Cloudflare 管理的 zone 里" }]);
  });
  it("accepts a tunnel running on the project's server and flags one running elsewhere", () => {
    const good = checkHost(v, "bi.example.com", at(["198.51.100.7"], "sg"));
    expect(good.viaTunnel?.name).toBe("sg-data");
    expect(good.issues).toEqual([]);
    expect(checkHost(v, "bi.example.com", at(["192.0.2.11"], "hk2")).issues[0]).toEqual({ level: "warn", text: "走的 Tunnel「sg-data」运行在另一台服务器上" });
  });
  it("notes a proxy flag that disagrees with Atoll", () => {
    expect(checkHost(v, "admin.example.com", at(["192.0.2.10"], "hk1"), true).issues).toEqual([{ level: "info", text: "Atoll 标记为代理，Cloudflare 里没开代理" }]);
  });
  it("builds expected IPs from the Atoll server and the matched VPS", () => {
    const atollSnap: AtollSnapshot = { syncedAt: T, servers: [{ id: "A", name: "a", status: "online", public_ipv6: "2001:db8::1" }], projects: [] };
    const la = mk({ id: "la", type: "server", name: "la", details: [{ label: "IPv4", value: "203.0.113.42" }], atoll: { serverId: "A" } });
    const av = buildAtollView([la], atollSnap);
    expect(expectedForAtollHost({ serverId: "A", serverAssetId: "la" }, av.servers, [la]).ips.sort()).toEqual(["2001:db8:0:0:0:0:0:1", "203.0.113.42"]);
    // the VPS is also known by its Atoll server's IPs when linking AAAA records
    const s2: CfSnapshot = { ...snap, records: [{ zoneId: "z1", name: "blog.example.com", type: "AAAA", content: "2001:db8::1", proxied: true }], tunnels: [] };
    expect(buildCloudflareView([la], s2, av).records[0].target).toMatchObject({ kind: "server", assetId: "la" });
  });
});
