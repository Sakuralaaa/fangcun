import { trafficUsed } from "@fangcun/core";
import clsx from "clsx";
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Asset, NodeStatus } from "../data/types";
import { useData, useLiveStatus } from "../lib/store";
import { Card, KomariBadge } from "./ui";

const G = 1024 ** 3;
export const gb = (b: number) => (b >= 1024 * G ? `${(b / 1024 / G).toFixed(2)} TB` : b >= G ? `${Math.round(b / G)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
const gb1 = (b: number) => `${(b / G).toFixed(1)} GB`;
export const speed = (b: number) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);
const typeLabel = { sum: "上下行合计", max: "取上下行较大者", min: "取上下行较小者", up: "只算上行", down: "只算下行" };
export const hhmm = (iso?: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "—");
export const pctOf = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

export function NodeStatusCard({ asset, status: s }: { asset: Asset; status?: NodeStatus }) {
  useLiveStatus();
  const { statusAt, refreshStatus } = useData();
  const [spin, setSpin] = useState(false);
  const k = asset.komari!;
  const online = Boolean(s?.online);
  const head = (
    <span className="flex items-center gap-2.5">
      运行状态
      <span className="flex items-center gap-1.5 text-xs font-normal text-muted">
        <span className={clsx("size-1.5 rounded-full", online ? "bg-ok" : "bg-subtle")} />{s ? (online ? "在线" : "离线") : "未获取"}
      </span>
    </span>
  );
  const extra = (
    <>
      <KomariBadge /><span title={`节点 ${k.uuid}${k.agentVersion ? ` · 客户端 ${k.agentVersion}` : ""}`}>{hhmm(statusAt)} 更新</span>
      <button onClick={async () => { setSpin(true); await refreshStatus(); setSpin(false); }} className="grid size-6 place-items-center rounded-[6px] text-subtle hover:bg-field hover:text-ink" title="立即刷新">
        <RefreshCw size={13} className={clsx(spin && "animate-spin")} />
      </button>
    </>
  );
  if (!s || !online) return <Card title={head} extra={extra}><p className="text-[13px] text-subtle">{s ? "节点离线，下面显示的是最后一次同步的配置。" : "还没有拿到这个节点的状态（探针未连接或节点不存在）。"}</p></Card>;
  const used = trafficUsed(s);
  const pct = pctOf(used, s.trafficLimit);
  const reset = k.trafficResetDay ? `每月 ${k.trafficResetDay} 日重置` : "重置日未填写";
  return (
    <Card title={head} extra={extra}>
      <div className="grid grid-cols-[1.25fr_1fr] gap-6">
        <div>
          <div className="flex items-baseline justify-between text-xs text-subtle">
            <span>本月流量 <span className="ml-1">{typeLabel[s.trafficType]}</span></span>
            <span>{reset}</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold tracking-tight tnum">{gb(used)}</span>
            <span className="text-[13px] text-subtle tnum">/ {s.trafficLimit ? gb(s.trafficLimit) : "不限"}</span>
            {s.trafficLimit > 0 && <span className={clsx("ml-auto text-[13px] font-semibold tnum", pct >= 90 ? "text-crit" : pct >= 75 ? "text-warn" : "text-muted")}>{pct}%</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
            <div className={clsx("h-full rounded-full", pct >= 90 ? "bg-crit" : pct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-subtle tnum">
            <span className="flex items-center gap-1"><ArrowUp size={12} />{gb(s.totalUp)}</span>
            <span className="flex items-center gap-1"><ArrowDown size={12} />{gb(s.totalDown)}</span>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div className="text-xs text-subtle">
              <div className="flex items-center gap-1 text-[13px] text-ink tnum"><ArrowUp size={13} className="text-subtle" />{speed(s.up)}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[13px] text-ink tnum"><ArrowDown size={13} className="text-subtle" />{speed(s.down)}</div>
            </div>
            {s.netHistory.length > 1 && <Spark data={s.netHistory} />}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-l border-line pl-6">
          <Meter label="CPU" pct={s.cpu} value={`${Math.round(s.cpu)}%`} />
          <Meter label="内存" pct={pctOf(s.ram[0], s.ram[1])} value={`${gb1(s.ram[0])} / ${gb(s.ram[1])}`} />
          <Meter label="硬盘" pct={pctOf(s.disk[0], s.disk[1])} value={`${gb(s.disk[0])} / ${gb(s.disk[1])}`} />
          <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
            <Mini label="负载" value={s.load[0].toFixed(2)} />
            <Mini label="连接" value={`${s.tcp + s.udp}`} />
            <Mini label="在线" value={`${Math.floor(s.uptimeSec / 86400)} 天`} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Meter({ label, pct, value }: { label: string; pct: number; value: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="text-subtle">{label}</span><span className="text-muted tnum">{value}</span></div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-field">
        <div className={clsx("h-full rounded-full", pct >= 90 ? "bg-crit" : "bg-ink/35")} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-subtle">{label}</div><div className="mt-0.5 text-[13px] tnum">{value}</div></div>;
}

function Spark({ data }: { data: number[] }) {
  const w = 150, h = 34, max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} className="text-accent">
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill="currentColor" opacity="0.1" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
