import { atollImpact, type AtollMatch, type AtollServer } from "@fangcun/core";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Asset } from "../data/types";
import { useData } from "../lib/store";
import { CfBadge, CfHostLine, useAtollCfCheck, useCfOn } from "./Cloudflare";
import { Card, Empty } from "./ui";

export function AtollBadge({ className }: { className?: string }) {
  return <span className={clsx("inline-flex h-[18px] items-center rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent", className)}>Atoll</span>;
}

const STATUS: Record<string, { label: string; dot: string }> = {
  running: { label: "运行中", dot: "bg-ok" },
  deploying: { label: "部署中", dot: "bg-accent animate-pulse" },
  stopped: { label: "已停止", dot: "bg-subtle" },
  partial: { label: "部分未运行", dot: "bg-warn" },
  failed: { label: "失败", dot: "border-[1.5px] border-ink bg-transparent" },
  unknown: { label: "未知", dot: "bg-line" },
};
const DOMAIN_STATUS: Record<string, string> = { active: "已生效", pending: "等待解析", provisioning: "配置中", error: "出错" };
export const statusOf = (s: string) => STATUS[s] ?? STATUS.unknown;

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const m = statusOf(status);
  return <span title={m.label} className={clsx("inline-block size-2 shrink-0 rounded-full", m.dot, className)} />;
}

/** Atoll is on (enabled) and either configured or has a snapshot to show. */
export function useAtollOn() {
  const { settings, atollSnap } = useData();
  return settings.atoll.enabled && Boolean(atollSnap || settings.atoll.url);
}

/** "影响 N 个 Atoll 项目" next to an expiry warning. */
export function AtollImpact({ asset }: { asset: Asset }) {
  const { atollView } = useData();
  const on = useAtollOn();
  const n = on ? atollImpact(atollView, asset) : 0;
  if (!n) return null;
  return <span className="text-xs whitespace-nowrap text-muted" title={asset.type === "server" ? "这台机器上运行的 Atoll 项目" : "有服务绑定了这个域名（或其子域名）的 Atoll 项目"}>影响 {n} 个 Atoll 项目</span>;
}

const srvLabel = (s: AtollServer) => [s.name, s.public_ipv4 || s.public_ipv6].filter(Boolean).join(" · ");

function matchText(m: AtollMatch | undefined, servers: AtollServer[]): string {
  const name = (id: string | null) => servers.find((s) => s.id === id)?.name ?? id ?? "";
  switch (m?.via) {
    case "ip": return `按 IP ${m.ip} 匹配 · ${name(m.serverId)}`;
    case "manual": return `手动绑定 · ${name(m.serverId)}`;
    case "manual-none": return "已设为不关联";
    case "manual-missing": return "手动绑定的服务器已不在 Atoll";
    case "ambiguous": return "IP 有歧义";
    default: return "未匹配";
  }
}

