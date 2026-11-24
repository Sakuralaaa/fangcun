import { displayTotal } from "./cost";
import { addCycle, addDays, daysUntil, isIsoDate } from "./dates";
import { CYCLE_MONTHS, type Asset, type AssetType, type DisplaySettings } from "./types";

export const CARD_RESERVE_WINDOWS = [7, 14, 30, 60, 90] as const;
export type CardReserveWindow = (typeof CARD_RESERVE_WINDOWS)[number];

export interface CardCharge {
  /** Unique key per scheduled charge occurrence. */
  key: string;
  assetId: string;
  assetName: string;
  assetType: AssetType;
  workspaceName?: string;
  date: string;
  days: number;
  amount: number;
  currency: string;
  autoRenew: boolean;
  overdue: boolean;
  isCardFee?: boolean;
}

export interface CardTimelineItem extends CardCharge {
  /** Converted to the card's balance currency (null if rate missing). */
  amountInCardCurrency: number | null;
  /** Running balance after this charge (null when balance is not recorded or rate missing). */
  runningBalance: number | null;
  /** True when this charge pushes running balance below 0. */
  insufficient: boolean;
  /** True when this charge stays >= 0 but drops below the configured reserveBuffer. */
  belowBuffer: boolean;
}

export type CardReserveStatus =
  | "card-risk"   // frozen with charges, or expires before an upcoming charge
  | "shortfall"   // recorded balance cannot cover upcoming charges + buffer
  | "prepare"     // no recorded balance, but has upcoming charges to keep money for
  | "ok"          // recorded balance covers upcoming charges + buffer
  | "idle";       // no upcoming charges in window (and balance >= buffer or unset)

export interface CardCurrencyTotal {
  total: number;
  unconverted: Record<string, number>;
  approx: boolean;
}

export interface CardReserveSummary {
  card: Asset;
  windowDays: number;
  balanceCurrency: string;
  balance: number | null;
  balanceUpdatedAt: string | null;
  reserveBuffer: number;
  /** All active non-deleted assets linked to this card (bidirectional). */
  linkedAssets: Asset[];
  /** Scheduled charges within the window (filtered by includeManual). */
  charges: CardCharge[];
  /** All charges (both auto + manual) within the window, regardless of filter. */
  allCharges: CardCharge[];
  /** Sum per original currency: auto-renew only. */
  autoByCurrency: Record<string, number>;
  /** Sum per original currency: manual-renew only. */
  manualByCurrency: Record<string, number>;
  /** Sum per original currency: active selection (auto only or auto + manual). */
  selectedByCurrency: Record<string, number>;
  /** Active selection converted into the card's balanceCurrency. */
  selectedInCardCurrency: CardCurrencyTotal;
  /** Auto-renew charges converted into the card's balanceCurrency. */
  autoInCardCurrency: CardCurrencyTotal;
  /** Total to keep on card (selected charges + reserveBuffer) in balanceCurrency. */
  recommendedKeep: number;
  /** Amount short of recommendedKeep (null when balance not recorded). */
  shortfall: number | null;
  /** Amount short of just the raw bills (excluding buffer; null when balance not recorded). */
  billShortfall: number | null;
  /** Projected remaining balance after selected charges (null when balance not recorded). */
  projectedRemaining: number | null;
  /** Chronological simulation with running balance. */
  timeline: CardTimelineItem[];
  /** First charge where balance drops below 0 (or below buffer if never < 0). */
  firstShortfallCharge: CardTimelineItem | null;
  nextCharge: CardCharge | null;
  /** Card is frozen while having upcoming charges. */
  isFrozenWithCharges: boolean;
  /** Card expires before at least one upcoming charge in this window. */
  expiresBeforeCharge: boolean;
  status: CardReserveStatus;
}

