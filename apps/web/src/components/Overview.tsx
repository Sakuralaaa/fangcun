import { compareStarred, computeCardReserves, displayTotal, findLinkedCards, isBilled, monthlyByCurrency, money, trafficUsed, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, ChevronDown, CreditCard, Pin, Plus, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { dueLabel, getToday, monthlyDisplay, perCycle, remindDays, renewOpen, renewOpensAt, urgency, ymd } from "../lib/fmt";
import { useData, useLiveStatus } from "../lib/store";
import { fmtCurMap, OverviewCardReserves } from "./CardReserves";
import { hhmm, pctOf } from "./NodeStatus";
import { Button, FocusMark, Kbd, KomariBadge, Pill, TypeIcon, typeMeta, urgencyText } from "./ui";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function Overview({
  onSelect,
  onAdd,
  onNav,
  onOpenSearch,
}: {
  onSelect: (id: string) => void;
  onAdd: () => void;
  onNav: (path: string) => void;
  onOpenSearch?: () => void;
}) {
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

  const cardReport = useMemo(
    () => computeCardReserves(assets, today, disp, { windowDays: 30, includeManual: true }),
    [assets, today, disp],
  );
  const cardAlerts = cardReport.cardsNeedingTopUp + cardReport.cardsAtRisk;

  const [open, toggle] = useFold();
  const week = upcoming.filter((a) => remindDays(a) <= 7);
  const later = upcoming.filter((a) => remindDays(a) > 7);
  const row = (a: Asset) => <DueRow key={a.id} a={a} cards={findLinkedCards(a, assets)} onClick={() => onSelect(a.id)} />;

  return (
    <main className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-6">
        {/* Hero Header */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <p className="text-[12.5px] font-medium text-muted">
              {d.getMonth() + 1} 月 {d.getDate()} 日 · 星期{WEEK[d.getDay()]}
            </p>
            <h1 className="mt-1 text-[26px] font-bold tracking-tight max-md:text-[22px]">
              {hello}，{thisWeek.length ? <>这周有 <span className="text-spark">{thisWeek.length} 项</span>要续费</> : "这周没有要续费的"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-line bg-panel px-2.5 text-[12.5px] text-muted shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-colors hover:bg-field hover:text-ink max-sm:hidden"
              >
                <Search size={14} />
                <span>快速查找</span>
                <Kbd>⌘K</Kbd>
              </button>
            )}
            <Button variant="primary" icon={<Plus size={15} />} onClick={onAdd}>添加资产</Button>
          </div>
        </div>

        {/* Backup Error Banner */}
        {backupError && (
          <button onClick={() => onNav("/settings/backup")} className="flex cursor-pointer items-center gap-2 rounded-md border border-crit/30 bg-crit-soft px-4 py-2.5 text-left text-[13px] text-crit">
            <AlertTriangle size={15} /> 自动备份失败：{backupError.slice(25) || backupError}<span className="ml-auto text-xs font-medium">去看看</span>
          </button>
        )}

        {/* 4-Card KPI Row */}
        <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
          <StatCard
            label="30 天内到期"
            value={soon.length}
            tone={thisWeek.length > 0 ? "crit" : "neutral"}
            foot={soon.length ? `其中 ${manual.length} 项需手动续费` : "近期没有到期项"}
            onClick={() => onNav("/assets")}
          />
          <StatCard
            label="30 天卡片预留"
            value={
              cardReport.totalShortfallDisplay.total > 0
                ? `差 ${money(Math.round(cardReport.totalShortfallDisplay.total), cur, { free: false })}`
                : fmtCurMap(cardReport.totalByCurrency, money(0, cur, { free: false }))
            }
            tone={cardAlerts > 0 ? "crit" : cardReport.cards.length ? "ok" : "neutral"}
            foot={
              cardReport.cardsNeedingTopUp > 0
                ? `${cardReport.cardsNeedingTopUp} 张卡需充值 · 共 ${cardReport.cards.length} 张卡`
                : cardReport.cardsAtRisk > 0
                  ? `${cardReport.cardsAtRisk} 张卡有状态风险`
                  : cardReport.cards.length
                    ? `共 ${cardReport.cards.length} 张卡${cardReport.unassignedCharges.length ? ` · ${cardReport.unassignedCharges.length} 项未绑卡` : ""}`
                    : "添加支付卡以开启提醒"
            }
            onClick={() => onNav("/costs/cards")}
          />
          <StatCard
            label="每月支出"
            value={money(Math.round(monthly), cur, { free: false })}
            foot={unconverted ? `另有 ${unconverted} 未折算` : `一年约 ${money(Math.round(monthly * 12), cur, { free: false })}${total.approx ? " · 按汇率估算" : ""}`}
            onClick={() => onNav("/costs")}
          />
          <StatCard
            label="探针节点"
            badge={<KomariBadge />}
            value={servers.length ? `${online}/${servers.length}` : "—"}
            tone={servers.length > 0 && online < servers.length ? "warn" : "neutral"}
            foot={servers.length ? `${servers.length - online ? `${servers.length - online} 台离线 · ` : "全部在线 · "}${hhmm(statusAt ?? komari?.lastSync)} 更新` : "点击连接 Komari"}
            onClick={() => onNav(servers.length ? "/servers" : "/settings/komari")}
          />
        </div>

        {/* Main 2-Column Content */}
        <div className="grid items-start gap-x-7 gap-y-6 @4xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          {/* Left: Upcoming Renewals Card */}
          <section className="surface-card min-w-0 overflow-hidden">
            <header className="flex min-h-11 items-center justify-between border-b border-line px-4 py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold">即将到期</h2>
                {upcoming.length > 0 && (
                  <span className="rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-muted tnum">{upcoming.length} 项</span>
                )}
              </div>
              <span className="text-xs text-subtle">未来 45 天</span>
            </header>

            {upcoming.length ? (
              <div>
                {week.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 bg-crit-soft/45 px-4 py-1.5 text-[11.5px] font-semibold text-crit">
                      <span className="size-1.5 rounded-full bg-crit" />
                      这周要续 <span className="font-normal opacity-80 tnum">{week.length}</span>
                    </div>
                    <div className="divide-y divide-line">{week.map(row)}</div>
                  </>
                )}
                {later.length > 0 && (
                  <>
                    {week.length > 0 && (
                      <div className="flex items-center gap-2 border-t border-line bg-bg/60 px-4 py-1.5 text-[11.5px] font-medium text-muted">
                        之后 <span className="text-subtle tnum">{later.length}</span>
                      </div>
                    )}
                    <div className="divide-y divide-line">{later.map(row)}</div>
                  </>
                )}
              </div>
            ) : (
              <p className="px-4 py-10 text-center text-[13px] text-muted">未来 45 天没有要到期的资产</p>
            )}
          </section>

          {/* Right Sidebar: Card Reserves + Starred + Cost Breakdown + Probe */}
          <aside className="flex min-w-0 flex-col gap-3.5">
            <OverviewCardReserves onSelect={onSelect} onNav={onNav} />

            <Fold id="starred" open={open.starred} onToggle={toggle} title="关注" summary={starred.length ? `${starred.length} 项` : "暂无"}>
              {starred.length ? (
                <>
                  <div className="divide-y divide-line border-t border-line">
                    {starred.map((a) => (
                      <StarredRow key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} onClick={() => onSelect(a.id)} />
                    ))}
                  </div>
                  <button onClick={() => onNav("/assets?type=starred")} className="flex cursor-pointer items-center gap-1 border-t border-line px-4 py-2.5 text-xs font-medium text-muted hover:bg-field/50 hover:text-ink">
                    全部关注<ArrowUpRight size={12} />
                  </button>
                </>
              ) : (
                <p className="flex items-center gap-2 border-t border-line px-4 py-3.5 text-[13px] text-muted">
                  <Star size={14} strokeWidth={1.9} className="shrink-0" />还没有关注的资产
                </p>
              )}
            </Fold>

            <Fold id="costs" open={open.costs} onToggle={toggle} title="每月支出构成" summary={`${money(Math.round(monthly), cur, { free: false })}/月`}>
              <div className="border-t border-line px-4 py-3.5">
                {monthly > 0 ? (
                  <>
                    <div className="mb-3.5 flex h-2 overflow-hidden rounded-full bg-field">
                      {byType.map(([t, v]) => (
                        <span key={t} style={{ width: `${(v / monthly) * 100}%` }} className={clsx("h-full", typeMeta[t as AssetType].bar)} />
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      {major.slice(0, 5).map(([t, v]) => (
                        <div key={t} className="flex items-center gap-2.5 text-[13px]">
                          <span className={clsx("size-2.5 shrink-0 rounded-[3px]", typeMeta[t as AssetType].bar)} />
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted">{TYPE_LABEL[t as AssetType]}</span>
                          <span className="text-xs text-subtle tnum">{Math.round((v / monthly) * 100)}%</span>
                          <span className="w-16 shrink-0 text-right font-semibold whitespace-nowrap tnum">
                            {money(Math.round(v * 10) / 10, cur, { free: false })}
                          </span>
                        </div>
                      ))}
                      {(minor > 0 || major.length > 5) && (
                        <div className="flex items-center gap-2.5 text-[13px]">
                          <span className="size-2.5 shrink-0 rounded-[3px] bg-subtle/40" />
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-muted">其他 {byType.length - Math.min(5, major.length)} 类</span>
                          <span className="text-xs text-subtle tnum">
                            {Math.max(1, Math.round(((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) / monthly) * 100))}%
                          </span>
                          <span className="w-16 shrink-0 text-right font-semibold whitespace-nowrap tnum">
                            {money(Math.round((minor + major.slice(5).reduce((s, [, v]) => s + v, 0)) * 10) / 10, cur, { free: false })}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-muted">还没有带价格的资产</p>
                )}
              </div>
            </Fold>

            <Fold id="probe" open={open.probe} onToggle={toggle} title={<span className="flex items-center gap-2">探针 <KomariBadge /></span>}
              summary={servers.length ? `${online}/${servers.length} 在线` : komari?.url ? "未绑定" : "未连接"}>
              {servers.length ? (
                <div className="border-t border-line">
                  <div className="divide-y divide-line">
                    {servers.map((s) => {
                      const st = status[s.komari!.uuid];
                      const on = Boolean(st?.online);
                      const pct = st && st.trafficLimit ? pctOf(trafficUsed(st), st.trafficLimit) : null;
                      return (
                        <button key={s.id} onClick={() => onSelect(s.id)} className="flex h-11 w-full shrink-0 cursor-pointer items-center gap-3 px-4 text-left text-[13px] transition-colors hover:bg-field/60">
                          <span className={clsx("size-2 shrink-0 rounded-full", on ? "bg-ok" : "bg-subtle")} title={on ? "在线" : "离线"} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{s.name}</span>
                          {on && pct !== null && (
                            <span className="flex w-20 shrink-0 items-center gap-2 @max-sm:hidden" title={`流量 ${pct}%`}>
                              <span className="h-1 flex-1 overflow-hidden rounded-full bg-field">
                                <span className={clsx("block h-full rounded-full", pct >= 90 ? "bg-crit" : pct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                              </span>
                              <span className="w-8 text-right text-[11px] text-muted tnum">{pct}%</span>
                            </span>
                          )}
                          {!on && <span className="shrink-0 text-xs text-muted">离线</span>}
                        </button>
                      );
                    })}
                  </div>
                  {komari?.url && (
                    <a href={komari.url} target="_blank" rel="noreferrer" className="flex w-full items-center gap-1 border-t border-line px-4 py-2.5 text-xs text-muted hover:bg-field/50 hover:text-ink">
                      {komari.url.replace(/^https?:\/\//, "")}<ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
              ) : (
                <button onClick={() => onNav("/settings/komari")} className="border-t border-line px-4 py-3.5 text-left text-[13px] text-muted hover:text-ink">
                  {komari?.url ? "去绑定节点" : "去连接 Komari"}
                </button>
              )}
            </Fold>
          </aside>
        </div>
      </div>
    </main>
  );
}

type FoldId = "starred" | "costs" | "probe";
const FOLD_KEY = "fc-overview-open-v2";
function useFold(): [Record<FoldId, boolean>, (id: FoldId) => void] {
  const [open, setOpen] = useState<Record<FoldId, boolean>>(() => {
    try { return { starred: true, costs: true, probe: false, ...JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") }; }
    catch { return { starred: true, costs: true, probe: false }; }
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
    <section className="surface-card overflow-hidden">
      <button onClick={() => onToggle(id)} aria-expanded={open} className="flex h-11 w-full cursor-pointer items-center gap-2 px-4 text-left transition-colors hover:bg-field/40">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</span>
        <span className="shrink-0 text-[12.5px] text-muted tnum">{summary}</span>
        <ChevronDown size={15} className={clsx("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </section>
  );
}

/** One row of the due list: calendar tile, icon, name + metadata + price + card, how it renews, time left. */
function DueRow({ a, cards, onClick }: { a: Asset; cards: Asset[]; onClick: () => void }) {
  const u = urgency(a);
  const at = renewOpensAt(a) && !renewOpen(a) && remindDays(a) >= 0 ? renewOpensAt(a)! : a.expiresAt!;
  const [, month, day] = at.split("-");
  const how = a.autoRenew ? "自动续费" : a.type === "payment" ? "需换卡" : renewOpensAt(a) ? "手动续期" : "手动续费";
  const sub = [TYPE_LABEL[a.type], a.provider, a.price > 0 ? perCycle(a) : "免费"].filter(Boolean).join(" · ");
  return (
    <button onClick={onClick} className="flex min-h-[60px] w-full cursor-pointer items-center gap-3.5 px-4 py-2.5 text-left transition-colors hover:bg-field/60">
      {/* Mini Calendar Date Badge */}
      <span
        className={clsx(
          "flex w-11 shrink-0 flex-col items-center justify-center rounded-[9px] py-1 text-center leading-none tnum",
          u === "crit" ? "bg-crit-soft text-crit" : u === "warn" ? "bg-warn-soft text-warn" : "bg-field text-ink",
        )}
        title={ymd(at)}
      >
        <span className="text-[10px] font-medium opacity-75">{Number(month)} 月</span>
        <span className="mt-0.5 text-[15px] font-bold">{day}</span>
      </span>

      <TypeIcon type={a.type} size="sm" tinted />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={clsx("truncate text-[13.5px] font-semibold", a.type === "server" && "font-mono text-[13px]")}>{a.name}</span>
          <FocusMark starred={a.starred} pinned={a.pinned} />
        </span>
        <span className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
          <span className="truncate tnum">{sub}</span>
          {cards.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-t-payment-soft/80 px-1.5 py-px text-[10.5px] text-t-payment max-sm:hidden">
              <CreditCard size={10} />
              <span className="font-mono">{cards[0].payment?.last4}</span>
            </span>
          )}
        </span>
      </span>

      <span
        className={clsx(
          "shrink-0 rounded-[6px] px-2 py-0.5 text-[11.5px] whitespace-nowrap @max-md:hidden",
          a.autoRenew ? "text-muted" : "border border-line bg-bg font-medium text-ink",
        )}
      >
        {how}
      </span>

      <span className="w-[74px] shrink-0 text-right">
        <Pill tone={u}>{dueLabel(a)}</Pill>
      </span>
    </button>
  );
}

function StatCard({
  label,
  value,
  foot,
  badge,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  foot: string;
  badge?: React.ReactNode;
  tone?: "neutral" | "crit" | "warn" | "ok";
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="surface-card-interactive group flex min-w-0 cursor-pointer flex-col px-4 py-3.5 text-left">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{label}</span>
        {badge}
      </div>
      <div
        className={clsx(
          "mt-2 truncate text-[24px] leading-none font-bold tracking-tight whitespace-nowrap tnum",
          tone === "crit" && "text-crit",
          tone === "warn" && "text-warn",
          tone === "ok" && "text-ok",
        )}
      >
        {value}
      </div>
      <div className="mt-2 truncate text-[12px] text-subtle group-hover:text-muted">{foot}</div>
    </button>
  );
}

/** One 关注 row: name, online dot, due time. */
function StarredRow({ a, online, onClick }: { a: Asset; online?: boolean; onClick: () => void }) {
  const u = urgency(a);
  return (
    <button onClick={onClick} className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-3 px-4 text-left transition-colors hover:bg-field/60">
      <TypeIcon type={a.type} size="sm" tinted />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={clsx("truncate font-medium", a.type === "server" && "font-mono text-[12.5px]")}>{a.name}</span>
        {a.komari && <span className={clsx("size-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-subtle")} title={online ? "在线" : "离线"} />}
        {a.pinned && <Pin size={11} strokeWidth={2} className="shrink-0 text-muted" aria-label="置顶" />}
      </span>
      <span className={clsx("shrink-0 text-[12.5px] whitespace-nowrap tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{dueLabel(a)}</span>
    </button>
  );
}
