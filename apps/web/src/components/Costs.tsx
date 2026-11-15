import { COST_SORT_FIRST, COST_SORT_KEYS, COST_SORT_LABEL, DEFAULT_COST_SORT, displayTotal, isBilled, monthlyByCurrency, monthlyCost, money, sortCosts, TYPE_LABEL, type CostSort, type CostSortKey } from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { dateLabel, daysUntil, perCycle, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { Card, FocusMark, TypeIcon, urgencyText } from "./ui";

const SORT_KEY = "fc-costs-sort";
function loadSort(): CostSort {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null");
    if (v && COST_SORT_KEYS.includes(v.key) && (v.dir === "asc" || v.dir === "desc")) return v;
  } catch { /* ignore */ }
  return DEFAULT_COST_SORT;
}

export function Costs({ onSelect }: { onSelect: (id: string) => void }) {
  const { assets, settings } = useData();
  const disp = settings.display;
  const [sort, setSortState] = useState<CostSort>(loadSort);
  const setSort = (key: CostSortKey) => {
    const next: CostSort = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: COST_SORT_FIRST[key] };
    localStorage.setItem(SORT_KEY, JSON.stringify(next));
    setSortState(next);
  };
  const billed = sortCosts(assets.filter((a) => isBilled(a) && monthlyCost(a) > 0), sort, disp);
  const byCur = monthlyByCurrency(billed);
  const total = displayTotal(byCur, disp);
  const next30 = assets.filter((a) => a.price > 0 && daysUntil(a.expiresAt) >= 0 && daysUntil(a.expiresAt) <= 30);
  const due30 = next30.reduce<Record<string, number>>((m, a) => ((m[a.currency] = (m[a.currency] ?? 0) + a.price), m), {});
  const fmtMap = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(Math.round(v * 100) / 100, c, { free: false })).join(" + ") || "—";
  return (
    <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-5">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">费用</h1>
          <p className="mt-1 text-[13px] text-subtle">价格按实付记录，各币种分开合计；其他币种按设置里的汇率（默认自动更新）估算折合。</p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-line rounded-md border border-line bg-panel @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0">
          <Kpi label="每月（各币种）" value={fmtMap(byCur)} foot={`${billed.length} 项计费资产`} />
          <Kpi label={`每月约（${disp.currency}）`} value={money(Math.round(total.total), disp.currency, { free: false })} foot={`一年约 ${money(Math.round(total.total * 12), disp.currency, { free: false })}`} />
          <Kpi label="30 天内要付" value={fmtMap(due30)} foot={`${next30.length} 项到期`} />
        </div>
        <Card title={`按${COST_SORT_LABEL[sort.key]}排序`} extra={`${billed.length} 项`} flush>
          <div role="table" aria-label="计费资产" aria-rowcount={billed.length + 1}>
            <div role="row" className={clsx("grid h-9 items-center gap-x-6 border-b border-line px-4 text-xs whitespace-nowrap text-subtle", COLS)}>
              <SortHead k="name" sort={sort} onSort={setSort}>资产</SortHead>
              <SortHead k="type" sort={sort} onSort={setSort} className="@max-2xl:hidden">类型</SortHead>
              <SortHead k="price" sort={sort} onSort={setSort} right className="@max-lg:hidden">实付</SortHead>
              <SortHead k="monthly" sort={sort} onSort={setSort} right>每月</SortHead>
              <SortHead k="expires" sort={sort} onSort={setSort} right>到期</SortHead>
            </div>
            {billed.map((a) => (
              <button key={a.id} role="row" onClick={() => onSelect(a.id)} className={clsx("grid h-11 w-full items-center gap-x-6 border-b border-line px-4 text-left text-[13px] last:border-0 hover:bg-field/60", COLS)}>
                <span role="cell" className="flex min-w-0 items-center gap-2.5"><TypeIcon type={a.type} size="sm" /><span className="truncate font-medium">{a.name}</span><FocusMark starred={a.starred} pinned={a.pinned} />{(a.region || a.discount) && <span className="truncate text-xs text-subtle">{[a.region, a.discount].filter(Boolean).join(" · ")}</span>}</span>
                <span role="cell" className="whitespace-nowrap text-muted @max-2xl:hidden">{TYPE_LABEL[a.type]}</span>
                <span role="cell" className="text-right whitespace-nowrap tnum @max-lg:hidden">{perCycle(a)}</span>
                <span role="cell" className="text-right font-medium whitespace-nowrap tnum">{money(Math.round(monthlyCost(a) * 100) / 100, a.currency, { free: false })}</span>
                <span role="cell" className={clsx("text-right text-xs whitespace-nowrap tnum", urgencyText[urgency(a)])}>{a.expiresAt ? dateLabel(a.expiresAt) : "—"}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}

/**
 * 资产 · 类型 · 实付 · 每月 · 到期. The name column takes all spare width; the others stay a fixed, compact width
 * so numbers sit together at the right instead of spreading across a wide screen. 类型 and 实付 drop out when the card is narrow.
 */
const COLS = "grid-cols-[minmax(0,1fr)_88px_84px] @lg:grid-cols-[minmax(0,1fr)_120px_96px_92px] @2xl:grid-cols-[minmax(0,1fr)_96px_140px_112px_100px]";

function SortHead({ k, sort, onSort, right, className, children }: { k: CostSortKey; sort: CostSort; onSort: (k: CostSortKey) => void; right?: boolean; className?: string; children: React.ReactNode }) {
  const on = sort.key === k;
  const Icon = !on ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <span role="columnheader" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={clsx("min-w-0", right && "text-right", className)}>
      <button type="button" onClick={() => onSort(k)} title={`按${COST_SORT_LABEL[k]}排序`}
        className={clsx("-mx-1 inline-flex h-7 max-w-full items-center gap-1 rounded-[6px] px-1 whitespace-nowrap hover:text-ink focus-visible:outline-2 focus-visible:outline-ink/30", right && "flex-row-reverse", on ? "font-medium text-ink" : "")}>
        {children}<Icon size={12} strokeWidth={2} className={clsx("shrink-0", on ? "text-ink" : "text-subtle/70")} aria-hidden />
      </button>
    </span>
  );
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-xs whitespace-nowrap text-muted">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[22px] leading-tight font-bold tracking-tight tnum">
        {typeof value === "string" ? value.split(" + ").map((p, i, all) => <span key={i} className="whitespace-nowrap">{p}{i < all.length - 1 && <span className="ml-2 font-normal text-subtle">+</span>}</span>) : value}
      </div>
      <div className="mt-1 text-xs whitespace-nowrap text-subtle">{foot}</div>
    </div>
  );
}
