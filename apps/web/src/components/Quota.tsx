import { PROVIDER_LABEL, QUOTA_STATUS_LABEL, quotaForAsset, windowLabel, type QuotaAccount } from "@fangcun/core";
import clsx from "clsx";
import type { Asset } from "../data/types";
import { useData } from "../lib/store";
import { Card } from "./ui";

const statusTone: Record<string, string> = { ok: "text-ok", limited: "text-warn", cooling: "text-warn", disabled: "text-muted", expired: "text-crit", error: "text-crit" };

export function CliproxyBadge() {
  return <span className="inline-flex h-[18px] items-center rounded-[5px] bg-spark-soft px-1.5 text-[10.5px] font-semibold text-spark">CLIProxyAPI</span>;
}

function bar(pct: number) {
  return pct >= 90 ? "bg-crit" : pct >= 70 ? "bg-warn" : "bg-accent";
}

export const resetLabel = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function QuotaRow({ a }: { a: QuotaAccount }) {
  return (
    <div className="border-b border-line px-4 py-3.5 last:border-0">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="shrink-0 font-semibold whitespace-nowrap">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
        {a.plan && <span className="shrink-0 rounded-[5px] bg-field px-1.5 py-px text-[11px] whitespace-nowrap text-muted">{a.plan}</span>}
        <span className="min-w-0 truncate font-mono text-[12px] text-muted">{a.email ?? a.label ?? a.id}</span>
        <span className="shrink-0 text-xs whitespace-nowrap text-muted">{a.connectionName}</span>
        <span className={clsx("ml-auto flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap", statusTone[a.status] ?? "text-muted")} title={a.message}><span className="size-1.5 rounded-full bg-current" />{QUOTA_STATUS_LABEL[a.status] ?? a.status}</span>
      </div>
      {a.windows.length > 0 && (
        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 @lg:grid-cols-2">
          {a.windows.map((w) => (
            <div key={w.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap">
                <span className="truncate text-muted">{windowLabel(w)}</span>
                <span className="tnum"><b className="font-semibold text-ink">剩 {Math.round(100 - w.usedPct)}%</b>{w.resetAt && <span className="ml-2 text-muted">{resetLabel(w.resetAt)} 重置</span>}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-field">
                <div className={clsx("h-full rounded-full", bar(w.usedPct))} style={{ width: `${w.usedPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuotaCard({ asset }: { asset: Asset }) {
  const { cpx, assets } = useData();
  if (asset.team) return null; // team members show their own quota in the workspace card
  const list = quotaForAsset(asset, cpx.accounts, assets);
  if (!list.length) return null;
  const at = cpx.connections.map((c) => c.fetchedAt).filter(Boolean).sort().pop();
  return (
    <Card title={<span className="flex items-center gap-2">用量与剩余额度 <CliproxyBadge /></span>} extra={at ? `${resetLabel(at)} 更新` : undefined} flush>
      {list.map((a) => <QuotaRow key={a.connectionId + a.id} a={a} />)}
    </Card>
  );
}
