import {
  computeCardReserves,
  COST_SORT_FIRST,
  COST_SORT_KEYS,
  COST_SORT_LABEL,
  DEFAULT_COST_SORT,
  displayTotal,
  findLinkedCards,
  isBilled,
  monthlyByCurrency,
  monthlyCost,
  money,
  sortCosts,
  TYPE_LABEL,
  type AssetType,
  type CostSort,
  type CostSortKey,
} from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronsUpDown, CreditCard, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { dateLabel, daysUntil, getToday, monthlyDisplay, perCycle, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { CardReservesView } from "./CardReserves";
import { Card, FocusMark, SegmentedControl, TypeIcon, typeMeta, urgencyText } from "./ui";

const SORT_KEY = "fc-costs-sort";
function loadSort(): CostSort {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null");
    if (v && COST_SORT_KEYS.includes(v.key) && (v.dir === "asc" || v.dir === "desc")) return v;
  } catch { /* ignore */ }
  return DEFAULT_COST_SORT;
}

export type CostsTab = "overview" | "cards";

export function Costs({
  tab = "overview",
  onTab,
  onSelect,
  onAddCard,
}: {
  tab?: CostsTab;
  onTab?: (t: CostsTab) => void;
  onSelect: (id: string) => void;
  onAddCard?: () => void;
}) {
  const { assets, settings } = useData();
  const disp = settings.display;
  const today = getToday();
  const [sort, setSortState] = useState<CostSort>(loadSort);
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">("all");
  const [autoOnly, setAutoOnly] = useState(false);

  const setSort = (key: CostSortKey) => {
    const next: CostSort = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: COST_SORT_FIRST[key] };
    localStorage.setItem(SORT_KEY, JSON.stringify(next));
    setSortState(next);
  };

  const reserveReport = useMemo(
    () => computeCardReserves(assets, today, disp, { windowDays: 30, includeManual: true }),
    [assets, today, disp],
  );
  const alertCount = reserveReport.cardsNeedingTopUp + reserveReport.cardsAtRisk;

  const allBilled = useMemo(() => assets.filter((a) => isBilled(a) && monthlyCost(a) > 0), [assets]);
  const filteredBilled = useMemo(
    () =>
      sortCosts(
        allBilled.filter((a) => (typeFilter === "all" || a.type === typeFilter) && (!autoOnly || a.autoRenew)),
        sort,
        disp,
      ),
    [allBilled, typeFilter, autoOnly, sort, disp],
  );

  const byCur = monthlyByCurrency(allBilled);
  const total = displayTotal(byCur, disp);
  const next30 = assets.filter((a) => a.price > 0 && daysUntil(a.expiresAt) >= 0 && daysUntil(a.expiresAt) <= 30);
  const due30 = next30.reduce<Record<string, number>>((m, a) => ((m[a.currency] = (m[a.currency] ?? 0) + a.price), m), {});
  const fmtMap = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(Math.round(v * 100) / 100, c, { free: false })).join(" + ") || "—";

  // Type breakdown in display currency
  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of allBilled) {
      map[a.type] = (map[a.type] ?? 0) + monthlyDisplay(a, disp);
    }
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [allBilled, disp]);

  const activeTab: CostsTab = tab === "cards" ? "cards" : "overview";

  return (
    <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">费用与卡片预留</h1>
            <p className="mt-1 text-[13px] text-muted">
              {activeTab === "cards"
                ? "按绑定的订阅、服务器与账单周期，计算每张支付卡需要留多少钱"
                : "实付金额永不自动换算；右侧折算仅用于月度合计参考"}
            </p>
          </div>
          <SegmentedControl<CostsTab>
            value={activeTab}
            onChange={(t) => onTab?.(t)}
            options={[
              {
                value: "overview",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Wallet size={14} />费用明细
                  </span>
                ),
              },
              {
                value: "cards",
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard size={14} />卡片预留
                  </span>
                ),
                badge:
                  alertCount > 0 ? (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[10.5px] font-semibold text-white tnum">
                      {alertCount}
                    </span>
                  ) : undefined,
              },
            ]}
          />
        </div>

        {activeTab === "cards" ? (
          <CardReservesView onSelect={onSelect} onAddCard={onAddCard} />
        ) : (
          <>
            <div className="surface-card grid grid-cols-1 divide-y divide-line overflow-hidden @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
              <Kpi label="每月（各币种实付）" value={fmtMap(byCur)} foot={`${allBilled.length} 项计费资产`} />
              <Kpi
                label={`每月约（${disp.currency}）`}
                value={money(Math.round(total.total), disp.currency, { free: false })}
                foot={`一年约 ${money(Math.round(total.total * 12), disp.currency, { free: false })}`}
              />
              <Kpi
                label="30 天内要付"
                value={fmtMap(due30)}
                foot={
                  alertCount > 0
                    ? `${next30.length} 项到期 · ${alertCount} 张卡待补足余额`
                    : `${next30.length} 项到期`
                }
                action={
                  onTab && (
                    <button
                      type="button"
                      onClick={() => onTab("cards")}
                      className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-t-payment hover:underline"
                    >
                      <CreditCard size={12} />查看每张卡要留多少钱 →
                    </button>
                  )
                }
              />
            </div>

            {/* Category visual bar + quick filter pills */}
            {byType.length > 0 && total.total > 0 && (
              <Card title="支出构成" extra={<span className="tnum">点击类型可筛选下方明细</span>}>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-field">
                  {byType.map(([t, v]) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter((cur) => (cur === t ? "all" : (t as AssetType)))}
                      title={`${TYPE_LABEL[t as AssetType]}：${money(Math.round(v * 10) / 10, disp.currency, { free: false })}/月`}
                      style={{ width: `${Math.max(1.5, (v / total.total) * 100)}%` }}
                      className={clsx(
                        "h-full cursor-pointer transition-opacity",
                        typeMeta[t as AssetType].bar,
                        typeFilter !== "all" && typeFilter !== t && "opacity-25",
                      )}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTypeFilter("all")}
                    className={clsx(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                      typeFilter === "all" ? "border-ink bg-ink font-medium text-bg" : "border-line bg-bg text-muted hover:text-ink",
                    )}
                  >
                    全部 <span className="tnum opacity-75">{allBilled.length}</span>
                  </button>
                  {byType.map(([t, v]) => {
                    const active = typeFilter === t;
                    const pct = Math.max(1, Math.round((v / total.total) * 100));
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTypeFilter((cur) => (cur === t ? "all" : (t as AssetType)))}
                        className={clsx(
                          "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors tnum",
                          active ? "border-ink bg-ink font-medium text-bg" : "border-line bg-panel text-muted hover:bg-field hover:text-ink",
                        )}
                      >
                        <span className={clsx("size-2 rounded-full", active ? "bg-bg" : typeMeta[t as AssetType].bar)} />
                        <span>{TYPE_LABEL[t as AssetType]}</span>
                        <span className="opacity-70">{pct}%</span>
                        <span className="font-medium">{money(Math.round(v * 10) / 10, disp.currency, { free: false })}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setAutoOnly((v) => !v)}
                    className={clsx(
                      "ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                      autoOnly ? "border-ink bg-ink font-medium text-bg" : "border-line bg-panel text-muted hover:bg-field hover:text-ink",
                    )}
                  >
                    仅看自动续费
                  </button>
                </div>
              </Card>
            )}

            <Card title={`按${COST_SORT_LABEL[sort.key]}排序`} extra={`${filteredBilled.length} 项`} flush>
              <div role="table" aria-label="计费资产" aria-rowcount={filteredBilled.length + 1}>
                <div role="row" className={clsx("grid h-9 items-center gap-x-5 border-b border-line bg-bg/50 px-4 text-xs whitespace-nowrap text-subtle", COLS)}>
                  <SortHead k="name" sort={sort} onSort={setSort}>资产</SortHead>
                  <span className="@max-3xl:hidden">付款卡</span>
                  <SortHead k="type" sort={sort} onSort={setSort} className="@max-2xl:hidden">类型</SortHead>
                  <SortHead k="price" sort={sort} onSort={setSort} right className="@max-lg:hidden">实付</SortHead>
                  <SortHead k="monthly" sort={sort} onSort={setSort} right>每月</SortHead>
                  <SortHead k="expires" sort={sort} onSort={setSort} right>到期</SortHead>
                </div>
                {filteredBilled.map((a) => {
                  const cards = findLinkedCards(a, assets);
                  return (
                    <button
                      key={a.id}
                      role="row"
                      onClick={() => onSelect(a.id)}
                      className={clsx("grid h-12 w-full cursor-pointer items-center gap-x-5 border-b border-line px-4 text-left text-[13px] transition-colors last:border-0 hover:bg-field/60", COLS)}
                    >
                      <span role="cell" className="flex min-w-0 items-center gap-2.5">
                        <TypeIcon type={a.type} size="sm" tinted />
                        <span className="truncate font-medium">{a.name}</span>
                        <FocusMark starred={a.starred} pinned={a.pinned} />
                        {a.autoRenew && <span className="shrink-0 rounded-[4px] bg-field px-1.5 py-px text-[10.5px] text-muted @max-sm:hidden">自动</span>}
                        {(a.region || a.discount) && (
                          <span className="truncate text-xs text-subtle @max-md:hidden">{[a.region, a.discount].filter(Boolean).join(" · ")}</span>
                        )}
                      </span>
                      <span role="cell" className="truncate text-xs text-muted @max-3xl:hidden">
                        {cards.length ? (
                          <span className="inline-flex items-center gap-1 rounded-[5px] bg-t-payment-soft/70 px-1.5 py-0.5 text-[11px] text-t-payment">
                            <CreditCard size={11} />
                            <span className="truncate">{cards[0].name}</span>
                            <span className="font-mono opacity-75">{cards[0].payment?.last4}</span>
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </span>
                      <span role="cell" className="whitespace-nowrap text-muted @max-2xl:hidden">{TYPE_LABEL[a.type]}</span>
                      <span role="cell" className="text-right whitespace-nowrap tnum @max-lg:hidden">{perCycle(a)}</span>
                      <span role="cell" className="text-right font-semibold whitespace-nowrap tnum">
                        {money(Math.round(monthlyCost(a) * 100) / 100, a.currency, { free: false })}
                      </span>
                      <span role="cell" className={clsx("text-right text-xs whitespace-nowrap tnum", urgencyText[urgency(a)])}>
                        {a.expiresAt ? dateLabel(a.expiresAt) : "—"}
                      </span>
                    </button>
                  );
                })}
                {!filteredBilled.length && (
                  <p className="px-4 py-8 text-center text-[13px] text-subtle">没有符合筛选条件的计费资产</p>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

const COLS =
  "grid-cols-[minmax(0,1fr)_88px_84px] @lg:grid-cols-[minmax(0,1fr)_120px_96px_92px] @2xl:grid-cols-[minmax(0,1fr)_86px_132px_104px_96px] @3xl:grid-cols-[minmax(0,1fr)_148px_78px_124px_100px_92px]";

function SortHead({ k, sort, onSort, right, className, children }: { k: CostSortKey; sort: CostSort; onSort: (k: CostSortKey) => void; right?: boolean; className?: string; children: React.ReactNode }) {
  const on = sort.key === k;
  const Icon = !on ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <span role="columnheader" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={clsx("min-w-0", right && "text-right", className)}>
      <button type="button" onClick={() => onSort(k)} title={`按${COST_SORT_LABEL[k]}排序`}
        className={clsx("-mx-1 inline-flex h-7 max-w-full cursor-pointer items-center gap-1 rounded-[6px] px-1 whitespace-nowrap hover:text-ink focus-visible:outline-2 focus-visible:outline-ink/30", right && "flex-row-reverse", on ? "font-medium text-ink" : "")}>
        {children}<Icon size={12} strokeWidth={2} className={clsx("shrink-0", on ? "text-ink" : "text-subtle/70")} aria-hidden />
      </button>
    </span>
  );
}

function Kpi({ label, value, foot, action }: { label: string; value: React.ReactNode; foot: string; action?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-xs whitespace-nowrap text-muted">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[22px] leading-tight font-bold tracking-tight tnum">
        {typeof value === "string" ? value.split(" + ").map((p, i, all) => <span key={i} className="whitespace-nowrap">{p}{i < all.length - 1 && <span className="ml-2 font-normal text-subtle">+</span>}</span>) : value}
      </div>
      <div className="mt-1 text-xs whitespace-nowrap text-subtle">{foot}</div>
      {action}
    </div>
  );
}
