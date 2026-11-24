import { displayTotal, money, monthlyByCurrency, perCycle } from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, CircleDollarSign, LayoutGrid, LayoutList, RefreshCw, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Asset, NodeStatus } from "../data/types";
import { remindDays, urgency } from "../lib/fmt";
import { useData, useLiveStatus } from "../lib/store";
import { useAtollOn } from "./Atoll";
import { hhmm } from "./NodeStatus";
import { bandwidthLabel, bytes, bytesParts, DotTrend, Flag, LatencyBars, latencyText, lossText, nodeOs, nodeRegion, Num, OsMark, pctLabel, SegBar, speedParts, speedText, usageText, usageTone } from "./probe";
import { Chip, EMPTY_BUCKETS, ExpiryValue, LifeCells, Meters, nodeView, PingCells, QuotaRow, SpeedCell, TotalCell, type NodeView } from "./probeBlocks";
import { FocusMark, KomariBadge, urgencyText } from "./ui";

type View = "large" | "compact" | "list";
const VIEW_KEY = "fc-servers-view";
const ALL = "__all";
const NONE = "__none";

function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const s = localStorage.getItem(key) as T | null;
    return s && allowed.includes(s) ? s : initial;
  });
  return [v, (x: T) => { localStorage.setItem(key, x); setV(x); }];
}

