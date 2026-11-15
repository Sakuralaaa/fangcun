import { ASSET_TYPES, CARD_NETWORKS, CARD_STATUS, CARD_STATUS_LABEL, CYCLE_LABEL, CYCLES, TYPE_LABEL, type CardStatus, type Cycle, type Workspace } from "@fangcun/core";
import clsx from "clsx";
import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { useData } from "../lib/store";
import { Button, Field, Modal, Select, TextArea, TextInput, Toggle, TypeIcon, typeMeta } from "./ui";

const CURRENCIES = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY", "TRY", "INR", "SGD"];
const cycleOpts = CYCLES.map((c) => [c, c === "once" ? "一次性" : `每${CYCLE_LABEL[c]}`] as [Cycle, string]);

type Draft = Partial<Asset> & { type: AssetType; name: string };

const blank = (type: AssetType): Draft => ({
  type, name: "", price: 0, currency: "USD", cycle: type === "payment" ? "year" : type === "account" || type === "document" ? "once" : "month",
  autoRenew: false, tags: [], details: [], related: [], renewals: [],
  ...(type === "payment" ? { payment: { issuer: "", last4: "", status: "active" as CardStatus } } : {}),
  ...(type === "phone" ? { phone: { number: "" } } : {}),
  ...(type === "account" ? { account: { username: "", websites: [] } } : {}),
});

