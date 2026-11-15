/** Metric blocks shared by the 服务器 page cards and the 运行状态 card on a VPS. */
import { trafficUsed } from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, CalendarClock, Cpu, Database, Gauge, Globe, HardDrive, MemoryStick, Power, Timer, Unlink, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Asset, NodePing, NodeStatus } from "../data/types";
import { daysUntil, urgency } from "../lib/fmt";
import { bytes, bytesParts, DotTrend, LatencyBars, latencyText, LossBars, lossText, nodeCores, Num, pct, pctLabel, SegBar, speedParts, uptimeParts, usageText, usageTone } from "./probe";
import { urgencyText } from "./ui";

export const EMPTY_BUCKETS = Array.from({ length: 24 }, () => ({ ms: null, loss: null }));

/** Everything a card shows about one node, computed once. Offline / unbound nodes read as zero with `on` false. */
export function nodeView(a: Asset, s?: NodeStatus) {
  const on = Boolean(s?.online);
  const cores = nodeCores(a, s);
  const load = on ? s!.load[0] : 0;
  const used = s ? trafficUsed(s) : 0;
  const limit = s?.trafficLimit ?? 0;
  return {
    on, cores, s,
    cpu: on ? s!.cpu : 0,
    mem: on ? pct(s!.ram[0], s!.ram[1]) : 0,
    disk: on ? pct(s!.disk[0], s!.disk[1]) : 0,
    load,
    loadPct: on ? Math.min(100, (load / Math.max(1, cores ?? 1)) * 100) : 0,
    used, limit,
    trafficPct: limit ? pct(used, limit) : 0,
    days: a.expiresAt ? daysUntil(a.expiresAt) : null,
  };
}
export type NodeView = ReturnType<typeof nodeView>;

function Label({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <span className="flex min-w-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-muted"><Icon size={13} strokeWidth={2} className="shrink-0 text-subtle" />{children}</span>;
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex h-5 max-w-full items-center truncate rounded-[5px] bg-field px-1.5 text-[11px] font-medium whitespace-nowrap text-muted tnum", className)}>{children}</span>;
}

/** One meter: label + value on a line, optional chip under it, then the segmented bar. */
export function Meter({ icon, label, value, unit, sub, bar, tone, compact, warnAt = true }: {
  icon: LucideIcon; label: string; value: ReactNode; unit?: string; sub?: ReactNode; bar: number; tone: string; compact?: boolean; warnAt?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <Label icon={icon}>{label}</Label>
        <Num v={value} u={unit} className={clsx("font-semibold", compact ? "text-[13px]" : "text-[14.5px]", warnAt && usageText(bar))} />
      </div>
      {sub !== undefined && !compact && <div className="mt-1 h-5">{sub !== null && <Chip>{sub}</Chip>}</div>}
      <SegBar className={compact ? "mt-1.5" : "mt-2"} value={bar} tone={warnAt ? usageTone(bar, tone) : tone} n={compact ? 18 : 16} h={compact ? "h-[6px]" : "h-[7px]"} />
    </div>
  );
}

/** CPU · 内存 · 磁盘 · 负载 in a 2×2 grid. */
export function Meters({ v, compact }: { v: NodeView; compact?: boolean }) {
  const s = v.s;
  const off = !v.on;
  return (
    <div className={clsx("grid grid-cols-2", compact ? "gap-x-4 gap-y-3" : "gap-x-5 gap-y-3.5")}>
      <Meter compact={compact} icon={Cpu} label="CPU" value={off ? "—" : pctLabel(v.cpu)} unit={off ? undefined : "%"} sub={v.cores ? `${v.cores} 核` : null} bar={v.cpu} tone="bg-p-cpu" />
      <Meter compact={compact} icon={MemoryStick} label="内存" value={off ? "—" : pctLabel(v.mem)} unit={off ? undefined : "%"} sub={s && v.on ? `${bytes(s.ram[0])} / ${bytes(s.ram[1])}` : null} bar={v.mem} tone="bg-p-mem" />
      <Meter compact={compact} icon={HardDrive} label="磁盘" value={off ? "—" : pctLabel(v.disk)} unit={off ? undefined : "%"} sub={s && v.on ? `${bytes(s.disk[0])} / ${bytes(s.disk[1])}` : null} bar={v.disk} tone="bg-p-disk" />
      <Meter compact={compact} icon={Gauge} label="负载" value={off ? "—" : v.load.toFixed(2)} sub={s && v.on ? `5/15 分 ${s.load[1].toFixed(2)} · ${s.load[2].toFixed(2)}` : null} bar={v.loadPct} tone="bg-p-load" />
    </div>
  );
}

/** Upload / download speed with the recent dot trend. */
export function SpeedCell({ dir, v }: { dir: "up" | "down"; v: NodeView }) {
  const s = v.s;
  const val = v.on && s ? (dir === "up" ? s.up : s.down) : 0;
  const hist = s ? (dir === "up" ? s.upHistory : s.downHistory) ?? (s.netHistory.length ? s.netHistory : undefined) : undefined;
  const [n, u] = speedParts(val);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <Label icon={dir === "up" ? ArrowUp : ArrowDown}>{dir === "up" ? "上行" : "下行"}</Label>
        <Num v={v.on ? n : "—"} u={v.on ? u : undefined} className={clsx("text-[15px] font-semibold", v.on && "text-ok")} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <DotTrend data={v.on ? hist : []} className="min-w-0 flex-1" />
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-subtle"><span className={clsx("size-1.5 rounded-full", v.on && val >= 1024 ? "bg-ok" : "bg-subtle/50")} />{v.on ? (val >= 1024 ? "实时" : "空闲") : "离线"}</span>
      </div>
    </div>
  );
}

