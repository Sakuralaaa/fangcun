import { linksForAccount, normEmail, prefFor, PROVIDER_LABEL, QUOTA_ASSET_TYPES, QUOTA_STATUS_LABEL, quotaForAsset, quotaForMembers, windowLabel, type QuotaAccount, type QuotaLink } from "@fangcun/core";
import clsx from "clsx";
import { Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Asset } from "../data/types";
import { useData } from "../lib/store";
import { Button, Card, Field, Modal, Select, StarButton } from "./ui";

const statusTone: Record<string, string> = { ok: "text-ok", limited: "text-warn", cooling: "text-warn", disabled: "text-muted", expired: "text-crit", error: "text-crit" };

export function CliproxyBadge() {
  return <span className="inline-flex h-[18px] items-center rounded-[5px] bg-spark-soft px-1.5 text-[10.5px] font-semibold text-spark">CLIProxyAPI</span>;
}

/** Red / orange only for high use; everything else stays ink. */
function bar(pct: number) {
  return pct >= 90 ? "bg-crit" : pct >= 70 ? "bg-warn" : "bg-accent";
}

export const resetLabel = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const CHIPS = 2;
const VIA: Record<QuotaLink["via"], string> = { bind: "手动绑定", member: "团队成员", email: "同邮箱", login: "登录账号同邮箱" };

export const accountName = (a: QuotaAccount) => a.email ?? a.label ?? a.id;

/** An account is 告急 when it is used up / broken, or any window is at 90% or more. */
export const isLow = (a: QuotaAccount) => a.status === "limited" || a.status === "expired" || a.windows.some((w) => w.usedPct >= 90);

