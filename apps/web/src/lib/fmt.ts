import {
  CYCLE_LABEL, assetDueLabel, assetUrgency, daysUntil as coreDays, remindDays as coreRemind, renewOpen as coreOpen, renewOpensAt, money as coreMoney, monthlyCost, perCycle as corePer,
  toDisplay, todayIso, type DisplaySettings, type Urgency,
} from "@fangcun/core";
import type { Asset } from "../data/types";

let today = todayIso();
/** Demo mode pins "today" so the sample data always looks the same. */
export const setToday = (iso: string) => { today = iso; };
export const getToday = () => today;

export const daysUntil = (iso?: string | null) => coreDays(iso, today);
type RenewFields = Pick<Asset, "expiresAt"> & Partial<Pick<Asset, "autoRenew" | "renewWindowDays">>;
/** Urgency and labels follow the reminder date: the manual-renewal window's opening day when set, else the expiry. */
export const urgency = (a: RenewFields): Urgency => assetUrgency(a, today);
export const dueLabel = (a: RenewFields) => assetDueLabel(a, today);
/** Days until the reminder date (window opening or expiry). */
export const remindDays = (a: RenewFields) => coreRemind(a, today);
export const renewOpen = (a: RenewFields) => coreOpen(a, today);
export { renewOpensAt };
export type { Urgency };

export const md = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};
export const ymd = (iso: string) => iso.replaceAll("-", "/");
export const cycleLabel = CYCLE_LABEL;
export const money = (n: number, c: string) => coreMoney(n, c);
export const perCycle = (a: Pick<Asset, "price" | "currency" | "cycle">) => corePer(a);

/** Monthly cost in the display currency using the user's own rates; 0 when a rate is missing. */
export const monthlyDisplay = (a: Asset, d: DisplaySettings) => toDisplay(monthlyCost(a), a.currency, d) ?? 0;

/** Calendar date for display: MM/DD inside the current year, YYYY/MM/DD otherwise (one rule site-wide). */
export const dateLabel = (iso: string) => (iso.slice(0, 4) === today.slice(0, 4) ? iso.slice(5, 10).replace("-", "/") : iso.slice(0, 10).replaceAll("-", "/"));