export function AssetForm({ asset, initialType, onClose, onSaved }: { asset?: Asset; initialType?: AssetType; onClose: () => void; onSaved: (id: string | null) => void }) {
  const { assets, create, update, remove, toast } = useData();
  const [d, setD] = useState<Draft>(() => (asset ? structuredClone(asset) : blank(initialType ?? "server")));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const isNew = !asset;
  const t = d.type;
  const priced = t !== "account" && t !== "document";
  const accounts = assets.filter((a) => a.type === "account" && a.id !== asset?.id);

  const save = async () => {
    setBusy(true);
    try {
      // 关注 / 置顶 are toggled from the star and the 更多 menu; the edit form never overwrites them
      const { starred: _s, pinned: _p, ...rest } = d as Draft & { starred?: boolean; pinned?: boolean };
      const body = isNew ? { ...d } : rest;
      if (body.type === "payment" && body.payment) body.payment = { ...body.payment, last4: (body.payment.last4 ?? "").replace(/\D/g, "") };
      const r = isNew ? await create(body) : await update(asset!.id, body);
      onSaved(r?.id ?? null);
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  };
  const del = async () => {
    if (!asset || !confirm(`把「${asset.name}」移到回收站？30 天内可以恢复。`)) return;
    try { await remove(asset.id); onSaved(null); onClose(); } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <Modal title={isNew ? "添加资产" : `编辑 · ${asset!.name}`} onClose={onClose} width={720}
      footer={<>
        {!isNew && <Button variant="danger" icon={<Trash2 size={14} />} onClick={del} className="mr-auto">删除</Button>}
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={save} disabled={busy || !d.name.trim()}>{isNew ? "添加" : "保存"}</Button>
      </>}>
      {isNew && (
        <div className="mb-4 grid grid-cols-9 gap-1.5">
          {ASSET_TYPES.map((x) => (
            <button key={x} onClick={() => setD((cur) => ({ ...blank(x), name: cur.name, tags: cur.tags, note: cur.note }))}
              className={clsx("flex flex-col items-center gap-1 rounded-sm border py-2 text-[11.5px]", t === x ? "border-ink bg-sel font-semibold" : "border-line text-muted hover:bg-field")}>
              <TypeIcon type={x} size="sm" />{typeMeta[x].label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="名称" className="col-span-1"><TextInput value={d.name} onChange={(v) => set("name", v)} autoFocus placeholder={placeholder[t]} mono={t === "server"} /></Field>
        <Field label="说明"><TextInput value={d.subtitle} onChange={(v) => set("subtitle", v)} placeholder="一句话说明用途" /></Field>
        {t !== "payment" && <Field label={t === "phone" ? "运营商 / 平台" : "服务商"}><TextInput value={t === "phone" ? d.phone?.carrier : d.provider} onChange={(v) => t === "phone" ? set("phone", { ...d.phone!, carrier: v }) : set("provider", v)} /></Field>}
        {t !== "account" && t !== "payment" && <Field label="购入日期"><TextInput type="date" value={d.purchasedAt} onChange={(v) => set("purchasedAt", v || null)} /></Field>}
      </div>

      {t === "payment" && <PaymentFields d={d} set={set} />}
      {t === "phone" && (
        <Section title="号码">
          <Field label="号码"><TextInput value={d.phone?.number} onChange={(v) => set("phone", { ...d.phone!, number: v })} mono placeholder="+1 555 010 2233" /></Field>
          <Field label="国家 / 地区"><TextInput value={d.phone?.country} onChange={(v) => set("phone", { ...d.phone!, country: v })} /></Field>
          <Field label="用途" className="col-span-2"><TextInput value={d.phone?.purpose} onChange={(v) => set("phone", { ...d.phone!, purpose: v })} placeholder="接码、银行预留…" /></Field>
        </Section>
      )}
      {t === "account" && <AccountFields d={d} set={set} />}

      {priced && (
        <Section title="费用与到期" hint="按实付手填，不做汇率换算">
          <div className="col-span-2 grid grid-cols-[1fr_0.8fr_1fr_1.2fr] gap-3">
            <Field label={t === "payment" ? "年费 / 月费" : "价格"}><TextInput value={String(d.price ?? 0)} onChange={(v) => set("price", Number(v) || 0)} inputMode="decimal" /></Field>
            <Field label="币种"><Select value={d.currency ?? "USD"} onChange={(v) => set("currency", v)} options={[...new Set([...CURRENCIES, d.currency ?? "USD"])].map((c) => [c, c] as [string, string])} /></Field>
            <Field label="周期"><Select value={d.cycle ?? "month"} onChange={(v) => set("cycle", v)} options={cycleOpts} /></Field>
            {t === "payment"
              ? <Field label="到期日" hint="跟随卡片有效期"><TextInput value={d.payment?.cardExpiry ? `${d.payment.cardExpiry} 月底` : "—"} onChange={() => {}} className="text-subtle" /></Field>
              : <Field label="到期日"><TextInput type="date" value={d.expiresAt} onChange={(v) => set("expiresAt", v || null)} /></Field>}
          </div>
          <Field label="区域" hint="如 土耳其区"><TextInput value={d.region} onChange={(v) => set("region", v)} /></Field>
          <Field label="折扣" hint="如 年付 8 折"><TextInput value={d.discount} onChange={(v) => set("discount", v)} /></Field>
          <label className="col-span-2 flex items-center gap-2.5 text-[13px]"><Toggle on={Boolean(d.autoRenew)} onChange={(v) => set("autoRenew", v)} />自动续费</label>
        </Section>
      )}

      {t === "subscription" && <TeamFields d={d} set={set} />}
      {t === "server" && (
        <Section title="Komari" hint="按 uuid 绑定后，价格、到期、配置、IP 会从探针同步">
          <Field label="节点 uuid"><TextInput value={d.komari?.uuid} mono onChange={(v) => set("komari", v ? { ...(d.komari ?? { fields: {}, overridden: {} }), uuid: v } : null)} placeholder="也可在 设置 → Komari 里一键绑定" /></Field>
          <Field label="流量重置日" hint="每月几号"><TextInput value={d.komari?.trafficResetDay ?? ""} inputMode="numeric" onChange={(v) => d.komari && set("komari", { ...d.komari, trafficResetDay: Number(v) || undefined })} /></Field>
        </Section>
      )}

      <Section title="详细信息" hint={t === "server" ? "IP、配置、系统…" : "任意键值"}>
        <DetailsEditor value={d.details ?? []} onChange={(v) => set("details", v)} />
      </Section>

      <Section title="标签与关联">
        <Field label="标签" hint="逗号分隔"><TextInput value={(d.tags ?? []).join(", ")} onChange={(v) => set("tags", v.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} /></Field>
        {t !== "account" ? (
          <Field label="登录账号"><Select value={d.accountId ?? ""} onChange={(v) => set("accountId", v || null)} options={[["", "不关联"], ...accounts.map((a) => [a.id, `${a.name}${a.account?.username ? ` · ${a.account.username}` : ""}`] as [string, string])]} /></Field>
        ) : <div />}
        <div className="col-span-2"><RelatedPicker value={d.related ?? []} self={asset?.id} onChange={(v) => set("related", v)} hint={t === "payment" ? "关联用这张卡付款的订阅、服务器…" : "关联的域名、证书、付款卡…"} /></div>
        <Field label="备注" className="col-span-2"><TextArea value={d.note} onChange={(v) => set("note", v)} /></Field>
      </Section>
    </Modal>
  );
}

const placeholder: Record<AssetType, string> = {
  server: "hk-api-01", domain: "example.com", cert: "api.example.com", subscription: "ChatGPT Plus", mail: "admin@example.com",
  phone: "美国号码", payment: "美元虚拟卡", account: "云服务商控制台", document: "租赁合同",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-1.5 text-[12.5px] font-semibold">{title}{hint && <span className="text-xs font-normal text-subtle">{hint}</span>}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

type SetFn = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

function PaymentFields({ d, set }: { d: Draft; set: SetFn }) {
  const p = d.payment ?? { issuer: "", last4: "", status: "active" as CardStatus };
  const up = (patch: Partial<typeof p>) => set("payment", { ...p, ...patch });
  return (
    <Section title="卡片" hint="只保存卡号末四位，绝不保存完整卡号和 CVV">
      <Field label="发卡平台"><TextInput value={p.issuer} onChange={(v) => { up({ issuer: v }); set("provider", v); }} placeholder="如 某数字银行 / U 卡平台" /></Field>
      <Field label="卡组织"><Select value={p.network ?? ""} onChange={(v) => up({ network: v || undefined })} options={[["", "未填"], ...CARD_NETWORKS.map((n) => [n, n] as [string, string])]} /></Field>
      <Field label="卡号末四位"><TextInput value={p.last4} onChange={(v) => up({ last4: v.replace(/\D/g, "").slice(0, 4) })} mono maxLength={4} inputMode="numeric" placeholder="4242" /></Field>
      <Field label="卡片有效期" hint="作为到期日提醒"><TextInput type="month" value={p.cardExpiry} onChange={(v) => up({ cardExpiry: v || undefined })} /></Field>
      <Field label="账单地区"><TextInput value={p.billingRegion} onChange={(v) => up({ billingRegion: v })} placeholder="美国 / 香港…" /></Field>
      <Field label="状态"><Select value={p.status} onChange={(v) => up({ status: v })} options={CARD_STATUS.map((s) => [s, CARD_STATUS_LABEL[s]] as [CardStatus, string])} /></Field>
      <Field label="开卡费 / 充值手续费" className="col-span-2"><TextInput value={p.fees} onChange={(v) => up({ fees: v })} placeholder="开卡 $10 · USDT 充值 1.5%" /></Field>
    </Section>
  );
}

function AccountFields({ d, set }: { d: Draft; set: SetFn }) {
  const a = d.account ?? { username: "" };
  const up = (patch: Partial<typeof a>) => set("account", { ...a, ...patch });
  return (
    <Section title="账号" hint="网页版不保存密码；端到端加密保险库在 v0.2">
      <Field label="用户名 / 邮箱"><TextInput value={a.username} onChange={(v) => up({ username: v })} /></Field>
      <Field label="登录地址"><TextInput value={a.site} onChange={(v) => up({ site: v })} mono /></Field>
      <Field label="相关网站" hint="每行：名称 网址" className="col-span-2">
        <TextArea rows={2} value={(a.websites ?? []).map((w) => `${w.label} ${w.url}`).join("\n")}
          onChange={(v) => up({ websites: v.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [label, ...u] = l.split(/\s+/); return u.length ? { label, url: u.join(" ") } : { label: "网站", url: label }; }) })} />
      </Field>
      <label className="col-span-2 flex items-center gap-2.5 text-[13px]"><Toggle on={Boolean(a.hasTotp)} onChange={(v) => up({ hasTotp: v })} />这个账号开了两步验证</label>
    </Section>
  );
}

function TeamFields({ d, set }: { d: Draft; set: SetFn }) {
  const team = d.team;
  const ws = team?.workspaces ?? [];
  const upWs = (i: number, patch: Partial<Workspace>) => set("team", { owner: team?.owner ?? "", workspaces: ws.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const add = () => set("team", { owner: team?.owner ?? "", workspaces: [...ws, { id: `ws_${Date.now().toString(36)}`, name: `空间 ${ws.length + 1}`, seats: 5, price: 0, currency: d.currency ?? "USD", cycle: d.cycle ?? "month", expiresAt: d.expiresAt ?? null, members: [] }] });
  return (
    <Section title="团队订阅" hint="母号 → 工作空间 → 成员；总价和到期由各空间汇总">
      {!team ? (
        <div className="col-span-2"><Button icon={<Plus size={14} />} onClick={() => set("team", { owner: "", workspaces: [] })}>这是团队订阅（有工作空间和成员）</Button></div>
      ) : (
        <>
          <Field label="母号（付款账号）"><TextInput value={team.owner} onChange={(v) => set("team", { ...team, owner: v })} /></Field>
          <div className="flex items-end justify-end gap-2"><Button icon={<Plus size={14} />} onClick={add}>添加工作空间</Button><Button variant="ghost" onClick={() => set("team", null)}>不是团队订阅</Button></div>
          {ws.map((w, i) => (
            <div key={w.id} className="col-span-2 rounded-sm border border-line p-3">
              <div className="grid grid-cols-[1.2fr_0.6fr_0.8fr_0.7fr_0.9fr_1fr_auto] gap-2">
                <Field label="空间名"><TextInput value={w.name} onChange={(v) => upWs(i, { name: v })} /></Field>
                <Field label="席位"><TextInput value={String(w.seats)} inputMode="numeric" onChange={(v) => upWs(i, { seats: Number(v) || 0 })} /></Field>
                <Field label="实付"><TextInput value={String(w.price)} inputMode="decimal" onChange={(v) => upWs(i, { price: Number(v) || 0 })} /></Field>
                <Field label="币种"><Select value={w.currency} onChange={(v) => upWs(i, { currency: v })} options={CURRENCIES.map((c) => [c, c] as [string, string])} /></Field>
                <Field label="周期"><Select value={w.cycle} onChange={(v) => upWs(i, { cycle: v })} options={cycleOpts} /></Field>
                <Field label="到期"><TextInput type="date" value={w.expiresAt} onChange={(v) => upWs(i, { expiresAt: v || null })} /></Field>
                <button onClick={() => set("team", { ...team, workspaces: ws.filter((_, j) => j !== i) })} className="mt-5 grid size-9 place-items-center text-subtle hover:text-crit"><X size={15} /></button>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_1fr_2fr] gap-2">
                <Field label="区域"><TextInput value={w.region} onChange={(v) => upWs(i, { region: v })} /></Field>
                <Field label="折扣"><TextInput value={w.discount} onChange={(v) => upWs(i, { discount: v })} /></Field>
                <Field label="成员邮箱" hint="每行一个，母号自动算一席">
                  <TextArea rows={2} value={w.members.filter((m) => m.role !== "owner").map((m) => m.email).join("\n")}
                    onChange={(v) => upWs(i, { members: [...(team.owner ? [{ email: team.owner, role: "owner" as const }] : []), ...v.split("\n").map((e) => e.trim()).filter(Boolean).map((email) => ({ ...w.members.find((m) => m.email === email), email, role: "member" as const }))] })} />
                </Field>
              </div>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

function DetailsEditor({ value, onChange }: { value: { label: string; value: string; mono?: boolean }[]; onChange: (v: { label: string; value: string; mono?: boolean }[]) => void }) {
  return (
    <div className="col-span-2 flex flex-col gap-2">
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-[0.6fr_1.4fr_auto] gap-2">
          <TextInput value={r.label} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, label: v } : x)))} placeholder="名称" />
          <TextInput value={r.value} onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...x, value: v } : x)))} placeholder="值" mono={r.mono} />
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-9 place-items-center text-subtle hover:text-crit"><X size={15} /></button>
        </div>
      ))}
      <div><Button variant="ghost" icon={<Plus size={14} />} onClick={() => onChange([...value, { label: "", value: "" }])}>添加一行</Button></div>
    </div>
  );
}

function RelatedPicker({ value, onChange, self, hint }: { value: string[]; onChange: (v: string[]) => void; self?: string; hint: string }) {
  const { assets } = useData();
  const [q, setQ] = useState("");
  const chosen = value.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
  const options = useMemo(() => assets.filter((a) => a.id !== self && !value.includes(a.id) && (!q || `${a.name} ${a.subtitle ?? ""}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 8), [assets, self, value, q]);
  return (
    <Field label="关联" hint={hint}>
      <div className="flex flex-wrap gap-1.5">
        {chosen.map((a) => (
          <span key={a.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line pr-1.5 pl-2.5 text-xs">
            {TYPE_LABEL[a.type]} · {a.name}
            <button onClick={() => onChange(value.filter((x) => x !== a.id))} className="text-subtle hover:text-crit"><X size={12} /></button>
          </span>
        ))}
      </div>
      <TextInput value={q} onChange={setQ} placeholder="搜索要关联的资产…" />
      {q && (
        <div className="overflow-hidden rounded-sm border border-line">
          {options.map((a) => (
            <button key={a.id} onClick={() => { onChange([...value, a.id]); setQ(""); }} className="flex h-9 w-full items-center gap-2 border-b border-line px-3 text-left text-[13px] last:border-0 hover:bg-field">
              <TypeIcon type={a.type} size="sm" /><span className="truncate">{a.name}</span><span className="ml-auto text-xs text-subtle">{TYPE_LABEL[a.type]}</span>
            </button>
          ))}
          {!options.length && <div className="px-3 py-2 text-xs text-subtle">没有匹配</div>}
        </div>
      )}
    </Field>
  );
}
