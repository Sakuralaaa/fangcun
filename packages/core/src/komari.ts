import { stableJson } from "./asset";
import type { Asset, Cycle, KomariFieldGroup, KomariSettings, NodeStatus } from "./types";

/** A client as returned by Komari 1.2.5 GET /api/admin/client/list (token is dropped on arrival). */
export interface KomariClient {
  uuid: string;
  name?: string;
  cpu_name?: string;
  arch?: string;
  cpu_cores?: number;
  os?: string;
  kernel_version?: string;
  ipv4?: string;
  ipv6?: string;
  region?: string;
  mem_total?: number;
  disk_total?: number;
  version?: string;
  price?: number;
  billing_cycle?: number;
  auto_renewal?: boolean;
  currency?: string;
  expired_at?: string | null;
  group?: string;
  tags?: string;
  hidden?: boolean;
  traffic_limit?: number;
  traffic_limit_type?: string;
  token?: string;
}

/** One entry of rpc2 common:getNodesLatestStatus result (map uuid → record). */
export interface KomariRecord {
  client?: string;
  time?: string;
  cpu?: number;
  ram?: number; ram_total?: number;
  swap?: number; swap_total?: number;
  load?: number; load5?: number; load15?: number;
  disk?: number; disk_total?: number;
  net_in?: number; net_out?: number;
  net_total_up?: number; net_total_down?: number;
  process?: number;
  connections?: number; connections_udp?: number;
  online?: boolean;
  uptime?: number;
}

/** Sync keys and the settings toggle each belongs to. */
export const KOMARI_KEYS: Record<string, KomariFieldGroup> = {
  price: "price",
  currency: "price",
  cycle: "cycle",
  expiresAt: "expiresAt",
  autoRenew: "autoRenew",
  "detail:CPU": "specs",
  "detail:内存": "specs",
  "detail:硬盘": "specs",
  "detail:系统": "specs",
  "detail:IPv4": "network",
  "detail:IPv6": "network",
  "detail:地区": "network",
  tags: "tags",
};

export const KOMARI_GROUP_LABEL: Record<KomariFieldGroup, [string, string]> = {
  price: ["价格与币种", "price · currency"],
  cycle: ["续费周期", "billing_cycle"],
  expiresAt: ["到期日", "expired_at"],
  autoRenew: ["自动续费", "auto_renewal"],
  specs: ["配置与系统", "cpu · mem · disk · os"],
  network: ["IP 与地区", "ipv4 · ipv6 · region"],
  tags: ["标签", "tags"],
};

const CURRENCY: Record<string, string> = { "$": "USD", "US$": "USD", "¥": "CNY", "￥": "CNY", "€": "EUR", "£": "GBP", "HK$": "HKD", "₺": "TRY", "₹": "INR", "JP¥": "JPY" };

export function komariCurrency(c?: string): string {
  if (!c) return "USD";
  const t = c.trim();
  if (CURRENCY[t]) return CURRENCY[t];
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  return "USD";
}

/** Komari stores the cycle as a day count (30 / 90 / 180 / 365, -1 = one-off). */
export function komariCycle(days?: number): Cycle {
  const d = Number(days ?? 0);
  if (d <= 0) return "once";
  if (d >= 27 && d <= 32) return "month";
  if (d >= 87 && d <= 95) return "quarter";
  if (d >= 175 && d <= 186) return "halfyear";
  if (d >= 360 && d <= 370) return "year";
  if (d >= 720 && d <= 750) return "2year";
  if (d >= 1080 && d <= 1150) return "3year";
  return d < 60 ? "month" : d < 135 ? "quarter" : d < 270 ? "halfyear" : "year";
}

