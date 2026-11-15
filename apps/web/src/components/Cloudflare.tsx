import {
  CF_SECTION_LABEL, CF_SECTIONS, checkHost, expectedForAtollHost, zoneToAssetInput,
  type AtollHostRef, type CfHostCheck, type CfRecordView, type CfSectionState,
  isWritePermission, permissionLevel,
} from "@fangcun/core";
import clsx from "clsx";
import { Check, Cloud, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Asset } from "../data/types";
import { post } from "../lib/api";
import { useData } from "../lib/store";
import { AtollBadge, StatusDot } from "./Atoll";
import { Button, Card, Empty, Toggle } from "./ui";

export function CfBadge({ className }: { className?: string }) {
  return <span className={clsx("inline-flex h-[18px] items-center rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent", className)}>Cloudflare</span>;
}

/** Cloudflare is on and a snapshot exists. */
export function useCfOn() {
  const { settings, cfSnap } = useData();
  return settings.cloudflare.enabled && Boolean(cfSnap);
}

/** Check an Atoll hostname against Cloudflare: where it points vs. the server Atoll runs it on. */
export function useAtollCfCheck() {
  const { cfView, atollView, assets } = useData();
  const on = useCfOn();
  return (hostname: string, ref: Pick<AtollHostRef, "serverId" | "serverAssetId">, proxied?: boolean): CfHostCheck | null =>
    on ? checkHost(cfView, hostname, expectedForAtollHost(ref, atollView.servers, assets), proxied) : null;
}

const ZONE_STATUS: Record<string, string> = { active: "已生效", pending: "等待切换 NS", initializing: "初始化中", moved: "已移出", deleted: "已删除", deactivated: "已停用" };
const TUNNEL_STATUS: Record<string, string> = { healthy: "正常", degraded: "降级", down: "离线", inactive: "未运行" };
const SECTION_STATE: Record<CfSectionState["state"], string> = { ok: "正常", unauthorized: "未授权", error: "出错", skipped: "未读取" };
const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "");

export function ProxyMark({ proxied, className }: { proxied: boolean; className?: string }) {
  return proxied
    ? <span className={clsx("inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ink", className)} title="经 Cloudflare 代理（橙云）"><Cloud size={12} strokeWidth={2.2} className="fill-current" />代理</span>
    : <span className={clsx("inline-flex shrink-0 items-center gap-1 text-[11.5px] text-subtle", className)} title="仅 DNS（灰云）"><Cloud size={12} strokeWidth={2} />仅 DNS</span>;
}

/** Where a record points, in words, plus the 方寸 server asset it reaches (if any). */
function target(r: CfRecordView, assets: Asset[]): { text: string; assetId: string | null; title: string } {
  const name = (id: string | null) => (id ? assets.find((a) => a.id === id)?.name ?? id : null);
  switch (r.target.kind) {
    case "server": return { text: `${name(r.target.assetId)} · ${r.target.ip}`, assetId: r.target.assetId, title: `${r.content} → 方寸服务器「${name(r.target.assetId)}」` };
    case "ambiguous": return { text: `${r.target.ip} · 多台服务器`, assetId: null, title: "这个 IP 同时写在多台服务器资产里，没有自动关联" };
    case "ip": return { text: r.target.ip, assetId: null, title: "方寸里没有这个 IP 的服务器" };
    case "tunnel": {
      const srv = name(r.target.serverAssetId);
      return { text: `Tunnel ${r.target.tunnelName ?? r.target.tunnelId.slice(0, 8)}${srv ? ` → ${srv}` : ""}`, assetId: r.target.serverAssetId, title: `${r.content}${srv ? `（cloudflared 运行在「${srv}」）` : ""}` };
    }
    default: return { text: r.target.host, assetId: null, title: r.content };
  }
}

