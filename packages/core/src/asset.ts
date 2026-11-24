import { normalizeQuotaBinds } from "./cliproxyapi";
import { endOfMonth, isIsoDate, nextExpiry, remindDays } from "./dates";
import {
  ASSET_TYPES, CARD_STATUS, CYCLES, type Asset, type AssetInput, type AssetType, type Cycle, type Renewal,
} from "./types";

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

const str = (v: unknown, max = 500): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
};
const windowDays = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw new ValidationError("可续期天数应为 0–3650 的整数");
  return n || null;
};

const date = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!isIsoDate(s)) throw new ValidationError(`${field} 需要 YYYY-MM-DD 格式`);
  return s;
};
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Digits that look like a full card number (13–19 digits, spaces/dashes allowed) and pass Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  if (/^\s*\+/.test(text)) return false; // international phone numbers (+86 138 …) are not cards
  for (const m of text.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, "");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let n = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

const FORBIDDEN_KEYS = /^(cvv|cvc|cvv2|cardnumber|card_number|pan|fullnumber|securitycode)$/i;

function assertNoCardData(value: unknown, path = "asset"): void {
  if (typeof value === "string") {
    if (looksLikeCardNumber(value)) throw new ValidationError(`${path} 看起来包含完整卡号；方寸只保存卡号末四位`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoCardData(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(k)) throw new ValidationError(`不保存 ${k}：方寸只保存卡号末四位，不存完整卡号和 CVV`);
      assertNoCardData(v, `${path}.${k}`);
    }
  }
}

export function newId(prefix = "a"): string {
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
  return `${prefix}_${r}`;
}

/**
 * Validate and normalise an asset. Rolls team workspaces up into price / expiry,
 * derives a payment card's expiry from its YYYY-MM, strips any vault secret.
 */
