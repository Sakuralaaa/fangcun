import { assetIps, canonicalIp, domainAssetForHost, serverIps, type AtollHostRef, type AtollServer, type AtollView } from "./atoll";
import type { Asset } from "./types";

/**
 * Cloudflare — read-only view.
 *
 * 方寸 keeps a small snapshot of what the Cloudflare API reports (zones, A/AAAA/CNAME records, Registrar
 * registrations, Tunnels, Workers, Pages, R2) and derives links to its own assets from it. Nothing here
 * writes to assets: links are computed on the fly, never stored in `related`, never touching typed fields.
 * Registrar values are only offered as suggestions the user may adopt.
 */

export const CF_SECTIONS = ["accounts", "zones", "dns", "registrar", "tunnels", "workers", "pages", "r2"] as const;
export type CfSection = (typeof CF_SECTIONS)[number];
export const CF_SECTION_LABEL: Record<CfSection, string> = {
  accounts: "账户", zones: "Zone", dns: "DNS 记录", registrar: "注册商", tunnels: "Tunnel", workers: "Workers", pages: "Pages", r2: "R2",
};

/** ok = read fine; unauthorized = the token lacks the permission (403 / 9109 / 10000); error = anything else; skipped = not tried. */
export interface CfSectionState { state: "ok" | "unauthorized" | "error" | "skipped"; message?: string }

export interface CfAccount { id: string; name: string }
export interface CfZone {
  id: string; name: string; status: string; paused: boolean; accountId: string;
  nameServers: string[]; originalRegistrar?: string; plan?: string;
}
export type CfRecordType = "A" | "AAAA" | "CNAME";
export interface CfDnsRecord { zoneId: string; name: string; type: CfRecordType; content: string; proxied: boolean; ttl?: number }
export interface CfRegistration {
  name: string; accountId: string; status?: string;
  expiresAt?: string | null; autoRenew?: boolean; locked?: boolean;
}
export interface CfTunnel {
  id: string; name: string; status: string; accountId: string;
  /** Public hostnames from the remotely-managed configuration (ingress); empty when locally managed or unreadable. */
  hostnames: string[];
  /** Public IPs of the hosts running cloudflared, from the connections endpoint. */
  originIps: string[];
  connections: number;
}
export interface CfWorker { name: string; accountId: string; modifiedOn?: string; domains: string[] }
export interface CfPagesProject { name: string; accountId: string; subdomain?: string; domains: string[] }
export interface CfR2Bucket { name: string; accountId: string; location?: string; createdAt?: string }

export interface CfSnapshot {
  syncedAt: string;
  accounts: CfAccount[];
  zones: CfZone[];
  records: CfDnsRecord[];
  registrations: CfRegistration[];
  tunnels: CfTunnel[];
  workers: CfWorker[];
  pages: CfPagesProject[];
  r2: CfR2Bucket[];
  sections: Record<CfSection, CfSectionState>;
}

// ---------------- picking (only these fields survive a sync) ----------------

