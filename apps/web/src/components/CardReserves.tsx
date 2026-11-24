import {
  CARD_RESERVE_WINDOWS,
  CARD_STATUS_LABEL,
  computeCardReserves,
  money,
  type Asset,
  type CardReserveSummary,
  type CardReserveWindow,
} from "@fangcun/core";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, CreditCard, Link2, Plus, ShieldAlert, Sparkles, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { dateLabel, getToday, md, ymd } from "../lib/fmt";
import { useData } from "../lib/store";
import { Button, Card, Field, Modal, Pill, SegmentedControl, Select, TextInput, TypeIcon } from "./ui";

const WIN_KEY = "fc-card-reserve-window";
const MANUAL_KEY = "fc-card-reserve-manual";
const CURRENCIES = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY", "SGD"];

function loadWindow(): CardReserveWindow {
  const n = Number(localStorage.getItem(WIN_KEY));
  return (CARD_RESERVE_WINDOWS as readonly number[]).includes(n) ? (n as CardReserveWindow) : 30;
}
function loadIncludeManual(): boolean {
  const raw = localStorage.getItem(MANUAL_KEY);
  return raw === null ? true : raw === "1";
}

export function fmtCurMap(m: Record<string, number>, fallback = "—"): string {
  const entries = Object.entries(m).filter(([, v]) => v > 0);
  if (!entries.length) return fallback;
  return entries.map(([c, v]) => money(Math.round(v * 100) / 100, c, { free: false })).join(" + ");
}

