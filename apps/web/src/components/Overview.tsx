import { compareStarred, displayTotal, isBilled, monthlyByCurrency, money, trafficUsed, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, ChevronDown, Pin, Plus, Star } from "lucide-react";
import { useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { dueLabel, md, remindDays, renewOpen, renewOpensAt, getToday, monthlyDisplay, urgency, ymd } from "../lib/fmt";
import { useData, useLiveStatus } from "../lib/store";
import { hhmm, pctOf } from "./NodeStatus";
import { Button, FocusMark, KomariBadge, Pill, TypeIcon, typeMeta, urgencyText } from "./ui";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function Overview({ onSelect, onAdd, onNav }: { onSelect: (id: string) => void; onAdd: () => void; onNav: (path: string) => void }) {
  useLiveStatus();
  const { assets, settings, status, statusAt, komari, backupError, demo } = useData();
  const today = getToday();
  const disp = settings.display;
  const cur = disp.currency;
  const billed = assets.filter(isBilled);
  const upcoming = assets.filter((a) => remindDays(a) <= 45).sort((a, b) => remindDays(a) - remindDays(b));
  const soon = assets.filter((a) => remindDays(a) <= 30);
  const thisWeek = assets.filter((a) => remindDays(a) <= 7);
  const total = displayTotal(monthlyByCurrency(billed), disp);
  const monthly = total.total;
  const manual = soon.filter((a) => !a.autoRenew);
  const byType = Object.entries(billed.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + monthlyDisplay(a, disp)), m), {}))
    .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const major = byType.filter(([, v]) => monthly && v / monthly >= 0.02);
  const minor = byType.filter(([, v]) => monthly && v / monthly < 0.02).reduce((s, [, v]) => s + v, 0);
  const servers = assets.filter((a) => a.komari);
  const online = servers.filter((a) => status[a.komari!.uuid]?.online).length;
  const d = new Date(`${today}T12:00:00`);
  const hour = new Date().getHours();
  const hello = demo ? "上午好" : hour < 6 ? "夜深了" : hour < 11 ? "上午好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const unconverted = Object.entries(total.unconverted).map(([c, v]) => money(Math.round(v), c)).join(" + ");
  const starred = assets.filter((a) => a.starred).sort((a, b) => compareStarred(a, b, today));

  const [open, toggle] = useFold();
  const week = upcoming.filter((a) => remindDays(a) <= 7);
  const later = upcoming.filter((a) => remindDays(a) > 7);
  const row = (a: Asset) => <DueRow key={a.id} a={a} onClick={() => onSelect(a.id)} />;

  return (
    <main className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <p className="text-[13px] text-muted">{d.getMonth() + 1} 月 {d.getDate()} 日 · 星期{WEEK[d.getDay()]}</p>
            <h1 className="mt-1 text-[26px] font-bold tracking-tight max-md:text-[22px]">
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

        <div className="flex flex-wrap gap-x-14 gap-y-4">
          <Stat label="30 天内到期" value={soon.length} title={soon.length ? `其中 ${manual.length} 项需手动续费` : undefined} onClick={() => onNav("/assets")} />
          <Stat label="每月支出" value={money(Math.round(monthly), cur, { free: false })}
            title={unconverted ? `另有 ${unconverted} 未折算` : `一年约 ${money(Math.round(monthly * 12), cur, { free: false })}${total.approx ? "，按汇率估算" : ""}`} onClick={() => onNav("/costs")} />
          <Stat label="探针在线" value={servers.length ? `${online}/${servers.length}` : "—"}
            title={servers.length ? `${hhmm(statusAt ?? komari?.lastSync)} 更新` : undefined} onClick={() => onNav(servers.length ? "/servers" : "/settings/komari")} />
        </div>

        <div className="grid items-start gap-x-10 gap-y-8 @4xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <section className="min-w-0">
            {upcoming.length ? <>
              {week.length > 0 && <><Heading title="这周要续" count={week.length} /><div className="flex flex-col">{week.map(row)}</div></>}
              {later.length > 0 && <><Heading title={week.length ? "即将到期" : "即将到期 · 45 天内"} count={later.length} className={week.length ? "mt-6" : undefined} /><div className="flex flex-col">{later.map(row)}</div></>}
            </> : <><Heading title="即将到期" /><p className="py-2 text-[13px] text-muted">未来 45 天没有要到期的资产</p></>}
          </section>

          <aside className="flex min-w-0 flex-col gap-3">
            <Fold id="starred" open={open.starred} onToggle={toggle} title="关注" summary={starred.length ? `${starred.length} 项` : "暂无"}>
              {starred.length ? <>
                {starred.map((a) => <StarredRow key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} onClick={() => onSelect(a.id)} />)}
                <button onClick={() => onNav("/assets?type=starred")} className="mt-1 flex items-center gap-1 px-4 pb-3 text-xs text-muted hover:text-ink">全部关注<ArrowUpRight size={12} /></button>
              </> : <p className="flex items-center gap-2 px-4 pb-4 text-[13px] text-muted"><Star size={14} strokeWidth={1.9} className="shrink-0" />还没有关注的资产</p>}
            </Fold>

            <Fold id="costs" open={open.costs} onToggle={toggle} title="每月支出构成" summary={`${money(Math.round(monthly), cur, { free: false })}/月`}>
              <div className="px-4 pb-4">
              {monthly > 0 ? (
                <>
                  <div className="mb-4 flex h-2 overflow-hidden rounded-full">
                    {byType.map(([t, v]) => <span key={t} style={{ width: `${(v / monthly) * 100}%` }} className={clsx("h-full", typeMeta[t as AssetType].bar)} />)}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {major.slice(0, 5).map(([t, v]) => (
                      <div key={t} className="flex items-center gap-2.5 text-[13px]">
                        <span className={clsx("size-2.5 shrink-0 rounded-[3px]", typeMeta[t as AssetType].bar)} />
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted">{TYPE_LABEL[t as AssetType]}</span>
                        <span className="text-muted tnum">{Math.round((v / monthly) * 100)}%</span>
                        <span className="w-16 shrink-0 text-right font-medium whitespace-nowrap tnum">{money(Math.round(v * 10) / 10, cur, { free: false })}</span>
                      </div>
                    ))}
                    {(minor > 0 || major.length > 5) && (
                      <div className="flex items-center gap-2.5 text-[13px]">
                        <span className="size-2.5 shrink-0 rounded-[3px] bg-subtle/40" />
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted">其他 {byType.length - Math.min(5, major.length)} 类</span>
                        <span className="text-muted tnum">{Math.max(1, Math.round(((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) / monthly) * 100))}%</span>
                        <span className="w-16 shrink-0 text-right font-medium whitespace-nowrap tnum">{money(Math.round((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) * 10) / 10, cur, { free: false })}</span>
                      </div>
                    )}
                  </div>
                </>
              ) : <p className="text-[13px] text-muted">还没有带价格的资产</p>}
              </div>
            </Fold>

            <Fold id="probe" open={open.probe} onToggle={toggle} title={<span className="flex items-center gap-2">探针 <KomariBadge /></span>}
              summary={servers.length ? `${online}/${servers.length} 在线` : komari?.url ? "未绑定" : "未连接"}>
              {servers.length ? <>
                {servers.map((s) => {
                  const st = status[s.komari!.uuid];
                  const on = Boolean(st?.online);
                  const pct = st && st.trafficLimit ? pctOf(trafficUsed(st), st.trafficLimit) : null;
                  return (
                    <button key={s.id} onClick={() => onSelect(s.id)} className="flex h-11 w-full shrink-0 items-center gap-3 px-4 text-left text-[13px] hover:bg-field/60">
                      <span className={clsx("size-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-subtle")} title={on ? "在线" : "离线"} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.name}</span>
                      {on && pct !== null && (
                        <span className="flex w-20 shrink-0 items-center gap-2 @max-sm:hidden" title={`流量 ${pct}%`}>
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-field"><span className={clsx("block h-full rounded-full", pct >= 90 ? "bg-crit" : pct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} /></span>
                          <span className="w-8 text-right text-[11px] text-muted tnum">{pct}%</span>
                        </span>
                      )}
                      {!on && <span className="shrink-0 text-xs text-muted">离线</span>}
                    </button>
                  );
                })}
                {komari?.url && <a href={komari.url} target="_blank" rel="noreferrer" className="mt-1 flex w-fit items-center gap-1 px-4 pb-3 text-xs text-muted hover:text-ink">{komari.url.replace(/^https?:\/\//, "")}<ArrowUpRight size={12} /></a>}
              </> : <button onClick={() => onNav("/settings/komari")} className="px-4 pb-4 text-[13px] text-muted hover:text-ink">{komari?.url ? "去绑定节点" : "去连接 Komari"}</button>}
            </Fold>
          </aside>
        </div>
      </div>
    </main>
  );
}