export function TotalCell({ dir, v }: { dir: "up" | "down"; v: NodeView }) {
  const s = v.s;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <Label icon={Globe}>{dir === "up" ? "出站" : "入站"}</Label>
      <span className="text-[13px] text-ink tnum">{s ? bytes(dir === "up" ? s.totalUp : s.totalDown) : "—"}</span>
    </div>
  );
}

/** 剩余流量: remaining on the left, used / limit on the right, segmented bar (∞ when unlimited). */
export function QuotaRow({ v, label = "剩余流量", right, n = 24 }: { v: NodeView; label?: string; right?: ReactNode; n?: number }) {
  const unlimited = !v.limit;
  const remain = Math.max(0, v.limit - v.used);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <Label icon={Database}>{label}</Label>
          <span className={clsx("text-[13px] font-semibold tnum", usageText(v.trafficPct))}>{unlimited ? "∞" : bytes(remain)}</span>
        </span>
        <span className="truncate text-[12px] text-muted tnum">{right ?? <>{v.s ? bytes(v.used) : "—"} / {unlimited ? "∞" : bytes(v.limit)}</>}</span>
      </div>
      <SegBar className="mt-2" value={v.trafficPct} tone={usageTone(v.trafficPct, "bg-ok")} n={n} h="h-[6px]" />
    </div>
  );
}

/** 延迟 + 丢包率 columns. `ping` undefined on a node Komari has no ping task for → 「未配置」 with flat ticks. */
export function PingCells({ ping, compact }: { ping?: NodePing; compact?: boolean }) {
  const b = ping?.buckets ?? EMPTY_BUCKETS;
  const [ms] = [ping?.latest ?? null];
  return (
    <div className={clsx("grid grid-cols-2", compact ? "gap-x-4" : "gap-x-5")} title={ping ? `检测任务：${ping.task} · 近 1 小时平均 ${ping.avg ?? "—"} ms` : "Komari 里没有覆盖这台机器的延迟检测任务"}>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <Label icon={Timer}>延迟</Label>
          {ping ? <Num v={ms ?? "—"} u={ms === null ? undefined : "ms"} className={clsx("text-[14px] font-semibold", latencyText(ms))} /> : <span className="text-[12px] text-subtle">未配置</span>}
        </div>
        <LatencyBars buckets={b} className="mt-2" h={compact ? 12 : 16} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <Label icon={Unlink}>丢包率</Label>
          {ping ? <Num v={pctLabel(ping.loss)} u="%" className={clsx("text-[14px] font-semibold", lossText(ping.loss))} /> : <span className="text-[12px] text-subtle">未配置</span>}
        </div>
        <LossBars buckets={b} className="mt-2" h={compact ? 12 : 16} />
      </div>
    </div>
  );
}

/** 在线时长 + 到期天数. */
export function LifeCells({ a, v }: { a: Asset; v: NodeView }) {
  const [un, uu] = v.on && v.s ? uptimeParts(v.s.uptimeSec) : ["—", ""];
  const u = urgency(a);
  return (
    <div className="grid grid-cols-2 gap-x-5">
      <div className="flex items-baseline justify-between gap-2">
        <Label icon={Power}>在线</Label>
        <Num v={un} u={uu || undefined} className={clsx("text-[14px] font-semibold", v.on && "text-p-cpu")} />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <Label icon={CalendarClock}>到期</Label>
        <ExpiryValue days={v.days} cls={clsx("text-[14px] font-semibold", u === "crit" || u === "warn" ? urgencyText[u] : "text-ok")} />
      </div>
    </div>
  );
}

export function ExpiryValue({ days, cls, prefix = "" }: { days: number | null; cls: string; prefix?: string }) {
  if (days === null) return <span className={clsx(cls, "text-muted")}>长期</span>;
  if (days < 0) return <Num v={`已过期 ${-days}`} u="天" className={cls} />;
  return <Num v={`${prefix}${days}`} u="天" className={cls} />;
}

export const bytesBig = (b: number) => bytesParts(b);