export interface CardReservesReport {
  windowDays: number;
  includeManual: boolean;
  cards: CardReserveSummary[];
  /** Upcoming paid charges on assets not linked to any active/frozen payment card. */
  unassignedCharges: CardCharge[];
  unassignedByCurrency: Record<string, number>;
  /** Total across all cards in selected mode, per original currency. */
  totalByCurrency: Record<string, number>;
  /** Auto-renew total across all cards, per original currency. */
  totalAutoByCurrency: Record<string, number>;
  /** Combined totals in the app's display currency. */
  totalDisplay: CardCurrencyTotal;
  totalAutoDisplay: CardCurrencyTotal;
  totalShortfallDisplay: CardCurrencyTotal;
  cardsNeedingTopUp: number;
  cardsAtRisk: number;
  cardsToPrepare: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Convert an amount between any two currencies using DisplaySettings.rates. */
export function convertCurrency(amount: number, from: string, to: string, d: DisplaySettings): number | null {
  if (from === to) return amount;
  const f = d.rates[from];
  const t = d.rates[to];
  if (!f || !t) return null;
  return (amount / f) * t;
}

/** Sum a currency map into any target currency using DisplaySettings.rates. */
export function convertCurrencyMap(byCurrency: Record<string, number>, targetCurrency: string, d: DisplaySettings): CardCurrencyTotal {
  let total = 0;
  const unconverted: Record<string, number> = {};
  for (const [c, v] of Object.entries(byCurrency)) {
    if (!v) continue;
    const x = convertCurrency(v, c, targetCurrency, d);
    if (x === null) unconverted[c] = r2((unconverted[c] ?? 0) + v);
    else total += x;
  }
  return {
    total: r2(total),
    unconverted,
    approx: Object.keys(byCurrency).some((c) => byCurrency[c] > 0 && c !== targetCurrency),
  };
}

/** Find all active (non-closed, non-deleted) payment cards linked bidirectionally to an asset. */
export function findLinkedCards(asset: Asset, allAssets: Asset[]): Asset[] {
  if (asset.type === "payment") return [];
  return allAssets.filter(
    (c) =>
      !c.deletedAt &&
      c.type === "payment" &&
      c.payment?.status !== "closed" &&
      (asset.related.includes(c.id) || c.related.includes(asset.id)),
  );
}

/** Find all non-deleted non-payment assets linked bidirectionally to a payment card. */
export function findAssetsForCard(card: Asset, allAssets: Asset[]): Asset[] {
  return allAssets.filter(
    (a) =>
      !a.deletedAt &&
      a.id !== card.id &&
      a.type !== "payment" &&
      (card.related.includes(a.id) || a.related.includes(card.id)),
  );
}

/** Add an amount to a currency map in place. */
function addCur(map: Record<string, number>, cur: string, amount: number) {
  if (!amount) return;
  map[cur] = r2((map[cur] ?? 0) + amount);
}

/** Collect every scheduled charge occurrence for one non-payment asset inside [-OVERDUE_LOOKBACK, windowDays]. */
const OVERDUE_LOOKBACK = 14;

export function collectAssetCharges(asset: Asset, today: string, windowDays: number): CardCharge[] {
  if (asset.deletedAt || asset.type === "payment") return [];
  const endDate = addDays(today, windowDays);
  const out: CardCharge[] = [];

  const pushSchedule = (
    baseKey: string,
    expiresAt: string | null | undefined,
    price: number,
    currency: string,
    cycle: Asset["cycle"],
    autoRenew: boolean,
    workspaceName?: string,
  ) => {
    if (!price || price <= 0 || !expiresAt || !isIsoDate(expiresAt)) return;
    const firstDays = daysUntil(expiresAt, today);
    if (firstDays < -OVERDUE_LOOKBACK || firstDays > windowDays) return;

    let curDate: string | null = expiresAt.slice(0, 10);
    let idx = 0;
    const MAX_OCCURRENCES = 12;
    while (curDate && curDate <= endDate && idx < MAX_OCCURRENCES) {
      const d = daysUntil(curDate, today);
      if (d >= -OVERDUE_LOOKBACK && d <= windowDays) {
        out.push({
          key: `${baseKey}:${curDate}:${idx}`,
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          ...(workspaceName ? { workspaceName } : {}),
          date: curDate,
          days: d,
          amount: r2(price),
          currency,
          autoRenew,
          overdue: d < 0,
        });
      }
      if (cycle === "once") break;
      const next = addCycle(curDate, cycle);
      if (!next || next <= curDate) break;
      curDate = next;
      idx++;
    }
  };

  if (asset.team?.workspaces.length) {
    for (const w of asset.team.workspaces) {
      pushSchedule(`${asset.id}:${w.id}`, w.expiresAt, w.price, w.currency, w.cycle, asset.autoRenew, w.name);
    }
  } else {
    pushSchedule(asset.id, asset.expiresAt, asset.price, asset.currency, asset.cycle, asset.autoRenew);
  }

  return out;
}

/** Collect recurring card fee charges (e.g. $1/month card maintenance fee) within the window. */
function collectCardFeeCharges(card: Asset, today: string, windowDays: number): CardCharge[] {
  if (card.deletedAt || card.type !== "payment" || card.payment?.status === "closed") return [];
  if (!card.price || card.price <= 0 || card.cycle === "once") return [];
  const months = CYCLE_MONTHS[card.cycle];
  if (!months) return [];

  const endDate = addDays(today, windowDays);
  const out: CardCharge[] = [];

  // Project next billing date from purchasedAt when available; otherwise treat monthly fee as due in 1 cycle
  let anchor: string | null = null;
  if (card.purchasedAt && isIsoDate(card.purchasedAt)) {
    let cur = card.purchasedAt.slice(0, 10);
    let guard = 0;
    while (cur < today && guard < 240) {
      const next = addCycle(cur, card.cycle);
      if (!next || next <= cur) break;
      cur = next;
      guard++;
    }
    anchor = cur;
  } else if (months === 1 && windowDays >= 28) {
    anchor = addDays(today, Math.min(windowDays, 30));
  }

  if (!anchor) return out;
  let curDate: string | null = anchor;
  let idx = 0;
  while (curDate && curDate <= endDate && idx < 12) {
    const d = daysUntil(curDate, today);
    if (d >= 0 && d <= windowDays) {
      out.push({
        key: `${card.id}:cardfee:${curDate}:${idx}`,
        assetId: card.id,
        assetName: `${card.name}（卡片费用）`,
        assetType: "payment",
        date: curDate,
        days: d,
        amount: r2(card.price),
        currency: card.currency,
        autoRenew: true,
        overdue: false,
        isCardFee: true,
      });
    }
    const next = addCycle(curDate, card.cycle);
    if (!next || next <= curDate) break;
    curDate = next;
    idx++;
  }
  return out;
}

const STATUS_PRIORITY: Record<CardReserveStatus, number> = {
  "card-risk": 0,
  shortfall: 1,
  prepare: 2,
  ok: 3,
  idle: 4,
};

export function computeCardReserves(
  assets: Asset[],
  today: string,
  display: DisplaySettings,
  opts: { windowDays?: number; includeManual?: boolean } = {},
): CardReservesReport {
  const windowDays = opts.windowDays ?? 30;
  const includeManual = opts.includeManual ?? true;
  const activeAssets = assets.filter((a) => !a.deletedAt);
  const paymentCards = activeAssets.filter((a) => a.type === "payment" && a.payment && a.payment.status !== "closed");

  const assignedAssetIds = new Set<string>();
  const totalByCurrency: Record<string, number> = {};
  const totalAutoByCurrency: Record<string, number> = {};
  const shortfallByCurrency: Record<string, number> = {};

  const cards: CardReserveSummary[] = paymentCards.map((card) => {
    const p = card.payment!;
    const balanceCurrency = p.balanceCurrency || card.currency || "USD";
    const balance = typeof p.balance === "number" && Number.isFinite(p.balance) ? r2(p.balance) : null;
    const reserveBuffer = typeof p.reserveBuffer === "number" && Number.isFinite(p.reserveBuffer) ? r2(p.reserveBuffer) : 0;

    const linkedAssets = findAssetsForCard(card, activeAssets);
    for (const la of linkedAssets) assignedAssetIds.add(la.id);

    const allCharges: CardCharge[] = [
      ...linkedAssets.flatMap((a) => collectAssetCharges(a, today, windowDays)),
      ...collectCardFeeCharges(card, today, windowDays),
    ].sort((a, b) => a.date.localeCompare(b.date) || Number(b.autoRenew) - Number(a.autoRenew) || a.assetName.localeCompare(b.assetName, "zh"));

    const charges = includeManual ? allCharges : allCharges.filter((c) => c.autoRenew);

    const autoByCurrency: Record<string, number> = {};
    const manualByCurrency: Record<string, number> = {};
    const selectedByCurrency: Record<string, number> = {};

    for (const c of allCharges) {
      if (c.autoRenew) addCur(autoByCurrency, c.currency, c.amount);
      else addCur(manualByCurrency, c.currency, c.amount);
    }
    for (const c of charges) {
      addCur(selectedByCurrency, c.currency, c.amount);
      addCur(totalByCurrency, c.currency, c.amount);
    }
    for (const [cur, val] of Object.entries(autoByCurrency)) {
      addCur(totalAutoByCurrency, cur, val);
    }

    const selectedInCardCurrency = convertCurrencyMap(selectedByCurrency, balanceCurrency, display);
    const autoInCardCurrency = convertCurrencyMap(autoByCurrency, balanceCurrency, display);
    const recommendedKeep = r2(selectedInCardCurrency.total + reserveBuffer);

    let running = balance;
    let firstShortfallCharge: CardTimelineItem | null = null;
    const timeline: CardTimelineItem[] = charges.map((c) => {
      const converted = convertCurrency(c.amount, c.currency, balanceCurrency, display);
      const amountInCardCurrency = converted === null ? null : r2(converted);
      let runningBalance: number | null = null;
      let insufficient = false;
      let belowBuffer = false;
      if (running !== null && amountInCardCurrency !== null) {
        running = r2(running - amountInCardCurrency);
        runningBalance = running;
        insufficient = running < 0;
        belowBuffer = !insufficient && reserveBuffer > 0 && running < reserveBuffer;
      }
      const item: CardTimelineItem = { ...c, amountInCardCurrency, runningBalance, insufficient, belowBuffer };
      if (!firstShortfallCharge && (insufficient || belowBuffer)) firstShortfallCharge = item;
      return item;
    });

    const billShortfall = balance !== null ? r2(Math.max(0, selectedInCardCurrency.total - balance)) : null;
    const shortfall = balance !== null ? r2(Math.max(0, recommendedKeep - balance)) : null;
    const projectedRemaining = balance !== null ? r2(balance - selectedInCardCurrency.total) : null;

    if (shortfall && shortfall > 0) addCur(shortfallByCurrency, balanceCurrency, shortfall);

    const nextCharge = charges[0] ?? null;
    const isFrozenWithCharges = p.status === "frozen" && charges.length > 0;
    const expiresBeforeCharge = Boolean(
      card.expiresAt && isIsoDate(card.expiresAt) && charges.some((c) => !c.isCardFee && c.date > card.expiresAt!),
    );

    let status: CardReserveStatus;
    if (isFrozenWithCharges || expiresBeforeCharge) {
      status = "card-risk";
    } else if (shortfall !== null && shortfall > 0) {
      status = "shortfall";
    } else if (balance === null && charges.length > 0) {
      status = "prepare";
    } else if (balance !== null && (charges.length > 0 || reserveBuffer > 0)) {
      status = "ok";
    } else {
      status = "idle";
    }

    return {
      card,
      windowDays,
      balanceCurrency,
      balance,
      balanceUpdatedAt: p.balanceUpdatedAt ?? null,
      reserveBuffer,
      linkedAssets,
      charges,
      allCharges,
      autoByCurrency,
      manualByCurrency,
      selectedByCurrency,
      selectedInCardCurrency,
      autoInCardCurrency,
      recommendedKeep,
      shortfall,
      billShortfall,
      projectedRemaining,
      timeline,
      firstShortfallCharge,
      nextCharge,
      isFrozenWithCharges,
      expiresBeforeCharge,
      status,
    };
  });

  cards.sort(
    (a, b) =>
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
      (a.nextCharge?.days ?? Infinity) - (b.nextCharge?.days ?? Infinity) ||
      (b.shortfall ?? 0) - (a.shortfall ?? 0) ||
      b.selectedInCardCurrency.total - a.selectedInCardCurrency.total ||
      a.card.name.localeCompare(b.card.name, "zh"),
  );

  // Unassigned upcoming charges: paid assets not linked to any active/frozen payment card
  const unassignedAll = activeAssets
    .filter((a) => a.type !== "payment" && !assignedAssetIds.has(a.id))
    .flatMap((a) => collectAssetCharges(a, today, windowDays))
    .filter((c) => (includeManual ? true : c.autoRenew))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(b.autoRenew) - Number(a.autoRenew) || a.assetName.localeCompare(b.assetName, "zh"));

  const unassignedByCurrency: Record<string, number> = {};
  for (const c of unassignedAll) addCur(unassignedByCurrency, c.currency, c.amount);

  return {
    windowDays,
    includeManual,
    cards,
    unassignedCharges: unassignedAll,
    unassignedByCurrency,
    totalByCurrency,
    totalAutoByCurrency,
    totalDisplay: displayTotal(totalByCurrency, display),
    totalAutoDisplay: displayTotal(totalAutoByCurrency, display),
    totalShortfallDisplay: displayTotal(shortfallByCurrency, display),
    cardsNeedingTopUp: cards.filter((c) => c.shortfall !== null && c.shortfall > 0).length,
    cardsAtRisk: cards.filter((c) => c.status === "card-risk").length,
    cardsToPrepare: cards.filter((c) => c.status === "prepare").length,
  };
}