type FoldId = "starred" | "costs" | "probe";
const FOLD_KEY = "fc-overview-open";
/** Which compact cards on 总览 are expanded; all collapsed by default, remembered in localStorage. */
function useFold(): [Record<FoldId, boolean>, (id: FoldId) => void] {
  const [open, setOpen] = useState<Record<FoldId, boolean>>(() => {
    try { return { starred: false, costs: false, probe: false, ...JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") }; }
    catch { return { starred: false, costs: false, probe: false }; }
  });
  const toggle = (id: FoldId) => setOpen((o) => {
    const next = { ...o, [id]: !o[id] };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [open, toggle];
}

function Fold({ id, open, onToggle, title, summary, children }: { id: FoldId; open: boolean; onToggle: (id: FoldId) => void; title: React.ReactNode; summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-panel shadow-[0_0_0_1px_var(--color-line)]">
      <button onClick={() => onToggle(id)} aria-expanded={open} className="flex h-12 w-full items-center gap-2 px-4 text-left">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</span>
        <span className="shrink-0 text-[13px] text-muted tnum">{summary}</span>
        <ChevronDown size={15} className={clsx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </section>
  );
}

function Heading({ title, count, className }: { title: string; count?: number; className?: string }) {
  return (
    <h2 className={clsx("mb-1 flex items-baseline gap-2 text-[15px] font-semibold", className)}>
      {title}{count !== undefined && <span className="text-[13px] font-normal text-muted tnum">{count}</span>}
    </h2>
  );
}

/** One row of the due list: date, name, how it renews, time left. */
function DueRow({ a, onClick }: { a: Asset; onClick: () => void }) {
  const u = urgency(a);
  const at = renewOpensAt(a) && !renewOpen(a) && remindDays(a) >= 0 ? renewOpensAt(a)! : a.expiresAt!;
  const how = a.autoRenew ? "自动续费" : a.type === "payment" ? "需换卡" : renewOpensAt(a) ? "手动续期" : "手动续费";
  return (
    <button onClick={onClick} className="-mx-3 flex h-14 items-center gap-4 rounded-sm px-3 text-left hover:bg-field/70">
      <span className="w-12 shrink-0 text-[13px] text-muted tnum" title={ymd(at)}>{md(at)}</span>
      <TypeIcon type={a.type} size="sm" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={clsx("truncate font-medium", a.type === "server" && "font-mono text-[13px]")}>{a.name}</span>
        <FocusMark starred={a.starred} pinned={a.pinned} />
      </span>
      <span className={clsx("shrink-0 text-xs whitespace-nowrap @max-md:hidden", a.autoRenew ? "text-muted" : "font-medium text-ink")}>{how}</span>
      <span className="w-[76px] shrink-0 text-right"><Pill tone={u}>{dueLabel(a)}</Pill></span>
    </button>
  );
}

function Stat({ label, value, title, onClick }: { label: string; value: React.ReactNode; title?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="group text-left">
      <div className="text-xs text-muted group-hover:text-ink">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tracking-tight whitespace-nowrap tnum">{value}</div>
    </button>
  );
}

/** One 关注 row: name, what it is, the one status that matters (online for a probed VPS), cost, and when it is next due. */
function StarredRow({ a, online, onClick }: { a: Asset; online?: boolean; onClick: () => void }) {
  const u = urgency(a);
  return (
    <button onClick={onClick} className="flex h-11 w-full min-w-0 items-center gap-3 px-4 text-left hover:bg-field/60">
      <TypeIcon type={a.type} size="sm" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={clsx("truncate font-medium", a.type === "server" && "font-mono text-[12.5px]")}>{a.name}</span>
        {a.komari && <span className={clsx("size-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-subtle")} title={online ? "在线" : "离线"} />}
        {a.pinned && <Pin size={11} strokeWidth={2} className="shrink-0 text-muted" aria-label="置顶" />}
      </span>
      <span className={clsx("shrink-0 text-[12.5px] whitespace-nowrap tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{dueLabel(a)}</span>
    </button>
  );
}
