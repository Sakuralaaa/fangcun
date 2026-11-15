import { displayTotal, isBilled, monthlyByCurrency, money, trafficUsed, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, Plus } from "lucide-react";
import type { AssetType } from "../data/types";
import { daysUntil, dueLabel, getToday, md, monthlyDisplay, perCycle, urgency } from "../lib/fmt";
import { useData, useLiveStatus } from "../lib/store";
import { hhmm, pctOf } from "./NodeStatus";
import { Button, Card, KomariBadge, Pill, TypeIcon, typeMeta, urgencyText } from "./ui";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function Overview({ onSelect, onAdd, onNav }: { onSelect: (id: string) => void; onAdd: () => void; onNav: (path: string) => void }) {
  useLiveStatus();
  const { assets, settings, status, statusAt, komari, backupError, demo } = useData();
  const today = getToday();
  const disp = settings.display;
  const cur = disp.currency;
  const billed = assets.filter(isBilled);
  const upcoming = assets.filter((a) => daysUntil(a.expiresAt) <= 45).sort((a, b) => daysUntil(a.expiresAt) - daysUntil(b.expiresAt));
  const soon = assets.filter((a) => daysUntil(a.expiresAt) <= 30);
  const thisWeek = assets.filter((a) => daysUntil(a.expiresAt) <= 7);
  const total = displayTotal(monthlyByCurrency(billed), disp);
  const monthly = total.total;
  const manual = soon.filter((a) => !a.autoRenew);
  const byType = Object.entries(billed.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + monthlyDisplay(a, disp)), m), {}))
    .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const major = byType.filter(([, v]) => monthly && v / monthly >= 0.02);
  const minor = byType.filter(([, v]) => monthly && v / monthly < 0.02).reduce((s, [, v]) => s + v, 0);
  const servers = assets.filter((a) => a.komari);
  const online = servers.filter((a) => status[a.komari!.uuid]?.online).length;
  const types = new Set(assets.map((a) => a.type)).size;
  const d = new Date(`${today}T12:00:00`);
  const hour = new Date().getHours();
  const hello = demo ? "上午好" : hour < 6 ? "夜深了" : hour < 11 ? "上午好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const unconverted = Object.entries(total.unconverted).map(([c, v]) => money(Math.round(v), c)).join(" + ");
  const cards = assets.filter((a) => a.type === "payment");

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-8 py-7">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[13px] text-subtle">{d.getMonth() + 1} 月 {d.getDate()} 日 · 星期{WEEK[d.getDay()]}</p>
            <h1 className="mt-1 text-[26px] font-bold tracking-tight">
              {hello}，{thisWeek.length ? <>这周有 <span className="text-accent">{thisWeek.length} 项</span>要续费</> : "这周没有要续费的"}
            </h1>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={onAdd}>添加资产</Button>
        </div>

        {backupError && (
          <button onClick={() => onNav("/settings/backup")} className="flex items-center gap-2 rounded-md border border-crit/30 bg-crit-soft px-4 py-2.5 text-left text-[13px] text-crit">
            <AlertTriangle size={15} /> 自动备份失败：{backupError.slice(25) || backupError}<span className="ml-auto text-xs">去看看</span>
          </button>
        )}

        <div className="grid grid-cols-4 gap-3">
          <Kpi label="全部资产" value={assets.length} foot={`${types} 种类型${cards.length ? ` · ${cards.length} 张支付卡` : ""}`} />
          <Kpi label="30 天内到期" value={soon.length} foot={soon.length ? `其中 ${manual.length} 项需手动续费` : "近期没有到期"} />
          <Kpi label="每月支出" value={money(Math.round(monthly), cur, { free: false })}
            foot={unconverted ? `另有 ${unconverted} 未折算` : `一年约 ${money(Math.round(monthly * 12), cur, { free: false })}${total.approx ? " · 按汇率估算" : ""}`} />
          <Kpi label="探针节点" value={servers.length ? `${online}/${servers.length}` : "—"} foot={servers.length ? `${servers.length - online} 台离线 · ${hhmm(statusAt ?? komari?.lastSync)} 更新` : komari?.url ? "还没有绑定节点" : "未连接 Komari"} badge />
        </div>

        <div className="grid h-[500px] grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
          <Card title="即将到期" extra="未来 45 天" flush scroll className="min-h-0">
            {upcoming.length ? upcoming.map((a) => {
              const u = urgency(a);
              return (
                <button key={a.id} onClick={() => onSelect(a.id)} className="flex h-[60px] w-full shrink-0 items-center gap-4 border-b border-line px-4 text-left last:border-0 hover:bg-field/60">
                  <div className="w-11 rounded-sm bg-field py-1 text-center leading-tight">
                    <div className="text-[10.5px] text-subtle">{Number(a.expiresAt!.slice(5, 7))} 月</div>
                    <div className="text-[17px] font-bold tnum">{a.expiresAt!.slice(8)}</div>
                  </div>
                  <TypeIcon type={a.type} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{a.name}</div>
                    <div className="truncate text-xs text-subtle">{typeMeta[a.type].label} · {a.payment ? `${a.payment.network ?? ""} ···· ${a.payment.last4} 卡片到期` : `${a.provider ?? ""} · ${perCycle(a)}`}</div>
                  </div>
                  {a.autoRenew ? <span className="text-xs text-subtle">自动续费</span> : <span className="rounded-[5px] border border-line px-1.5 py-px text-[11px] text-muted">{a.type === "payment" ? "需换卡" : "手动续费"}</span>}
                  <div className="w-[76px] text-right"><Pill tone={u}>{dueLabel(a)}</Pill></div>
                </button>
              );
            }) : <p className="px-4 pt-2 text-[13px] text-subtle">未来 45 天没有要到期的资产。</p>}
          </Card>

          <div className="flex min-h-0 flex-col gap-4">
            <Card title="每月支出构成" extra={<span title={total.approx ? "其他币种按设置里的汇率折算，仅作估算" : undefined}>{money(Math.round(monthly), cur, { free: false })}/月</span>} className="shrink-0">
              {monthly > 0 ? (
                <>
                  <div className="mb-4 flex h-2.5 overflow-hidden rounded-full">
                    {byType.map(([t, v]) => <span key={t} style={{ width: `${(v / monthly) * 100}%` }} className={clsx("h-full", typeMeta[t as AssetType].bar)} />)}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {major.slice(0, 5).map(([t, v]) => (
                      <div key={t} className="flex items-center gap-2.5 text-[13px]">
                        <span className={clsx("size-2.5 rounded-[3px]", typeMeta[t as AssetType].bar)} />
                        <span className="flex-1 text-muted">{TYPE_LABEL[t as AssetType]}</span>
                        <span className="text-subtle tnum">{Math.round((v / monthly) * 100)}%</span>
                        <span className="w-16 text-right font-medium tnum">{money(Math.round(v * 10) / 10, cur, { free: false })}</span>
                      </div>
                    ))}
                    {(minor > 0 || major.length > 5) && (
                      <div className="flex items-center gap-2.5 text-[13px]">
                        <span className="size-2.5 rounded-[3px] bg-subtle/40" />
                        <span className="flex-1 text-muted">其他 {byType.length - Math.min(5, major.length)} 类</span>
                        <span className="text-subtle tnum">{Math.max(1, Math.round(((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) / monthly) * 100))}%</span>
                        <span className="w-16 text-right font-medium tnum">{money(Math.round((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) * 10) / 10, cur, { free: false })}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : <p className="text-[13px] text-subtle">还没有带价格的资产。</p>}
            </Card>
            <Card title={<span className="flex items-center gap-2">探针 <KomariBadge /></span>}
              extra={komari?.url ? <a href={komari.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">{komari.url.replace(/^https?:\/\//, "")} <ArrowUpRight size={12} /></a> : <button onClick={() => onNav("/settings/komari")} className="hover:text-ink">去连接</button>}
              flush scroll className="min-h-0 flex-1">
              {servers.length ? servers.map((s) => {
                const st = status[s.komari!.uuid];
                const on = Boolean(st?.online);
                const pct = st && st.trafficLimit ? pctOf(trafficUsed(st), st.trafficLimit) : null;
                return (
                  <button key={s.id} onClick={() => onSelect(s.id)} className="flex h-[60px] w-full shrink-0 items-center gap-3 border-b border-line px-4 text-left text-[13px] last:border-0 hover:bg-field/60">
                    <span className={clsx("size-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-subtle")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12.5px] font-medium">{s.name}</div>
                      <div className="text-xs text-subtle">{s.details.find((x) => x.label === "地区")?.value ?? s.provider}{on ? ` · CPU ${Math.round(st!.cpu)}%` : " · 离线"}</div>
                    </div>
                    {on && pct !== null && (
                      <div className="w-24">
                        <div className="flex justify-between text-[11px] text-subtle"><span>流量</span><span className="tnum">{pct}%</span></div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-field"><div className={clsx("h-full rounded-full", pct >= 90 ? "bg-crit" : pct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
                      </div>
                    )}
                    <span className={clsx("w-12 text-right text-xs tnum", urgencyText[urgency(s)])}>{s.expiresAt ? md(s.expiresAt) : "—"}</span>
                  </button>
                );
              }) : <p className="px-4 pb-4 text-[13px] text-subtle">{komari?.url ? "在设置里把 Komari 节点绑定到服务器资产后，这里会显示运行状态。" : "在设置里填上 Komari 探针地址，服务器的在线状态和流量会显示在这里。"}</p>}
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}

function Kpi({ label, value, foot, badge }: { label: string; value: React.ReactNode; foot: string; badge?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 pt-3.5 pb-3.5">
      <div className="flex items-center justify-between text-xs text-muted">{label}{badge && <KomariBadge />}</div>
      <div className="mt-2 text-[28px] font-bold tracking-tight tnum">{value}</div>
      <div className="mt-0.5 truncate text-xs text-subtle">{foot}</div>
    </div>
  );
}