/** One CLIProxyAPI account: 关注, provider / plan / email, the assets it links to, a bind button, status and quota bars. */
export function QuotaRow({ a, links, onOpen, showConnection = true, manage = true }: {
  a: QuotaAccount; links?: QuotaLink[]; onOpen?: (assetId: string) => void; showConnection?: boolean; manage?: boolean;
}) {
  const { cpx, assets, setCpaPref } = useData();
  const [binding, setBinding] = useState(false);
  const pref = prefFor(a, cpx.prefs);
  const starred = Boolean(pref?.starred);
  const name = accountName(a);
  const linked = (links ?? []).map((l) => ({ l, asset: assets.find((x) => x.id === l.assetId) })).filter((x): x is { l: QuotaLink; asset: Asset } => Boolean(x.asset));
  return (
    <div className="group/row border-b border-line px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
        {manage && <StarButton on={starred} name={`${PROVIDER_LABEL[a.provider] ?? a.provider} ${name}`} onToggle={() => setCpaPref(a, { starred: !starred })} size={14} className="-ml-1.5 size-7" />}
        <span className="shrink-0 font-semibold whitespace-nowrap">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
        {a.plan && <span className="shrink-0 rounded-[5px] bg-field px-1.5 py-px text-[11px] whitespace-nowrap text-muted">{a.plan}</span>}
        <span className="min-w-0 flex-1 basis-[120px] truncate font-mono text-[12px] text-muted" title={name}>{name}</span>
        {showConnection && <span className="shrink-0 text-xs whitespace-nowrap text-muted">{a.connectionName}</span>}
        <span className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
          {linked.slice(0, CHIPS).map(({ l, asset }) => (
            <button key={asset.id} type="button" onClick={() => onOpen?.(asset.id)} disabled={!onOpen}
              title={`${VIA[l.via]}：${asset.name}${l.member ? ` · ${l.member}` : ""}`}
              className="inline-flex h-6 max-w-[180px] min-w-0 items-center gap-1 rounded-full border border-line px-2 text-xs text-ink hover:bg-field disabled:hover:bg-transparent">
              {l.via === "bind" && <Link2 size={11} className="shrink-0 text-muted" />}
              <span className="truncate">{asset.name}</span>
            </button>
          ))}
          {linked.length > CHIPS && (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-field px-2 text-xs text-muted tnum" tabIndex={0}
              title={linked.slice(CHIPS).map(({ l, asset }) => `${VIA[l.via]}：${asset.name}`).join("\n")} aria-label={`另有 ${linked.length - CHIPS} 项关联：${linked.slice(CHIPS).map(({ asset }) => asset.name).join("、")}`}>
              +{linked.length - CHIPS}
            </span>
          )}
          <span className={clsx("flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap", statusTone[a.status] ?? "text-muted")} title={a.message}>
            <span className="size-1.5 rounded-full bg-current" />{QUOTA_STATUS_LABEL[a.status] ?? a.status}
          </span>
          {manage && (
            <button type="button" onClick={() => setBinding(true)} aria-label={`绑定「${name}」到资产`} title="绑定到资产"
              className={clsx("grid size-7 shrink-0 place-items-center rounded-[6px] hover:bg-field hover:text-ink", pref?.assetId ? "text-ink" : "text-muted")}>
              <Link2 size={14} />
            </button>
          )}
        </span>
      </div>
      {a.windows.length > 0 && (
        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 @lg:grid-cols-2">
          {a.windows.map((w) => (
            <div key={w.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap">
                <span className="min-w-0 truncate text-muted">{windowLabel(w)}</span>
                <span className="tnum"><b className="font-semibold text-ink">剩 {Math.round(100 - w.usedPct)}%</b>{w.resetAt && resetLabel(w.resetAt) && <span className="ml-2 text-muted">{resetLabel(w.resetAt)} 重置</span>}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-field">
                <div className={clsx("h-full rounded-full", bar(w.usedPct))} style={{ width: `${w.usedPct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {binding && <BindDialog a={a} onClose={() => setBinding(false)} />}
    </div>
  );
}

/** Bind one account to a subscription / account / mail asset (and, for a team, to one seat). Stored in 方寸 only. */
function BindDialog({ a, onClose }: { a: QuotaAccount; onClose: () => void }) {
  const { cpx, assets, setCpaPref } = useData();
  const pref = prefFor(a, cpx.prefs);
  const [assetId, setAssetId] = useState(pref?.assetId ?? "");
  const [member, setMember] = useState(pref?.member ?? "");
  const options = useMemo(() => assets.filter((x) => (QUOTA_ASSET_TYPES as readonly string[]).includes(x.type) && !x.deletedAt)
    .sort((x, y) => QUOTA_ASSET_TYPES.indexOf(x.type as never) - QUOTA_ASSET_TYPES.indexOf(y.type as never) || x.name.localeCompare(y.name, "zh")), [assets]);
  const target = options.find((x) => x.id === assetId);
  const seats = [...new Set((target?.team?.workspaces ?? []).flatMap((w) => w.members.map((m) => normEmail(m.email))))];
  const save = async (id: string | null) => { await setCpaPref(a, { assetId: id, member: id && member ? member : null }); onClose(); };
  return (
    <Modal title={<span className="flex min-w-0 items-center gap-2"><Link2 size={16} className="shrink-0" /><span className="truncate">{accountName(a)}</span></span>} onClose={onClose} width={440}
      footer={<>
        {pref?.assetId && <Button className="mr-auto" onClick={() => save(null)}>解除绑定</Button>}
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={() => save(assetId || null)} disabled={!assetId}>保存</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <Field label="资产">
          <Select value={assetId} onChange={(v) => { setAssetId(v); setMember(""); }}
            options={[["", "选择资产"], ...options.map((x) => [x.id, x.name] as [string, string])]} />
        </Field>
        {seats.length > 0 && (
          <Field label="团队成员">
            <Select value={member} onChange={setMember} options={[["", "不指定"], ...seats.map((e) => [e, e] as [string, string])]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** 资产详情: the accounts linked to this asset. For a team, the accounts already shown on a seat are left to the team card. */
export function QuotaCard({ asset, onOpen }: { asset: Asset; onOpen?: (id: string) => void }) {
  const { cpx, assets } = useData();
  const all = quotaForAsset(asset, cpx.accounts, assets, cpx.prefs);
  let list = all;
  if (asset.team) {
    const seats = quotaForMembers(asset, cpx.accounts, cpx.prefs);
    const owners = new Set((asset.team.workspaces ?? []).flatMap((w) => w.members.filter((m) => m.role === "owner").map((m) => normEmail(m.email))));
    const onSeat = new Set([...seats].filter(([e]) => !owners.has(e)).flatMap(([, v]) => v));
    list = all.filter((x) => !onSeat.has(x));
  }
  if (!list.length) return null;
  const at = cpx.connections.map((c) => c.fetchedAt).filter(Boolean).sort().pop();
  return (
    <Card title={<span className="flex items-center gap-2">用量与剩余额度 <CliproxyBadge /></span>} extra={at ? `${resetLabel(at)} 更新` : undefined} flush>
      {list.map((a) => <QuotaRow key={a.connectionId + a.id} a={a} onOpen={onOpen}
        links={linksForAccount(a, assets, cpx.prefs).filter((l) => l.assetId !== asset.id)} />)}
    </Card>
  );
}