const s = (v: unknown, max = 300): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t ? t.slice(0, max) : undefined;
};
const host = (v: unknown) => (s(v, 300) ?? "").toLowerCase().replace(/\.$/, "");
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.map((x) => host(x)).filter(Boolean).slice(0, max) : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function pickCfAccount(x: Record<string, unknown>): CfAccount { return { id: s(x.id, 64) ?? "", name: s(x.name, 200) ?? "" }; }
export function pickCfZone(x: Record<string, unknown>): CfZone {
  return {
    id: s(x.id, 64) ?? "", name: host(x.name), status: s(x.status, 40) ?? "unknown", paused: Boolean(x.paused),
    accountId: s(rec(x.account).id, 64) ?? "", nameServers: strs(x.name_servers, 10),
    originalRegistrar: s(x.original_registrar, 120), plan: s(rec(x.plan).name, 60),
  };
}
const RECORD_TYPES = new Set(["A", "AAAA", "CNAME"]);
/** A/AAAA/CNAME only; anything else (TXT, MX…) is dropped on arrival. */
export function pickCfRecord(x: Record<string, unknown>, zoneId: string): CfDnsRecord | null {
  const type = s(x.type, 10)?.toUpperCase();
  if (!type || !RECORD_TYPES.has(type)) return null;
  const name = host(x.name);
  const content = type === "CNAME" ? host(x.content) : (s(x.content, 64) ?? "");
  if (!name || !content) return null;
  return { zoneId, name, type: type as CfRecordType, content, proxied: Boolean(x.proxied), ttl: typeof x.ttl === "number" ? x.ttl : undefined };
}
const ymdOf = (v: unknown): string | null => {
  const t = s(v, 40);
  if (!t) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m) return m[1];
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
/** New Registrar API (`/registrar/registrations`: domain_name) and the legacy list (`/registrar/domains`: name). */
export function pickCfRegistration(x: Record<string, unknown>, accountId: string): CfRegistration {
  return {
    name: host(x.domain_name ?? x.name), accountId, status: s(x.status, 40),
    expiresAt: ymdOf(x.expires_at), autoRenew: typeof x.auto_renew === "boolean" ? x.auto_renew : undefined,
    locked: typeof x.locked === "boolean" ? x.locked : undefined,
  };
}
export function pickCfTunnel(x: Record<string, unknown>, accountId: string): CfTunnel {
  return { id: (s(x.id, 64) ?? "").toLowerCase(), name: s(x.name, 200) ?? "", status: s(x.status, 40) ?? "unknown", accountId, hostnames: [], originIps: [], connections: 0 };
}
/** GET …/cfd_tunnel/{id}/connections → result[]: one client each, with conns[].origin_ip. */
export function tunnelOriginIps(clients: unknown): { ips: string[]; connections: number } {
  const ips = new Set<string>();
  let connections = 0;
  for (const c of Array.isArray(clients) ? clients : []) {
    for (const conn of Array.isArray(rec(c).conns) ? (rec(c).conns as unknown[]) : []) {
      connections++;
      const ip = canonicalIp(String(rec(conn).origin_ip ?? ""));
      if (ip) ips.add(ip);
    }
  }
  return { ips: [...ips], connections };
}
/** GET …/configurations → result.config.ingress[].hostname (catch-all rules have no hostname). */
export function tunnelHostnames(cfg: unknown): string[] {
  const ingress = rec(rec(rec(cfg).config)).ingress;
  const out = new Set<string>();
  for (const r of Array.isArray(ingress) ? ingress : []) { const h = host(rec(r).hostname); if (h) out.add(h); }
  return [...out];
}
export function pickCfWorker(x: Record<string, unknown>, accountId: string): CfWorker {
  return { name: s(x.id, 200) ?? "", accountId, modifiedOn: ymdOf(x.modified_on) ?? undefined, domains: [] };
}
export function pickCfPages(x: Record<string, unknown>, accountId: string): CfPagesProject {
  return { name: s(x.name, 200) ?? "", accountId, subdomain: host(x.subdomain) || undefined, domains: strs(x.domains) };
}
export function pickCfBucket(x: Record<string, unknown>, accountId: string): CfR2Bucket {
  return { name: s(x.name, 200) ?? "", accountId, location: s(x.location, 20), createdAt: ymdOf(x.creation_date) ?? undefined };
}

// ---------------- token permissions ----------------

/** A permission group grants more than reading when its name says Edit / Write (or an action like Purge, Revoke, Run, Admin). */
const WRITE_PERM = /\b(edit|write|purge|revoke|run|admin|editor)\b/i;
export const isWritePermission = (name: string) => WRITE_PERM.test(name);
/** Names of every allowed permission group on a token (GET /user/tokens/{id} or /accounts/{a}/tokens/{id}). */
export function tokenPermissionNames(token: unknown): string[] {
  const out = new Set<string>();
  for (const p of Array.isArray(rec(token).policies) ? (rec(token).policies as unknown[]) : []) {
    if (rec(p).effect === "deny") continue;
    for (const g of Array.isArray(rec(p).permission_groups) ? (rec(p).permission_groups as unknown[]) : []) {
      const n = s(rec(g).name, 120);
      if (n) out.add(n);
    }
  }
  return [...out];
}

// ---------------- the derived view ----------------

const clean = (h: string) => h.trim().toLowerCase().replace(/\.$/, "").replace(/^\*\./, "");
export const TUNNEL_SUFFIX = ".cfargotunnel.com";
/** `<uuid>.cfargotunnel.com` → uuid. */
export function tunnelIdOf(target: string): string | null {
  const t = clean(target);
  return t.endsWith(TUNNEL_SUFFIX) ? t.slice(0, -TUNNEL_SUFFIX.length) || null : null;
}

/** The zone a hostname belongs to (longest suffix wins). */
export function zoneForHost(hostname: string, zones: CfZone[]): CfZone | null {
  const h = clean(hostname);
  let best: CfZone | null = null;
  for (const z of zones) if ((h === z.name || h.endsWith(`.${z.name}`)) && (!best || z.name.length > best.name.length)) best = z;
  return best;
}

