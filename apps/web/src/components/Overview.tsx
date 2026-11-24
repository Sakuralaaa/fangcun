import { compareStarred, computeCardReserves, displayTotal, findLinkedCards, isBilled, monthlyByCurrency, money, trafficUsed, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, Pin, Plus, Search, Server, Star } from "lucide-react";
import { useMemo } from "react";
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

  const week = upcoming.filter((a) => remindDays(a) <= 7);
  const later = upcoming.filter((a) => remindDays(a) > 7);
  const row = (a: Asset) => <DueRow key={a.id} a={a} cards={findLinkedCards(a, assets)} onClick={() => onSelect(a.id)} />;

  return (
    <main className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-5">
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

        {/* Row 1: 4 Equal-Height KPI Cards */}
        <div className="grid grid-cols-2 gap-3.5 @4xl:grid-cols-4">
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

        {/* Row 2: Full-width Horizontal Expense Breakdown Bar (matching 费用 page style) */}
        {monthly > 0 && byType.length > 0 && (
          <section className="surface-card px-4 py-3.5">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[13.5px] font-semibold">每月支出占比</h2>
                <span className="text-xs text-subtle tnum">
                  约 {money(Math.round(monthly), cur, { free: false })}/月
                  {unconverted ? ` · 另有 ${unconverted}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNav("/costs")}
                className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                费用明细<ArrowUpRight size={13} />
              </button>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-field">
              {byType.map(([t, v]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onNav(`/assets?type=${t}`)}
                  title={`${TYPE_LABEL[t as AssetType]}：${money(Math.round(v * 10) / 10, cur, { free: false })}/月`}
                  style={{ width: `${Math.max(1.5, (v / monthly) * 100)}%` }}
                  className={clsx("h-full cursor-pointer transition-opacity hover:opacity-85", typeMeta[t as AssetType].bar)}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {byType.map(([t, v]) => {
                const pct = Math.max(1, Math.round((v / monthly) * 100));
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onNav(`/assets?type=${t}`)}
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-bg/70 px-2.5 text-xs text-muted transition-colors hover:bg-field hover:text-ink tnum"
                  >
                    <span className={clsx("size-2 rounded-full", typeMeta[t as AssetType].bar)} />
                    <span>{TYPE_LABEL[t as AssetType]}</span>
                    <span className="text-subtle">{pct}%</span>
                    <span className="font-semibold text-ink">{money(Math.round(v * 10) / 10, cur, { free: false })}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Row 3: Perfectly Equal-Height Paired Row (即将到期 | 卡片预留提醒) */}
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <section className="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden @4xl:h-[420px]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold">即将到期</h2>
                {upcoming.length > 0 && (
                  <span className="rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-muted tnum">{upcoming.length} 项</span>
                )}
              </div>
              <span className="text-xs text-subtle">未来 45 天</span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
              {upcoming.length ? (
                <div>
                  {week.length > 0 && (
                    <>
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/60 bg-crit-soft/85 px-4 py-1.5 text-[11.5px] font-semibold text-crit backdrop-blur-xs">
                        <span className="size-1.5 rounded-full bg-crit" />
                        这周要续 <span className="font-normal opacity-80 tnum">{week.length}</span>
                      </div>
                      <div className="divide-y divide-line">{week.map(row)}</div>
                    </>
                  )}
                  {later.length > 0 && (
                    <>
                      {week.length > 0 && (
                        <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-bg/92 px-4 py-1.5 text-[11.5px] font-medium text-muted backdrop-blur-xs">
                          之后 <span className="text-subtle tnum">{later.length}</span>
                        </div>
                      )}
                      <div className="divide-y divide-line">{later.map(row)}</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid h-full min-h-[160px] place-items-center px-4 text-[13px] text-muted">
                  未来 45 天没有要到期的资产
                </div>
              )}
            </div>
          </section>

          <OverviewCardReserves onSelect={onSelect} onNav={onNav} className="@4xl:h-[420px]" />
        </div>

        {/* Row 4: Perfectly Equal-Height Paired Row (关注 | 探针 Komari) */}
        <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
          {/* Starred Card */}
          <section className="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden @4xl:h-[300px]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
              <div className="flex items-center gap-2">
                <Star size={14} strokeWidth={2} className="text-muted" />
                <h2 className="text-[14px] font-semibold">关注</h2>
                <span className="text-xs text-subtle tnum">{starred.length} 项</span>
              </div>
              <button
                type="button"
                onClick={() => onNav("/assets?type=starred")}
                className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                全部<ArrowUpRight size={13} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
              {starred.length ? (
                <div className="divide-y divide-line">
                  {starred.map((a) => (
                    <StarredRow key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} onClick={() => onSelect(a.id)} />
                  ))}
                </div>
              ) : (
                <div className="grid h-full min-h-[140px] place-items-center px-4 text-[13px] text-muted">
                  还没有关注的资产，可在资产列表点星标添加
                </div>
              )}
            </div>
          </section>

          {/* Komari Probe Card */}
          <section className="surface-card flex min-h-0 min-w-0 flex-col overflow-hidden @4xl:h-[300px]">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
              <div className="flex items-center gap-2">
                <Server size={14} strokeWidth={2} className="text-t-server" />
                <h2 className="text-[14px] font-semibold">探针</h2>
                <KomariBadge />
                <span className="text-xs text-subtle tnum">
                  {servers.length ? `${online}/${servers.length} 在线` : komari?.url ? "未绑定" : "未连接"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNav(servers.length ? "/servers" : "/settings/komari")}
                className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                {servers.length ? "监控面板" : "去配置"}<ArrowUpRight size={13} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
              {servers.length ? (
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
                          <span className="flex w-24 shrink-0 items-center gap-2 @max-sm:hidden" title={`流量 ${pct}%`}>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-field">
                              <span className={clsx("block h-full rounded-full", pct >= 90 ? "bg-crit" : pct >= 75 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-8 text-right text-[11px] text-muted tnum">{pct}%</span>
                          </span>
                        )}
                        {!on && <span className="shrink-0 text-xs text-subtle">离线</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid h-full min-h-[140px] place-items-center px-4 text-[13px] text-muted">
                  <button type="button" onClick={() => onNav("/settings/komari")} className="cursor-pointer underline decoration-line underline-offset-4 hover:text-ink">
                    {komari?.url ? "去绑定 Komari 节点" : "去连接 Komari 探针"}
                  </button>
                </div>
              )}
            </div>

            {komari?.url && servers.length > 0 && (
              <a
                href={komari.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 shrink-0 items-center justify-between border-t border-line bg-bg/40 px-4 text-xs text-muted transition-colors hover:bg-field/60 hover:text-ink"
              >
                <span className="truncate font-mono">{komari.url.replace(/^https?:\/\//, "")}</span>
                <ArrowUpRight size={13} className="shrink-0" />
              </a>
            )}
          </section>
        </div>
      </div>
    </main>
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
    <button onClick={onClick} className="flex min-h-[58px] w-full cursor-pointer items-center gap-3.5 px-4 py-2.5 text-left transition-colors hover:bg-field/60">
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