export function Servers({ onSelect }: { onSelect: (id: string) => void }) {
  useLiveStatus();
  const { assets, status, statusAt, pingState, refreshStatus, settings, atollView } = useData();
  const atollOn = useAtollOn();
  const projCount = (a: Asset) => (atollOn && atollView.projectsByAsset.has(a.id) ? atollView.projectsByAsset.get(a.id)!.length : null);
  const [spin, setSpin] = useState(false);
  const [view, setView] = useStored<View>(VIEW_KEY, "large", ["large", "compact", "list"]);
  const [tab, setTab] = useState(ALL);
  const st = (a: Asset) => (a.komari ? status[a.komari.uuid] : undefined);

  const servers = assets.filter((a) => a.type === "server")
    // 关注 first (置顶 before other starred), then online, then by expiry
    .sort((a, b) => Number(b.starred) - Number(a.starred) || Number(b.pinned) - Number(a.pinned) || Number(!!st(b)?.online) - Number(!!st(a)?.online) || remindDays(a) - remindDays(b));

  // Tabs: Komari groups when any node has one, otherwise 方寸 tags.
  const byGroup = servers.some((a) => st(a)?.group);
  const groupsOf = (a: Asset): string[] => (byGroup ? [st(a)?.group || NONE] : a.tags);
  const tabs = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of servers) for (const g of groupsOf(a)) count.set(g, (count.get(g) ?? 0) + 1);
    return [...count.entries()].sort((x, y) => Number(x[0] === NONE) - Number(y[0] === NONE) || y[1] - x[1] || x[0].localeCompare(y[0], "zh"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.map((a) => a.id + groupsOf(a).join(",")).join("|")]);
  useEffect(() => { if (tab !== ALL && !tabs.some(([g]) => g === tab)) setTab(ALL); }, [tabs, tab]);
  const shown = tab === ALL ? servers : servers.filter((a) => groupsOf(a).includes(tab));

  // Summary
  const stats = servers.map(st);
  const live = stats.filter((s): s is NodeStatus => Boolean(s?.online));
  const known = stats.filter((s): s is NodeStatus => Boolean(s));
  const up = live.reduce((s, x) => s + x.up, 0);
  const down = live.reduce((s, x) => s + x.down, 0);
  const totUp = known.reduce((s, x) => s + x.totalUp, 0);
  const totDown = known.reduce((s, x) => s + x.totalDown, 0);
  const monthly = displayTotal(monthlyByCurrency(servers), settings.display);
  const cur = settings.display.currency;
  const unconverted = Object.entries(monthly.unconverted);
  const due = servers.filter((a) => a.expiresAt && remindDays(a) <= 14).length;
  const showPing = pingState === "ok" && servers.some((a) => st(a)?.ping);
  const [bwN, bwU] = speedParts(up + down);
  const [tN, tU] = bytesParts(totUp + totDown);
  const bw = bandwidthLabel(up + down);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">服务器</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle">
              <KomariBadge /> <span>数据由 Komari 转发 · {hhmm(statusAt)} 更新</span>
              {pingState && pingState !== "ok" && <span title={pingState === "empty" ? "在 Komari 后台「延迟监测」里添加任务后，这里会显示延迟和丢包" : "Komari 没有返回延迟记录（接口不可用或请求失败）"}>· {pingState === "empty" ? "未配置延迟检测" : "延迟数据暂不可用"}</span>}
              <button onClick={async () => { setSpin(true); await refreshStatus(); setSpin(false); }} className="grid size-6 place-items-center rounded-[6px] hover:bg-field hover:text-ink" title="立即刷新"><RefreshCw size={13} className={clsx(spin && "animate-spin")} /></button>
            </p>
          </div>
          <div className="flex items-center rounded-sm border border-line bg-panel p-0.5" role="radiogroup" aria-label="布局">
            {([["large", LayoutGrid, "大卡片"], ["compact", Rows3, "紧凑卡片"], ["list", LayoutList, "列表"]] as const).map(([k, Icon, t]) => (
              <button key={k} onClick={() => setView(k)} title={t} aria-checked={view === k} role="radio"
                className={clsx("flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px]", view === k ? "bg-field font-medium text-ink" : "text-subtle hover:text-ink")}>
                <Icon size={14} /><span className="hidden sm:inline">{t}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="在线节点" value={<><Num v={live.length} className="text-[30px] font-bold" /><span className="ml-1 text-[15px] font-medium text-subtle tnum">/ {servers.length}</span></>}
            right={servers.length - live.length ? `${servers.length - live.length} 台离线` : "全部在线"}>
            <div className="flex h-2 gap-[3px]">
              {servers.map((a) => <span key={a.id} title={`${a.name} · ${st(a)?.online ? "在线" : "离线"}`} className={clsx("min-w-[3px] flex-1 rounded-[2px]", st(a)?.online ? "bg-ok" : "bg-p-track")} />)}
              {!servers.length && <span className="flex-1 rounded-[2px] bg-p-track" />}
            </div>
          </Summary>
          <Summary label="累计流量" value={<Num v={tN} u={tU} className="text-[30px] font-bold" unitClass="text-[14px]" />} right={`${known.length} 台合计`}>
            <UpDown up={bytes(totUp)} down={bytes(totDown)} />
          </Summary>
          <Summary label="实时带宽" value={<Num v={bwN} u={bwU} className="text-[30px] font-bold text-ok" unitClass="text-[14px]" />}
            right={<span className={clsx("font-semibold", bw === "高负载" ? "text-warn" : bw === "繁忙" ? "text-p-cpu" : "text-ok")}>{bw}</span>}>
            <UpDown up={speedText(up)} down={speedText(down)} />
          </Summary>
          <Summary label="资产概览" value={<><Num v={money(Math.round(monthly.total * 100) / 100, cur, { free: false })} className="text-[30px] font-bold" /><span className="ml-1 text-[13px] text-subtle">/月</span></>}
            right={due ? <span className="font-semibold text-warn">{due} 台 14 天内到期</span> : "近期无到期"}>
            <div className="truncate text-[12.5px] text-muted tnum" title={unconverted.length ? `未设置汇率、未计入：${unconverted.map(([c, v]) => money(v, c)).join("、")}` : "按「设置 → 显示」里的汇率换算"}>
              一年约 {money(Math.round(monthly.total * 12), cur, { free: false })} · {monthly.approx ? "按设置汇率换算" : `${servers.length} 台`}{unconverted.length ? ` · ${unconverted.length} 种币种未换算` : ""}
            </div>
          </Summary>
        </div>

        {tabs.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <div className="inline-flex gap-1 rounded-md border border-line bg-panel p-1">
              {[[ALL, servers.length] as [string, number], ...tabs].map(([g, n]) => (
                <button key={g} onClick={() => setTab(g)}
                  className={clsx("flex h-8 items-center gap-1.5 rounded-sm px-3.5 text-[13px] whitespace-nowrap transition-colors", tab === g ? "bg-field font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink")}>
                  {g === ALL ? "全部" : g === NONE ? "未分组" : g}<span className="text-[11px] text-subtle tnum">{n}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!servers.length && <p className="rounded-md border border-dashed border-line px-6 py-10 text-center text-[13px] text-subtle">还没有服务器</p>}
        {view === "list" ? (
          <ListView servers={shown} st={st} showPing={showPing} onSelect={onSelect} />
        ) : (
          <div className={clsx("grid grid-cols-1 gap-4", view === "large" ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4")}>
            {shown.map((a) => view === "large"
              ? <BigCard key={a.id} a={a} s={st(a)} group={byGroup ? st(a)?.group : undefined} projects={projCount(a)} showPing={showPing} onClick={() => onSelect(a.id)} />
              : <SmallCard key={a.id} a={a} s={st(a)} group={byGroup ? st(a)?.group : undefined} showPing={showPing} onClick={() => onSelect(a.id)} />)}
          </div>
        )}
      </div>
    </main>
  );
}

function Summary({ label, value, right, children }: { label: string; value: ReactNode; right: ReactNode; children: ReactNode }) {
  return (
    <section className="surface-card flex min-w-0 flex-col px-5 pt-4 pb-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline leading-none tracking-tight">{value}</div>
      <div className="mt-auto flex items-end gap-3 pt-3.5">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="shrink-0 text-[12px] text-subtle">{right}</div>
      </div>
    </section>
  );
}

function UpDown({ up, down }: { up: string; down: string }) {
  return (
    <div className="flex items-center gap-2 truncate text-[12.5px] text-muted tnum">
      <span className="flex items-center gap-0.5"><ArrowUp size={12} className="text-subtle" />{up}</span>
      <span className="text-subtle">·</span>
      <span className="flex items-center gap-0.5"><ArrowDown size={12} className="text-subtle" />{down}</span>
    </div>
  );
}

function Head({ a, s, v, group, extra, small }: { a: Asset; s?: NodeStatus; v: NodeView; group?: string; extra?: ReactNode; small?: boolean }) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <Flag region={nodeRegion(a, s)} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={clsx("min-w-0 truncate font-semibold tracking-tight", small ? "text-[14px]" : "text-[15.5px]")} title={a.subtitle ? `${a.name} · ${a.subtitle}` : a.name}>{a.name}</span>
          <FocusMark starred={a.starred} pinned={a.pinned} size={small ? 12 : 13} />
        </span>
        <OsMark os={nodeOs(a, s)} className={small ? "size-7" : undefined} />
      </div>
      <div className="mt-2 flex h-5 min-w-0 items-center gap-1.5 overflow-hidden">
        {!v.on && <Chip className="bg-p-track text-subtle">{a.komari ? (s ? "离线" : "暂无状态") : "未绑定探针"}</Chip>}
        {group && <Chip>{group}</Chip>}
        {extra}
      </div>
    </>
  );
}

function Pills({ a, max = 3, projects }: { a: Asset; max?: number; projects?: number | null }) {
  const tags = a.tags.slice(0, max);
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tags.map((t) => <span key={t} className="inline-flex h-6 max-w-[140px] items-center truncate rounded-[7px] bg-p-mem-soft px-2 text-[11.5px] font-medium text-p-mem">{t}</span>)}
      {a.tags.length > max && <span className="inline-flex h-6 items-center rounded-[7px] bg-field px-2 text-[11.5px] text-muted">+{a.tags.length - max}</span>}
      <span className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-ok-soft px-2 text-[11.5px] font-semibold text-ok tnum"><CircleDollarSign size={12} />{perCycle(a)}</span>
      {projects != null && <span className="inline-flex h-6 items-center rounded-[7px] bg-field px-2 text-[11.5px] text-muted" title="这台机器上的 Atoll 项目">{projects} 个 Atoll 项目</span>}
    </div>
  );
}

const cardCls = (on: boolean) => clsx(
  "surface-card-interactive group flex h-full min-w-0 cursor-pointer flex-col overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-ink/30",
  !on && "[&>*]:opacity-55 [&>*]:grayscale",
);

function BigCard({ a, s, group, projects, showPing, onClick }: { a: Asset; s?: NodeStatus; group?: string; projects: number | null; showPing: boolean; onClick: () => void }) {
  const v = nodeView(a, s);
  return (
    <div role="link" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className={cardCls(v.on)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-3.5 [scrollbar-width:thin]">
        <Head a={a} s={s} v={v} group={group} />
        <div className="mt-3"><Meters v={v} /></div>
        <div className="mt-4 grid grid-cols-2 gap-x-5"><SpeedCell dir="up" v={v} /><SpeedCell dir="down" v={v} /></div>
        <div className="mt-3 grid grid-cols-2 gap-x-5"><TotalCell dir="up" v={v} /><TotalCell dir="down" v={v} /></div>
        <div className="mt-3.5"><QuotaRow v={v} /></div>
        {showPing && <div className="mt-3.5 border-t border-line pt-3"><PingCells ping={s?.ping} /></div>}
        <div className="mt-3.5 border-t border-line pt-3"><LifeCells a={a} v={v} /></div>
        <div className="mt-auto pt-3.5"><Pills a={a} projects={projects} /></div>
      </div>
    </div>
  );
}

function SmallCard({ a, s, group, showPing, onClick }: { a: Asset; s?: NodeStatus; group?: string; showPing: boolean; onClick: () => void }) {
  const v = nodeView(a, s);
  const u = urgency(a);
  const tags = a.tags.slice(0, 2);
  const [un, uu] = v.on && s ? [Math.floor(s.uptimeSec / 86400), "天"] : ["—", ""];
  return (
    <div role="link" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className={cardCls(v.on)}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5 [scrollbar-width:thin]">
        <Head a={a} s={s} v={v} group={group} small
          extra={tags.map((t) => <span key={t} className="inline-flex h-5 max-w-[110px] items-center truncate rounded-[5px] bg-p-mem-soft px-1.5 text-[11px] font-medium text-p-mem">{t}</span>)} />
        <div className="mt-3"><Meters v={v} compact /></div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-sm bg-field/70 px-2.5 py-2">
            <div className="flex items-center justify-between gap-1 text-[12px] tnum"><ArrowUp size={12} className="shrink-0 text-subtle" /><span className={clsx("truncate font-semibold", v.on && "text-ok")}>{v.on && s ? speedText(s.up) : "—"}</span></div>
            <div className="flex items-center justify-between gap-1 text-[12px] tnum"><ArrowDown size={12} className="shrink-0 text-subtle" /><span className={clsx("truncate font-semibold", v.on && "text-ok")}>{v.on && s ? speedText(s.down) : "—"}</span></div>
            <DotTrend data={v.on ? s?.netHistory : []} n={14} className="mt-1.5" />
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-1 rounded-sm bg-field/70 px-2.5 py-2 text-right">
            <ExpiryValue days={v.days} prefix="余 " cls={clsx("text-[13px] font-semibold", u === "crit" || u === "warn" ? urgencyText[u] : "text-ok")} />
            <span className="truncate text-[12px] font-semibold text-muted tnum">{perCycle(a)}</span>
          </div>
        </div>
        <div className="mt-3">
          <QuotaRow v={v} label="流量" n={20} right={<span className="text-[12px] text-muted">在线 <span className={clsx("font-semibold", v.on ? "text-p-cpu" : "")}>{un}{uu}</span></span>} />
          <div className="mt-1 text-right text-[11.5px] text-subtle tnum">{s ? bytes(v.used) : "—"} / {v.limit ? bytes(v.limit) : "∞"}</div>
        </div>
        {showPing && <div className="mt-auto border-t border-line pt-2.5"><PingCells ping={s?.ping} compact /></div>}
      </div>
    </div>
  );
}

function ListView({ servers, st, showPing, onSelect }: { servers: Asset[]; st: (a: Asset) => NodeStatus | undefined; showPing: boolean; onSelect: (id: string) => void }) {
  const cols = showPing ? "grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_minmax(0,1.1fr)_minmax(0,1fr)_90px]" : "grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_minmax(0,1.1fr)_90px]";
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <div className="min-w-[760px]">
        <div className={clsx("grid h-9 items-center gap-4 border-b border-line px-4 text-[11.5px] text-subtle", cols)}>
          <span>节点</span><span>CPU</span><span>内存</span><span>磁盘</span><span>上行 / 下行</span>{showPing && <span>延迟 · 丢包</span>}<span className="text-right">到期</span>
        </div>
        {servers.map((a) => {
          const s = st(a);
          const v = nodeView(a, s);
          const u = urgency(a);
          const m = (p: number, tone: string) => (
            <span className="min-w-0"><span className={clsx("text-[12.5px] font-semibold tnum", usageText(p))}>{v.on ? `${pctLabel(p)}%` : "—"}</span><SegBar value={p} tone={usageTone(p, tone)} n={12} h="h-[5px]" className="mt-1" /></span>
          );
          return (
            <button key={a.id} onClick={() => onSelect(a.id)} className={clsx("grid h-14 w-full items-center gap-4 border-b border-line px-4 text-left text-[13px] last:border-0 hover:bg-field/60", cols, !v.on && "opacity-60")}>
              <span className="flex min-w-0 items-center gap-2"><Flag region={nodeRegion(a, s)} /><span className="truncate font-semibold">{a.name}</span><FocusMark starred={a.starred} pinned={a.pinned} /></span>
              {m(v.cpu, "bg-p-cpu")}{m(v.mem, "bg-p-mem")}{m(v.disk, "bg-p-disk")}
              <span className="truncate text-[12px] text-muted tnum">{v.on && s ? <>↑ {speedText(s.up)}<br />↓ {speedText(s.down)}</> : "—"}</span>
              {showPing && (
                <span className="min-w-0">
                  <span className="text-[12px] tnum">{s?.ping ? <><span className={clsx("font-semibold", latencyText(s.ping.latest))}>{s.ping.latest ?? "—"} ms</span> · <span className={lossText(s.ping.loss)}>{pctLabel(s.ping.loss)}%</span></> : <span className="text-subtle">未配置</span>}</span>
                  <LatencyBars buckets={s?.ping?.buckets ?? EMPTY_BUCKETS} h={10} className="mt-1" />
                </span>
              )}
              <span className={clsx("text-right text-[12.5px] font-semibold", u === "crit" || u === "warn" ? urgencyText[u] : "text-muted")}><ExpiryValue days={v.days} cls="" /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