export type CfTarget =
  | { kind: "server"; assetId: string; ip: string }
  | { kind: "ambiguous"; ip: string; candidates: string[] }
  | { kind: "ip"; ip: string }
  | { kind: "tunnel"; tunnelId: string; tunnelName: string | null; serverAssetId: string | null }
  | { kind: "host"; host: string };

export interface CfRecordView extends CfDnsRecord {
  zoneName: string;
  target: CfTarget;
  /** Domain asset this hostname falls under (longest suffix), when any. */
  domainAssetId: string | null;
}

export type CfTunnelMatch = { assetId: string; ip: string } | { assetId: null; ambiguous: string[] } | { assetId: null };

export interface CfSuggestion { field: "expiresAt" | "autoRenew"; label: string; cf: string | boolean; current: string | boolean | null }

export interface CfDomainInfo {
  zone: CfZone | null;
  registration: CfRegistration | null;
  /** Registrar values that differ from what 方寸 has; adopting them is the user's choice. */
  suggestions: CfSuggestion[];
  records: CfRecordView[];
}

export interface CfServiceView {
  kind: "worker" | "pages" | "r2";
  name: string; accountId: string; detail?: string;
  domains: { hostname: string; domainAssetId: string | null }[];
}

export type CfTunnelView = CfTunnel & { match: CfTunnelMatch };

export interface CfView {
  on: boolean;
  records: CfRecordView[];
  /** Domain asset id → zone, registration, suggestions, records under it. */
  byDomain: Map<string, CfDomainInfo>;
  /** Server asset id → records pointing at it (directly by IP or through a tunnel running there). */
  byServer: Map<string, CfRecordView[]>;
  tunnels: CfTunnelView[];
  /** Zones with no domain asset covering them: candidates the user may import. */
  importable: (CfZone & { registration: CfRegistration | null })[];
  services: CfServiceView[];
  zones: CfZone[];
}

/** Every IP a server asset is known by: its own detail rows / Komari IPs, plus the Atoll server it is matched to. */
function knownIps(assets: Asset[], atoll?: AtollView | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const atollById = new Map((atoll?.servers ?? []).map((x) => [x.id, x]));
  for (const a of assets) {
    if (a.type !== "server" || a.deletedAt) continue;
    const ips = new Set(assetIps(a));
    const m = atoll?.match.get(a.id);
    const srv = m?.serverId && m.via !== "manual-missing" ? atollById.get(m.serverId) : undefined;
    if (srv) for (const ip of serverIps(srv)) ips.add(ip);
    out.set(a.id, [...ips]);
  }
  return out;
}

/** One IP → the single server asset that has it, or ambiguity. Never guesses between two. */
function ipIndex(ips: Map<string, string[]>) {
  const idx = new Map<string, string[]>();
  for (const [assetId, list] of ips) for (const ip of list) idx.set(ip, [...(idx.get(ip) ?? []), assetId]);
  return idx;
}

const toYmd = (v?: string | null) => (v ? v.slice(0, 10) : null);

