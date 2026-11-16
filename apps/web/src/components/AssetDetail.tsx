import { addCycle, CARD_STATUS_LABEL, formatKomariValue, monthsHeld, nextExpiry, paidSoFar, yearlyCost } from "@fangcun/core";
import clsx from "clsx";
import { Check, ChevronLeft, Download, ExternalLink, FileUp, Globe, Lock, Pencil, Pin, PinOff, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "../data/types";
import { api } from "../lib/api";
import { cycleLabel, dateLabel, daysUntil, dueLabel, perCycle, remindDays, renewOpen, renewOpensAt, getToday, money, urgency, ymd } from "../lib/fmt";
import { useData } from "../lib/store";
import { AtollDomainCard, AtollImpact, AtollProjectsCard } from "./Atoll";
import { CloudflareDomainCard, CloudflareServerCard } from "./Cloudflare";
import { NodeStatusCard } from "./NodeStatus";
import { QuotaCard } from "./Quota";
import { TeamCard } from "./Team";
import { Button, Card, Empty, Field, KomariBadge, Modal, MoreMenu, Pill, StarButton, TextInput, TypeIcon, urgencyText } from "./ui";

export type Mode = "web" | "desktop";

/** Rows shown in 详细信息: type-specific structured fields first, then free-form details. */
function detailRows(a: Asset): { label: string; value: string; mono?: boolean; synced?: boolean }[] {
  const rows: { label: string; value: string; mono?: boolean; synced?: boolean }[] = [];
  if (a.payment) {
    const p = a.payment;
    rows.push(
      { label: "发卡平台", value: p.issuer }, { label: "卡组织", value: p.network ?? "—" },
      { label: "卡号", value: `···· ${p.last4}`, mono: true }, { label: "有效期", value: p.cardExpiry ? p.cardExpiry.replace("-", "/") : "—", mono: true },
      { label: "状态", value: CARD_STATUS_LABEL[p.status] }, { label: "账单地区", value: p.billingRegion ?? "—" },
      ...(p.fees ? [{ label: "手续费", value: p.fees }] : []),
    );
  }
  if (a.phone) {
    const ph = a.phone;
    rows.push({ label: "号码", value: ph.number, mono: true }, { label: "运营商", value: ph.carrier ?? "—" }, { label: "国家", value: ph.country ?? "—" }, { label: "用途", value: ph.purpose ?? "—" });
  }
  if (a.region) rows.push({ label: "区域", value: a.region });
  if (a.discount) rows.push({ label: "折扣", value: a.discount });
  const synced = new Set(Object.keys(a.komari?.fields ?? {}).filter((k) => k.startsWith("detail:")).map((k) => k.slice(7)));
  for (const d of a.details) rows.push({ ...d, synced: synced.has(d.label) && !a.komari?.overridden?.[`detail:${d.label}`] });
  return rows;
}

export function AssetDetail({ asset: a, onSelect, onEdit, onBack, className }: { asset: Asset; mode?: Mode; onSelect: (id: string) => void; onEdit: () => void; onBack?: () => void; className?: string }) {
  const { assets, status, restoreField, setFocus } = useData();
  const [renewing, setRenewing] = useState(false);
  const today = getToday();
  const u = urgency(a);
  const d = daysUntil(a.expiresAt);
  const rd = remindDays(a);
  const opensAt = renewOpensAt(a);
  const months = monthsHeld(a.purchasedAt, today);
  const ov = a.komari?.overridden ?? {};
  const account = a.type === "account" ? a : assets.find((x) => x.id === a.accountId && x.type === "account");
  const related = a.related.map((id) => assets.find((x) => x.id === id)).filter(Boolean) as Asset[];
  const backlinks = assets.filter((x) => x.id !== a.id && !a.related.includes(x.id) && (x.related.includes(a.id) || x.accountId === a.id));
  const links = [...related, ...backlinks];
  const rows = detailRows(a);
  // shared height of the 续费记录 | 备注 row: fits its content, between 220 and 320px
  const rowH = Math.min(320, Math.max(220, 44 + Math.max(1, a.renewals.length) * 44 + 8, 44 + 112 + 16 + (links.length ? 16 + 44 + links.length * 48 : 0)));
  const isAccount = a.type === "account";
  const stat = a.komari ? status[a.komari.uuid] : undefined;
  // servers keep the wide dashboard; every other type reads as one centred column
  const narrow = a.type !== "server";

  return (
    <main className={clsx("flex min-w-0 flex-1 flex-col", className)}>
      <div className="@container flex-1 overflow-y-auto">
        <div className={clsx("page flex flex-col", narrow ? "@container max-w-[840px] gap-5" : "gap-4")}>
          {onBack && <button onClick={onBack} className="-mb-1 flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink lg:hidden"><ChevronLeft size={16} />资产</button>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TypeIcon type={a.type} size="lg" />
            <div className={clsx("min-w-0 flex-1", narrow && (rd <= 30 || a.name.length > 14) ? "basis-[calc(100%-72px)]" : "basis-[220px]")}>
              <div className="flex min-w-0 items-center gap-1.5">
                <h1 className={clsx("truncate text-[22px] font-bold tracking-tight", a.type === "server" && "font-mono text-[23px]")}>{a.name}</h1>
                <StarButton on={a.starred} name={a.name} onToggle={() => setFocus(a.id, { starred: !a.starred })} size={17} className="size-8" />
                {a.pinned && <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[6px] bg-field px-1.5 text-[11.5px] whitespace-nowrap text-muted"><Pin size={11} strokeWidth={2} />置顶</span>}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted">{[a.subtitle, a.provider].filter(Boolean).join(" · ")}{a.tags.length > 0 && <span className="text-subtle"> · {a.tags.map((t) => `#${t}`).join("  ")}</span>}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {rd <= 30 && <AtollImpact asset={a} />}
              {rd <= 30 && <Pill tone={u} dot>{d < 0 || renewOpen(a) ? dueLabel(a) : opensAt ? `${dueLabel(a)}后可续期` : `${dueLabel(a)}后到期`}</Pill>}
              {a.payment && a.payment.status !== "active" && <Pill tone="none">{CARD_STATUS_LABEL[a.payment.status]}</Pill>}
              <Button icon={<Pencil size={14} />} onClick={onEdit}>编辑</Button>
              {!isAccount && a.cycle !== "once" && <Button variant="primary" icon={<Check size={15} />} onClick={() => setRenewing(true)}>标记已续费</Button>}
              <MoreMenu items={[a.pinned
                ? { label: "取消置顶", icon: <PinOff size={14} />, onSelect: () => setFocus(a.id, { pinned: false }) }
                : { label: "置顶", icon: <Pin size={14} />, onSelect: () => setFocus(a.id, { pinned: true }) }]} />
            </div>
          </div>

          {!isAccount && (
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              <Stat label={a.type === "payment" ? "卡片有效期" : "下次续费"}
                value={<span className={urgencyText[u]}>{a.expiresAt ? dateLabel(a.expiresAt) : "—"}</span>}
                foot={a.expiresAt ? `${d < 0 ? `已过期 ${-d} 天` : `还有 ${d} 天`}${a.autoRenew ? " · 自动续费" : ""}${opensAt && d >= 0 ? (renewOpen(a) ? " · 已可续期" : ` · ${dateLabel(opensAt)}起可续期`) : ""}` : "长期有效"}
                synced={Boolean(a.komari?.fields && "expiresAt" in a.komari.fields)}
                override={ov.expiresAt && { text: formatKomariValue("expiresAt", ov.expiresAt.komari), changed: ov.expiresAt.changed, onRestore: () => restoreField(a.id, "expiresAt") }} />
              <Stat label="费用" value={<>{money(a.price, a.currency)}{a.price > 0 && <span className="text-[15px] font-medium text-subtle">/{cycleLabel[a.cycle]}</span>}</>}
                foot={[a.region, a.discount].filter(Boolean).join(" · ") || (a.price ? (a.cycle === "once" ? "一次性" : `一年约 ${money(yearlyCost(a), a.currency)}`) : "无需付费")}
                synced={Boolean(a.komari?.fields && "price" in a.komari.fields)}
                override={ov.price && { text: formatKomariValue("price", ov.price.komari, a.currency), changed: ov.price.changed, onRestore: () => restoreField(a.id, "price") }} />
              {a.purchasedAt
                ? <Stat label="已用" value={`${months} 个月`} foot={`${ymd(a.purchasedAt)} 购入${a.price ? ` · 累计约 ${money(paidSoFar(a, today), a.currency)}` : ""}`} />
                : paidTotal(a)
                  ? <Stat label="累计续费" value={paidTotal(a)} foot={`${a.renewals.length} 次记录 · 最近 ${ymd(a.renewals[0].date)}`} />
                  : <Stat label="续费方式" value={a.autoRenew ? "自动续费" : a.price ? "手动续费" : a.renewWindowDays ? "手动续期" : "免费"}
                      foot={a.autoRenew ? "到期自动扣费，留意卡片余额" : a.renewWindowDays ? `到期前 ${a.renewWindowDays} 天可续期` : a.price ? "到期前记得手动续费" : "无需付费"} />}
            </div>
          )}

          {a.komari && <NodeStatusCard asset={a} status={stat} />}
          {a.type === "server" && <AtollProjectsCard asset={a} onSelect={onSelect} />}
          {a.type === "server" && <CloudflareServerCard asset={a} onSelect={onSelect} />}
          {a.type === "domain" && <CloudflareDomainCard asset={a} onSelect={onSelect} />}
          {a.type === "domain" && <AtollDomainCard asset={a} onSelect={onSelect} />}
          {a.team && <TeamCard asset={a} />}
          <QuotaCard asset={a} />

          {narrow ? <>
            {!isAccount && <Timeline a={a} />}
            {isAccount ? <AccountCard account={a} /> : rows.length > 0 && (
              <Card title="详细信息" flush>
                <div className="-mb-px grid @lg:grid-cols-2">
                  {rows.map((f, i) => {
                    const lastOdd = rows.length % 2 === 1 && i === rows.length - 1;
                    return (
                      <div key={f.label + i} className={clsx("flex h-11 min-w-0 items-center justify-between gap-3 border-b border-line px-4 text-[13px]",
                        lastOdd ? "@lg:col-span-2" : i % 2 === 0 && "@lg:border-r")}>
                        <span className="shrink-0 whitespace-nowrap text-muted">{f.label}</span>
                        <span className={clsx("truncate", f.mono && !f.value.includes("@") && "font-mono text-[12.5px]")} title={f.value}>{f.value}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
            {account && !isAccount && <AccountCard account={account} compact onOpen={() => onSelect(account.id)} />}
            {(links.length > 0 || isAccount) && <LinkCard title={isAccount ? "使用这个账号的资产" : a.type === "payment" ? "用这张卡付款" : "关联资产"} links={links} onSelect={onSelect} />}
            <NoteCard a={a} />
          </> : <>
          {/* paired rows: cards side by side always share one height; overflow scrolls inside */}
          <div className={clsx("grid gap-4", account && !isAccount && "@3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]", isAccount && "@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
            {isAccount ? <AccountCard account={a} /> : (
              <Card title="详细信息" extra={a.komari ? <><KomariBadge /> 标记的字段来自探针</> : undefined} flush scroll className="max-h-[360px]">
                {rows.length ? (
                  <div className="-mb-px grid @lg:grid-cols-2">
                    {rows.map((f, i) => {
                      // an odd last field spans both columns, so no cell ends with half a divider
                      const lastOdd = rows.length % 2 === 1 && i === rows.length - 1;
                      return (
                      <div key={f.label + i} className={clsx("flex h-11 min-w-0 items-center justify-between gap-3 border-b border-line px-4 text-[13px]",
                        lastOdd ? "@lg:col-span-2" : i % 2 === 0 && "@lg:border-r")}>
                        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-subtle">{f.label}{f.synced && <span className="size-1 rounded-full bg-accent" />}</span>
                        <span className={clsx("truncate", f.mono && !f.value.includes("@") && "font-mono text-[12.5px]")} title={f.value}>{f.value}</span>
                      </div>
                      );
                    })}
                  </div>
                ) : <Empty>还没有填写，点「编辑」补充{DETAIL_HINT[a.type]}等信息</Empty>}
                {rows.length > 0 && rows.length < 4 && <p className="px-4 pt-3 pb-4 text-xs leading-relaxed text-subtle">只填了 {rows.length} 项。可以点「编辑」补充{DETAIL_HINT[a.type]}等信息。</p>}
              </Card>
            )}
            {account && !isAccount && <AccountCard account={account} compact onOpen={() => onSelect(account.id)} />}
            {isAccount && <LinkCard title="使用这个账号的资产" links={links} onSelect={onSelect} />}
          </div>

          {!isAccount && (
            // 续费记录 | 备注 + 关联: one row, both columns share its height; the note's textarea fills what is left
            <div className="grid gap-4 @3xl:h-[var(--row-h)] @3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" style={{ "--row-h": `${rowH}px` } as React.CSSProperties}>
              <Card title="续费记录" extra={`${a.renewals.length} 次`} flush scroll className="max-h-[320px] @3xl:max-h-none">
                {a.renewals.length ? a.renewals.map((r, i) => (
                  <div key={r.date + i} className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-4 text-[13px] last:border-0">
                    <span className="w-24 shrink-0 whitespace-nowrap text-subtle tnum">{ymd(r.date)}</span>
                    <span className="flex-1 truncate text-muted">{r.note}{r.to ? <span className="text-subtle"> · 到期改为 {ymd(r.to)}</span> : null}</span>
                    <span className="shrink-0 font-medium whitespace-nowrap tnum">{money(r.amount, r.currency ?? a.currency)}</span>
                  </div>
                )) : <Empty>还没有续费记录</Empty>}
              </Card>
              <div className="flex min-h-0 flex-col gap-4">
                <NoteCard a={a} className="flex-1" />
                {links.length > 0 && <LinkCard title={a.type === "payment" ? "用这张卡付款" : "关联"} links={links} onSelect={onSelect} className="max-h-[calc(100%-172px)] shrink-0" />}
              </div>
            </div>
          )}
          {isAccount && <NoteCard a={a} />}
          </>}

          {(a.type === "document" || (a.attachments?.length ?? 0) > 0) && <Attachments a={a} />}
        </div>
      </div>
      {renewing && <RenewDialog a={a} onClose={() => setRenewing(false)} />}
    </main>
  );
}

const DETAIL_HINT: Record<Asset["type"], string> = {
  server: " IP、配置、系统", domain: " DNS、注册人、实名、转移锁", cert: "域名、签发者、部署位置", subscription: "套餐、席位、付款方式",
  mail: "席位、域名、套餐", phone: "运营商、用途", payment: "卡组织、账单地区", account: "网站、用途", document: "编号、签署日期",
};

/** Sum of recorded renewals when they share one currency; empty string otherwise. */
function paidTotal(a: Asset): string {
  if (!a.renewals.length) return "";
  const cur = a.renewals[0].currency ?? a.currency;
  if (a.renewals.some((r) => (r.currency ?? a.currency) !== cur)) return `${a.renewals.length} 次`;
  return money(Math.round(a.renewals.reduce((s, r) => s + r.amount, 0) * 100) / 100, cur);
}

/** 备注: always present, edited in place, saved when the field loses focus. Fills its card; at least ~4 lines. */
function NoteCard({ a, className }: { a: Asset; className?: string }) {
  const { update, toast } = useData();
  const [v, setV] = useState(a.note ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => { setV(a.note ?? ""); setState("idle"); }, [a.id, a.note]);
  const save = async () => {
    if (v.trim() === (a.note ?? "").trim()) return;
    setState("saving");
    try { await update(a.id, { note: v }); setState("saved"); } catch (e) { toast((e as Error).message, "err"); setState("idle"); }
  };
  return (
    <Card title="备注" extra={state === "saving" ? "保存中…" : state === "saved" ? "已保存" : "离开输入框自动保存"} fill className={clsx("min-h-0", className)}>
      <textarea value={v} onChange={(e) => { setV(e.target.value); setState("idle"); }} onBlur={save} aria-label={`「${a.name}」的备注`}
        placeholder="记点什么：用途、续费方式、转移码放在哪…"
        className="block min-h-[96px] w-full flex-1 resize-none rounded-sm border border-transparent bg-field px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-subtle focus:border-ink/30" />
    </Card>
  );
}

function LinkCard({ title, links, onSelect, className }: { title: string; links: Asset[]; onSelect: (id: string) => void; className?: string }) {
  return (
    <Card title={title} extra={links.length} flush scroll className={clsx("min-h-0", className)}>
      {links.length ? links.map((r) => (
        <button key={r.id} onClick={() => onSelect(r.id)} className="flex h-12 w-full shrink-0 items-center gap-3 border-b border-line px-4 text-left last:border-0 hover:bg-field/60">
          <TypeIcon type={r.type} size="sm" />
          <span className="flex-1 truncate text-[13px] font-medium">{r.name}</span>
          <span className={clsx("shrink-0 text-xs whitespace-nowrap tnum", urgencyText[urgency(r)])}>{dueLabel(r)}</span>
        </button>
      )) : <Empty>暂无</Empty>}
    </Card>
  );
}

function Stat({ label, value, foot, override, synced }: { label: string; value: React.ReactNode; foot?: string; synced?: boolean; override?: { text: string; changed?: boolean; onRestore: () => void } | undefined }) {
  return (
    <div className="rounded-md border border-line bg-panel px-4 pt-3.5 pb-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">{label}{synced && !override && <span className="size-1 rounded-full bg-accent" title="来自 Komari" />}</div>
      <div className="mt-1.5 truncate text-[24px] font-bold tracking-tight whitespace-nowrap tnum @4xl:text-[26px]">{value}</div>
      {override ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          <span className="shrink-0 rounded-[5px] bg-warn-soft px-1.5 py-px font-medium whitespace-nowrap text-warn">已手动修改</span>
          <span className="truncate text-subtle">Komari{override.changed ? " 已变为" : ""}: {override.text}</span>
          <button onClick={override.onRestore} title="恢复为 Komari 的值" className="ml-auto grid size-5 place-items-center rounded text-subtle hover:bg-field hover:text-ink"><Undo2 size={13} /></button>
        </div>
      ) : (
        <div className="mt-1 truncate text-xs text-subtle tnum">{foot}</div>
      )}
    </div>
  );
}

function AccountCard({ account, compact, onOpen }: { account: Asset; compact?: boolean; onOpen?: () => void }) {
  const info = account.account;
  return (
    <Card title="登录账号" extra={compact && onOpen ? <button onClick={onOpen} className="hover:text-ink">{account.name}</button> : undefined} scroll className="max-h-[360px]">
      <div className="flex flex-col gap-2 text-[13px]">
        <Row label="账号" value={info?.username || "—"} />
        <div className="flex items-center gap-2 rounded-sm bg-field px-3 py-2">
          <span className="w-8 shrink-0 text-xs whitespace-nowrap text-subtle">密码</span>
          <span className="min-w-0 flex-1 text-xs text-subtle">网页版不保存密码</span>
          <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-subtle" title="端到端加密的密码保险库在 v0.2 提供"><Lock size={12} />v0.2 保险库</span>
        </div>
        {info?.hasTotp && <div className="flex items-center gap-2 rounded-sm bg-field px-3 py-2">
          <span className="w-8 shrink-0 text-xs text-subtle">2FA</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">这个账号开了两步验证</span>
        </div>}
      </div>
      {(info?.websites?.length ?? 0) > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-subtle">相关网站</div>
          {info!.websites!.map((w) => (
            <a key={w.url} href={/^https?:/.test(w.url) ? w.url : `https://${w.url}`} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-2 text-[13px] hover:underline">
              <Globe size={13} className="shrink-0 text-subtle" />
              <span className="w-10 shrink-0 text-muted">{w.label}</span>
              <span className="flex-1 truncate text-accent">{w.url}</span>
              <ExternalLink size={13} className="text-subtle" />
            </a>
          ))}
        </div>
      )}
      {!compact ? null : account.note && <p className="mt-3 rounded-sm bg-field px-3 py-2 text-xs leading-relaxed text-muted">{account.note}</p>}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm bg-field px-3 py-2">
      <span className="w-8 shrink-0 text-xs text-subtle">{label}</span>
      <span className="flex-1 truncate text-[13px]">{value}</span>
      <button onClick={() => navigator.clipboard?.writeText(value)} className="text-xs text-subtle hover:text-ink">复制</button>
    </div>
  );
}

function RenewDialog({ a, onClose }: { a: Asset; onClose: () => void }) {
  const { renew, toast } = useData();
  const [amount, setAmount] = useState(String(a.team ? a.team.workspaces.filter((w) => w.expiresAt === a.expiresAt).reduce((s, w) => s + w.price, 0) : a.price));
  const [note, setNote] = useState(a.autoRenew ? "自动扣费" : "手动续费");
  const [busy, setBusy] = useState(false);
  const next = a.team ? null : nextExpiry(a, getToday());
  const submit = async () => {
    setBusy(true);
    try { await renew(a.id, { amount: Number(amount) || 0, note }); onClose(); }
    catch (e) { toast((e as Error).message, "err"); setBusy(false); }
  };
  return (
    <Modal title={`标记已续费 · ${a.name}`} onClose={onClose} width={440}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={submit} disabled={busy}>确认续费</Button></>}>
      <div className="mb-4 flex items-center justify-between rounded-sm bg-field px-4 py-3 text-[13px]">
        <span className="text-muted">到期日</span>
        <span className="tnum">{a.expiresAt ? ymd(a.expiresAt) : "—"} <span className="text-subtle">→</span> <b>{a.team ? "最早到期的工作空间顺延一个周期" : next ? ymd(next) : "—"}</b></span>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <Field label="实付金额" hint={a.currency}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
        <Field label="备注"><TextInput value={note} onChange={setNote} /></Field>
      </div>
    </Modal>
  );
}

function Attachments({ a }: { a: Asset }) {
  const { demo, reload, toast } = useData();
  const input = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    try {
      await api("POST", `/api/assets/${encodeURIComponent(a.id)}/attachments?name=${encodeURIComponent(f.name)}`, f, { contentType: f.type || "application/octet-stream" });
      await reload();
      toast(`已上传 ${f.name}`);
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const remove = async (name: string) => {
    if (!confirm(`删除附件 ${name}？`)) return;
    await api("DELETE", `/api/assets/${encodeURIComponent(a.id)}/attachments/${encodeURIComponent(name)}`).catch((e) => toast(e.message, "err"));
    await reload();
  };
  return (
    <Card title="附件" extra={!demo && <Button variant="ghost" className="h-7 px-2 text-xs" icon={<FileUp size={13} />} onClick={() => input.current?.click()}>上传</Button>} flush>
      <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {a.attachments?.length ? a.attachments.map((f) => (
        <div key={f.name} className="flex h-11 items-center gap-3 border-b border-line px-4 text-[13px] last:border-0">
          <span className="flex-1 truncate">{f.name}</span>
          <span className="text-xs text-subtle tnum">{(f.size / 1024).toFixed(f.size > 102400 ? 0 : 1)} KB · {f.addedAt.slice(0, 10)}</span>
          <a href={`/api/assets/${encodeURIComponent(a.id)}/attachments/${encodeURIComponent(f.name)}`} className="text-subtle hover:text-ink" title="下载"><Download size={14} /></a>
          <button onClick={() => remove(f.name)} className="text-subtle hover:text-crit" title="删除"><Trash2 size={14} /></button>
        </div>
      )) : <Empty>还没有附件</Empty>}
    </Card>
  );
}

type Ev = { date: string; kind: "buy" | "renew" | "open" | "today" | "due" | "next"; title: string; meta?: string; amount?: string };
const EV_ORDER: Record<Ev["kind"], number> = { buy: 0, renew: 1, open: 2, today: 3, due: 4, next: 5 };

/** 时间线: purchase → recorded renewals → today → renewal window opening → next due, oldest first. */
function Timeline({ a }: { a: Asset }) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [a.id]);
  const today = getToday();
  const d = daysUntil(a.expiresAt);
  const opensAt = renewOpensAt(a);
  const card = a.type === "payment";
  const renewals: Ev[] = a.renewals.map((r) => ({
    date: r.date.slice(0, 10), kind: "renew", title: r.note || "续费",
    meta: r.to ? `到期改为 ${ymd(r.to)}` : undefined, amount: money(r.amount, r.currency ?? a.currency),
  }));
  const LIMIT = 5;
  const sortedRenewals = [...renewals].sort((x, y) => x.date.localeCompare(y.date));
  const hidden = all ? 0 : Math.max(0, sortedRenewals.length - LIMIT);
  const ev: Ev[] = [...sortedRenewals.slice(hidden)];
  if (a.purchasedAt) ev.push({ date: a.purchasedAt.slice(0, 10), kind: "buy", title: card ? "开卡" : "购入", meta: !card && a.price > 0 ? perCycle(a) : undefined });
  ev.push({ date: today, kind: "today", title: "今天", meta: !a.expiresAt ? "长期有效" : d < 0 ? `已过期 ${-d} 天` : d === 0 ? "今天到期" : `还有 ${d} 天${card ? "卡片到期" : "到期"}` });
  if (opensAt && a.expiresAt && d >= 0) ev.push({ date: opensAt, kind: "open", title: opensAt <= today ? "已开放续期" : "开放续期", meta: `到期前 ${a.renewWindowDays} 天` });
  if (a.expiresAt) ev.push({
    date: a.expiresAt.slice(0, 10), kind: "due",
    title: card ? "卡片到期" : a.cycle === "once" ? "到期" : a.autoRenew ? "自动扣费" : "到期",
    meta: card ? "需换卡" : a.cycle === "once" || a.autoRenew ? undefined : a.price ? "需手动续费" : opensAt ? "需手动续期" : undefined,
    amount: !card && a.price > 0 && a.cycle !== "once" ? money(a.price, a.currency) : undefined,
  });
  const after = !card && a.expiresAt && a.cycle !== "once" ? addCycle(a.expiresAt.slice(0, 10), a.cycle) : null;
  if (after) ev.push({ date: after, kind: "next", title: "续费后到期" });
  ev.sort((x, y) => x.date.localeCompare(y.date) || EV_ORDER[x.kind] - EV_ORDER[y.kind]);
  const total = paidTotal(a);
  const u = urgency(a);
  return (
    <Card title="时间线" extra={a.renewals.length ? `续费 ${a.renewals.length} 次${total && !total.endsWith("次") ? ` · 累计 ${total}` : ""}` : undefined}>
      {hidden > 0 && (
        <button onClick={() => setAll(true)} className="mb-1 ml-[130px] text-xs text-muted hover:text-ink">更早的 {hidden} 次续费</button>
      )}
      <ol className="flex flex-col">
        {ev.map((e, i) => {
          const past = e.date < today && e.kind !== "today";
          const last = i === ev.length - 1;
          return (
            <li key={e.kind + e.date + i} className={clsx("flex gap-4 text-[13px]", !last && "min-h-12")}>
              <span className={clsx("w-[86px] shrink-0 pt-px text-right whitespace-nowrap tnum", e.kind === "today" ? "font-semibold text-ink" : "text-muted")}>{ymd(e.date)}</span>
              <span className="relative flex w-3 shrink-0 justify-center">
                {!last && <span className={clsx("absolute top-3 -bottom-0.5 w-px", ev[i + 1].kind === "next" ? "border-l border-dashed border-line" : "bg-line")} />}
                <span className={clsx("relative mt-[5px] size-2.5 rounded-full",
                  e.kind === "today" ? "bg-ink ring-4 ring-accent-soft"
                    : e.kind === "due" ? clsx("border-2 bg-panel", u === "crit" ? "border-crit" : u === "warn" ? "border-warn" : "border-muted")
                    : e.kind === "next" ? "border-[1.5px] border-muted bg-panel opacity-70"
                    : past ? "bg-muted" : "border-2 border-muted bg-panel")} />
              </span>
              <span className={clsx("min-w-0 flex-1", !last && "pb-3")}>
                <span className={clsx("block truncate", e.kind === "today" || e.kind === "due" ? "font-semibold" : e.kind === "next" ? "text-muted" : "font-medium", e.kind === "due" && urgencyText[u])}>{e.title}</span>
                {e.meta && <span className="block truncate text-xs text-muted">{e.meta}</span>}
              </span>
              {e.amount && <span className="shrink-0 pt-px font-medium whitespace-nowrap tnum">{e.amount}</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