export function CardReservesView({ onSelect, onAddCard }: { onSelect: (id: string) => void; onAddCard?: () => void }) {
  const { assets, settings, update, toast } = useData();
  const [windowDays, setWindowDaysState] = useState<CardReserveWindow>(loadWindow);
  const [includeManual, setIncludeManualState] = useState<boolean>(loadIncludeManual);
  const [editingCard, setEditingCard] = useState<CardReserveSummary | null>(null);
  const [bindingId, setBindingId] = useState<string | null>(null);

  const setWindowDays = (w: CardReserveWindow) => {
    localStorage.setItem(WIN_KEY, String(w));
    setWindowDaysState(w);
  };
  const setIncludeManual = (v: boolean) => {
    localStorage.setItem(MANUAL_KEY, v ? "1" : "0");
    setIncludeManualState(v);
  };

  const today = getToday();
  const disp = settings.display;
  const report = useMemo(
    () => computeCardReserves(assets, today, disp, { windowDays, includeManual }),
    [assets, today, disp, windowDays, includeManual],
  );

  const activeCards = useMemo(
    () => assets.filter((a) => !a.deletedAt && a.type === "payment" && a.payment?.status !== "closed"),
    [assets],
  );

  const bindAssetToCard = async (assetId: string, cardId: string) => {
    const asset = assets.find((a) => a.id === assetId);
    const card = assets.find((c) => c.id === cardId);
    if (!asset || !card) return;
    setBindingId(assetId);
    try {
      const nextRelated = [...new Set([...asset.related, cardId])];
      await update(asset.id, { related: nextRelated });
      toast(`已将「${asset.name}」绑定到「${card.name}」`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBindingId(null);
    }
  };

  const hasShortfall = report.cardsNeedingTopUp > 0 || report.cardsAtRisk > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            size="sm"
            value={windowDays}
            onChange={setWindowDays}
            options={CARD_RESERVE_WINDOWS.map((w) => ({ value: w, label: `${w} 天` }))}
          />
          <SegmentedControl
            size="sm"
            value={includeManual ? "all" : "auto"}
            onChange={(v) => setIncludeManual(v === "all")}
            options={[
              { value: "all", label: "全部待付" },
              { value: "auto", label: "仅自动扣费" },
            ]}
          />
        </div>
        {onAddCard && (
          <Button icon={<Plus size={14} />} onClick={onAddCard}>添加支付卡</Button>
        )}
      </div>

      {/* Top KPI Summary Strip */}
      <div className="surface-card grid grid-cols-1 divide-y divide-line overflow-hidden @xl:grid-cols-2 @xl:divide-y @4xl:grid-cols-4 @4xl:divide-x @4xl:divide-y-0">
        <SummaryKpi
          label={`未来 ${windowDays} 天卡片待扣`}
          value={fmtCurMap(report.totalByCurrency, money(0, disp.currency, { free: false }))}
          foot={
            report.totalDisplay.total > 0 && report.totalDisplay.approx
              ? `折合约 ${money(Math.round(report.totalDisplay.total * 100) / 100, disp.currency, { free: false })} · ${report.cards.length} 张在用卡`
              : `${report.cards.length} 张在用支付卡`
          }
        />
        <SummaryKpi
          label="其中自动扣费必留"
          value={fmtCurMap(report.totalAutoByCurrency, money(0, disp.currency, { free: false }))}
          foot={
            report.totalAutoDisplay.total > 0
              ? `到期将自动扣款，避免余额不足失败`
              : `未来 ${windowDays} 天无自动扣费`
          }
        />
        <SummaryKpi
          label="当前余额缺口"
          tone={hasShortfall ? "crit" : report.cards.some((c) => c.balance !== null) ? "ok" : "neutral"}
          value={
            report.totalShortfallDisplay.total > 0
              ? money(Math.round(report.totalShortfallDisplay.total * 100) / 100, disp.currency, { free: false })
              : report.cardsAtRisk > 0
                ? `${report.cardsAtRisk} 张风险`
                : report.cards.some((c) => c.balance !== null)
                  ? "余额充足"
                  : "未记录余额"
          }
          foot={
            report.cardsNeedingTopUp > 0
              ? `${report.cardsNeedingTopUp} 张卡需要充值${report.cardsAtRisk ? ` · ${report.cardsAtRisk} 张有卡状态风险` : ""}`
              : report.cardsToPrepare > 0
                ? `${report.cardsToPrepare} 张卡尚未填写当前余额`
                : "已记录余额的卡片均可覆盖"
          }
        />
        <SummaryKpi
          label="未绑卡即将扣费"
          tone={report.unassignedCharges.length > 0 ? "warn" : "neutral"}
          value={report.unassignedCharges.length > 0 ? fmtCurMap(report.unassignedByCurrency) : "无"}
          foot={
            report.unassignedCharges.length > 0
              ? `${report.unassignedCharges.length} 项未关联付款卡，下方可一键绑定`
              : "所有即将扣费项目均已关联卡片"
          }
        />
      </div>

      {/* Payment Cards Grid */}
      {!report.cards.length ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-t-payment-soft text-t-payment">
              <CreditCard size={22} />
            </span>
            <p className="text-[14px] font-semibold">还没有添加支付卡</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted">
              添加你的 U 卡、虚拟卡或银行卡（仅保存末四位），并关联用这张卡扣费的订阅和服务器，方寸会自动提醒你每张卡里需要留多少钱。
            </p>
            {onAddCard && (
              <Button variant="primary" icon={<Plus size={14} />} className="mt-4" onClick={onAddCard}>添加第一张支付卡</Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          {report.cards.map((summary) => (
            <ReserveCardTile
              key={summary.card.id}
              summary={summary}
              onSelect={onSelect}
              onEditBalance={() => setEditingCard(summary)}
            />
          ))}
        </div>
      )}

      {/* Unassigned Upcoming Charges */}
      {report.unassignedCharges.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-warn" />
              未绑定付款卡的即将扣费
            </span>
          }
          extra={
            <span className="tnum">
              {report.unassignedCharges.length} 项 · 合计 {fmtCurMap(report.unassignedByCurrency)}
            </span>
          }
          flush
        >
          <div className="max-h-[340px] overflow-y-auto border-t border-line [scrollbar-width:thin]">
            {report.unassignedCharges.map((ch) => (
              <div
                key={ch.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 text-[13px] last:border-0 hover:bg-field/40"
              >
                <span className={clsx("w-12 shrink-0 text-xs tnum", ch.days <= 7 ? "font-semibold text-crit" : ch.days <= 14 ? "font-semibold text-warn" : "text-muted")} title={ymd(ch.date)}>
                  {md(ch.date)}
                </span>
                <TypeIcon type={ch.assetType} size="sm" tinted />
                <button
                  type="button"
                  onClick={() => onSelect(ch.assetId)}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:underline"
                >
                  {ch.assetName}
                  {ch.workspaceName && <span className="ml-1.5 text-xs font-normal text-subtle">· {ch.workspaceName}</span>}
                </button>
                <span className={clsx("rounded-[5px] px-1.5 py-0.5 text-[11px]", ch.autoRenew ? "bg-warn-soft text-warn font-medium" : "bg-field text-muted")}>
                  {ch.autoRenew ? "自动扣费" : "手动续费"}
                </span>
                <span className="w-20 shrink-0 text-right font-semibold tnum">
                  {money(ch.amount, ch.currency, { free: false })}
                </span>
                {activeCards.length > 0 && (
                  <div className="relative w-44 shrink-0">
                    <select
                      aria-label={`为「${ch.assetName}」选择付款卡`}
                      disabled={bindingId === ch.assetId}
                      value=""
                      onChange={(e) => e.target.value && bindAssetToCard(ch.assetId, e.target.value)}
                      className="h-7 w-full cursor-pointer appearance-none rounded-[7px] border border-line bg-panel pr-7 pl-2.5 text-xs text-ink outline-none transition-colors hover:bg-field focus:border-ink/40 disabled:opacity-50"
                    >
                      <option value="">＋ 绑定付款卡…</option>
                      {activeCards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ···· {c.payment?.last4}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editingCard && (
        <BalanceModal
          card={editingCard.card}
          summary={editingCard}
          onClose={() => setEditingCard(null)}
        />
      )}
    </div>
  );
}

/** One full card tile in the Card Reserve Center. */
function ReserveCardTile({
  summary,
  onSelect,
  onEditBalance,
}: {
  summary: CardReserveSummary;
  onSelect: (id: string) => void;
  onEditBalance: () => void;
}) {
  const { card, balance, balanceCurrency, reserveBuffer, recommendedKeep, shortfall, billShortfall, projectedRemaining, timeline, status, windowDays } = summary;
  const p = card.payment!;
  const billsInCard = summary.selectedInCardCurrency.total;

  // Progress bar ratio: how much of recommendedKeep is covered by current balance
  const ratio = balance !== null && recommendedKeep > 0 ? Math.min(100, Math.round((balance / recommendedKeep) * 100)) : null;
  const billMarkerPct = recommendedKeep > 0 && reserveBuffer > 0 ? Math.min(100, Math.round((billsInCard / recommendedKeep) * 100)) : null;

  const badge = (() => {
    if (status === "card-risk") return <Pill tone="crit" dot>{summary.isFrozenWithCharges ? "卡片已冻结" : "扣费前到期"}</Pill>;
    if (status === "shortfall") return <Pill tone="crit" dot>还差 {money(shortfall!, balanceCurrency, { free: false })}</Pill>;
    if (status === "prepare") return <Pill tone="warn" dot>需留 {fmtCurMap(summary.selectedByCurrency)}</Pill>;
    if (status === "ok") return <Pill tone="good" dot>余额充足</Pill>;
    return <Pill tone="none">近期无扣费</Pill>;
  })();

  return (
    <section
      className={clsx(
        "surface-card flex flex-col overflow-hidden transition-shadow",
        status === "card-risk" || (billShortfall !== null && billShortfall > 0)
          ? "ring-1 ring-crit/25"
          : status === "shortfall"
            ? "ring-1 ring-warn/30"
            : "",
      )}
    >
      {/* Card Header (subtle card-face identity) */}
      <div className="flex items-start gap-3 border-b border-line bg-bg/55 px-4 py-3.5">
        <TypeIcon type="payment" size="md" tinted />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(card.id)}
              className="cursor-pointer truncate text-[15px] font-bold tracking-tight hover:underline"
            >
              {card.name}
            </button>
            <span className="shrink-0 font-mono text-xs text-muted">···· {p.last4}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-subtle">
            <span>{p.issuer}</span>
            {p.network && <><span>·</span><span>{p.network}</span></>}
            {p.cardExpiry && <><span>·</span><span className="font-mono">{p.cardExpiry.replace("-", "/")}</span></>}
            {p.status !== "active" && <><span>·</span><span className="font-medium text-crit">{CARD_STATUS_LABEL[p.status]}</span></>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
        </div>
      </div>

      {/* Metrics & Coverage Body */}
      <div className="flex flex-col gap-3.5 px-4 py-3.5">
        <div className="grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <div className="text-[11.5px] text-muted">{windowDays} 天建议留存</div>
            <div className="mt-1 truncate text-[19px] font-bold tracking-tight tnum">
              {recommendedKeep > 0 ? money(recommendedKeep, balanceCurrency, { free: false }) : fmtCurMap(summary.selectedByCurrency, money(0, balanceCurrency, { free: false }))}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-subtle tnum">
              {summary.charges.length ? `待扣 ${money(billsInCard, balanceCurrency, { free: false })}` : "无待扣账单"}
              {reserveBuffer > 0 ? ` + 底线 ${money(reserveBuffer, balanceCurrency, { free: false })}` : ""}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[11.5px] text-muted">
              <span>当前余额</span>
            </div>
            <div className={clsx("mt-1 truncate text-[19px] font-bold tracking-tight tnum", balance === null && "text-subtle")}>
              {balance !== null ? money(balance, balanceCurrency, { free: false }) : "未记录"}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-subtle">
              {summary.balanceUpdatedAt ? `${dateLabel(summary.balanceUpdatedAt)} 更新` : "点击右侧记录余额"}
            </div>
          </div>

          <div className="min-w-0 text-right">
            <div className="text-[11.5px] text-muted">
              {shortfall !== null && shortfall > 0 ? "建议充值" : "扣完预计余"}
            </div>
            <div
              className={clsx(
                "mt-1 truncate text-[19px] font-bold tracking-tight tnum",
                shortfall !== null && shortfall > 0
                  ? billShortfall && billShortfall > 0
                    ? "text-crit"
                    : "text-warn"
                  : projectedRemaining !== null
                    ? "text-ok"
                    : "text-subtle",
              )}
            >
              {shortfall !== null && shortfall > 0
                ? money(shortfall, balanceCurrency, { free: false })
                : projectedRemaining !== null
                  ? money(projectedRemaining, balanceCurrency, { free: false })
                  : "—"}
            </div>
            <div className="mt-0.5">
              <button
                type="button"
                onClick={onEditBalance}
                className="cursor-pointer text-[11.5px] font-medium text-ink underline decoration-line underline-offset-3 transition-colors hover:decoration-ink"
              >
                {balance !== null ? "更新余额" : "记录余额"}
              </button>
            </div>
          </div>
        </div>

        {/* Coverage Bar */}
        {ratio !== null && (
          <div>
            <div className="relative h-2 overflow-hidden rounded-full bg-field">
              <div
                className={clsx(
                  "h-full rounded-full transition-all duration-300",
                  billShortfall && billShortfall > 0 ? "bg-crit" : shortfall && shortfall > 0 ? "bg-warn" : "bg-ok",
                )}
                style={{ width: `${ratio}%` }}
              />
              {billMarkerPct !== null && billMarkerPct > 0 && billMarkerPct < 100 && (
                <span
                  className="absolute top-0 bottom-0 w-0.5 bg-panel"
                  style={{ left: `${billMarkerPct}%` }}
                  title={`账单扣费线：${money(billsInCard, balanceCurrency, { free: false })}`}
                />
              )}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-subtle tnum">
              <span>余额覆盖 {ratio}%</span>
              {summary.selectedInCardCurrency.approx && <span>多币种按设置汇率估算</span>}
            </div>
          </div>
        )}

        {/* Risk / Shortfall Alert Banner */}
        {(summary.isFrozenWithCharges || summary.expiresBeforeCharge) && (
          <div className="flex items-start gap-2 rounded-sm bg-crit-soft px-3 py-2 text-xs leading-relaxed text-crit">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              {summary.isFrozenWithCharges && "卡片当前处于冻结状态，但未来仍有待扣项目，解冻或更换付款卡前可能会扣费失败。"}
              {summary.expiresBeforeCharge && `卡片有效期至 ${card.expiresAt}，早于部分即将到来的扣费日，请提前换卡。`}
            </span>
          </div>
        )}
        {!summary.isFrozenWithCharges && !summary.expiresBeforeCharge && summary.firstShortfallCharge && (
          <div
            className={clsx(
              "flex items-start gap-2 rounded-sm px-3 py-2 text-xs leading-relaxed",
              summary.firstShortfallCharge.insufficient ? "bg-crit-soft text-crit" : "bg-warn-soft text-warn",
            )}
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {summary.firstShortfallCharge.insufficient ? (
                <>
                  按当前余额，将在 <b>{md(summary.firstShortfallCharge.date)}</b>「{summary.firstShortfallCharge.assetName}」扣费时余额不足（预计差{" "}
                  <b className="tnum">{money(Math.abs(summary.firstShortfallCharge.runningBalance ?? 0), balanceCurrency, { free: false })}</b>）。
                </>
              ) : (
                <>
                  扣完 <b>{md(summary.firstShortfallCharge.date)}</b>「{summary.firstShortfallCharge.assetName}」后，余额将低于设定的安全底线{" "}
                  <b className="tnum">{money(reserveBuffer, balanceCurrency, { free: false })}</b>。
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Deduction Schedule Timeline */}
      <div className="mt-auto border-t border-line bg-bg/30">
        {timeline.length > 0 ? (
          <div className="max-h-[240px] divide-y divide-line overflow-y-auto [scrollbar-width:thin]">
            {timeline.map((item) => (
              <div key={item.key} className="flex h-10 items-center gap-2.5 px-4 text-[12.5px] hover:bg-field/50">
                <span
                  className={clsx(
                    "w-10 shrink-0 text-xs tnum",
                    item.overdue || item.days <= 7 ? "font-semibold text-crit" : item.days <= 14 ? "font-semibold text-warn" : "text-muted",
                  )}
                  title={ymd(item.date)}
                >
                  {md(item.date)}
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(item.assetId)}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:underline"
                >
                  {item.assetName}
                  {item.workspaceName && <span className="ml-1 font-normal text-subtle">· {item.workspaceName}</span>}
                </button>
                <span
                  className={clsx(
                    "shrink-0 rounded-[4px] px-1.5 py-px text-[10.5px]",
                    item.isCardFee
                      ? "bg-t-payment-soft text-t-payment"
                      : item.autoRenew
                        ? "bg-field font-medium text-ink"
                        : "bg-field text-muted",
                  )}
                >
                  {item.isCardFee ? "卡费" : item.autoRenew ? "自动" : "手动"}
                </span>
                <span className="w-16 shrink-0 text-right font-semibold tnum">
                  -{money(item.amount, item.currency, { free: false })}
                </span>
                {item.runningBalance !== null && (
                  <span
                    className={clsx(
                      "w-18 shrink-0 text-right text-[11.5px] tnum max-sm:hidden",
                      item.insufficient ? "font-semibold text-crit" : item.belowBuffer ? "font-medium text-warn" : "text-subtle",
                    )}
                    title="该笔扣费后的预计卡内余额"
                  >
                    余 {money(item.runningBalance, balanceCurrency, { free: false })}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-10 items-center justify-between px-4 text-xs text-subtle">
            <span>未来 {windowDays} 天内无待扣项目</span>
            <span>共关联 {summary.linkedAssets.length} 项资产</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** Detail-page Card Reserve widget shown inside AssetDetail when asset.type === "payment". */
export function CardReserveDetailCard({ card, onSelect }: { card: Asset; onSelect: (id: string) => void }) {
  const { assets, settings } = useData();
  const [windowDays, setWindowDays] = useState<CardReserveWindow>(30);
  const [includeManual, setIncludeManual] = useState(true);
  const [editing, setEditing] = useState(false);

  const report = useMemo(
    () => computeCardReserves(assets, getToday(), settings.display, { windowDays, includeManual }),
    [assets, settings.display, windowDays, includeManual],
  );
  const summary = report.cards.find((c) => c.card.id === card.id);
  if (!summary) return null;

  const { balance, balanceCurrency, reserveBuffer, recommendedKeep, shortfall, billShortfall, projectedRemaining, timeline } = summary;
  const billsInCard = summary.selectedInCardCurrency.total;

  return (
    <>
      <Card
        title={
          <span className="flex items-center gap-2">
            <Wallet size={15} className="text-t-payment" />
            卡片预留与扣费推演
          </span>
        }
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              value={windowDays}
              onChange={setWindowDays}
              options={[
                { value: 14 as CardReserveWindow, label: "14 天" },
                { value: 30 as CardReserveWindow, label: "30 天" },
                { value: 60 as CardReserveWindow, label: "60 天" },
              ]}
            />
            <Button className="h-7 px-2.5 text-xs" onClick={() => setEditing(true)}>
              {balance !== null ? "更新余额" : "记录余额"}
            </Button>
          </div>
        }
        flush
      >
        {/* Top Metrics */}
        <div className="grid grid-cols-1 divide-y divide-line border-t border-line @lg:grid-cols-3 @lg:divide-x @lg:divide-y-0">
          <div className="px-4 py-3">
            <div className="text-xs text-muted">{windowDays} 天建议留存</div>
            <div className="mt-1 text-[21px] font-bold tracking-tight tnum">
              {recommendedKeep > 0 ? money(recommendedKeep, balanceCurrency, { free: false }) : money(0, balanceCurrency, { free: false })}
            </div>
            <div className="mt-0.5 text-xs text-subtle tnum">
              待扣 {money(billsInCard, balanceCurrency, { free: false })}
              {reserveBuffer > 0 ? ` + 底线 ${money(reserveBuffer, balanceCurrency, { free: false })}` : ""}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted">当前卡内余额</div>
            <div className={clsx("mt-1 text-[21px] font-bold tracking-tight tnum", balance === null && "text-subtle")}>
              {balance !== null ? money(balance, balanceCurrency, { free: false }) : "未记录"}
            </div>
            <div className="mt-0.5 text-xs text-subtle">
              {summary.balanceUpdatedAt ? `${ymd(summary.balanceUpdatedAt)} 记录` : "记下余额可自动算缺口"}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-muted">{shortfall && shortfall > 0 ? "建议至少充值" : "扣完预计剩余"}</div>
            <div
              className={clsx(
                "mt-1 text-[21px] font-bold tracking-tight tnum",
                shortfall && shortfall > 0
                  ? billShortfall && billShortfall > 0
                    ? "text-crit"
                    : "text-warn"
                  : projectedRemaining !== null
                    ? "text-ok"
                    : "text-subtle",
              )}
            >
              {shortfall && shortfall > 0
                ? money(shortfall, balanceCurrency, { free: false })
                : projectedRemaining !== null
                  ? money(projectedRemaining, balanceCurrency, { free: false })
                  : "—"}
            </div>
            <div className="mt-0.5 text-xs text-subtle">
              <button
                type="button"
                onClick={() => setIncludeManual((v) => !v)}
                className="cursor-pointer underline decoration-line underline-offset-2 hover:text-ink"
              >
                当前：{includeManual ? "含手动续费" : "仅自动扣费"}（点此切换）
              </button>
            </div>
          </div>
        </div>

        {/* Alert */}
        {summary.firstShortfallCharge && (
          <div
            className={clsx(
              "flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs",
              summary.firstShortfallCharge.insufficient ? "bg-crit-soft text-crit" : "bg-warn-soft text-warn",
            )}
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              {summary.firstShortfallCharge.insufficient
                ? `余额预计可撑到 ${md(summary.firstShortfallCharge.date)}，在「${summary.firstShortfallCharge.assetName}」扣费时将差 ${money(Math.abs(summary.firstShortfallCharge.runningBalance ?? 0), balanceCurrency, { free: false })}。`
                : `在 ${md(summary.firstShortfallCharge.date)}「${summary.firstShortfallCharge.assetName}」扣费后，余额将低于安全底线 ${money(reserveBuffer, balanceCurrency, { free: false })}。`}
            </span>
          </div>
        )}

        {/* Timeline */}
        <div className="max-h-[320px] overflow-y-auto border-t border-line [scrollbar-width:thin]">
          {timeline.length > 0 ? (
            timeline.map((item) => (
              <div key={item.key} className="flex h-11 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0 hover:bg-field/45">
                <span className={clsx("w-12 shrink-0 text-xs tnum", item.days <= 7 ? "font-semibold text-crit" : item.days <= 14 ? "font-semibold text-warn" : "text-muted")}>
                  {md(item.date)}
                </span>
                <button type="button" onClick={() => onSelect(item.assetId)} className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:underline">
                  {item.assetName}
                  {item.workspaceName && <span className="ml-1.5 text-xs font-normal text-subtle">· {item.workspaceName}</span>}
                </button>
                <span className={clsx("shrink-0 rounded-[5px] px-1.5 py-0.5 text-[11px]", item.autoRenew ? "bg-field font-medium text-ink" : "bg-field text-muted")}>
                  {item.isCardFee ? "卡片费用" : item.autoRenew ? "自动扣费" : "手动续费"}
                </span>
                <span className="w-20 shrink-0 text-right font-semibold tnum">
                  -{money(item.amount, item.currency, { free: false })}
                </span>
                {item.runningBalance !== null && (
                  <span
                    className={clsx(
                      "w-22 shrink-0 text-right text-xs tnum max-sm:hidden",
                      item.insufficient ? "font-semibold text-crit" : item.belowBuffer ? "font-medium text-warn" : "text-muted",
                    )}
                  >
                    余 {money(item.runningBalance, balanceCurrency, { free: false })}
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="px-4 py-4 text-[13px] text-subtle">
              未来 {windowDays} 天没有关联到这张卡的待扣费用。
            </p>
          )}
        </div>
      </Card>
      {editing && <BalanceModal card={card} summary={summary} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Compact Card Reserve Reminder widget for Overview. */
export function OverviewCardReserves({
  onSelect,
  onNav,
}: {
  onSelect: (id: string) => void;
  onNav: (path: string) => void;
}) {
  const { assets, settings } = useData();
  const [editing, setEditing] = useState<CardReserveSummary | null>(null);
  const report = useMemo(
    () => computeCardReserves(assets, getToday(), settings.display, { windowDays: 30, includeManual: true }),
    [assets, settings.display],
  );

  if (!report.cards.length && !report.unassignedCharges.length) return null;

  return (
    <>
      <section className="surface-card overflow-hidden">
        <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="text-t-payment" />
            <h3 className="text-[13.5px] font-semibold">卡片预留提醒</h3>
            <span className="text-xs text-subtle">未来 30 天</span>
          </div>
          <button
            type="button"
            onClick={() => onNav("/costs/cards")}
            className="flex cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            详情<ArrowUpRight size={13} />
          </button>
        </header>

        <div className="max-h-[220px] divide-y divide-line overflow-y-auto [scrollbar-width:thin]">
          {report.cards.map((c) => {
            const p = c.card.payment!;
            const needLabel = c.recommendedKeep > 0 ? money(c.recommendedKeep, c.balanceCurrency, { free: false }) : fmtCurMap(c.selectedByCurrency, "无待扣");
            return (
              <div key={c.card.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-field/45">
                <button type="button" onClick={() => onSelect(c.card.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{c.card.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-subtle">···· {p.last4}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted tnum">
                    <span>需留 {needLabel}</span>
                    {c.balance !== null && <span>· 余 {money(c.balance, c.balanceCurrency, { free: false })}</span>}
                    {c.nextCharge && (
                      <span className="truncate text-subtle">· 下笔 {md(c.nextCharge.date)} {c.nextCharge.assetName}</span>
                    )}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.status === "card-risk" ? (
                    <Pill tone="crit" dot>{c.isFrozenWithCharges ? "已冻结" : "将过期"}</Pill>
                  ) : c.status === "shortfall" ? (
                    <button type="button" onClick={() => setEditing(c)} className="cursor-pointer" title="点击更新余额">
                      <Pill tone="crit" dot>补 {money(c.shortfall!, c.balanceCurrency, { free: false })}</Pill>
                    </button>
                  ) : c.status === "prepare" ? (
                    <button type="button" onClick={() => setEditing(c)} className="cursor-pointer" title="点击记录卡内余额">
                      <Pill tone="warn">留 {needLabel}</Pill>
                    </button>
                  ) : c.status === "ok" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                      <CheckCircle2 size={13} />充足
                    </span>
                  ) : (
                    <span className="text-xs text-subtle">无待扣</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {report.unassignedCharges.length > 0 && (
          <button
            type="button"
            onClick={() => onNav("/costs/cards")}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-line bg-warn-soft/50 px-4 py-2.5 text-left text-xs text-warn transition-colors hover:bg-warn-soft"
          >
            <Link2 size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              另有 <b>{report.unassignedCharges.length}</b> 项（{fmtCurMap(report.unassignedByCurrency)}）未绑定付款卡
            </span>
            <span className="shrink-0 font-medium">去绑定</span>
          </button>
        )}
      </section>
      {editing && <BalanceModal card={editing.card} summary={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Quick Modal for updating card balance & safety buffer without opening full AssetForm. */
export function BalanceModal({
  card,
  summary,
  onClose,
}: {
  card: Asset;
  summary: CardReserveSummary;
  onClose: () => void;
}) {
  const { update, toast } = useData();
  const p = card.payment!;
  const [balance, setBalance] = useState(p.balance != null ? String(p.balance) : "");
  const [currency, setCurrency] = useState(p.balanceCurrency || card.currency || "USD");
  const [buffer, setBuffer] = useState(p.reserveBuffer != null ? String(p.reserveBuffer) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const balVal = balance.trim() === "" ? null : Number(balance);
      const bufVal = buffer.trim() === "" ? null : Number(buffer);
      if (balVal !== null && (!Number.isFinite(balVal) || balVal < 0)) {
        toast("余额请输入非负数字", "err");
        setBusy(false);
        return;
      }
      if (bufVal !== null && (!Number.isFinite(bufVal) || bufVal < 0)) {
        toast("安全底线请输入非负数字", "err");
        setBusy(false);
        return;
      }
      await update(card.id, {
        payment: {
          ...p,
          balance: balVal,
          balanceCurrency: currency,
          balanceUpdatedAt: balVal !== null ? getToday() : null,
          reserveBuffer: bufVal,
        },
      });
      toast(`已更新「${card.name}」的余额与预留设置`);
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  };

  const quickTopUp = () => {
    if (!summary.shortfall || summary.shortfall <= 0) return;
    const next = Math.ceil(((summary.balance ?? 0) + summary.shortfall) * 100) / 100;
    setBalance(String(next));
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Wallet size={16} className="text-t-payment" />
          更新余额 · {card.name}
          <span className="font-mono text-xs font-normal text-subtle">···· {p.last4}</span>
        </span>
      }
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save} disabled={busy}>保存</Button>
        </>
      }
    >
      <div className="mb-4 rounded-sm bg-field px-3.5 py-2.5 text-xs leading-relaxed text-muted">
        <div className="flex items-center justify-between">
          <span>未来 {summary.windowDays} 天待扣合计</span>
          <span className="font-semibold text-ink tnum">{money(summary.selectedInCardCurrency.total, summary.balanceCurrency, { free: false })}</span>
        </div>
        {summary.shortfall !== null && summary.shortfall > 0 && (
          <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-crit">
            <span>当前建议至少充值</span>
            <button
              type="button"
              onClick={quickTopUp}
              className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] bg-crit-soft px-2 py-0.5 font-semibold hover:brightness-95"
            >
              <Sparkles size={11} />填入已补足金额（{money((summary.balance ?? 0) + summary.shortfall, summary.balanceCurrency, { free: false })}）
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1.4fr_0.9fr] gap-3">
        <Field label="当前卡内余额" hint="留空表示不记录">
          <TextInput value={balance} onChange={setBalance} inputMode="decimal" placeholder="如 150" autoFocus />
        </Field>
        <Field label="余额币种">
          <Select value={currency} onChange={setCurrency} options={[...new Set([...CURRENCIES, currency])].map((c) => [c, c] as [string, string])} />
        </Field>
        <Field label="最低安全底线 / 额外预留" hint={`按 ${currency} 计，扣完账单后希望至少剩余`} className="col-span-2">
          <TextInput value={buffer} onChange={setBuffer} inputMode="decimal" placeholder="如 50（可选，0 或留空表示不设）" />
        </Field>
      </div>
    </Modal>
  );
}

function SummaryKpi({
  label,
  value,
  foot,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  foot: string;
  tone?: "neutral" | "crit" | "warn" | "ok";
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-xs whitespace-nowrap text-muted">{label}</div>
      <div
        className={clsx(
          "mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[22px] leading-tight font-bold tracking-tight tnum",
          tone === "crit" && "text-crit",
          tone === "warn" && "text-warn",
          tone === "ok" && "text-ok",
        )}
      >
        {typeof value === "string"
          ? value.split(" + ").map((part, i, all) => (
              <span key={i} className="whitespace-nowrap">
                {part}
                {i < all.length - 1 && <span className="ml-2 font-normal text-subtle">+</span>}
              </span>
            ))
          : value}
      </div>
      <div className="mt-1 truncate text-xs text-subtle">{foot}</div>
    </div>
  );
}
