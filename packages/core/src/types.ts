/** Data schema version. Bump together with a migration in backup.ts. */
export const SCHEMA_VERSION = 2;
export const APP_VERSION = "0.1.2";

export const ASSET_TYPES = [
  "server", "domain", "cert", "subscription", "mail", "phone", "payment", "account", "document",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const TYPE_LABEL: Record<AssetType, string> = {
  server: "服务器", domain: "域名", cert: "证书", subscription: "订阅", mail: "邮箱",
  phone: "号码", payment: "支付", account: "账号", document: "文档",
};

export const CYCLES = ["month", "quarter", "halfyear", "year", "2year", "3year", "once"] as const;
export type Cycle = (typeof CYCLES)[number];
export const CYCLE_LABEL: Record<Cycle, string> = {
  month: "月", quarter: "季", halfyear: "半年", year: "年", "2year": "两年", "3year": "三年", once: "一次性",
};
export const CYCLE_MONTHS: Record<Cycle, number> = {
  month: 1, quarter: 3, halfyear: 6, year: 12, "2year": 24, "3year": 36, once: 0,
};

/** One free-form row in 详细信息. `key` is stable for synced rows (e.g. "ipv4"). */
export interface Detail { label: string; value: string; mono?: boolean }

export interface Renewal {
  date: string;          // YYYY-MM-DD the renewal was recorded
  amount: number;
  currency?: string;
  note: string;
  from?: string | null;  // previous expiry
  to?: string | null;    // new expiry
}

/** Komari binding. `fields` holds the last values read from Komari, keyed by sync key. */
export interface KomariLink {
  uuid: string;
  syncedAt?: string;
  agentVersion?: string;
  /** Last values seen in Komari (raw, JSON-able). */
  fields?: Record<string, unknown>;
  /** Keys edited in 方寸: Komari no longer overwrites them. `changed` = Komari's value moved since. */
  overridden?: Record<string, { komari: unknown; changed?: boolean }>;
  /** Day of month the provider resets traffic (typed by hand in 方寸). */
  trafficResetDay?: number;
}

export interface TeamMember {
  email: string;
  role: "owner" | "member";
  note?: string;
  /** Demo-only quota preview (CPA plugin is on the roadmap). */
  quota?: { label: string; usedPct: number; resetAt: string }[];
  authIndex?: string;
}
/** A workspace under a parent account; price is what was actually paid (region / discount), never converted. */
export interface Workspace {
  id: string; name: string; seats: number; price: number; currency: string; cycle: Cycle;
  expiresAt?: string | null; region?: string; discount?: string; members: TeamMember[];
}
export interface Team { owner: string; workspaces: Workspace[] }

export interface AccountInfo {
  username: string;
  site?: string;
  websites?: { label: string; url: string }[];
  hasTotp?: boolean;
  /** Placeholder for the end-to-end encrypted vault (v0.2). Never returned by the API. */
  secret?: null;
}

export const CARD_NETWORKS = ["Visa", "Mastercard", "银联", "American Express", "JCB", "Discover", "其他"] as const;
export const CARD_STATUS = ["active", "frozen", "closed"] as const;
export type CardStatus = (typeof CARD_STATUS)[number];
export const CARD_STATUS_LABEL: Record<CardStatus, string> = { active: "正常", frozen: "冻结", closed: "已注销" };

/** Payment card (U 卡 / 虚拟卡 / 银行卡). Only the last four digits are ever stored — never the full number or CVV. */
export interface PaymentInfo {
  issuer: string;           // 发卡平台
  network?: string;         // 卡组织
  last4: string;            // 卡号末四位
  cardExpiry?: string;      // YYYY-MM, drives expiresAt
  fees?: string;            // 开卡费 / 充值手续费 (free text)
  billingRegion?: string;   // 账单地区
  status: CardStatus;
}

export interface PhoneInfo {
  number: string;
  carrier?: string;         // 运营商 / 平台
  country?: string;
  purpose?: string;
}

export interface Attachment { name: string; size: number; sha256: string; addedAt: string; mime?: string }

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  subtitle?: string;
  provider?: string;
  /** Actually paid, typed by hand. Never auto-converted. */
  price: number;
  currency: string;
  cycle: Cycle;
  expiresAt?: string | null;
  autoRenew: boolean;
  purchasedAt?: string | null;
  /** Free-form price tags: 区域 (e.g. 土耳其区) and 折扣 (e.g. 年付 8 折). */
  region?: string;
  discount?: string;
  tags: string[];
  details: Detail[];
  accountId?: string | null;
  related: string[];
  note?: string;
  renewals: Renewal[];
  komari?: KomariLink | null;
  team?: Team | null;
  account?: AccountInfo | null;
  payment?: PaymentInfo | null;
  phone?: PhoneInfo | null;
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export type AssetInput = Partial<Omit<Asset, "createdAt" | "updatedAt" | "deletedAt">> & { type: AssetType; name: string };

/** Forwarded from Komari rpc2 common:getNodesLatestStatus, normalised. Bytes / bytes per second. */
export interface NodeStatus {
  uuid: string;
  online: boolean;
  cpu: number;
  ram: [number, number];
  swap: [number, number];
  disk: [number, number];
  load: [number, number, number];
  up: number; down: number;
  totalUp: number; totalDown: number;
  trafficLimit: number;
  trafficType: "sum" | "max" | "min" | "up" | "down";
  uptimeSec: number;
  tcp: number; udp: number;
  process: number;
  updatedAt?: string;
  /** Recent (down+up) speed samples collected by the 方寸 server. */
  netHistory: number[];
}

export type TokenScope = "read" | "write" | "full";
export const SCOPE_LABEL: Record<TokenScope, string> = { read: "只读", write: "可写（需审批）", full: "完全权限" };

export type Op =
  | { op: "put"; id: string; before: Asset | null; after: Asset }
  | { op: "delete"; id: string; before: Asset }
  | { op: "purge"; id: string; before: Asset };

export interface Changeset {
  id: string;
  createdAt: string;
  actor: string;
  summary: string;
  ops: Op[];
  status: "pending" | "applied" | "rejected" | "conflict";
  decidedAt?: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  assetId: string | null;
  summary: string;
  before: Asset | null;
  after: Asset | null;
  changesetId?: string | null;
  undoneBy?: number | null;
}

export interface KomariSettings {
  url: string;
  intervalMin: number;
  fields: Record<KomariFieldGroup, boolean>;
}
export type KomariFieldGroup = "price" | "cycle" | "expiresAt" | "autoRenew" | "specs" | "network" | "tags";

export interface DisplaySettings {
  /** Currency used for overview totals. */
  currency: string;
  /** How many units of each currency equal 1 display currency. Only for 约 totals; asset prices are never converted. */
  rates: Record<string, number>;
  /** Fetch rates automatically (ECB via Frankfurter, fallback open.er-api). When false, rates are hand-typed. */
  autoRates: boolean;
  /** When the automatic rates were last fetched (ISO) and from where. */
  ratesUpdatedAt?: string;
  ratesSource?: string;
}

export interface BackupSettings { keep: number; hour: number }

export interface Settings {
  komari: KomariSettings;
  display: DisplaySettings;
  backup: BackupSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  komari: {
    url: "",
    intervalMin: 30,
    fields: { price: true, cycle: true, expiresAt: true, autoRenew: true, specs: true, network: true, tags: false },
  },
  display: { currency: "USD", rates: { USD: 1, CNY: 7.2, HKD: 7.8, EUR: 0.92, GBP: 0.79, JPY: 150 }, autoRates: true },
  backup: { keep: 30, hour: 4 },
};

/** The JSON document inside a .fangcun backup and the JSON export. */
export interface DataDoc {
  schemaVersion: number;
  exportedAt: string;
  assets: Asset[];
  settings: Settings;
}
