import { describe, expect, it } from "vitest";
import {
  assetIps, atollImpact, buildAtollView, canonicalIp, domainAssetForHost, matchAtollServers, mergeAtollDomains, normalizeAsset,
  pickAtollProject, type Asset, type AtollServer, type AtollSnapshot,
} from "../src";

const T = "2026-11-15T00:00:00.000Z";
const mk = (s: Partial<Asset> & Pick<Asset, "id" | "type" | "name">): Asset => ({
  price: 0, currency: "USD", cycle: "month", autoRenew: false, tags: [], details: [], related: [], renewals: [], starred: false, pinned: false, createdAt: T, updatedAt: T, ...s,
});
const srv = (id: string, v4?: string, v6?: string): AtollServer => ({ id, name: id, status: "online", public_ipv4: v4, public_ipv6: v6 });

describe("canonicalIp", () => {
  it("normalises IPv4 and IPv6 forms", () => {
    expect(canonicalIp(" 192.0.2.11 ")).toBe("192.0.2.11");
    expect(canonicalIp("192.0.2.256")).toBeNull();
    expect(canonicalIp("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8:0:0:0:0:0:1");
    expect(canonicalIp("2001:db8::1")).toBe(canonicalIp("2001:0db8:0000::0001"));
    expect(canonicalIp("[2001:db8::1]")).toBe(canonicalIp("2001:db8::1/64"));
    expect(canonicalIp("香港")).toBeNull();
    expect(canonicalIp("1:2:3")).toBeNull();
  });
});

describe("assetIps", () => {
  it("reads every IP-like detail row and the IPs last seen in Komari", () => {
    const a = mk({ id: "s", type: "server", name: "s",
      details: [{ label: "IPv4", value: "192.0.2.11" }, { label: "公网 IP", value: "198.51.100.1, 198.51.100.2" }, { label: "IP 地址", value: "2001:db8::1 / 10.0.0.2" }, { label: "地区", value: "1.1.1.1" }],
      komari: { uuid: "k", fields: { "detail:IPv4": "203.0.113.9", "detail:IPv6": "2001:db8::9" } } });
    expect(assetIps(a).sort()).toEqual(["10.0.0.2", "192.0.2.11", "198.51.100.1", "198.51.100.2", "2001:db8:0:0:0:0:0:1", "2001:db8:0:0:0:0:0:9", "203.0.113.9"].sort());
  });
});

describe("matchAtollServers", () => {
  const servers = [srv("A", "192.0.2.11"), srv("B", "", "2001:db8::2"), srv("C", "198.51.100.7")];

  it("matches by public IPv4 or IPv6", () => {
    const assets = [
      mk({ id: "hk", type: "server", name: "hk", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
      mk({ id: "v6", type: "server", name: "v6", details: [{ label: "IPv6", value: "2001:0db8:0:0::2" }] }),
      mk({ id: "none", type: "server", name: "none", details: [{ label: "IPv4", value: "203.0.113.1" }] }),
      mk({ id: "dom", type: "domain", name: "198.51.100.7" }),
    ];
    const m = matchAtollServers(assets, servers);
    expect(m.get("hk")).toEqual({ serverId: "A", via: "ip", ip: "192.0.2.11" });
    expect(m.get("v6")).toMatchObject({ serverId: "B", via: "ip" });
    expect(m.get("none")).toEqual({ serverId: null, via: "none" });
    expect(m.has("dom")).toBe(false);
  });

  it("manual binding wins over IP and takes the server out of auto matching", () => {
    const assets = [
      mk({ id: "byip", type: "server", name: "byip", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
      mk({ id: "manual", type: "server", name: "manual", details: [{ label: "IPv4", value: "198.51.100.7" }], atoll: { serverId: "A" } }),
      mk({ id: "off", type: "server", name: "off", details: [{ label: "IPv4", value: "198.51.100.7" }], atoll: { serverId: null } }),
      mk({ id: "gone", type: "server", name: "gone", atoll: { serverId: "Z" } }),
    ];
    const m = matchAtollServers(assets, servers);
    expect(m.get("manual")).toEqual({ serverId: "A", via: "manual" });
    expect(m.get("byip")).toEqual({ serverId: null, via: "none" }); // A is claimed by hand
    expect(m.get("off")).toEqual({ serverId: null, via: "manual-none" }); // C would match by IP, but the user said no
    expect(m.get("gone")).toEqual({ serverId: "Z", via: "manual-missing" });
  });

  it("does not guess when one IP fits several assets", () => {
    const assets = [
      mk({ id: "x", type: "server", name: "x", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
      mk({ id: "y", type: "server", name: "y", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
    ];
    const m = matchAtollServers(assets, servers);
    expect(m.get("x")).toEqual({ serverId: null, via: "ambiguous", candidates: ["A"] });
    expect(m.get("y")?.via).toBe("ambiguous");
  });
});

describe("domainAssetForHost", () => {
  const domains = [
    mk({ id: "ex", type: "domain", name: "example.com" }),
    mk({ id: "co", type: "domain", name: "Example.co.uk" }),
    mk({ id: "sub", type: "domain", name: "shop.example.com" }),
    mk({ id: "srv", type: "server", name: "blog.example.com" }),
  ];
  it("matches by suffix, longest first", () => {
    expect(domainAssetForHost("blog.example.com", domains)?.id).toBe("ex");
    expect(domainAssetForHost("example.com", domains)?.id).toBe("ex");
    expect(domainAssetForHost("api.shop.example.com", domains)?.id).toBe("sub");
    expect(domainAssetForHost("shop.example.com.", domains)?.id).toBe("sub");
    expect(domainAssetForHost("WWW.example.co.uk", domains)?.id).toBe("co");
  });
  it("never matches a mere string suffix or another type", () => {
    expect(domainAssetForHost("myexample.com", domains)).toBeNull();
    expect(domainAssetForHost("example.com.evil.net", domains)).toBeNull();
    expect(domainAssetForHost("blog.example.org", domains)).toBeNull();
  });
});

describe("buildAtollView", () => {
  const snap: AtollSnapshot = {
    syncedAt: T,
    servers: [srv("A", "192.0.2.11"), srv("B", "198.51.100.7")],
    projects: [
      { id: "p1", name: "shop", display_name: "星桥商城", server_id: "A", services: [
        { id: "s1", name: "api", kind: "image", image: "ghcr.io/x/api:1", status: "running", domains: [{ id: "d1", service_id: "s1", hostname: "api.example.com", status: "active" }] },
        { id: "s2", name: "pg", kind: "postgres", image: "postgres:17", status: "running", server_id: "B", domains: [] },
      ] },
      { id: "p2", name: "blog", server_id: "B", services: [
        { id: "s3", name: "web", kind: "image", image: "ghost:5", status: "stopped", domains: [{ id: "d2", service_id: "s3", hostname: "blog.example.com", status: "active" }, { id: "d3", service_id: "s3", hostname: "blog.other.net", status: "pending" }] },
      ] },
    ],
  };
  const assets = [
    mk({ id: "hk", type: "server", name: "hk", expiresAt: "2026-11-20", details: [{ label: "IPv4", value: "192.0.2.11" }] }),
    mk({ id: "sg", type: "server", name: "sg", details: [{ label: "IPv4", value: "198.51.100.7" }] }),
    mk({ id: "ex", type: "domain", name: "example.com" }),
  ];
  const before = structuredClone(assets);
  const v = buildAtollView(assets, snap);

  it("groups projects by the server each service runs on", () => {
    expect(v.projectsByAsset.get("hk")!.map((p) => [p.name, p.services.map((s) => s.name)])).toEqual([["星桥商城", ["api"]]]);
    expect(v.projectsByAsset.get("sg")!.map((p) => [p.name, p.services.map((s) => s.name)])).toEqual([["星桥商城", ["pg"]], ["blog", ["web"]]]);
    expect(v.projectCountByServer.get("B")).toBe(2);
  });
  it("lists services pointing at a domain asset and counts the impact", () => {
    expect(v.hostsByDomain.get("ex")!.map((h) => [h.hostname, h.serviceName, h.serverAssetId])).toEqual([["api.example.com", "api", "hk"], ["blog.example.com", "web", "sg"]]);
    expect(atollImpact(v, assets[0])).toBe(1);
    expect(atollImpact(v, assets[2])).toBe(2);
  });
  it("is a pure derived view: assets are not modified", () => {
    expect(assets).toEqual(before);
    expect(assets.every((a) => a.related.length === 0)).toBe(true);
  });
  it("empty snapshot gives an empty view", () => {
    const e = buildAtollView(assets, null);
    expect(e.projectsByAsset.size).toBe(0);
    expect(atollImpact(e, assets[0])).toBe(0);
  });
});

describe("snapshot hygiene", () => {
  it("keeps only whitelisted fields and merges GET /domains", () => {
    const p = pickAtollProject({ id: "p", name: "n", server_id: "A", root_domain: "x", services: [{ id: "s", name: "web", image: "i", status: "running", env: [{ key: "SECRET", value: "v" }], ports: [1] }] });
    expect(JSON.stringify(p)).not.toContain("SECRET");
    expect(Object.keys(p.services[0]).sort()).toEqual(["display_name", "domains", "id", "image", "kind", "name", "server_id", "status"].sort());
    const merged = mergeAtollDomains([p], [{ id: "d", service_id: "s", hostname: "a.example.com", status: "active" }]);
    expect(merged[0].services[0].domains.map((d) => d.hostname)).toEqual(["a.example.com"]);
  });
  it("normalizeAsset keeps a manual Atoll binding on servers only", () => {
    expect(normalizeAsset({ type: "server", name: "s", atoll: { serverId: "srv_1" } }).atoll).toEqual({ serverId: "srv_1" });
    expect(normalizeAsset({ type: "server", name: "s", atoll: { serverId: null } }).atoll).toEqual({ serverId: null });
    expect(normalizeAsset({ type: "domain", name: "d.com", atoll: { serverId: "srv_1" } }).atoll).toBeNull();
  });
});