/** RFC3339 → YYYY-MM-DD in the timestamp's own offset; null for "no expiry" (Komari uses far-future dates). */
export function komariDate(s?: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  if (y <= 1971 || y >= 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const GB = 1024 ** 3;
export function bytesLabel(b?: number): string | undefined {
  if (!b) return undefined;
  if (b >= 1024 * GB) return `${(b / 1024 / GB).toFixed(1).replace(/\.0$/, "")} TB`;
  if (b >= GB) return `${(b / GB).toFixed(1).replace(/\.0$/, "")} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

export function komariPrice(p?: number | null): number {
  const n = Number(p ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Map a Komari client to sync-key → value. Missing values are left out. */
export function mapClient(c: KomariClient): Record<string, unknown> {
  const out: Record<string, unknown> = {
    // Komari marks free machines with price -1 (and leaves 0 for "not filled"); 方寸 records both as 0 = 免费
    price: komariPrice(c.price),
    currency: komariCurrency(c.currency),
    cycle: komariCycle(c.billing_cycle),
    expiresAt: komariDate(c.expired_at),
    autoRenew: Boolean(c.auto_renewal),
    tags: (c.tags ?? "").split(";").map((t) => t.trim()).filter(Boolean),
  };
  const cpu = [c.cpu_cores ? `${c.cpu_cores} 核` : "", c.cpu_name ?? ""].filter(Boolean).join(" · ");
  if (cpu) out["detail:CPU"] = cpu;
  if (bytesLabel(c.mem_total)) out["detail:内存"] = bytesLabel(c.mem_total);
  if (bytesLabel(c.disk_total)) out["detail:硬盘"] = bytesLabel(c.disk_total);
  if (c.os) out["detail:系统"] = c.os;
  if (c.ipv4) out["detail:IPv4"] = c.ipv4;
  if (c.ipv6) out["detail:IPv6"] = c.ipv6;
  if (c.region) out["detail:地区"] = c.region;
  return out;
}

const MONO = new Set(["IPv4", "IPv6"]);

export function getKey(a: Asset, key: string): unknown {
  if (key.startsWith("detail:")) return a.details.find((d) => d.label === key.slice(7))?.value;
  return (a as unknown as Record<string, unknown>)[key];
}

export function setKey(a: Asset, key: string, value: unknown): void {
  if (key.startsWith("detail:")) {
    const label = key.slice(7);
    const i = a.details.findIndex((d) => d.label === label);
    if (value === undefined || value === null || value === "") {
      if (i >= 0) a.details.splice(i, 1);
    } else if (i >= 0) a.details[i] = { ...a.details[i], value: String(value) };
    else a.details.push({ label, value: String(value), ...(MONO.has(label) ? { mono: true } : {}) });
    return;
  }
  (a as unknown as Record<string, unknown>)[key] = value;
}

const same = (x: unknown, y: unknown) => stableJson(x) === stableJson(y);

/**
 * Apply one Komari client to a bound asset. Enabled groups overwrite the asset unless the
 * field was edited in 方寸 (overridden), in which case only the remembered Komari value moves
 * and the override is flagged `changed` so the UI can offer a restore.
 */
export function applyKomari(asset: Asset, client: KomariClient, settings: Pick<KomariSettings, "fields">, now: string): { asset: Asset; changed: string[] } {
  if (!asset.komari || asset.komari.uuid !== client.uuid) throw new Error("asset is not bound to this node");
  const a = structuredClone(asset);
  const k = a.komari!;
  const mapped = mapClient(client);
  const overridden = { ...(k.overridden ?? {}) };
  const changed: string[] = [];
  for (const [key, group] of Object.entries(KOMARI_KEYS)) {
    if (!settings.fields[group]) continue;
    const value = mapped[key];
    if (overridden[key]) {
      if (!same(overridden[key].komari, value)) overridden[key] = { komari: value, changed: true };
      continue;
    }
    if (value === undefined && key.startsWith("detail:")) continue;
    if (!same(getKey(a, key), value)) {
      setKey(a, key, value);
      changed.push(key);
    }
  }
  k.fields = mapped;
  k.overridden = overridden;
  k.syncedAt = now;
  if (client.version) k.agentVersion = client.version;
  return { asset: a, changed };
}

/**
 * After a user edit: any synced field whose value now differs from Komari becomes 「已手动修改」;
 * a field edited back to Komari's value loses the mark.
 */
export function markOverrides(before: Asset | null, after: Asset, settings: Pick<KomariSettings, "fields">): Asset {
  if (!after.komari?.fields) return after;
  const k = after.komari;
  const overridden = { ...(k.overridden ?? {}) };
  for (const [key, group] of Object.entries(KOMARI_KEYS)) {
    if (!settings.fields[group] || !(key in k.fields!)) continue;
    const komariValue = k.fields![key];
    const now = getKey(after, key);
    const was = before ? getKey(before, key) : undefined;
    if (same(now, komariValue)) delete overridden[key];
    else if (!overridden[key] && !same(now, was)) overridden[key] = { komari: komariValue };
  }
  k.overridden = overridden;
  return after;
}

/** 一键恢复: take Komari's value again and drop the override. */
export function restoreKomariField(asset: Asset, key: string): Asset {
  const a = structuredClone(asset);
  const k = a.komari;
  if (!k?.overridden?.[key]) return a;
  setKey(a, key, k.overridden[key].komari);
  delete k.overridden[key];
  return a;
}

export function formatKomariValue(key: string, v: unknown, currency = "USD"): string {
  if (v === null || v === undefined) return "—";
  if (key === "price") return `${currency === "CNY" ? "¥" : currency === "USD" ? "$" : currency + " "}${v}`;
  if (key === "autoRenew") return v ? "开" : "关";
  if (key === "tags") return (v as string[]).join("、") || "无";
  if (key === "cycle") return ({ month: "月付", quarter: "季付", halfyear: "半年付", year: "年付", "2year": "两年付", "3year": "三年付", once: "一次性" } as Record<string, string>)[String(v)] ?? String(v);
  return String(v);
}

const TRAFFIC_TYPES = ["sum", "max", "min", "up", "down"] as const;

export function mapStatus(uuid: string, r: KomariRecord, client?: KomariClient, history: number[] = []): NodeStatus {
  const udp = Number(r.connections_udp ?? 0);
  const tt = TRAFFIC_TYPES.find((t) => t === client?.traffic_limit_type) ?? "max";
  return {
    uuid,
    online: Boolean(r.online),
    cpu: Math.round(Number(r.cpu ?? 0) * 10) / 10,
    ram: [Number(r.ram ?? 0), Number(r.ram_total ?? client?.mem_total ?? 0)],
    swap: [Number(r.swap ?? 0), Number(r.swap_total ?? 0)],
    disk: [Number(r.disk ?? 0), Number(r.disk_total ?? client?.disk_total ?? 0)],
    load: [Number(r.load ?? 0), Number(r.load5 ?? 0), Number(r.load15 ?? 0)],
    up: Number(r.net_out ?? 0),
    down: Number(r.net_in ?? 0),
    totalUp: Number(r.net_total_up ?? 0),
    totalDown: Number(r.net_total_down ?? 0),
    trafficLimit: Number(client?.traffic_limit ?? 0),
    trafficType: tt,
    uptimeSec: Number(r.uptime ?? 0),
    tcp: Math.max(0, Number(r.connections ?? 0) - udp),
    udp,
    process: Number(r.process ?? 0),
    updatedAt: r.time,
    netHistory: history,
  };
}

/** Traffic counted the way Komari counts it for the limit (utils/notifier/traffic.go). */
export function trafficUsed(s: Pick<NodeStatus, "trafficType" | "totalUp" | "totalDown">): number {
  switch (s.trafficType) {
    case "sum": return s.totalUp + s.totalDown;
    case "up": return s.totalUp;
    case "down": return s.totalDown;
    case "min": return Math.min(s.totalUp, s.totalDown);
    default: return Math.max(s.totalUp, s.totalDown);
  }
}

/** Build a new server asset from an unbound Komari node. */
export function assetFromClient(c: KomariClient, settings: Pick<KomariSettings, "fields">): Partial<Asset> & { type: "server"; name: string } {
  const mapped = mapClient(c);
  const base: Asset = {
    id: "", type: "server", name: c.name || c.uuid.slice(0, 8), price: 0, currency: "USD", cycle: "month", autoRenew: false,
    tags: [], details: [], related: [], renewals: [], createdAt: "", updatedAt: "",
    komari: { uuid: c.uuid, fields: {}, overridden: {} },
  };
  for (const [key, group] of Object.entries(KOMARI_KEYS)) {
    if (settings.fields[group] && mapped[key] !== undefined) setKey(base, key, mapped[key]);
  }
  base.komari = { uuid: c.uuid, fields: mapped, overridden: {}, agentVersion: c.version };
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = base;
  return { ...rest, type: "server" };
}
