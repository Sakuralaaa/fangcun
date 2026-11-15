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