/** One line: how Cloudflare answers for an Atoll hostname, plus a warning when it disagrees. */
export function CfHostLine({ check, className }: { check: CfHostCheck | null; className?: string }) {
  const { assets } = useData();
  if (!check) return null;
  const warn = check.issues.find((i) => i.level === "warn");
  const info = check.issues.find((i) => i.level === "info");
  const r = check.records[0];
  const t = check.final ? target(check.final, assets) : null;
  return (
    <span className={clsx("flex min-w-0 items-center gap-2 text-[12px]", className)} title={[check.zone ? `zone ${check.zone.name}` : "", ...check.issues.map((i) => i.text)].filter(Boolean).join("\n")}>
      {r ? <>
        <span className="shrink-0 font-mono text-[11px] text-subtle">{r.type}</span>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-muted">{r.type === "CNAME" && check.viaTunnel ? `Tunnel ${check.viaTunnel.name}` : t?.text ?? r.content}</span>
        <ProxyMark proxied={r.proxied} />
      </> : null}
      {warn ? <span className="min-w-0 truncate font-medium text-warn">{warn.text}</span>
        : info && !r ? <span className="min-w-0 truncate text-subtle">{info.text}</span>
        : r ? <Check size={13} className="shrink-0 text-subtle" aria-label="与 Cloudflare 一致" /> : null}
    </span>
  );
}

// ---------------- domain detail ----------------

