import { displayTotal, monthlyByCurrency, money, trafficUsed } from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, LayoutGrid, List, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Asset, NodeStatus } from "../data/types";
import { daysUntil, dueLabel, perCycle, urgency } from "../lib/fmt";
import { useData, useLiveStatus } from "../lib/store";
import { gb, hhmm, pctOf, speed } from "./NodeStatus";
import { useAtollOn } from "./Atoll";
import { KomariBadge, urgencyText } from "./ui";

const region = (a: Asset) => a.details.find((d) => d.label === "地区")?.value ?? "";

export function Servers({ onSelect }: { onSelect: (id: string) => void }) {
  useLiveStatus();
  const { assets, status, statusAt, refreshStatus, settings, atollView } = useData();
  const atollOn = useAtollOn();
  /** Atoll project count for a VPS, only when it matches an Atoll server. */
  const projCount = (a: Asset) => (atollOn && atollView.projectsByAsset.has(a.id) ? atollView.projectsByAsset.get(a.id)!.length : null);
  const [spin, setSpin] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const st = (a: Asset) => (a.komari ? status[a.komari.uuid] : undefined);
  const servers = assets.filter((a) => a.type === "server")
    .sort((a, b) => Number(!!st(b)?.online) - Number(!!st(a)?.online) || daysUntil(a.expiresAt) - daysUntil(b.expiresAt));
  const live = servers.map(st).filter((s): s is NodeStatus => Boolean(s?.online));
  const up = live.reduce((s, x) => s + x.up, 0);
  const down = live.reduce((s, x) => s + x.down, 0);
  const used = live.reduce((s, x) => s + trafficUsed(x), 0);
  const limit = live.reduce((s, x) => s + x.trafficLimit, 0);
  const cost = displayTotal(monthlyByCurrency(servers), settings.display).total;
  const due = servers.filter((a) => daysUntil(a.expiresAt) <= 14).length;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-8 py-7">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">服务器</h1>
            <p className="mt-1 flex items-center gap-2 text-[13px] text-subtle">
              <KomariBadge /> 数据由 Komari 转发 · {hhmm(statusAt)} 更新
              <button onClick={async () => { setSpin(true); await refreshStatus(); setSpin(false); }} className="grid size-6 place-items-center rounded-[6px] hover:bg-field hover:text-ink" title="立即刷新"><RefreshCw size={13} className={clsx(spin && "animate-spin")} /></button>
            </p>
          </div>
          <div className="flex items-center rounded-sm border border-line bg-panel p-0.5">
            <button onClick={() => setView("grid")} className={clsx("grid size-7 place-items-center rounded-[6px]", view === "grid" ? "bg-field text-ink" : "text-subtle")}><LayoutGrid size={15} /></button>
            <button onClick={() => setView("list")} className={clsx("grid size-7 place-items-center rounded-[6px]", view === "list" ? "bg-field text-ink" : "text-subtle")}><List size={15} /></button>
          </div>
        </div>

        <div className="grid grid-cols-4 divide-x divide-line rounded-md border border-line bg-panel">
          <Kpi label="在线" value={<>{live.length}<span className="text-[17px] text-subtle">/{servers.length}</span></>} foot={servers.length - live.length ? `${servers.length - live.length} 台离线或未绑定` : "全部在线"} />
          <Kpi label="实时带宽" value={<span className="flex items-baseline gap-3 text-[20px]"><span className="flex items-center gap-0.5"><ArrowUp size={15} className="text-subtle" />{speed(up)}</span><span className="flex items-center gap-0.5"><ArrowDown size={15} className="text-subtle" />{speed(down)}</span></span>} foot={`${live.length} 台合计`} />
          <Kpi label="本月流量" value={<>{gb(used)}{limit > 0 && <span className="text-[15px] font-medium text-subtle"> / {gb(limit)}</span>}</>} foot={limit ? `已用 ${pctOf(used, limit)}%` : "未设流量上限"} />
          <Kpi label="每月成本" value={money(Math.round(cost), settings.display.currency, { free: false })} foot={due ? `${due} 台 14 天内到期` : "近期无到期"} />
        </div>

        {!servers.length && <p className="rounded-md border border-dashed border-line px-6 py-10 text-center text-[13px] text-subtle">还没有服务器。到「设置 → Komari 探针」把节点一键导入，或在资产里手动添加。</p>}
        {view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {servers.map((a) => <NodeCard key={a.id} a={a} s={st(a)} projects={projCount(a)} onClick={() => onSelect(a.id)} />)}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-panel">
            {servers.map((a) => {
              const s = st(a);
              return (
                <button key={a.id} onClick={() => onSelect(a.id)} className="grid h-12 w-full grid-cols-[minmax(0,1.4fr)_70px_70px_70px_minmax(0,1fr)_100px] items-center gap-3 border-b border-line px-4 text-left text-[13px] last:border-0 hover:bg-field/60">
                  <span className="flex items-center gap-2 truncate font-mono text-[12.5px] font-medium"><span className={clsx("size-2 shrink-0 rounded-full", s?.online ? "bg-ok" : "bg-subtle")} />{a.name}</span>
                  <span className="text-muted tnum">{s?.online ? `${Math.round(s.cpu)}%` : "—"}</span>
                  <span className="text-muted tnum">{s?.online ? `${pctOf(s.ram[0], s.ram[1])}%` : "—"}</span>
                  <span className="text-muted tnum">{s?.online ? `${pctOf(s.disk[0], s.disk[1])}%` : "—"}</span>
                  <span className="truncate text-xs text-subtle">{[region(a), a.provider, projCount(a) != null && `${projCount(a)} 个 Atoll 项目`].filter(Boolean).join(" · ")}</span>
                  <span className={clsx("text-right text-xs tnum", urgencyText[urgency(a)])}>{dueLabel(a)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value, foot }: { label: string; value: React.ReactNode; foot: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold tracking-tight tnum">{value}</div>
      <div className="mt-0.5 text-xs text-subtle">{foot}</div>
    </div>
  );
}

function NodeCard({ a, s, projects, onClick }: { a: Asset; s?: NodeStatus; projects: number | null; onClick: () => void }) {
  const u = urgency(a);
  const on = Boolean(s?.online);
  const tPct = s ? pctOf(trafficUsed(s), s.trafficLimit) : 0;
  return (
    <button onClick={onClick} className={clsx("flex flex-col rounded-md border border-line bg-panel p-4 text-left transition-shadow hover:shadow-[0_2px_12px_rgb(0_0_0/0.06)]", !on && "opacity-70")}>
      <div className="flex items-start gap-2.5">
        <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-subtle")} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[14px] font-semibold">{a.name}</div>
          <div className="truncate text-xs text-subtle">{[region(a), a.provider].filter(Boolean).join(" · ")}{projects != null && <span title="这台机器上的 Atoll 项目"> · {projects} 个 Atoll 项目</span>}</div>
        </div>
        <div className="text-right">
          <div className={clsx("text-xs tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{dueLabel(a)}</div>
          <div className="text-[11px] text-subtle tnum">{perCycle(a)}</div>
        </div>
      </div>

      {s && on ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Ring label="CPU" pct={s.cpu} />
            <Ring label="内存" pct={pctOf(s.ram[0], s.ram[1])} />
            <Ring label="硬盘" pct={pctOf(s.disk[0], s.disk[1])} />
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs"><span className="text-subtle">本月流量</span><span className="text-muted tnum">{gb(trafficUsed(s))}{s.trafficLimit ? ` / ${gb(s.trafficLimit)}` : ""}</span></div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-field">
              <div className={clsx("h-full rounded-full", tPct >= 90 ? "bg-crit" : tPct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${tPct}%` }} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-xs text-muted tnum">
            <span className="flex items-center gap-1"><ArrowUp size={12} className="text-subtle" />{speed(s.up)}</span>
            <span className="flex items-center gap-1"><ArrowDown size={12} className="text-subtle" />{speed(s.down)}</span>
            <span className="ml-auto text-subtle">负载 {s.load[0].toFixed(2)} · 在线 {Math.floor(s.uptimeSec / 86400)} 天</span>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-1 items-center justify-center rounded-sm bg-field py-6 text-xs text-subtle">
          {a.komari ? (s ? "离线" : "暂无状态") + (a.komari.syncedAt ? ` · 最后同步 ${a.komari.syncedAt.slice(5, 16).replace("T", " ")}` : "") : "未绑定 Komari 节点"}
        </div>
      )}
    </button>
  );
}

function Ring({ label, pct }: { label: string; pct: number }) {
  const r = 17, c = 2 * Math.PI * r, p = Math.round(pct);
  return (
    <div className="flex items-center gap-2.5">
      <svg width="42" height="42" viewBox="0 0 42 42" className="shrink-0 -rotate-90">
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--color-field)" strokeWidth="4" />
        <circle cx="21" cy="21" r={r} fill="none" strokeWidth="4" strokeLinecap="round" stroke={p >= 90 ? "var(--color-crit)" : p >= 75 ? "var(--color-warn)" : "var(--color-accent)"}
          strokeDasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <div><div className="text-[13px] font-semibold tnum">{p}%</div><div className="text-[11px] text-subtle">{label}</div></div>
    </div>
  );
}
