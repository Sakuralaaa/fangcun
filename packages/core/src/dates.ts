import { CYCLE_MONTHS, type Asset, type Cycle } from "./types";

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from `today` to `iso` (negative = past). Infinity when there is no date. */
export function daysUntil(iso: string | null | undefined, today: string): number {
  if (!iso) return Infinity;
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / DAY);
}

/** Add whole months, clamping to the end of month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ny}-${p(nm + 1)}-${p(Math.min(d, last))}`;
}

export function addCycle(iso: string, cycle: Cycle, n = 1): string | null {
  const months = CYCLE_MONTHS[cycle];
  if (!months) return null;
  return addMonths(iso, months * n);
}

/** Last day of a YYYY-MM card expiry. */
export function endOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/**
 * Next expiry after marking renewed. Starts from the current expiry, or today when the asset
 * lapsed more than one cycle ago / has no expiry, so one click never leaves it still overdue.
 */
export function nextExpiry(a: Pick<Asset, "expiresAt" | "cycle">, today: string): string | null {
  if (a.cycle === "once") return a.expiresAt ?? null;
  let base = a.expiresAt && isIsoDate(a.expiresAt) ? a.expiresAt : today;
  let next = addCycle(base, a.cycle)!;
  if (next < today) {
    base = today;
    next = addCycle(base, a.cycle)!;
  }
  return next;
}

export type Urgency = "crit" | "warn" | "ok" | "none";

/** 红 ≤7 天（含已过期），橙 ≤14 天，其余中性。 */
export function urgency(expiresAt: string | null | undefined, today: string): Urgency {
  const d = daysUntil(expiresAt, today);
  if (d === Infinity) return "none";
  if (d <= 7) return "crit";
  if (d <= 14) return "warn";
  return "ok";
}

export function dueLabel(expiresAt: string | null | undefined, today: string): string {
  const d = daysUntil(expiresAt, today);
  if (d === Infinity) return "长期";
  if (d < 0) return `已过期 ${-d} 天`;
  if (d === 0) return "今天";
  if (d < 60) return `${d} 天`;
  if (d < 730) return `${Math.round(d / 30)} 个月`;
  return `${Math.round(d / 365)} 年`;
}

/** Months between purchase and today, at least 1. */
export function monthsHeld(purchasedAt: string | null | undefined, today: string): number {
  if (!purchasedAt) return 0;
  return Math.max(1, Math.round((Date.parse(today) - Date.parse(purchasedAt)) / (30.44 * DAY)));
}