export function CloudflareDomainCard({ asset, onSelect }: { asset: Asset; onSelect: (id: string) => void }) {
  const { cfView, atollView, update, toast, assets } = useData();
  const on = useCfOn();
  const atollOn = useData().settings.atoll.enabled;
  const check = useAtollCfCheck();
  const info = on ? cfView.byDomain.get(asset.id) : undefined;
  if (!info) return null;
  const { zone, registration: reg, suggestions, records } = info;
  const hosts = atollOn ? atollView.hostsByDomain.get(asset.id) ?? [] : [];
  const atollFor = (h: string) => hosts.find((x) => x.hostname === h);
  const missing = hosts.filter((h) => !records.some((r) => r.name === h.hostname));
  const services = cfView.services.flatMap((s) => s.domains.filter((d) => d.domainAssetId === asset.id).map((d) => ({ ...d, kind: s.kind, name: s.name })));
  const adopt = async () => {
    const patch: Partial<Asset> = {};
    for (const s of suggestions) (patch as Record<string, unknown>)[s.field] = s.cf;
    try { await update(asset.id, patch); toast("已采纳 Cloudflare 的值"); } catch (e) { toast((e as Error).message, "err"); }
  };
  const cell = (label: string, value: React.ReactNode, title?: string, mono?: boolean) => (
    <div className="flex h-10 min-w-0 items-center justify-between gap-3 px-4 text-[13px]">
      <span className="shrink-0 whitespace-nowrap text-subtle">{label}</span>
      <span className={clsx("min-w-0 truncate", mono && "font-mono text-[12px]")} title={title ?? (typeof value === "string" ? value : undefined)}>{value}</span>
    </div>
  );
  const counts = (["A", "AAAA", "CNAME"] as const).map((t) => `${t} ${records.filter((r) => r.type === t).length}`).join(" · ");
  return (
    <Card title="Cloudflare" flush scroll className="max-h-[520px]"
      extra={<><CfBadge />{zone ? <span>{zone.name === asset.name.toLowerCase() ? "zone" : `属于 zone ${zone.name}`} · {ZONE_STATUS[zone.status] ?? zone.status}{zone.paused ? "（已暂停代理）" : ""}</span> : <span>不是 zone</span>}</>}>
      <div className="grid gap-px border-y border-line bg-line @md:grid-cols-2 @2xl:grid-cols-3 [&>*]:bg-panel">
        {cell("NS", zone?.nameServers.length ? zone.nameServers.join(", ") : "—", undefined, true)}
        {cell("注册商", reg ? "Cloudflare" : zone?.originalRegistrar ? `其他（${zone.originalRegistrar}）` : "不在 Cloudflare 注册")}
        {cell("套餐", zone?.plan ?? "—")}
        {cell("到期", reg?.expiresAt ?? "—", undefined, true)}
        {cell("自动续费", reg ? (reg.autoRenew ? "开" : "关") : "—")}
        {cell("转移锁", reg?.locked === undefined ? "—" : reg.locked ? "开启" : "关闭")}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-field/60 px-4 py-2.5 text-[12.5px]">
          <span className="shrink-0 font-medium whitespace-nowrap">来自 Cloudflare</span>
          <span className="min-w-0 flex-1 basis-[200px] text-muted" title="Cloudflare 注册商里的值和方寸不同。采纳后写入资产，之后仍可在方寸里改；不采纳就保持你手填的值。">
            {suggestions.map((s) => `${s.label} ${typeof s.cf === "boolean" ? (s.cf ? "开" : "关") : s.cf}（方寸：${s.current === null ? "未填" : typeof s.current === "boolean" ? (s.current ? "开" : "关") : s.current}）`).join(" · ")}
          </span>
          <Button className="ml-auto h-7 px-2.5 text-xs" onClick={adopt}>采纳</Button>
        </div>
      )}
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs whitespace-nowrap text-subtle">
        <span className="font-medium text-muted">DNS 记录</span><span>{counts}</span><span>· 代理 {records.filter((r) => r.proxied).length}</span>
        {hosts.length > 0 && <span className="ml-auto flex items-center gap-1.5"><AtollBadge />按项目所在服务器核对</span>}
      </div>
      {records.length || missing.length ? <>
        {records.map((r) => {
          const t = target(r, assets);
          const ref = atollFor(r.name);
          const issue = ref ? check(r.name, ref, ref.proxied)?.issues.find((i) => i.level === "warn") : undefined;
          return (
            <div key={r.name + r.type + r.content} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] @2xl:grid-cols-[minmax(0,1.25fr)_44px_minmax(0,1.35fr)_62px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[13px] @max-2xl:[&>*:nth-child(3)]:order-4 @max-2xl:[&>*:nth-child(3)]:col-span-3 @max-2xl:[&>*:nth-child(5)]:order-5 @max-2xl:[&>*:nth-child(5)]:col-span-3 @max-2xl:[&>*:nth-child(4)]:order-3">
              <span className="truncate font-mono text-[12px]" title={r.name}>{r.name}</span>
              <span className="font-mono text-[11px] text-subtle">{r.type}</span>
              {t.assetId
                ? <button onClick={() => onSelect(t.assetId!)} title={t.title} className="truncate text-left font-mono text-[11.5px] text-muted hover:text-ink hover:underline">{t.text}</button>
                : <span className="truncate font-mono text-[11.5px] text-subtle" title={t.title}>{t.text}</span>}
              <ProxyMark proxied={r.proxied} />
              <span className="flex min-w-0 flex-col text-xs leading-tight">
                {ref ? <span className="truncate text-muted" title={`Atoll：${ref.projectName} / ${ref.serviceName}（${ref.serverName}）`}>{ref.projectName}<span className="text-subtle"> / {ref.serviceName}</span></span>
                  : <span className="text-subtle">—</span>}
                {issue && <span className="mt-0.5 font-medium text-warn" title={issue.text}>{issue.text}</span>}
              </span>
            </div>
          );
        })}
        {missing.map((h) => (
          <div key={`m-${h.hostname}`} className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] @2xl:grid-cols-[minmax(0,1.25fr)_44px_minmax(0,1.35fr)_62px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[13px] @max-2xl:[&>*:nth-child(3)]:order-4 @max-2xl:[&>*:nth-child(3)]:col-span-3 @max-2xl:[&>*:nth-child(5)]:order-5 @max-2xl:[&>*:nth-child(5)]:col-span-3 @max-2xl:[&>*:nth-child(4)]:order-3">
            <span className="truncate font-mono text-[12px]" title={h.hostname}>{h.hostname}</span>
            <span className="font-mono text-[11px] text-subtle">—</span>
            <span className="truncate text-xs font-medium text-warn">Cloudflare 里没有这条记录</span>
            <span />
            <span className="truncate text-xs text-muted">{h.projectName}<span className="text-subtle"> / {h.serviceName}</span></span>
          </div>
        ))}
      </> : <Empty>这个域名下没有 A / AAAA / CNAME 记录。</Empty>}
      {services.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-subtle">
          <span className="mr-1">绑定的服务</span>
          {services.map((s) => <span key={s.kind + s.name + s.hostname} className="rounded-[5px] bg-field px-1.5 py-px font-mono text-[11.5px] text-muted" title={s.hostname}>{SERVICE_KIND[s.kind]} {s.name} · {s.hostname}</span>)}
        </div>
      )}
    </Card>
  );
}

