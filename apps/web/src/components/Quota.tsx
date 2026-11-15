import clsx from "clsx";
import type { QuotaAccount, QuotaLink } from "../data/types";
import { Card } from "./ui";

const providerName = { codex: "Codex", claude: "Claude", gemini: "Gemini" };
const statusText = { ready: ["可用", "text-ok"], cooling: ["冷却中", "text-warn"], error: ["异常", "text-crit"] } as const;

export function CpaBadge() {
  return <span className="inline-flex h-[18px] items-center rounded-[5px] bg-spark-soft px-1.5 text-[10.5px] font-semibold text-spark">CPA</span>;
}

function bar(pct: number) {
  return pct >= 90 ? "bg-crit" : pct >= 70 ? "bg-warn" : "bg-accent";
}

function Row({ a }: { a: QuotaAccount }) {
  const [st, cls] = statusText[a.status];
  return (
    <div className="border-b border-line px-4 py-3.5 last:border-0">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="shrink-0 font-semibold whitespace-nowrap">{providerName[a.provider]}</span>
        <span className="shrink-0 rounded-[5px] bg-field px-1.5 py-px text-[11px] whitespace-nowrap text-muted">{a.plan}</span>
        <span className="min-w-0 truncate font-mono text-[12px] text-subtle">{a.email}</span>
        <span className={clsx("ml-auto flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap", cls)}><span className="size-1.5 rounded-full bg-current" />{st}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 @lg:grid-cols-2">
        {a.windows.map((w) => (
          <div key={w.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap">
              <span className="text-muted">{w.label}</span>
              <span className="tnum"><b className="font-semibold text-ink">剩 {100 - w.usedPct}%</b><span className="ml-2 text-subtle">{w.resetAt.slice(5).replace("-", "/")} 重置</span></span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-field">
              <div className={clsx("h-full rounded-full", bar(w.usedPct))} style={{ width: `${w.usedPct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuotaCard({ quota }: { quota: QuotaLink }) {
  return (
    <Card title={<span className="flex items-center gap-2">用量与剩余额度 <CpaBadge /></span>} extra={<>{quota.observedAt.slice(11)} 更新 · 演示数据</>} flush>
      {quota.accounts.map((a) => <Row key={a.authIndex} a={a} />)}
    </Card>
  );
}
