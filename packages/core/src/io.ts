import { normalizeAsset, ValidationError } from "./asset";
import { daysUntil } from "./dates";
import { perCycle } from "./cost";
import { ASSET_TYPES, TYPE_LABEL, type Asset, type AssetInput, type AssetType, type CardStatus, type Cycle } from "./types";

/** CSV columns, shared by every type so one file can be imported back. */
export const CSV_COLUMNS = [
  "id", "type", "name", "subtitle", "provider", "price", "currency", "cycle", "expiresAt", "autoRenew", "purchasedAt",
  "region", "discount", "tags", "related", "accountId", "details", "note", "starred", "pinned",
  "komariUuid", "trafficResetDay",
  "accountUsername", "accountSite",
  "phoneNumber", "phoneCarrier", "phoneCountry", "phonePurpose",
  "cardIssuer", "cardNetwork", "cardLast4", "cardExpiry", "cardFees", "cardBillingRegion", "cardStatus",
] as const;

const esc = (v: unknown) => {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+@]/.test(s) || /^-[^\d]/.test(s)) s = "'" + s; // keep spreadsheets from running formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function row(a: Asset): Record<(typeof CSV_COLUMNS)[number], unknown> {
  return {
    id: a.id, type: a.type, name: a.name, subtitle: a.subtitle, provider: a.provider, price: a.price, currency: a.currency,
    cycle: a.cycle, expiresAt: a.expiresAt, autoRenew: a.autoRenew ? "yes" : "no", purchasedAt: a.purchasedAt,
    region: a.region, discount: a.discount, tags: a.tags.join(";"), related: a.related.join(";"), accountId: a.accountId,
    details: a.details.map((d) => `${d.label}=${d.value}`).join(";"), note: a.note,
    starred: a.starred ? "yes" : "no", pinned: a.pinned ? "yes" : "no",
    komariUuid: a.komari?.uuid, trafficResetDay: a.komari?.trafficResetDay,
    accountUsername: a.account?.username, accountSite: a.account?.site,
    phoneNumber: a.phone?.number, phoneCarrier: a.phone?.carrier, phoneCountry: a.phone?.country, phonePurpose: a.phone?.purpose,
    cardIssuer: a.payment?.issuer, cardNetwork: a.payment?.network, cardLast4: a.payment?.last4, cardExpiry: a.payment?.cardExpiry,
    cardFees: a.payment?.fees, cardBillingRegion: a.payment?.billingRegion, cardStatus: a.payment?.status,
  };
}

export function toCsv(assets: Asset[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const a of assets) {
    const r = row(a);
    lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** One CSV per type ("按类型分表"), keyed by file name. */
export function toCsvByType(assets: Asset[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of ASSET_TYPES) {
    const list = assets.filter((a) => a.type === t);
    if (list.length) out[`${t}.csv`] = toCsv(list);
  }
  return out;
}

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((x) => x !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((x) => x !== "")) rows.push(cur); }
  return rows;
}

const TYPE_ALIASES: Record<string, AssetType> = {
  sub: "subscription", 订阅: "subscription", 服务器: "server", vps: "server", 域名: "domain", 证书: "cert", 邮箱: "mail",
  号码: "phone", 支付: "payment", card: "payment", 卡: "payment", 账号: "account", 文档: "document", doc: "document",
};
const CYCLE_ALIASES: Record<string, Cycle> = { 月: "month", 月付: "month", monthly: "month", 季: "quarter", quarterly: "quarter", 半年: "halfyear", 年: "year", 年付: "year", yearly: "year", annual: "year", 一次性: "once", lifetime: "once" };
const truthy = (s: string) => /^(1|yes|true|是|y|on)$/i.test(s.trim());
const list = (s?: string) => (s ?? "").split(/[;；]/).map((x) => x.trim()).filter(Boolean);

