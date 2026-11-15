import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Asset, NodeStatus } from "../data/types";
import { useData, useLiveStatus } from "../lib/store";
import { bytes, detail, Flag, nodeOs, nodeRegion, OsMark, regionCode } from "./probe";
import { Chip, Meters, nodeView, PingCells, QuotaRow, SpeedCell, TotalCell } from "./probeBlocks";
import { Card, KomariBadge } from "./ui";

const typeLabel = { sum: "上下行合计", max: "取上下行较大者", min: "取上下行较小者", up: "只算上行", down: "只算下行" };
export const hhmm = (iso?: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "—");
export const pctOf = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

/** 运行状态 on a VPS: the same meters, bars and colours as the 服务器 page cards. */
export function NodeStatusCard({ asset, status: s }: { asset: Asset; status?: NodeStatus }) {
  useLiveStatus();
  const { statusAt, refreshStatus, pingState } = useData();
  const [spin, setSpin] = useState(false);
  const k = asset.komari!;
  const v = nodeView(asset, s);
  const head = (
    <span className="flex items-center gap-2.5">
      运行状态
      <span className="flex items-center gap-1.5 text-xs font-normal whitespace-nowrap text-muted">
        <span className={clsx("size-1.5 rounded-full", v.on ? "bg-ok" : "bg-subtle")} />{s ? (v.on ? "在线" : "离线") : "未获取"}
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
  const reset = k.trafficResetDay ? `每月 ${k.trafficResetDay} 日重置` : "重置日未填写";
  const showPing = pingState === "ok";
  return (
    <Card title={head} extra={extra}>
      {!v.on && (
        <p className="mb-3 rounded-sm bg-field px-3 py-2 text-[12.5px] text-muted">
          {s ? "节点离线，下面是最后一次同步到的数据。" : "还没有拿到这个节点的状态（探针未连接或节点不存在）。"}
        </p>
      )}
      <div className={clsx("grid grid-cols-1 gap-y-5 @xl:grid-cols-2 @4xl:grid-cols-3", !v.on && "opacity-60 grayscale")}>
        <Col className="border-line @xl:border-r @xl:pr-6">
          <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">
            <Flag region={nodeRegion(asset, s)} />
            <span className="truncate">{[detail(asset, "地区") || (regionCode(nodeRegion(asset, s)) ?? ""), nodeOs(asset, s)].filter(Boolean).join(" · ") || "地区、系统未知"}</span>
            {s?.group && <Chip>{s.group}</Chip>}
            <OsMark os={nodeOs(asset, s)} className="ml-auto size-7" />
          </div>
          <Meters v={v} />
        </Col>
        <Col className="border-t border-line pt-5 @xl:border-t-0 @xl:pt-0 @xl:pl-6 @4xl:border-r @4xl:pr-6">
          <div className="grid grid-cols-2 gap-x-5"><SpeedCell dir="up" v={v} /><SpeedCell dir="down" v={v} /></div>
          <div className="mt-3 grid grid-cols-2 gap-x-5"><TotalCell dir="up" v={v} /><TotalCell dir="down" v={v} /></div>
          <div className="mt-4"><QuotaRow v={v} label="本月剩余" /></div>
          <div className="mt-1.5 flex justify-between gap-3 text-[11.5px] whitespace-nowrap text-subtle"><span className="min-w-0 truncate">{s ? typeLabel[s.trafficType] : ""}</span><span className="shrink-0">{reset}</span></div>
        </Col>
        <Col className="border-t border-line pt-5 @xl:col-span-2 @4xl:col-span-1 @4xl:border-t-0 @4xl:pt-0 @4xl:pl-6">
          {showPing ? <PingCells ping={s?.ping} /> : (
            <p className="text-[12px] text-subtle">{pingState === "empty" ? "Komari 里还没有延迟检测任务，加上后这里显示延迟和丢包。" : "暂时拿不到延迟数据。"}</p>
          )}
          {s?.ping && <div className="mt-1.5 truncate text-[11.5px] text-subtle">任务「{s.ping.task}」· 近 1 小时平均 {s.ping.avg ?? "—"} ms</div>}
          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 text-xs whitespace-nowrap">
            <Mini label="在线" value={v.on && s ? `${Math.floor(s.uptimeSec / 86400)} 天` : "—"} />
            <Mini label="连接" value={v.on && s ? `${s.tcp + s.udp}` : "—"} />
            <Mini label="进程" value={v.on && s ? `${s.process}` : "—"} />
            <Mini label="交换" value={v.on && s && s.swap[1] ? bytes(s.swap[0]) : "—"} />
          </div>
        </Col>
      </div>
    </Card>
  );
}

function Col({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("min-w-0", className)}>{children}</div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-subtle">{label}</div><div className="mt-0.5 truncate text-[13px] tnum">{value}</div></div>;
}
