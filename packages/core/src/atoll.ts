import type { Asset } from "./types";

/**
 * Atoll (self-hosted multi-VPS container panel) — read-only view.
 *
 * 方寸 only keeps a small snapshot of what Atoll reports (servers, projects, services, domains)
 * and derives links to its own assets from it. Nothing here writes to assets: the links are a
 * view computed on the fly, never stored in `related` and never touching hand-typed fields.
 */

export interface AtollServer {
  id: string;
  name: string;
  status: string;            // pending | online | offline | draining
  public_ipv4?: string;
  public_ipv6?: string;
  provider?: string;
  region?: string;
}

export interface AtollDomain {
  id: string;
  service_id: string;
  hostname: string;
  status: string;            // pending | provisioning | active | error
  proxied?: boolean;
}

export interface AtollService {
  id: string;
  name: string;
  display_name?: string;
  kind: string;
  image: string;
  status: string;            // running | deploying | stopped | failed | unknown
  server_id?: string;
  domains: AtollDomain[];
}

export interface AtollProject {
  id: string;
  name: string;
  display_name?: string;
  server_id: string;
  services: AtollService[];
}

/** What a sync leaves behind: only the fields above, nothing else from Atoll is kept. */
export interface AtollSnapshot {
  syncedAt: string;
  servers: AtollServer[];
  projects: AtollProject[];
}

const s = (v: unknown, max = 300): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t ? t.slice(0, max) : undefined;
};

/** Keep only the whitelisted fields of Atoll's answers (env, ports, volumes… are dropped on arrival). */
export function pickAtollServer(x: Record<string, unknown>): AtollServer {
  return {
    id: s(x.id, 100) ?? "", name: s(x.name, 200) ?? "", status: s(x.status, 40) ?? "unknown",
    public_ipv4: s(x.public_ipv4, 64), public_ipv6: s(x.public_ipv6, 64), provider: s(x.provider, 100), region: s(x.region, 100),
  };
}
export function pickAtollDomain(x: Record<string, unknown>): AtollDomain {
  return { id: s(x.id, 100) ?? "", service_id: s(x.service_id, 100) ?? "", hostname: (s(x.hostname, 300) ?? "").toLowerCase(), status: s(x.status, 40) ?? "unknown", proxied: Boolean(x.proxied) };
}
export function pickAtollService(x: Record<string, unknown>): AtollService {
  const domains = Array.isArray(x.domains) ? (x.domains as Record<string, unknown>[]).map(pickAtollDomain) : [];
  return {
    id: s(x.id, 100) ?? "", name: s(x.name, 200) ?? "", display_name: s(x.display_name, 100), kind: s(x.kind, 40) ?? "image",
    image: s(x.image, 400) ?? "", status: s(x.status, 40) ?? "unknown", server_id: s(x.server_id, 100), domains,
  };
}
export function pickAtollProject(x: Record<string, unknown>): AtollProject {
  const services = Array.isArray(x.services) ? (x.services as Record<string, unknown>[]).map(pickAtollService) : [];
  return { id: s(x.id, 100) ?? "", name: s(x.name, 200) ?? "", display_name: s(x.display_name, 100), server_id: s(x.server_id, 100) ?? "", services };
}

/** Merge GET /domains into the services (by service_id), keeping one entry per domain id. */
export function mergeAtollDomains(projects: AtollProject[], domains: AtollDomain[]): AtollProject[] {
  const bySvc = new Map<string, AtollDomain[]>();
  for (const d of domains) {
    if (!d.service_id || !d.hostname) continue;
    bySvc.set(d.service_id, [...(bySvc.get(d.service_id) ?? []), d]);
  }
  return projects.map((p) => ({
    ...p,
    services: p.services.map((svc) => {
      const seen = new Set(svc.domains.map((d) => d.id || d.hostname));
      const extra = (bySvc.get(svc.id) ?? []).filter((d) => !seen.has(d.id || d.hostname));
      return extra.length ? { ...svc, domains: [...svc.domains, ...extra] } : svc;
    }),
  }));
}

// ---------------- IP matching ----------------

/** Canonical text for an IPv4 / IPv6 address, or null when it is not one. Brackets, zone ids and /prefix are ignored. */
export function canonicalIp(raw: string): string | null {
  let t = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\/\d{1,3}$/, "").replace(/%.*$/, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
    const parts = t.split(".").map(Number);
    return parts.every((n) => n >= 0 && n <= 255) ? parts.join(".") : null;
  }
  if (!t.includes(":") || !/^[0-9a-f:.]+$/.test(t)) return null;
  // IPv4 tail (::ffff:1.2.3.4) → two hex groups
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (v4) {
    const n = v4[1].split(".").map(Number);
    if (n.some((x) => x > 255)) return null;
    t = t.slice(0, -v4[1].length) + `${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}`;
  }
  const halves = t.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16).toString(16)).join(":");
}

