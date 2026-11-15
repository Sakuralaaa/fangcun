import { CYCLE_LABEL, CYCLE_MONTHS, type Asset, type Cycle, type DisplaySettings } from "./types";
import { monthsHeld } from "./dates";

const SYMBOL: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "JP¥", HKD: "HK$", TRY: "₺", INR: "₹" };

export const currencySymbol = (c: string) => SYMBOL[c] ?? `${c} `;

export function money(n: number, currency: string, opts: { free?: boolean } = { free: true }): string {
  if (n === 0 && opts.free) return "免费";
  const v = Math.abs(n) >= 100 || Number.isInteger(n) ? Math.round(n).toLocaleString("en-US") : n.toFixed(2).replace(/\.?0+$/, "");
  return `${n < 0 ? "-" : ""}${currencySymbol(currency)}${v.replace("-", "")}`;
}

export const perCycle = (a: Pick<Asset, "price" | "currency" | "cycle">) =>
  a.price === 0 ? "免费" : `${money(a.price, a.currency)}/${CYCLE_LABEL[a.cycle]}`;

/** Monthly cost in the asset's own currency. One-off purchases count as 0. */
export function monthlyCost(a: Pick<Asset, "price" | "cycle">): number {
  const m = CYCLE_MONTHS[a.cycle as Cycle];
  return m ? a.price / m : 0;
}

export function yearlyCost(a: Pick<Asset, "price" | "cycle">): number {
  return monthlyCost(a) * 12;
}

/** Rough total paid since purchase: whole cycles started × price (one-off = price). */
export function paidSoFar(a: Pick<Asset, "price" | "cycle" | "purchasedAt">, today: string): number {
  const months = monthsHeld(a.purchasedAt, today);
  const per = CYCLE_MONTHS[a.cycle];
  if (!per) return a.price;
  return a.price * Math.max(1, Math.ceil(months / per));
}

/** Monthly totals per currency — exact, no conversion. Excludes deleted and closed cards. */
export function monthlyByCurrency(assets: Asset[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assets) {
    if (a.deletedAt || !isBilled(a)) continue;
    const m = monthlyCost(a);
    if (m) out[a.currency] = (out[a.currency] ?? 0) + m;
  }
  return out;
}

export const isBilled = (a: Asset) => !(a.type === "payment" && a.payment?.status === "closed");

/**
 * Convert to the display currency with the user's own hand-typed rates.
 * Returns null when a rate is missing — callers show that currency separately instead of guessing.
 */
export function toDisplay(amount: number, currency: string, d: DisplaySettings): number | null {
  if (currency === d.currency) return amount;
  const from = d.rates[currency];
  const to = d.rates[d.currency];
  if (!from || !to) return null;
  return (amount / from) * to;
}

export function displayTotal(byCurrency: Record<string, number>, d: DisplaySettings) {
  let total = 0;
  const unconverted: Record<string, number> = {};
  for (const [c, v] of Object.entries(byCurrency)) {
    const x = toDisplay(v, c, d);
    if (x === null) unconverted[c] = v;
    else total += x;
  }
  return { total, unconverted, approx: Object.keys(byCurrency).some((c) => c !== d.currency) };
}

/** Per-seat cost of a workspace. */
export const perSeat = (price: number, seats: number) => (seats > 0 ? price / seats : price);

/** 费用表可排序的列。 */
export const COST_SORT_KEYS = ["name", "type", "price", "monthly", "expires"] as const;
export type CostSortKey = (typeof COST_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export interface CostSort { key: CostSortKey; dir: SortDir }
export const DEFAULT_COST_SORT: CostSort = { key: "monthly", dir: "desc" };
export const COST_SORT_LABEL: Record<CostSortKey, string> = { name: "资产名", type: "类型", price: "实付", monthly: "月成本", expires: "到期日" };
/** Direction a column starts in when first clicked: text and dates ascending, money descending. */
export const COST_SORT_FIRST: Record<CostSortKey, SortDir> = { name: "asc", type: "asc", price: "desc", monthly: "desc", expires: "asc" };

const TYPE_ORDER = ["server", "domain", "cert", "subscription", "mail", "phone", "payment", "account", "document"];

/**
 * Sort rows of the 费用 table. Money columns compare amounts converted to the display currency with the user's rates
 * (实付 = one cycle's price converted, not the literal number); rows whose currency has no rate, and rows without an
 * expiry, always go last whichever way the column is sorted. 类型 groups by type, then 每月 descending inside a type.
 */
export function sortCosts<T extends Pick<Asset, "name" | "type" | "price" | "currency" | "cycle" | "expiresAt">>(list: T[], sort: CostSort, d: DisplaySettings): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const monthly = (a: T) => toDisplay(monthlyCost(a), a.currency, d);
  const price = (a: T) => toDisplay(a.price, a.currency, d);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "zh");
  /** Compare two nullable values; null sorts last regardless of direction. */
  const nullable = (x: number | string | null | undefined, y: number | string | null | undefined) => {
    const xn = x === null || x === undefined, yn = y === null || y === undefined;
    if (xn || yn) return Number(xn) - Number(yn);
    return (x! < y! ? -1 : x! > y! ? 1 : 0) * sign;
  };
  const cmp = (a: T, b: T): number => {
    switch (sort.key) {
      case "name": return byName(a, b) * sign;
      case "type": {
        // inside one type: 每月 descending (missing rate last), whatever the direction of the type column
        const ma = monthly(a), mb = monthly(b);
        const inner = ma === null || mb === null ? Number(ma === null) - Number(mb === null) : mb - ma;
        return (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) * sign || inner || byName(a, b);
      }
      case "price": return nullable(price(a), price(b)) || byName(a, b);
      case "monthly": return nullable(monthly(a), monthly(b)) || byName(a, b);
      case "expires": return nullable(a.expiresAt || null, b.expiresAt || null) || byName(a, b);
    }
  };
  return [...list].sort(cmp);
}