const SERVICE_KIND = { worker: "Workers", pages: "Pages", r2: "R2" } as const;

// ---------------- VPS detail ----------------

export function CloudflareServerCard({ asset, onSelect }: { asset: Asset; onSelect: (id: string) => void }) {
  const { cfView } = useData();
  const on = useCfOn();
  if (!on) return null;
  const records = cfView.byServer.get(asset.id) ?? [];
  const tunnels = cfView.tunnels.filter((t) => t.match.assetId === asset.id);
  if (!records.length && !tunnels.length) return null;
  return (
    <Card title="指向这台服务器的域名" flush scroll className="max-h-[340px]"
      extra={<><CfBadge />{tunnels.length ? <span>Tunnel {tunnels.map((t) => t.name).join("、")} 运行在这台</span> : null}<span>{records.length} 条记录</span></>}>
      {records.length ? records.map((r) => (
        <div key={r.name + r.type + r.content} className="grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[13px] first:border-t-0 @2xl:grid-cols-[minmax(0,1.4fr)_44px_minmax(0,1.3fr)_62px_minmax(0,0.9fr)] @max-2xl:[&>*:nth-child(3)]:order-4 @max-2xl:[&>*:nth-child(3)]:col-span-2 @max-2xl:[&>*:nth-child(4)]:order-3 @max-2xl:[&>*:nth-child(5)]:order-5 @max-2xl:[&>*:nth-child(5)]:text-right">
          {r.domainAssetId
            ? <button onClick={() => onSelect(r.domainAssetId!)} className="truncate text-left font-mono text-[12px] hover:underline" title={`${r.name} · 打开域名资产`}>{r.name}</button>
            : <span className="truncate font-mono text-[12px]" title={r.name}>{r.name}</span>}
          <span className="font-mono text-[11px] text-subtle">{r.type}</span>
          <span className="truncate font-mono text-[11.5px] text-muted" title={r.content}>{r.target.kind === "tunnel" ? `经 Tunnel ${r.target.tunnelName ?? ""}` : r.content}</span>
          <ProxyMark proxied={r.proxied} />
          <span className="truncate text-right text-xs text-subtle" title={`zone ${r.zoneName}`}>{r.zoneName}</span>
        </div>
      )) : <Empty>Tunnel 在这台机器上运行，但还没有 DNS 记录指向它。</Empty>}
    </Card>
  );
}

// ---------------- settings ----------------

const PERMS: [string, string, string][] = [
  ["账户", "Account Settings · Read", "列出账户（设了账户 ID 可不勾）"],
  ["区域", "Zone · Read", "列出 zone：状态、NS、套餐"],
  ["区域", "DNS · Read", "读 A / AAAA / CNAME 记录"],
  ["账户", "Registrar Domains · Read", "注册商：到期日、自动续费、转移锁"],
  ["账户", "Cloudflare Tunnel · Read", "Tunnel 列表、公网主机名、连接来源 IP"],
  ["账户", "Workers Scripts · Read", "Workers 脚本与自定义域名"],
  ["账户", "Cloudflare Pages · Read", "Pages 项目与自定义域名"],
  ["账户", "Workers R2 Storage · Read", "R2 存储桶列表"],
  ["用户", "API Tokens · Read（可选）", "核对令牌自身的权限"],
];