const IP_LABEL = /ip/i;

/**
 * Every IP address 方寸 knows for an asset: detail rows whose label mentions IP (IPv4, IPv6, 公网 IP,
 * IP 地址…; a cell may hold several, separated by commas, spaces or slashes) and the IPs last read from Komari.
 */
export function assetIps(a: Pick<Asset, "details" | "komari">): string[] {
  const raw: string[] = [];
  for (const d of a.details ?? []) if (IP_LABEL.test(d.label)) raw.push(...String(d.value).split(/[\s,，;；、|]+/));
  const f = a.komari?.fields ?? {};
  for (const k of ["detail:IPv4", "detail:IPv6"]) if (typeof f[k] === "string") raw.push(f[k] as string);
  const out = new Set<string>();
  for (const r of raw) {
    const c = canonicalIp(r);
    if (c) out.add(c);
  }
  return [...out];
}

export function serverIps(srv: AtollServer): string[] {
  return [srv.public_ipv4, srv.public_ipv6].map((x) => (x ? canonicalIp(x) : null)).filter((x): x is string => Boolean(x));
}

export type AtollMatch =
  | { serverId: string; via: "manual" }
  | { serverId: string; via: "ip"; ip: string }
  | { serverId: null; via: "manual-none" }
  | { serverId: string; via: "manual-missing" }
  | { serverId: null; via: "ambiguous"; candidates: string[] }
  | { serverId: null; via: "none" };

/**
 * Pair 方寸 server assets with Atoll servers.
 *  1. A manual choice on the asset (`atoll.serverId`) always wins; `serverId: null` means "not on Atoll".
 *     A manually claimed Atoll server is taken out of automatic matching for every other asset.
 *  2. Otherwise public IPv4 / IPv6 of the Atoll server equal to any IP of the asset.
 *     Only one-to-one pairs are kept: an IP that fits several assets or servers is reported as ambiguous.
 */
export function matchAtollServers(assets: Asset[], servers: AtollServer[]): Map<string, AtollMatch> {
  const out = new Map<string, AtollMatch>();
  const vps = assets.filter((a) => a.type === "server" && !a.deletedAt);
  const known = new Set(servers.map((x) => x.id));
  const claimed = new Set<string>();
  for (const a of vps) {
    if (!a.atoll) continue;
    if (a.atoll.serverId === null) { out.set(a.id, { serverId: null, via: "manual-none" }); continue; }
    const id = a.atoll.serverId;
    claimed.add(id);
    out.set(a.id, known.has(id) ? { serverId: id, via: "manual" } : { serverId: id, via: "manual-missing" });
  }
  const free = servers.filter((x) => !claimed.has(x.id));
  const cand = new Map<string, { serverId: string; ip: string }[]>();
  const byServer = new Map<string, string[]>();
  for (const a of vps) {
    if (out.has(a.id)) continue;
    const ips = new Set(assetIps(a));
    const hits: { serverId: string; ip: string }[] = [];
    for (const srv of free) {
      const ip = serverIps(srv).find((x) => ips.has(x));
      if (ip) hits.push({ serverId: srv.id, ip });
    }
    cand.set(a.id, hits);
    for (const h of hits) byServer.set(h.serverId, [...(byServer.get(h.serverId) ?? []), a.id]);
  }
  for (const a of vps) {
    if (out.has(a.id)) continue;
    const hits = cand.get(a.id) ?? [];
    if (!hits.length) out.set(a.id, { serverId: null, via: "none" });
    else if (hits.length > 1 || (byServer.get(hits[0].serverId)?.length ?? 0) > 1) out.set(a.id, { serverId: null, via: "ambiguous", candidates: hits.map((h) => h.serverId) });
    else out.set(a.id, { serverId: hits[0].serverId, via: "ip", ip: hits[0].ip });
  }
  return out;
}

// ---------------- domain matching ----------------

const cleanHost = (h: string) => h.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "").replace(/^\*\./, "");

