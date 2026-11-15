import { displayTotal, isBilled, monthlyByCurrency, monthlyCost, money, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { daysUntil, monthlyDisplay, perCycle, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { Card, TypeIcon, urgencyText } from "./ui";

export function Costs({ onSelect }: { onSelect: (id: string) => void }) {
  const { assets, settings } = useData();
  const disp = settings.display;
  const billed = assets.filter((a) => isBilled(a) && monthlyCost(a) > 0).sort((a, b) => monthlyDisplay(b, disp) - monthlyDisplay(a, disp));
  const byCur = monthlyByCurrency(billed);
  const total = displayTotal(byCur, disp);
  const next30 = assets.filter((a) => a.price > 0 && daysUntil(a.expiresAt) >= 0 && daysUntil(a.expiresAt) <= 30);
  const due30 = next30.reduce<Record<string, number>>((m, a) => ((m[a.currency] = (m[a.currency] ?? 0) + a.price), m), {});
  const fmtMap = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(Math.round(v * 100) / 100, c, { free: false })).join(" + ") || "—";
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-5 px-8 py-7">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight">费用</h1>
          <p className="mt-1 text-[13px] text-subtle">价格按实付记录，各币种分开合计；其他币种按设置里的汇率（默认自动更新）估算折合。</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-panel">
          <Kpi label="每月（各币种）" value={fmtMap(byCur)} foot={`${billed.length} 项计费资产`} />
          <Kpi label={`每月约（${disp.currency}）`} value={money(Math.round(total.total), disp.currency, { free: false })} foot={`一年约 ${money(Math.round(total.total * 12), disp.currency, { free: false })}`} />
          <Kpi label="30 天内要付" value={fmtMap(due30)} foot={`${next30.length} 项到期`} />
        </div>
        <Card title="按月成本排序" extra={`${billed.length} 项`} flush>
          <div className="grid h-9 grid-cols-[minmax(0,1.6fr)_90px_120px_110px_90px] items-center gap-3 border-b border-line px-4 text-xs text-subtle">
            <span>资产</span><span>类型</span><span className="text-right">实付</span><span className="text-right">每月</span><span className="text-right">到期</span>
          </div>
          {billed.map((a) => (
            <button key={a.id} onClick={() => onSelect(a.id)} className="grid h-11 w-full grid-cols-[minmax(0,1.6fr)_90px_120px_110px_90px] items-center gap-3 border-b border-line px-4 text-left text-[13px] last:border-0 hover:bg-field/60">
              <span className="flex min-w-0 items-center gap-2.5"><TypeIcon type={a.type} size="sm" /><span className="truncate font-medium">{a.name}</span>{(a.region || a.discount) && <span className="truncate text-xs text-subtle">{[a.region, a.discount].filter(Boolean).join(" · ")}</span>}</span>
              <span className="text-muted">{TYPE_LABEL[a.type]}</span>
              <span className="text-right tnum">{perCycle(a)}</span>
              <span className="text-right font-medium tnum">{money(Math.round(monthlyCost(a) * 100) / 100, a.currency, { free: false })}</span>
              <span className={clsx("text-right text-xs tnum", urgencyText[urgency(a)])}>{a.expiresAt?.slice(5).replace("-", "/") ?? "—"}</span>
            </button>
          ))}
        </Card>
      </div>
    </main>
  );
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 truncate text-[22px] font-bold tracking-tight tnum">{value}</div>
      <div className="mt-0.5 text-xs text-subtle">{foot}</div>
    </div>
  );
}
