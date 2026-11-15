import { CARD_STATUS_LABEL, formatKomariValue, monthsHeld, nextExpiry, paidSoFar, yearlyCost } from "@fangcun/core";
import clsx from "clsx";
import { Check, ChevronLeft, Download, ExternalLink, FileUp, Globe, Lock, Pencil, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import type { Asset } from "../data/types";
import { api } from "../lib/api";
import { cycleLabel, daysUntil, dueLabel, getToday, money, urgency, ymd } from "../lib/fmt";
import { useData } from "../lib/store";
import { AtollDomainCard, AtollImpact, AtollProjectsCard } from "./Atoll";
import { CloudflareDomainCard, CloudflareServerCard } from "./Cloudflare";
import { NodeStatusCard } from "./NodeStatus";
import { QuotaCard } from "./Quota";
import { TeamCard } from "./Team";
import { Button, Card, Empty, Field, KomariBadge, Modal, Pill, TextInput, TypeIcon, urgencyText } from "./ui";

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
  const { assets, status, restoreField } = useData();
  const [renewing, setRenewing] = useState(false);
  const today = getToday();
  const u = urgency(a);
  const d = daysUntil(a.expiresAt);
  const months = monthsHeld(a.purchasedAt, today);
  const ov = a.komari?.overridden ?? {};
  const account = a.type === "account" ? a : assets.find((x) => x.id === a.accountId && x.type === "account");
  const related = a.related.map((id) => assets.find((x) => x.id === id)).filter(Boolean) as Asset[];
  const backlinks = assets.filter((x) => x.id !== a.id && !a.related.includes(x.id) && (x.related.includes(a.id) || x.accountId === a.id));
  const links = [...related, ...backlinks];
  const rows = detailRows(a);
  const hasSide = Boolean(a.note || links.length);
  const isAccount = a.type === "account";
  const stat = a.komari ? status[a.komari.uuid] : undefined;

  return (
    <main className={clsx("flex min-w-0 flex-1 flex-col", className)}>
      <div className="@container flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1080px] flex-col gap-4 px-7 py-6 max-md:px-4 max-md:py-4">
          {onBack && <button onClick={onBack} className="-mb-1 flex w-fit items-center gap-1 text-[13px] text-muted hover:text-ink lg:hidden"><ChevronLeft size={16} />资产</button>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <TypeIcon type={a.type} size="lg" />
            <div className="min-w-0 flex-1 basis-[220px]">
              <h1 className={clsx("truncate text-[22px] font-bold tracking-tight", a.type === "server" && "font-mono text-[23px]")}>{a.name}</h1>
              <p className="mt-0.5 truncate text-[13px] text-muted">{[a.subtitle, a.provider].filter(Boolean).join(" · ")}{a.tags.length > 0 && <span className="text-subtle"> · {a.tags.map((t) => `#${t}`).join("  ")}</span>}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {d <= 30 && <AtollImpact asset={a} />}
              {d <= 30 && <Pill tone={u} dot>{d < 0 ? dueLabel(a) : `${dueLabel(a)}后到期`}</Pill>}
              {a.payment && a.payment.status !== "active" && <Pill tone="none">{CARD_STATUS_LABEL[a.payment.status]}</Pill>}
              <Button icon={<Pencil size={14} />} onClick={onEdit}>编辑</Button>
              {!isAccount && a.cycle !== "once" && <Button variant="primary" icon={<Check size={15} />} onClick={() => setRenewing(true)}>标记已续费</Button>}
            </div>
          </div>

          {!isAccount && (
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              <Stat label={a.type === "payment" ? "卡片有效期" : "下次续费"}
                value={<span className={urgencyText[u]}>{a.expiresAt ? (d > 300 ? ymd(a.expiresAt) : ymd(a.expiresAt).slice(5)) : "—"}</span>}
                foot={a.expiresAt ? `${d < 0 ? `已过期 ${-d} 天` : `还有 ${d} 天`}${a.autoRenew ? " · 自动续费" : ""}` : "长期有效"}
                synced={Boolean(a.komari?.fields && "expiresAt" in a.komari.fields)}
                override={ov.expiresAt && { text: formatKomariValue("expiresAt", ov.expiresAt.komari), changed: ov.expiresAt.changed, onRestore: () => restoreField(a.id, "expiresAt") }} />
              <Stat label="费用" value={<>{money(a.price, a.currency)}{a.price > 0 && <span className="text-[15px] font-medium text-subtle">/{cycleLabel[a.cycle]}</span>}</>}
                foot={[a.region, a.discount].filter(Boolean).join(" · ") || (a.price ? (a.cycle === "once" ? "一次性" : `一年约 ${money(yearlyCost(a), a.currency)}`) : "无需付费")}
                synced={Boolean(a.komari?.fields && "price" in a.komari.fields)}
                override={ov.price && { text: formatKomariValue("price", ov.price.komari, a.currency), changed: ov.price.changed, onRestore: () => restoreField(a.id, "price") }} />
              <Stat label="已用" value={a.purchasedAt ? `${months} 个月` : "—"} foot={a.purchasedAt ? `${ymd(a.purchasedAt)} 购入${a.price ? ` · 累计约 ${money(paidSoFar(a, today), a.currency)}` : ""}` : "没填购入日期"} />
            </div>
          )}

          {a.komari && <NodeStatusCard asset={a} status={stat} />}
          {a.type === "server" && <AtollProjectsCard asset={a} onSelect={onSelect} />}
          {a.type === "server" && <CloudflareServerCard asset={a} onSelect={onSelect} />}
          {a.type === "domain" && <CloudflareDomainCard asset={a} onSelect={onSelect} />}
          {a.type === "domain" && <AtollDomainCard asset={a} onSelect={onSelect} />}
          {a.team && <TeamCard team={a.team} />}
          {a.quota && <QuotaCard quota={a.quota} />}

          {/* paired rows: cards side by side always share one height; overflow scrolls inside */}
          <div className={clsx("grid gap-4", account && !isAccount && "@3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]", isAccount && "@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
            {isAccount ? <AccountCard account={a} /> : (
              <Card title="详细信息" extra={a.komari ? <><KomariBadge /> 标记的字段来自探针</> : undefined} flush scroll className="max-h-[360px]">
                {rows.length ? (
                  <div className="-mb-px grid @lg:grid-cols-2">
                    {rows.map((f, i) => (
                      <div key={f.label + i} className={clsx("flex h-11 min-w-0 items-center justify-between gap-3 border-b border-line px-4 text-[13px]",
                        i % 2 === 0 && "@lg:border-r")}>
                        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-subtle">{f.label}{f.synced && <span className="size-1 rounded-full bg-accent" />}</span>
                        <span className={clsx("truncate", f.mono && !f.value.includes("@") && "font-mono text-[12.5px]")} title={f.value}>{f.value}</span>
                      </div>
                    ))}
                  </div>
                ) : <Empty>还没有填写，点「编辑」补充 IP、配置、套餐等信息</Empty>}
              </Card>
            )}
            {account && !isAccount && <AccountCard account={account} compact onOpen={() => onSelect(account.id)} />}
            {isAccount && <LinkCard title="使用这个账号的资产" links={links} onSelect={onSelect} />}
          </div>

          {!isAccount && (
            <div className={clsx("grid gap-4", hasSide && "@3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]")}>
              <Card title="续费记录" extra={`${a.renewals.length} 次`} flush scroll className="max-h-[320px]">
                {a.renewals.length ? a.renewals.map((r, i) => (
                  <div key={r.date + i} className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-4 text-[13px] last:border-0">
                    <span className="w-24 shrink-0 whitespace-nowrap text-subtle tnum">{ymd(r.date)}</span>
                    <span className="flex-1 truncate text-muted">{r.note}{r.to ? <span className="text-subtle"> · 到期改为 {ymd(r.to)}</span> : null}</span>
                    <span className="shrink-0 font-medium whitespace-nowrap tnum">{money(r.amount, r.currency ?? a.currency)}</span>
                  </div>
                )) : <Empty>还没有记录。点「标记已续费」会推进到期日并记一条。</Empty>}
              </Card>
              {hasSide && (
                <div className="flex min-h-0 flex-col gap-4 @3xl:max-h-[320px] @3xl:[&>*:last-child]:flex-1">
                  {a.note && <Card title="备注" scroll className="shrink-0 max-h-[50%]"><p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{a.note}</p></Card>}
                  {links.length > 0 && <LinkCard title={a.type === "payment" ? "用这张卡付款" : "关联"} links={links} onSelect={onSelect} />}
                </div>
              )}
            </div>
          )}
          {isAccount && a.note && <Card title="备注"><p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{a.note}</p></Card>}

          {(a.type === "document" || (a.attachments?.length ?? 0) > 0) && <Attachments a={a} />}
        </div>
      </div>
      {renewing && <RenewDialog a={a} onClose={() => setRenewing(false)} />}
    </main>
  );
}

function LinkCard({ title, links, onSelect }: { title: string; links: Asset[]; onSelect: (id: string) => void }) {
  return (
    <Card title={title} extra={links.length} flush scroll className="min-h-0">
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
      )) : <Empty>合同、发票、证书文件可以放这里，会随完整备份一起导出。</Empty>}
    </Card>
  );
}