/** Build every link at once. Pure: same assets + snapshot (+ Atoll view) → same view. */
export function buildCloudflareView(assets: Asset[], snap: CfSnapshot | null | undefined, atoll?: AtollView | null): CfView {
  const zones = snap?.zones ?? [];
  const live = assets.filter((a) => !a.deletedAt);
  const domains = live.filter((a) => a.type === "domain");
  const ips = knownIps(live, atoll);
  const idx = ipIndex(ips);

  const tunnels = (snap?.tunnels ?? []).map((t): CfTunnelView => {
    const hits = new Map<string, string>();
    let ambiguous: string[] | null = null;
    for (const ip of t.originIps) {
      const c = idx.get(ip) ?? [];
      if (c.length > 1) ambiguous = [...new Set([...(ambiguous ?? []), ...c])];
      else if (c.length === 1 && !hits.has(c[0])) hits.set(c[0], ip);
    }
    let match: CfTunnelMatch = { assetId: null };
    if (ambiguous || hits.size > 1) match = { assetId: null, ambiguous: [...new Set([...(ambiguous ?? []), ...hits.keys()])] };
    else if (hits.size === 1) { const [[assetId, ip]] = [...hits]; match = { assetId, ip }; }
    return { ...t, match };
  });
  const tunnelById = new Map(tunnels.map((t) => [t.id, t]));
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const records: CfRecordView[] = (snap?.records ?? []).map((r) => {
    let target: CfTarget;
    if (r.type === "CNAME") {
      const tid = tunnelIdOf(r.content);
      if (tid) {
        const t = tunnelById.get(tid);
        target = { kind: "tunnel", tunnelId: tid, tunnelName: t?.name ?? null, serverAssetId: t && t.match.assetId ? t.match.assetId : null };
      } else target = { kind: "host", host: r.content };
    } else {
      const ip = canonicalIp(r.content) ?? r.content;
      const c = idx.get(ip) ?? [];
      target = c.length === 1 ? { kind: "server", assetId: c[0], ip } : c.length > 1 ? { kind: "ambiguous", ip, candidates: c } : { kind: "ip", ip };
    }
    return { ...r, zoneName: zoneById.get(r.zoneId)?.name ?? "", target, domainAssetId: domainAssetForHost(r.name, domains)?.id ?? null };
  });

  const regByName = new Map((snap?.registrations ?? []).map((g) => [g.name, g]));
  const byDomain = new Map<string, CfDomainInfo>();
  for (const d of domains) {
    const name = clean(d.name);
    const zone = zones.find((z) => z.name === name) ?? zoneForHost(name, zones);
    const registration = regByName.get(name) ?? null;
    const suggestions: CfSuggestion[] = [];
    if (registration?.expiresAt && registration.expiresAt !== toYmd(d.expiresAt)) suggestions.push({ field: "expiresAt", label: "到期日", cf: registration.expiresAt, current: toYmd(d.expiresAt) });
    if (typeof registration?.autoRenew === "boolean" && registration.autoRenew !== d.autoRenew) suggestions.push({ field: "autoRenew", label: "自动续费", cf: registration.autoRenew, current: d.autoRenew });
    const recs = records.filter((r) => r.domainAssetId === d.id);
    if (zone || registration || recs.length) byDomain.set(d.id, { zone, registration, suggestions, records: recs });
  }

  const byServer = new Map<string, CfRecordView[]>();
  for (const r of records) {
    const sid = r.target.kind === "server" ? r.target.assetId : r.target.kind === "tunnel" ? r.target.serverAssetId : null;
    if (sid) byServer.set(sid, [...(byServer.get(sid) ?? []), r]);
  }

  const covered = (z: CfZone) => domains.some((d) => { const n = clean(d.name); return n === z.name || z.name.endsWith(`.${n}`); });
  const importable = zones.filter((z) => !covered(z)).map((z) => ({ ...z, registration: regByName.get(z.name) ?? null }));

  const dom = (h: string) => ({ hostname: h, domainAssetId: domainAssetForHost(h, domains)?.id ?? null });
  const services: CfServiceView[] = [
    ...(snap?.workers ?? []).map((w): CfServiceView => ({ kind: "worker", name: w.name, accountId: w.accountId, detail: w.modifiedOn ? `更新于 ${w.modifiedOn}` : undefined, domains: w.domains.map(dom) })),
    ...(snap?.pages ?? []).map((p): CfServiceView => ({ kind: "pages", name: p.name, accountId: p.accountId, detail: p.subdomain, domains: p.domains.map(dom) })),
    ...(snap?.r2 ?? []).map((b): CfServiceView => ({ kind: "r2", name: b.name, accountId: b.accountId, detail: b.location ? `位置 ${b.location}` : undefined, domains: [] })),
  ];

  return { on: Boolean(snap), records, byDomain, byServer, tunnels, importable, services, zones };
}

// ---------------- one hostname, checked against where Atoll runs it ----------------

export type CfIssue = { level: "warn" | "info"; text: string };
export interface CfHostCheck {
  hostname: string;
  zone: CfZone | null;
  records: CfRecordView[];
  /** The record actually answering after following CNAMEs inside the snapshot (max 5 hops). */
  final: CfRecordView | null;
  viaTunnel: CfTunnelView | null;
  issues: CfIssue[];
}

/**
 * Where Cloudflare sends `hostname`, and whether it agrees with the server Atoll runs it on.
 * `expected` = every IP of that server (Atoll's public IPs + the matched VPS asset's IPs) and its asset id.
 * Read-only hints: nothing is changed anywhere.
 */