export function normalizeAsset(input: AssetInput & Partial<Asset>, now = new Date().toISOString()): Asset {
  if (!input || typeof input !== "object") throw new ValidationError("资产数据无效");
  assertNoCardData(input);
  const type = input.type as AssetType;
  if (!ASSET_TYPES.includes(type)) throw new ValidationError(`未知类型 ${String(input.type)}`);
  const name = str(input.name, 200);
  if (!name) throw new ValidationError("名称不能为空");
  const cycle = (input.cycle ?? "month") as Cycle;
  if (!CYCLES.includes(cycle)) throw new ValidationError(`未知周期 ${String(input.cycle)}`);
  const price = Number(input.price ?? 0);
  if (!Number.isFinite(price) || price < 0) throw new ValidationError("价格需要是非负数字");
  const currency = (str(input.currency, 8) ?? "USD").toUpperCase();
  if (!/^[A-Z]{3,5}$/.test(currency)) throw new ValidationError("币种用 3 位字母代码，如 USD、CNY");

  const a: Asset = {
    id: str(input.id, 64) ?? newId(),
    type, name,
    subtitle: str(input.subtitle, 200),
    provider: str(input.provider, 200),
    price: Math.round(price * 100) / 100,
    currency, cycle,
    expiresAt: date(input.expiresAt, "到期日"),
    autoRenew: Boolean(input.autoRenew),
    renewWindowDays: windowDays(input.renewWindowDays),
    purchasedAt: date(input.purchasedAt, "购入日期"),
    region: str(input.region, 60),
    discount: str(input.discount, 60),
    tags: uniq((input.tags ?? []).map(String)).slice(0, 50),
    details: (input.details ?? [])
      .filter((d) => d && str(d.label) && d.value !== undefined)
      .map((d) => ({ label: str(d.label, 60)!, value: String(d.value).slice(0, 500), ...(d.mono ? { mono: true } : {}) })),
    accountId: str(input.accountId, 64) ?? null,
    related: uniq((input.related ?? []).map(String)),
    note: str(input.note, 10_000),
    // 置顶隐含关注
    starred: Boolean(input.starred) || Boolean(input.pinned),
    pinned: Boolean(input.pinned),
    renewals: (input.renewals ?? []).map((r) => ({
      date: date(r.date, "续费日期") ?? now.slice(0, 10),
      amount: Number(r.amount) || 0,
      ...(r.currency ? { currency: String(r.currency) } : {}),
      note: String(r.note ?? ""),
      ...(r.from !== undefined ? { from: r.from } : {}),
      ...(r.to !== undefined ? { to: r.to } : {}),
    })),
    komari: input.komari && str(input.komari.uuid)
      ? {
          uuid: str(input.komari.uuid, 64)!,
          syncedAt: input.komari.syncedAt,
          agentVersion: input.komari.agentVersion,
          fields: input.komari.fields ?? {},
          overridden: input.komari.overridden ?? {},
          ...(input.komari.trafficResetDay ? { trafficResetDay: clampDay(input.komari.trafficResetDay) } : {}),
        }
      : null,
    atoll: type === "server" && input.atoll && typeof input.atoll === "object" && "serverId" in input.atoll
      ? { serverId: input.atoll.serverId === null ? null : str(input.atoll.serverId, 100) ?? null }
      : null,
    quotaBinds: normalizeQuotaBinds(input.quotaBinds),
    team: null,
    account: null,
    payment: null,
    phone: null,
    attachments: input.attachments ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    deletedAt: input.deletedAt ?? null,
  };
  if (a.id === a.accountId) a.accountId = null;
  a.related = a.related.filter((r) => r !== a.id);

  if (input.team && Array.isArray(input.team.workspaces)) {
    a.team = {
      owner: str(input.team.owner, 200) ?? "",
      workspaces: input.team.workspaces.map((w) => ({
        id: str(w.id, 64) ?? newId("ws"),
        name: str(w.name, 100) ?? "工作空间",
        seats: Math.max(0, Math.floor(Number(w.seats) || 0)),
        price: Math.max(0, Number(w.price) || 0),
        currency: (str(w.currency, 8) ?? currency).toUpperCase(),
        cycle: CYCLES.includes(w.cycle) ? w.cycle : cycle,
        expiresAt: date(w.expiresAt, "工作空间到期日"),
        region: str(w.region, 60),
        discount: str(w.discount, 60),
        members: (w.members ?? []).filter((m) => str(m.email)).map((m) => ({
          email: str(m.email, 200)!, role: m.role === "owner" ? "owner" : "member",
          ...(m.note ? { note: String(m.note) } : {}),
        })),
      })),
    };
    rollupTeam(a);
  }

  if (type === "account" || input.account) {
    const acc = input.account;
    if (acc) {
      a.account = {
        username: str(acc.username, 200) ?? "",
        site: str(acc.site, 300),
        websites: (acc.websites ?? []).filter((w) => str(w.url)).map((w) => ({ label: str(w.label, 40) ?? "网站", url: str(w.url, 500)! })),
        hasTotp: Boolean(acc.hasTotp),
        secret: null, // vault lands in v0.2; nothing is stored here in v0.1
      };
    }
  }

  if (type === "payment") {
    const p = input.payment;
    if (!p) throw new ValidationError("支付类型需要卡片信息（发卡平台、末四位）");
    const last4 = String(p.last4 ?? "").replace(/\D/g, "");
    if (last4.length !== 4) throw new ValidationError("卡号末四位需要正好 4 位数字（方寸不保存完整卡号）");
    const exp = str(p.cardExpiry, 7);
    if (exp && !/^\d{4}-(0[1-9]|1[0-2])$/.test(exp)) throw new ValidationError("卡片有效期用 YYYY-MM 格式，如 2028-09");
    const status = CARD_STATUS.includes(p.status) ? p.status : "active";
    const optMoney = (v: unknown, label: string): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${label}需要是非负数字`);
      return Math.round(n * 100) / 100;
    };
    const balance = optMoney(p.balance, "卡内余额");
    const reserveBuffer = optMoney(p.reserveBuffer, "最低预留底线");
    const balCurRaw = str(p.balanceCurrency, 8)?.toUpperCase();
    if (balCurRaw && !/^[A-Z]{3,5}$/.test(balCurRaw)) throw new ValidationError("余额币种用 3 位字母代码，如 USD、CNY");
    const balanceUpdatedAt = p.balanceUpdatedAt === undefined ? undefined : date(p.balanceUpdatedAt, "余额更新日期");
    a.payment = {
      issuer: str(p.issuer, 100) ?? a.provider ?? "",
      network: str(p.network, 40),
      last4,
      cardExpiry: exp,
      fees: str(p.fees, 500),
      billingRegion: str(p.billingRegion, 60),
      status,
      ...(balance !== undefined ? { balance } : {}),
      ...(balCurRaw ? { balanceCurrency: balCurRaw } : {}),
      ...(balanceUpdatedAt !== undefined ? { balanceUpdatedAt } : {}),
      ...(reserveBuffer !== undefined ? { reserveBuffer } : {}),
    };
    if (!a.payment.issuer) throw new ValidationError("支付类型需要填写发卡平台");
    if (!a.provider) a.provider = a.payment.issuer;
    // The card's validity drives the expiry reminder; a closed card no longer reminds.
    a.expiresAt = status === "closed" ? null : exp ? endOfMonth(exp) : a.expiresAt;
  }

  if (type === "phone" || input.phone) {
    const ph = input.phone;
    if (ph || type === "phone") {
      a.phone = {
        number: str(ph?.number, 40) ?? name,
        carrier: str(ph?.carrier, 100),
        country: str(ph?.country, 60),
        purpose: str(ph?.purpose, 200),
      };
    }
  }

  return stripUndefined(a);
}

const clampDay = (n: number) => Math.min(31, Math.max(1, Math.floor(Number(n) || 1)));

/** Team asset = sum of workspace prices (same currency) and the earliest workspace expiry. */
export function rollupTeam(a: Asset): Asset {
  const ws = a.team?.workspaces ?? [];
  if (!ws.length) return a;
  const same = ws.every((w) => w.currency === ws[0].currency && w.cycle === ws[0].cycle);
  if (same) {
    a.price = Math.round(ws.reduce((s, w) => s + w.price, 0) * 100) / 100;
    a.currency = ws[0].currency;
    a.cycle = ws[0].cycle;
  }
  const dates = ws.map((w) => w.expiresAt).filter(Boolean) as string[];
  if (dates.length) a.expiresAt = dates.sort()[0];
  return a;
}

function stripUndefined<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

/**
 * Mark an asset renewed: push its expiry forward one cycle and append a renewal record.
 * For team assets, renews the workspace(s) that expire first (or the one named).
 */
export function renewAsset(a: Asset, today: string, opts: { amount?: number; note?: string; workspaceId?: string } = {}): Asset {
  const next = structuredClone(a);
  const record: Renewal = { date: today, amount: opts.amount ?? a.price, currency: a.currency, note: opts.note ?? "手动续费", from: a.expiresAt ?? null, to: null };
  if (next.team?.workspaces.length) {
    const target = opts.workspaceId
      ? next.team.workspaces.filter((w) => w.id === opts.workspaceId)
      : next.team.workspaces.filter((w) => w.expiresAt && w.expiresAt === a.expiresAt);
    if (!target.length) throw new ValidationError("没有找到要续费的工作空间");
    for (const w of target) w.expiresAt = nextExpiry(w, today);
    if (opts.amount === undefined) record.amount = target.reduce((s, w) => s + w.price, 0);
    record.note = opts.note ?? `续费 ${target.map((w) => w.name).join("、")}`;
    rollupTeam(next);
    record.to = next.expiresAt ?? null;
  } else if (next.type === "payment" && next.payment) {
    // A card "renewal" is a re-issued card: bump the validity by the cycle (typically years).
    const to = nextExpiry(next, today);
    next.expiresAt = to;
    if (to) next.payment.cardExpiry = to.slice(0, 7);
    record.to = to;
  } else {
    next.expiresAt = nextExpiry(next, today);
    record.to = next.expiresAt ?? null;
  }
  next.renewals = [record, ...next.renewals];
  return next;
}

/** JSON with object keys sorted, so equal values always compare equal. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x);
}

/** Field-level diff for change plans and the audit log. */
export function diffAssets(before: Asset | null, after: Asset | null): { field: string; before: unknown; after: unknown }[] {
  const out: { field: string; before: unknown; after: unknown }[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (k === "updatedAt" || k === "createdAt") continue;
    const b = (before as Record<string, unknown> | null)?.[k];
    const x = (after as Record<string, unknown> | null)?.[k];
    if (stableJson(b) !== stableJson(x)) out.push({ field: k, before: b ?? null, after: x ?? null });
  }
  return out;
}

/** Remove fields that must never leave the server (vault placeholder). */
export function publicAsset(a: Asset): Asset {
  if (!a.account) return a;
  const { secret: _s, ...account } = a.account;
  return { ...a, account: account as Asset["account"] };
}

/**
 * Make a 关注 / 置顶 patch consistent before it is merged onto an asset:
 * 取消关注 also 取消置顶; 置顶 also 关注. Other keys pass through untouched.
 */
export function focusPatch<T extends { starred?: boolean; pinned?: boolean }>(patch: T): T {
  const p = { ...patch };
  if (p.starred === false && p.pinned === undefined) p.pinned = false;
  if (p.pinned === true) p.starred = true;
  return p;
}

/** 资产列表顺序：置顶在前，其次按到期日（无到期日在后），再按名称。 */
export function compareAssets(a: Pick<Asset, "pinned" | "expiresAt" | "name" | "autoRenew" | "renewWindowDays">, b: Pick<Asset, "pinned" | "expiresAt" | "name" | "autoRenew" | "renewWindowDays">, today: string): number {
  return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || remindDays(a, today) - remindDays(b, today)
    || a.name.localeCompare(b.name, "zh");
}

/** 总览「关注」区块顺序：30 天内到期的关注项最先（按到期日），其次置顶，再按到期日。 */
export function compareStarred(a: Pick<Asset, "pinned" | "expiresAt" | "name" | "autoRenew" | "renewWindowDays">, b: Pick<Asset, "pinned" | "expiresAt" | "name" | "autoRenew" | "renewWindowDays">, today: string): number {
  const rank = (x: Pick<Asset, "pinned" | "expiresAt" | "autoRenew" | "renewWindowDays">) => (remindDays(x, today) <= 30 ? 0 : x.pinned ? 1 : 2);
  return rank(a) - rank(b) || remindDays(a, today) - remindDays(b, today) || a.name.localeCompare(b.name, "zh");
}

export function searchAssets(list: Asset[], q: string): Asset[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  return list.filter((a) => {
    const hay = [
      a.id, a.name, a.subtitle, a.provider, a.note, a.region, a.discount, ...a.tags,
      ...a.details.map((d) => `${d.label} ${d.value}`),
      a.account?.username, a.account?.site, a.payment?.issuer, a.payment?.last4, a.payment?.network,
      a.phone?.number, a.phone?.carrier, a.phone?.country, a.phone?.purpose, a.komari?.uuid,
      ...(a.team?.workspaces.flatMap((w) => [w.name, ...w.members.map((m) => m.email)]) ?? []),
    ].filter(Boolean).join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t.replace(/^#/, "")));
  });
}