/** VPS detail: projects → services → domains running on the Atoll server this VPS matches. */
export function AtollProjectsCard({ asset, onSelect }: { asset: Asset; onSelect: (id: string) => void }) {
  const { atollView, update, toast } = useData();
  const on = useAtollOn();
  const cfOn = useCfOn();
  const cfCheck = useAtollCfCheck();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (!on) return null;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const servers = atollView.servers;
  const m = atollView.match.get(asset.id);
  const projects = atollView.projectsByAsset.get(asset.id) ?? [];
  const value = asset.atoll ? (asset.atoll.serverId ?? "__none") : "__auto";
  const bind = async (v: string) => {
    try { await update(asset.id, { atoll: v === "__auto" ? null : { serverId: v === "__none" ? null : v } }); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  const empty = !m?.serverId || m.via === "manual-missing";
  return (
    <Card title="Atoll 上的项目" flush scroll className="max-h-[380px]"
      extra={<>
        <AtollBadge />{cfOn && <CfBadge />}
        <span className="max-w-[260px] truncate" title={matchText(m, servers)}>{matchText(m, servers)}</span>
        <select value={value} onChange={(e) => bind(e.target.value)} title="选择这台 VPS 对应的 Atoll 服务器"
          className="h-7 max-w-[170px] rounded-[6px] border border-line bg-field px-2 text-xs text-ink outline-none focus:border-ink/40">
          {[["__auto", "自动（按 IP）"], ["__none", "不关联"], ...servers.map((s) => [s.id, srvLabel(s)])].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </>}>
      {empty ? (
        <Empty>{
          m?.via === "manual-none" ? "已设为不关联 Atoll。改回「自动（按 IP）」即可重新匹配。"
          : m?.via === "manual-missing" ? `手动绑定的 Atoll 服务器（${m.serverId}）已不在 Atoll 里，请重新选择。`
          : m?.via === "ambiguous" ? "同一个 IP 对应了多台机器，没有自动关联。请在右上角手动选择 Atoll 服务器。"
          : servers.length ? "没有按公网 IP 匹配到 Atoll 服务器。如果这台机器在 Atoll 里，可以在右上角手动选择。"
          : "还没有 Atoll 数据。到「设置 → Atoll 面板」立即同步一次。"
        }</Empty>
      ) : !projects.length ? <Empty>这台机器上还没有 Atoll 项目。</Empty> : projects.map((p) => (
        <ProjectRow key={p.id} name={p.name} handle={p.handle} services={p.services} open={open.has(p.id)} onToggle={() => toggle(p.id)}>
          {p.services.map((s) => (<div key={s.id}>
            <div className="grid min-h-9 grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] items-center gap-3 py-1.5 pr-4 pl-7 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot status={s.status} />
                <span className="truncate">{s.name}</span>
                {s.status !== "running" && <span className="shrink-0 text-[11.5px] text-subtle">{statusOf(s.status).label}</span>}
              </span>
              <span className="truncate font-mono text-[11.5px] text-subtle" title={s.image}>{s.image || "—"}</span>
              <span className="flex min-w-0 flex-wrap justify-end gap-1">
                {cfOn ? <span className="text-xs whitespace-nowrap text-subtle">{s.domains.length ? `${s.domains.length} 个域名` : "无域名"}</span>
                : s.domains.length ? s.domains.map((d) => (
                  <button key={d.hostname} disabled={!d.domainAssetId} onClick={() => d.domainAssetId && onSelect(d.domainAssetId)}
                    title={`${d.hostname} · ${DOMAIN_STATUS[d.status] ?? d.status}${d.proxied ? " · Cloudflare 代理" : ""}${d.domainAssetId ? " · 点击打开域名资产" : ""}`}
                    className={clsx("max-w-full truncate rounded-[5px] bg-field px-1.5 py-px font-mono text-[11.5px]", d.domainAssetId ? "text-ink hover:bg-sel hover:underline" : "cursor-default text-muted", d.status !== "active" && "opacity-60")}>
                    {d.hostname}
                  </button>
                )) : <span className="text-xs text-subtle">无域名</span>}
              </span>
            </div>
            {cfOn && s.domains.map((d) => (
              <div key={d.hostname} className="grid min-h-8 items-center gap-x-3 gap-y-0.5 py-1 pr-4 pl-11 text-[13px] @xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2.6fr)]">
                <button disabled={!d.domainAssetId} onClick={() => d.domainAssetId && onSelect(d.domainAssetId)}
                  title={`${d.hostname} · Atoll ${DOMAIN_STATUS[d.status] ?? d.status}${d.domainAssetId ? " · 点击打开域名资产" : ""}`}
                  className={clsx("truncate text-left font-mono text-[12px]", d.domainAssetId ? "text-ink hover:underline" : "cursor-default text-muted", d.status !== "active" && "opacity-60")}>{d.hostname}</button>
                <CfHostLine check={cfCheck(d.hostname, { serverId: p.serverId, serverAssetId: asset.id }, d.proxied)} />
              </div>
            ))}
          </div>))}
        </ProjectRow>
      ))}
    </Card>
  );
}

/** One Atoll project as a collapsible row: the header sums up its services; services and hostnames show only when expanded. */
function ProjectRow({ name, handle, services, open, onToggle, children }: {
  name: string; handle: string; services: { status: string; domains: unknown[] }[]; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const down = services.filter((s) => s.status !== "running").length;
  const domains = services.reduce((n, s) => n + s.domains.length, 0);
  return (
    <div className="border-b border-line last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex h-10 w-full items-center gap-2 px-4 text-left text-[13px] hover:bg-field focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink/30">
        <ChevronRight size={14} strokeWidth={2} className={clsx("shrink-0 text-muted transition-transform", open && "rotate-90")} />
        <StatusDot status={down ? (down === services.length ? "stopped" : "partial") : "running"} />
        <span className="truncate font-semibold">{name}</span>
        {handle !== name && <span className="truncate font-mono text-[11.5px] text-subtle">{handle}</span>}
        <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted">
          {services.length} 个服务{down ? ` · ${down} 个未运行` : ""}{domains ? ` · ${domains} 个域名` : ""}
        </span>
      </button>
      {open && <div className="pb-1.5">{children}</div>}
    </div>
  );
}

/** Domain detail: Atoll services whose hostname is this domain or a subdomain of it. */
export function AtollDomainCard({ asset, onSelect }: { asset: Asset; onSelect: (id: string) => void }) {
  const { atollView } = useData();
  const on = useAtollOn();
  const cfOn = useCfOn();
  const cfCheck = useAtollCfCheck();
  if (!on) return null;
  const hosts = atollView.hostsByDomain.get(asset.id) ?? [];
  return (
    <Card title="指向这个域名的服务" extra={<><AtollBadge />{hosts.length ? `${hosts.length} 个主机名` : null}</>} flush scroll className="max-h-[320px]">
      {hosts.length ? hosts.map((h) => (
        <div key={h.hostname + h.serviceId} className="border-b border-line last:border-0">
        <div className={clsx("grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 text-[13px] @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_70px] @max-2xl:py-1.5 @max-2xl:[&>*:nth-child(4)]:order-2", cfOn ? "@2xl:h-9 @2xl:pt-1" : "@2xl:h-11")}>
          <span className="truncate font-mono text-[12.5px]" title={h.hostname}>{h.hostname}</span>
          <span className="flex min-w-0 items-center gap-2"><StatusDot status={h.serviceStatus} /><span className="truncate">{h.projectName}<span className="text-subtle"> / {h.serviceName}</span></span></span>
          {h.serverAssetId
            ? <button onClick={() => onSelect(h.serverAssetId!)} className="truncate text-left font-mono text-[12px] text-muted hover:text-ink hover:underline">{h.serverName}</button>
            : <span className="truncate font-mono text-[12px] text-subtle" title="这台 Atoll 服务器没有对应的方寸资产">{h.serverName}</span>}
          <span className="text-right text-xs whitespace-nowrap text-subtle">{DOMAIN_STATUS[h.status] ?? h.status}</span>
        </div>
        {cfOn && <div className="flex min-h-7 items-center gap-2 px-4 pb-1"><span className="shrink-0 text-[11px] text-subtle">Cloudflare</span><CfHostLine check={cfCheck(h.hostname, h, h.proxied)} /></div>}
        </div>
      )) : <Empty>Atoll 里没有服务绑定到这个域名或它的子域名。</Empty>}
    </Card>
  );
}
