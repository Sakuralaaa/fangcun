import { perSeat, quotaForMembers, type QuotaAccount } from "@fangcun/core";
import clsx from "clsx";
import type { Asset, TeamMember, Workspace } from "../data/types";
import { useData } from "../lib/store";
import { cycleLabel, daysUntil, money, dateLabel } from "../lib/fmt";
import { Card } from "./ui";

export function TeamCard({ asset }: { asset: Asset }) {
  const team = asset.team!;
  const { cpx } = useData();
  const q = quotaForMembers(asset, cpx.accounts);
  const seats = team.workspaces.reduce((s, w) => s + w.seats, 0);
  const used = team.workspaces.reduce((s, w) => s + w.members.length, 0);
  return (
    <Card
      title={<span>工作空间 <span className="ml-1 font-normal text-subtle">{team.owner ? `母号 ${team.owner}` : ""}</span></span>}
      extra={<span className="tnum">{team.workspaces.length} 个空间 · 席位 {used}/{seats}</span>}
      flush scroll className="max-h-[520px]"
    >
      {team.workspaces.map((w) => <WorkspaceBlock key={w.id} w={w} q={q} />)}
    </Card>
  );
}

function WorkspaceBlock({ w, q }: { w: Workspace; q: Map<string, QuotaAccount[]> }) {
  const members = w.members.filter((m) => m.role !== "owner");
  const used = w.members.length;
  const d = daysUntil(w.expiresAt);
  const hasQuota = members.some((m) => q.has(m.email.toLowerCase()));
  const meta = [w.region, w.discount, `${used}/${w.seats} 席`, w.seats ? `人均 ${money(Math.round(perSeat(w.price, w.seats) * 10) / 10, w.currency)}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-line px-4 pt-3 pb-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="shrink-0 text-[14px] font-semibold whitespace-nowrap">{w.name}</span>
        <span className="min-w-0 flex-1 basis-[140px] truncate text-xs text-subtle">{meta}</span>
        <span className="shrink-0 text-[13px] whitespace-nowrap tnum">{money(w.price, w.currency)}<span className="text-subtle">/{cycleLabel[w.cycle]}</span></span>
        <span className={clsx("w-[76px] shrink-0 text-right text-xs whitespace-nowrap tnum", d <= 7 ? "font-semibold text-crit" : d <= 14 ? "font-semibold text-warn" : "text-subtle")}>{w.expiresAt ? `${dateLabel(w.expiresAt)} 到期` : "—"}</span>
      </div>
      {members.length > 0 && (
        <div className={clsx("mt-2 grid items-center gap-x-6 text-xs text-subtle", hasQuota ? "grid-cols-[minmax(0,1fr)_88px_88px] @lg:grid-cols-[minmax(0,1fr)_120px_120px]" : "grid-cols-1")}>
          <span>成员</span>{hasQuota && <><span>5 小时剩余</span><span>每周剩余</span></>}
        </div>
      )}
      {members.map((m) => <MemberRow key={m.email} m={m} quota={hasQuota} acc={q.get(m.email.toLowerCase())?.[0]} />)}
      {used < w.seats && <div className="py-1.5 text-xs text-subtle">空席位 {w.seats - used}</div>}
    </div>
  );
}

function MemberRow({ m, quota, acc }: { m: TeamMember; quota: boolean; acc?: QuotaAccount }) {
  const pick = (win: string) => acc?.windows.find((w) => !w.group && w.window === win);
  const h5 = pick("5h"), wk = pick("week") ?? pick("month");
  return (
    <div className={clsx("grid h-9 items-center gap-x-6 text-[13px]", quota ? "grid-cols-[minmax(0,1fr)_88px_88px] @lg:grid-cols-[minmax(0,1fr)_120px_120px]" : "grid-cols-[minmax(0,1fr)_auto]")}>
      <span className="truncate" title={acc ? acc.connectionName : undefined}>{m.email}{acc && <span className="ml-2 text-xs text-muted">{acc.connectionName}</span>}</span>
      {quota ? (acc ? <>{h5 ? <Meter left={Math.round(100 - h5.usedPct)} /> : <span />}{wk ? <Meter left={Math.round(100 - wk.usedPct)} /> : <span />}</> : <span className="col-span-2 text-xs text-muted">未关联号池账号</span>)
        : <span className="text-xs text-subtle">{m.note ?? ""}</span>}
    </div>
  );
}

function Meter({ left }: { left: number }) {
  const low = left <= 10;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-field">
        <div className={clsx("h-full rounded-full", low ? "bg-crit" : "bg-ink/35")} style={{ width: `${left}%` }} />
      </div>
      <span className={clsx("w-9 text-right text-xs tnum", low ? "font-semibold text-crit" : "text-muted")}>{left}%</span>
    </div>
  );
}