/** CSV text → asset inputs (not yet saved). Unknown columns are ignored. Errors carry the line number. */
export function csvToInputs(text: string): AssetInput[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const idx = (k: string) => header.findIndex((h) => h.trim().toLowerCase() === k.toLowerCase());
  const get = (r: string[], k: string) => { const i = idx(k); return i >= 0 ? (r[i] ?? "").trim().replace(/^'(?=[=+\-@])/, "") : ""; };
  return rows.map((r, n) => {
    try {
      const rawType = get(r, "type").toLowerCase();
      const type = (TYPE_ALIASES[rawType] ?? rawType) as AssetType;
      const cycleRaw = get(r, "cycle");
      const input: AssetInput = {
        ...(get(r, "id") ? { id: get(r, "id") } : {}),
        type, name: get(r, "name"),
        subtitle: get(r, "subtitle") || undefined, provider: get(r, "provider") || undefined,
        price: Number(get(r, "price") || 0), currency: get(r, "currency") || "USD",
        cycle: (CYCLE_ALIASES[cycleRaw] ?? (cycleRaw || "month")) as Cycle,
        expiresAt: get(r, "expiresAt") || null, autoRenew: truthy(get(r, "autoRenew")), purchasedAt: get(r, "purchasedAt") || null,
        region: get(r, "region") || undefined, discount: get(r, "discount") || undefined,
        tags: list(get(r, "tags")), related: list(get(r, "related")), accountId: get(r, "accountId") || null,
        details: list(get(r, "details")).map((d) => { const [label, ...v] = d.split("="); return { label, value: v.join("=") }; }),
        note: get(r, "note") || undefined,
      };
      // 关注 / 置顶 only when the file has the column, so importing an older CSV never clears them
      if (idx("starred") >= 0) input.starred = truthy(get(r, "starred"));
      if (idx("pinned") >= 0) input.pinned = truthy(get(r, "pinned"));
      if (get(r, "komariUuid")) input.komari = { uuid: get(r, "komariUuid"), ...(get(r, "trafficResetDay") ? { trafficResetDay: Number(get(r, "trafficResetDay")) } : {}) };
      if (get(r, "accountUsername")) input.account = { username: get(r, "accountUsername"), site: get(r, "accountSite") || undefined };
      if (type === "phone") input.phone = { number: get(r, "phoneNumber") || input.name, carrier: get(r, "phoneCarrier") || undefined, country: get(r, "phoneCountry") || undefined, purpose: get(r, "phonePurpose") || undefined };
      if (type === "payment") input.payment = {
        issuer: get(r, "cardIssuer") || input.provider || "", network: get(r, "cardNetwork") || undefined, last4: get(r, "cardLast4"),
        cardExpiry: get(r, "cardExpiry") || undefined, fees: get(r, "cardFees") || undefined, billingRegion: get(r, "cardBillingRegion") || undefined,
        status: (get(r, "cardStatus") || "active") as CardStatus,
      };
      normalizeAsset(input); // validate early
      return input;
    } catch (e) {
      throw new ValidationError(`第 ${n + 2} 行：${(e as Error).message}`);
    }
  });
}

/** JSON import accepts a bare array of assets or a data.json document. */
export function jsonToInputs(text: string): AssetInput[] {
  const v = JSON.parse(text);
  const arr = Array.isArray(v) ? v : Array.isArray(v?.assets) ? v.assets : null;
  if (!arr) throw new ValidationError("JSON 需要是资产数组，或含 assets 字段的导出文件");
  return arr.map((a: AssetInput, i: number) => {
    const t = TYPE_ALIASES[String(a.type).toLowerCase()];
    const input = t ? { ...a, type: t } : a;
    try { normalizeAsset(input); } catch (e) { throw new ValidationError(`第 ${i + 1} 项：${(e as Error).message}`); }
    return input;
  });
}

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsDate = (iso: string) => iso.replaceAll("-", "");
const fold = (line: string) => {
  const out: string[] = [];
  let s = line;
  while (s.length > 70) { out.push(s.slice(0, 70)); s = " " + s.slice(70); }
  out.push(s);
  return out.join("\r\n");
};

/** 续费日历: one all-day event per expiry, with a 7-day and a 1-day reminder. */
export function toIcs(assets: Asset[], stamp = new Date().toISOString()): string {
  const dt = stamp.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fangcun//Renewals//ZH", "CALSCALE:GREGORIAN", "X-WR-CALNAME:方寸 · 续费日历"];
  for (const a of assets) {
    if (!a.expiresAt || a.deletedAt) continue;
    const end = new Date(Date.parse(a.expiresAt) + 86_400_000).toISOString().slice(0, 10);
    const desc = [`${TYPE_LABEL[a.type]} · ${a.provider ?? ""}`, perCycle(a), a.autoRenew ? "自动续费" : "需手动续费", a.note ?? ""].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT", `UID:${a.id}-${icsDate(a.expiresAt)}@fangcun`, `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${icsDate(a.expiresAt)}`, `DTEND;VALUE=DATE:${icsDate(end)}`,
      fold(`SUMMARY:${icsEsc(`${a.name} 到期`)}`), fold(`DESCRIPTION:${icsEsc(desc)}`),
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P7D", fold(`DESCRIPTION:${icsEsc(`${a.name} 7 天后到期`)}`), "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P1D", fold(`DESCRIPTION:${icsEsc(`${a.name} 明天到期`)}`), "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export interface DoctorIssue { level: "error" | "warn" | "info"; code: string; assetId: string; name: string; message: string }

/** `fangcun doctor`: missing fields, duplicates, lapsed and unlinked assets. */
export function doctor(assets: Asset[], today: string): DoctorIssue[] {
  const live = assets.filter((a) => !a.deletedAt);
  const ids = new Set(live.map((a) => a.id));
  const issues: DoctorIssue[] = [];
  const add = (a: Asset, level: DoctorIssue["level"], code: string, message: string) => issues.push({ level, code, assetId: a.id, name: a.name, message });
  const seen = new Map<string, Asset>();
  const linked = new Set<string>();
  for (const a of live) { a.related.forEach((r) => linked.add(r)); if (a.accountId) linked.add(a.accountId); }
  for (const a of live) {
    const d = daysUntil(a.expiresAt, today);
    if (d < 0 && !(a.type === "payment" && a.payment?.status === "closed")) add(a, "error", "expired", `已过期 ${-d} 天，未标记续费或删除`);
    if (!a.expiresAt && a.cycle !== "once" && !["account", "document"].includes(a.type)) add(a, "warn", "no-expiry", "缺少到期日");
    if (a.price === 0 && !["cert", "account", "document"].includes(a.type) && a.cycle !== "once") add(a, "info", "no-price", "价格为 0，确认是否免费");
    if (!a.provider && !["account", "document"].includes(a.type)) add(a, "info", "no-provider", "缺少服务商");
    if (a.type === "server" && !a.komari && !a.details.some((x) => x.label === "IPv4")) add(a, "info", "no-ip", "服务器没有 IP，也未绑定 Komari");
    if (a.type === "payment" && a.payment?.status === "active" && !a.payment.cardExpiry) add(a, "warn", "card-no-expiry", "支付卡缺少有效期");
    if (a.type === "phone" && !a.expiresAt) add(a, "warn", "phone-keep", "号码缺少保号/续费到期日");
    for (const r of a.related) if (!ids.has(r)) add(a, "warn", "broken-link", `关联的资产 ${r} 不存在`);
    if (a.accountId && !ids.has(a.accountId)) add(a, "warn", "broken-account", `登录账号 ${a.accountId} 不存在`);
    if (!a.related.length && !linked.has(a.id) && !a.accountId && a.type !== "account") add(a, "info", "unlinked", "没有任何关联");
    const key = `${a.type}:${a.name.toLowerCase()}`;
    const dup = seen.get(key);
    if (dup) add(a, "warn", "duplicate", `与 ${dup.id} 同名同类型，可能重复`);
    else seen.set(key, a);
    for (const w of a.team?.workspaces ?? []) {
      if (w.members.length > w.seats && w.seats > 0) add(a, "warn", "seats", `工作空间「${w.name}」成员 ${w.members.length} 人超过 ${w.seats} 席`);
    }
  }
  return issues;
}