export function checkHost(view: CfView, hostname: string, expected: { ips: string[]; serverAssetId: string | null }, atollProxied?: boolean): CfHostCheck {
  const h = clean(hostname);
  const zone = zoneForHost(h, view.zones);
  const out: CfHostCheck = { hostname: h, zone, records: [], final: null, viaTunnel: null, issues: [] };
  if (!view.on) return out;
  if (!zone) { out.issues.push({ level: "info", text: "不在 Cloudflare 管理的 zone 里" }); return out; }
  const find = (name: string) => {
    const exact = view.records.filter((r) => r.name === name);
    if (exact.length) return exact;
    const wild = `*.${name.split(".").slice(1).join(".")}`;
    return view.records.filter((r) => r.name === wild);
  };
  out.records = find(h);
  if (!out.records.length) { out.issues.push({ level: "warn", text: "Cloudflare 里没有这个主机名的 A / AAAA / CNAME 记录" }); return out; }

  let cur = out.records;
  for (let hop = 0; hop < 5; hop++) {
    const cname = cur.find((r) => r.type === "CNAME");
    if (!cname) break;
    if (cname.target.kind === "tunnel") { out.final = cname; break; }
    const next = find(cname.content);
    if (!next.length) { out.final = cname; break; }
    cur = next;
  }
  out.final ??= cur[0] ?? null;

  const exp = new Set(expected.ips.map((x) => canonicalIp(x)).filter(Boolean) as string[]);
  const f = out.final;
  if (f?.target.kind === "tunnel") {
    const tid = f.target.tunnelId;
    out.viaTunnel = view.tunnels.find((t) => t.id === tid) ?? null;
    if (!out.viaTunnel) out.issues.push({ level: "warn", text: "CNAME 指向的 Tunnel 不在这个账号里（可能已删除）" });
    else if (out.viaTunnel.match.assetId && expected.serverAssetId && out.viaTunnel.match.assetId !== expected.serverAssetId)
      out.issues.push({ level: "warn", text: `走的 Tunnel「${out.viaTunnel.name}」运行在另一台服务器上` });
    else if (!out.viaTunnel.match.assetId && out.viaTunnel.originIps.length && exp.size && !out.viaTunnel.originIps.some((ip) => exp.has(ip)))
      out.issues.push({ level: "warn", text: `Tunnel「${out.viaTunnel.name}」的连接来源 IP 不是项目所在服务器` });
  } else if (f && (f.type === "A" || f.type === "AAAA")) {
    const addrs = cur.filter((r) => r.type === "A" || r.type === "AAAA").map((r) => canonicalIp(r.content) ?? r.content);
    const wrong = addrs.filter((ip) => exp.size && !exp.has(ip));
    if (wrong.length) out.issues.push({ level: "warn", text: `记录指向 ${wrong.join("、")}，不是项目所在服务器` });
  } else if (f?.type === "CNAME") {
    out.issues.push({ level: "info", text: `CNAME 指向 ${f.content}，不在快照内，无法核对` });
  }
  if (typeof atollProxied === "boolean" && out.records[0] && atollProxied !== out.records[0].proxied)
    out.issues.push({ level: "info", text: atollProxied ? "Atoll 标记为代理，Cloudflare 里没开代理" : "Cloudflare 开了代理，Atoll 标记为不代理" });
  return out;
}

/** Expected IPs for an Atoll host reference: its Atoll server's public IPs plus the matched VPS asset's IPs. */
export function expectedForAtollHost(ref: Pick<AtollHostRef, "serverId" | "serverAssetId">, servers: AtollServer[], assets: Asset[]): { ips: string[]; serverAssetId: string | null } {
  const ips = new Set<string>();
  const srv = servers.find((x) => x.id === ref.serverId);
  if (srv) for (const ip of serverIps(srv)) ips.add(ip);
  const a = ref.serverAssetId ? assets.find((x) => x.id === ref.serverAssetId) : undefined;
  if (a) for (const ip of assetIps(a)) ips.add(ip);
  return { ips: [...ips], serverAssetId: ref.serverAssetId };
}

/** A new domain asset built from a zone (and its registration when Cloudflare is the registrar). Only on the user's click. */
export function zoneToAssetInput(z: CfZone, reg: CfRegistration | null): Partial<Asset> & { type: "domain"; name: string } {
  const details = [{ label: "DNS", value: "Cloudflare" }, ...(z.nameServers.length ? [{ label: "NS", value: z.nameServers.join(", "), mono: true }] : [])];
  if (reg?.locked !== undefined) details.push({ label: "转移锁", value: reg.locked ? "开启" : "关闭" });
  return {
    type: "domain", name: z.name, subtitle: reg ? "Cloudflare 注册" : "Cloudflare 托管 DNS",
    provider: reg ? "Cloudflare" : z.originalRegistrar || undefined,
    price: 0, currency: "USD", cycle: "year", expiresAt: reg?.expiresAt ?? null, autoRenew: reg?.autoRenew ?? false,
    tags: [], details, related: [], renewals: [],
  };
}