export function CloudflareSettings({ onSelect }: { onSelect?: (id: string) => void }) {
  const { settings, saveSettings, cf, cfSnap, cfView, reloadCloudflare, create, toast, demo, assets } = useData();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const s = settings.cloudflare;
  const toggle = async (v: boolean) => {
    try { await saveSettings({ ...settings, cloudflare: { enabled: v } }); await reloadCloudflare(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await post<{ zones: number; records: number }>("/api/cloudflare/sync");
      toast(`同步完成：${r.zones} 个 zone，${r.records} 条记录`);
    } catch (e) { toast((e as Error).message, "err"); }
    await reloadCloudflare().catch(() => {});
    setBusy(false);
  };
  const doImport = async (zoneId: string) => {
    const z = cfView.importable.find((x) => x.id === zoneId);
    if (!z) return;
    setImporting(zoneId);
    try { const a = await create(zoneToAssetInput(z, z.registration)); if (a) toast(`已导入域名资产 ${z.name}`); } catch (e) { toast((e as Error).message, "err"); }
    setImporting(null);
  };
  const tok = cf?.token;
  const connected = Boolean(s.enabled && cf?.hasToken && !cf?.lastError && cf?.lastSync);
  const status = !s.enabled ? <span className="text-subtle">已关闭</span>
    : connected ? <span className="flex items-center gap-1.5 text-ok"><span className="size-1.5 rounded-full bg-ok" />已连接</span>
    // the error itself is shown once, in 权限检查 below
    : <span className="flex items-center gap-1.5 text-muted"><span className="size-1.5 rounded-full border border-subtle" />{cf?.lastError ? "未连接 · 原因见下方" : !cf?.hasToken ? "缺少 API 令牌" : "还没同步过"}</span>;
  const sections = cf?.sections ?? cfSnap?.sections ?? null;
  const unknownPerms = (tok?.permissions ?? []).filter((p) => permissionLevel(p) === "unknown");
  const groups = [
    { label: "Tunnel", rows: cfView.tunnels.map((t) => ({ key: t.id, name: t.name, status: t.status, detail: [TUNNEL_STATUS[t.status] ?? t.status, t.connections ? `${t.connections} 条连接` : "", t.match.assetId ? `运行在 ${assets.find((a) => a.id === t.match.assetId)?.name}` : t.originIps.length ? `来源 ${t.originIps.join("、")}` : ""].filter(Boolean).join(" · "), domains: t.hostnames.map((h) => ({ hostname: h, domainAssetId: null as string | null })) })) },
    ...(["worker", "pages", "r2"] as const).map((k) => ({ label: SERVICE_KIND[k], rows: cfView.services.filter((x) => x.kind === k).map((x) => ({ key: x.kind + x.name, name: x.name, status: "", detail: x.detail ?? "", domains: x.domains })) })),
  ].filter((g) => g.rows.length);

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">Cloudflare <CfBadge /></h1>
      </div>
      {demo && <p className="rounded-sm bg-field px-3 py-2 text-xs text-subtle">演示模式：这里的操作不会连接服务端。</p>}

      <Card title="连接" extra={status}>
        <div className="grid gap-3 text-[13px] @lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs text-muted">API 令牌</span>
            <span className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-line bg-field px-3 text-subtle"><Lock size={13} className="shrink-0" /><span className="truncate">{cf?.hasToken ? "已由环境变量 CLOUDFLARE_API_TOKEN 提供" : "未设置（CLOUDFLARE_API_TOKEN）"}</span></span></div>
          <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs text-muted">账户 ID</span>
            <span className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-line bg-field px-3 text-subtle"><Lock size={13} className="shrink-0" /><span className="truncate">{cf?.hasAccountId ? "只读这个账户（CLOUDFLARE_ACCOUNT_ID）" : "未设置：读令牌能看到的全部账户"}</span></span></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          <span className="whitespace-nowrap text-muted">启用</span>
          <Toggle on={s.enabled} onChange={toggle} />
          <span className="min-w-0 truncate text-xs text-subtle @max-xl:order-last @max-xl:basis-full">
            每 10 分钟最多自动刷新一次 · {cf?.lastSync ? `上次 ${date(cf.lastSync)}` : "还没同步过"}{cf?.counts ? `，${cf.counts.zones} 个 zone、${cf.counts.records} 条记录、${cf.counts.tunnels} 个 Tunnel` : ""}
          </span>
          <div className="flex-1" />
          <Button icon={<RefreshCw size={14} className={clsx(busy && "animate-spin")} />} onClick={sync} disabled={demo || busy || !s.enabled || !cf?.hasToken}>立即同步</Button>
        </div>
      </Card>

      <Card title="权限检查" extra={tok ? <span>{tok.kind === "account" ? "账户令牌" : "用户令牌"} · {tok.status === "active" ? "有效" : tok.status}{tok.checkedAt ? ` · ${date(tok.checkedAt)}` : ""}</span> : undefined}>
        {tok?.readOnly !== false && cf?.lastError && s.enabled ? (
          <p className="mb-3 rounded-sm border border-line bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn">{cf.lastError}</p>
        ) : tok?.readOnly === false ? (
          <p className="mb-3 rounded-sm border border-line bg-warn-soft px-3 py-2 text-[13px] text-warn">
            这个令牌不是只读（含 {(tok.permissions ?? []).filter(isWritePermission).join("、")}），方寸已拒绝使用。请另建一个只勾 Read 的令牌，替换 CLOUDFLARE_API_TOKEN 后重建方寸容器（docker compose up -d --force-recreate）。
          </p>
        ) : tok?.readOnly ? (
          <>
            <p className="mb-3 text-[13px] text-muted">只读 · {tok.permissions?.length ?? 0} 项权限</p>
            {unknownPerms.length > 0 && (
              <p className="mb-3 rounded-sm bg-field px-3 py-2 text-xs leading-relaxed text-muted">
                无法判断，请自查：{unknownPerms.join("、")}
              </p>
            )}
          </>
        ) : tok ? (
          <p className="mb-3 text-[13px] text-muted">未能读取令牌权限（未勾 API Tokens · Read），请自行确认只勾了 Read。</p>
        ) : <p className="mb-3 text-[13px] text-subtle">还没同步过</p>}
        {sections ? <>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line @xl:grid-cols-4 [&>*]:bg-panel">
          {CF_SECTIONS.map((k) => {
            const st = sections?.[k];
            return (
              <div key={k} className="flex h-12 min-w-0 flex-col justify-center px-3 text-[13px]" title={st?.message}>
                <span className="text-xs whitespace-nowrap text-subtle">{CF_SECTION_LABEL[k]}</span>
                <span className={clsx("flex min-w-0 items-center gap-1.5", st?.state === "ok" ? "text-ink" : "text-muted")}>
                  <span className={clsx("size-1.5 shrink-0 rounded-full", st?.state === "ok" ? "bg-ok" : st ? "border border-subtle" : "bg-line")} />
                  <span className="truncate">{st ? SECTION_STATE[st.state] : "—"}{st?.message ? <span className="text-subtle"> · {st.message}</span> : null}</span>
                </span>
              </div>
            );
          })}
        </div>
        </> : null}
      </Card>

      <Card title="可导入为域名资产" extra={cfSnap ? `${cfView.importable.length} 个 zone 在方寸里还没有对应资产` : undefined} flush scroll className="max-h-[300px]">
        {cfView.importable.length ? cfView.importable.map((z) => (
          <div key={z.id} className="grid min-h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[13px] first:border-t-0 @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_72px] @max-2xl:[&>*:nth-child(3)]:order-4 @max-2xl:[&>*:nth-child(3)]:col-span-3">
            <span className="truncate font-mono text-[12.5px]">{z.name}</span>
            <span className="text-xs whitespace-nowrap text-muted">{ZONE_STATUS[z.status] ?? z.status}</span>
            <span className="truncate text-xs text-subtle">{z.registration ? `Cloudflare 注册 · ${z.registration.expiresAt ?? "?"} 到期${z.registration.autoRenew ? " · 自动续费" : ""}` : z.originalRegistrar ? `仅 DNS · 注册在 ${z.originalRegistrar}` : "仅 DNS"}</span>
            <Button className="h-7 justify-self-end px-2.5 text-xs" onClick={() => doImport(z.id)} disabled={importing === z.id}>导入</Button>
          </div>
        )) : <Empty>{cfSnap ? "每个 zone 都已有对应的域名资产。" : "同步一次后列出没有对应资产的 zone。"}</Empty>}
      </Card>

      <Card title="账号下的服务" extra={groups.length ? `${groups.reduce((n, g) => n + g.rows.length, 0)} 项` : undefined} flush scroll className="max-h-[360px]">
        {groups.length ? groups.map((g) => (
          <div key={g.label}>
            <div className="flex h-8 items-center border-t border-line bg-field/50 px-4 text-xs font-medium whitespace-nowrap text-muted first:border-t-0">{g.label}<span className="ml-1.5 font-normal text-subtle">{g.rows.length}</span></div>
            {g.rows.map((r) => (
              <div key={r.key} className="grid min-h-10 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-line px-4 py-1.5 text-[13px] @2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.4fr)] @max-2xl:[&>*:nth-child(3)]:col-span-2 @max-2xl:[&>*:nth-child(3)]:justify-start @max-2xl:[&>*:nth-child(2)]:text-right">
                <span className="flex min-w-0 items-center gap-2">{r.status && <StatusDot status={r.status === "healthy" ? "running" : r.status === "inactive" ? "stopped" : "unknown"} />}<span className="truncate font-mono text-[12.5px]">{r.name}</span></span>
                <span className="truncate text-xs text-subtle" title={r.detail}>{r.detail || "—"}</span>
                <span className="flex min-w-0 flex-wrap justify-end gap-1">
                  {r.domains.length ? r.domains.map((d) => (
                    <button key={d.hostname} disabled={!d.domainAssetId || !onSelect} onClick={() => d.domainAssetId && onSelect?.(d.domainAssetId)} title={d.hostname}
                      className={clsx("max-w-full truncate rounded-[5px] bg-field px-1.5 py-px font-mono text-[11.5px]", d.domainAssetId && onSelect ? "text-ink hover:bg-sel hover:underline" : "cursor-default text-muted")}>{d.hostname}</button>
                  )) : <span className="text-xs text-subtle">无自定义域名</span>}
                </span>
              </div>
            ))}
          </div>
        )) : <Empty>{cfSnap ? "没有 Tunnel、Workers、Pages 或 R2" : "还没同步过"}</Empty>}
      </Card>

      <Card title="令牌需要的权限（全部 Read）" flush>
        {PERMS.map(([scope, name, use]) => (
          <div key={name} className="grid min-h-9 grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-t border-line px-4 py-1.5 text-[13px] @xl:grid-cols-[56px_minmax(0,1.1fr)_minmax(0,1.4fr)]">
            <span className="text-xs whitespace-nowrap text-subtle">{scope}</span>
            <span className="font-medium whitespace-nowrap">{name}</span>
            <span className="text-xs text-muted @max-xl:col-start-2 @xl:truncate" title={use}>{use}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
