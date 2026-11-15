import { perSeat } from "@fangcun/core";
import clsx from "clsx";
import type { Team, TeamMember, Workspace } from "../data/types";
import { cycleLabel, daysUntil, money, ymd } from "../lib/fmt";
import { Card } from "./ui";

export function TeamCard({ team }: { team: Team }) {
  const seats = team.workspaces.reduce((s, w) => s + w.seats, 0);
  const used = team.workspaces.reduce((s, w) => s + w.members.length, 0);
  return (
    <Card
      title={<span>工作空间 <span className="ml-1 font-normal text-subtle">{team.owner ? `母号 ${team.owner}` : ""}</span></span>}
      extra={<span className="tnum">{team.workspaces.length} 个空间 · 席位 {used}/{seats}</span>}
      flush scroll className="max-h-[520px]"
    >
      {team.workspaces.map((w) => <WorkspaceBlock key={w.id} w={w} />)}
    </Card>
  );
}

function WorkspaceBlock({ w }: { w: Workspace }) {
  const members = w.members.filter((m) => m.role !== "owner");
  const used = w.members.length;
  const d = daysUntil(w.expiresAt);
  const hasQuota = members.some((m) => m.quota?.length);
  const meta = [w.region, w.discount, `${used}/${w.seats} 席`, w.seats ? `人均 ${money(Math.round(perSeat(w.price, w.seats) * 10) / 10, w.currency)}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-line px-4 pt-3 pb-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[14px] font-semibold">{w.name}</span>
        <span className="truncate text-xs text-subtle">{meta}</span>
        <div className="flex-1" />
        <span className="text-[13px] tnum">{money(w.price, w.currency)}<span className="text-subtle">/{cycleLabel[w.cycle]}</span></span>
        <span className={clsx("w-[70px] text-right text-xs tnum", d <= 7 ? "font-semibold text-crit" : d <= 14 ? "font-semibold text-warn" : "text-subtle")}>{w.expiresAt ? `${ymd(w.expiresAt).slice(5)} 到期` : "—"}</span>
      </div>
      {members.length > 0 && (
        <div className={clsx("mt-2 grid items-center gap-x-6 text-xs text-subtle", hasQuota ? "grid-cols-[minmax(0,1fr)_120px_120px]" : "grid-cols-1")}>
          <span>成员</span>{hasQuota && <><span>5 小时剩余</span><span>每周剩余</span></>}
        </div>
      )}
      {members.map((m) => <MemberRow key={m.email} m={m} quota={hasQuota} />)}
      {used < w.seats && <div className="py-1.5 text-xs text-subtle">空席位 {w.seats - used}</div>}
    </div>
  );
}

function MemberRow({ m, quota }: { m: TeamMember; quota: boolean }) {
  return (
    <div className={clsx("grid h-9 items-center gap-x-6 text-[13px]", quota ? "grid-cols-[minmax(0,1fr)_120px_120px]" : "grid-cols-[minmax(0,1fr)_auto]")}>
      <span className="truncate">{m.email}</span>
      {quota ? (m.quota ? m.quota.map((q) => <Meter key={q.label} left={100 - q.usedPct} />) : <span className="col-span-2 text-xs text-subtle">未关联号池账号</span>)
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