/** The domain asset a hostname belongs to: equal or a subdomain of it; the longest name wins (a.b.example over b.example). */
export function domainAssetForHost<T extends Pick<Asset, "id" | "name" | "type">>(hostname: string, domains: T[]): T | null {
  const host = cleanHost(hostname);
  if (!host) return null;
  let best: T | null = null;
  let bestLen = 0;
  for (const d of domains) {
    if (d.type !== "domain") continue;
    const name = cleanHost(d.name);
    if (!name.includes(".")) continue;
    if ((host === name || host.endsWith(`.${name}`)) && name.length > bestLen) { best = d; bestLen = name.length; }
  }
  return best;
}

// ---------------- the derived view ----------------

export interface AtollServiceView {
  id: string; name: string; kind: string; image: string; status: string;
  domains: { hostname: string; status: string; proxied: boolean; domainAssetId: string | null }[];
}
export interface AtollProjectView { id: string; name: string; handle: string; serverId: string; services: AtollServiceView[] }
export interface AtollHostRef {
  hostname: string; status: string; proxied: boolean;
  projectId: string; projectName: string; serviceId: string; serviceName: string; serviceStatus: string;
  serverId: string; serverName: string; serverAssetId: string | null;
}
export interface AtollView {
  /** Server asset id → its Atoll match. */
  match: Map<string, AtollMatch>;
  /** Server asset id → projects with at least one service on it (or the project's home server). */
  projectsByAsset: Map<string, AtollProjectView[]>;
  /** Domain asset id → hostnames under it, with the service that serves each. */
  hostsByDomain: Map<string, AtollHostRef[]>;
  /** Atoll server id → project count. */
  projectCountByServer: Map<string, number>;
  servers: AtollServer[];
}

export const atollLabel = (x: { name: string; display_name?: string }) => x.display_name || x.name;

/** Build every link at once. Pure: same assets + snapshot → same view. */
export function buildAtollView(assets: Asset[], snap: AtollSnapshot | null | undefined): AtollView {
  const servers = snap?.servers ?? [];
  const projects = snap?.projects ?? [];
  const match = matchAtollServers(assets, servers);
  const domains = assets.filter((a) => a.type === "domain" && !a.deletedAt);
  const assetByServer = new Map<string, string>();
  for (const [assetId, m] of match) if (m.serverId && m.via !== "manual-missing") assetByServer.set(m.serverId, assetId);
  const serverName = new Map(servers.map((x) => [x.id, x.name]));

  const perServer = new Map<string, AtollProjectView[]>();
  const hostsByDomain = new Map<string, AtollHostRef[]>();
  for (const p of projects) {
    const groups = new Map<string, AtollServiceView[]>();
    if (p.server_id) groups.set(p.server_id, []);
    for (const svc of p.services) {
      const where = svc.server_id || p.server_id;
      const view: AtollServiceView = {
        id: svc.id, name: atollLabel(svc), kind: svc.kind, image: svc.image, status: svc.status,
        domains: svc.domains.map((d) => ({ hostname: d.hostname, status: d.status, proxied: Boolean(d.proxied), domainAssetId: domainAssetForHost(d.hostname, domains)?.id ?? null })),
      };
      if (where) groups.set(where, [...(groups.get(where) ?? []), view]);
      for (const d of view.domains) {
        if (!d.domainAssetId) continue;
        const ref: AtollHostRef = {
          hostname: d.hostname, status: d.status, proxied: d.proxied, projectId: p.id, projectName: atollLabel(p),
          serviceId: svc.id, serviceName: view.name, serviceStatus: svc.status,
          serverId: where, serverName: serverName.get(where) ?? where, serverAssetId: assetByServer.get(where) ?? null,
        };
        hostsByDomain.set(d.domainAssetId, [...(hostsByDomain.get(d.domainAssetId) ?? []), ref]);
      }
    }
    for (const [sid, services] of groups) {
      perServer.set(sid, [...(perServer.get(sid) ?? []), { id: p.id, name: atollLabel(p), handle: p.name, serverId: sid, services }]);
    }
  }
  const projectsByAsset = new Map<string, AtollProjectView[]>();
  for (const [sid, assetId] of assetByServer) projectsByAsset.set(assetId, perServer.get(sid) ?? []);
  const projectCountByServer = new Map([...perServer].map(([k, v]) => [k, v.length]));
  return { match, projectsByAsset, hostsByDomain, projectCountByServer, servers };
}

/** How many Atoll projects an asset's expiry would hit: projects on the VPS, or projects serving a hostname under the domain. */
export function atollImpact(view: AtollView, a: Pick<Asset, "id" | "type">): number {
  if (a.type === "server") return view.projectsByAsset.get(a.id)?.length ?? 0;
  if (a.type === "domain") return new Set((view.hostsByDomain.get(a.id) ?? []).map((h) => h.projectId)).size;
  return 0;
}
