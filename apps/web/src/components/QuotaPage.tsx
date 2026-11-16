import { linksForAccount, prefFor, type QuotaAccount } from "@fangcun/core";
import clsx from "clsx";
import { ChevronRight, ListChecks, RefreshCw, Search, Settings2 } from "lucide-react";
import { useState } from "react";
import type { CliproxyConnection } from "../data/types";
import { post } from "../lib/api";
import { useData, type Cpx } from "../lib/store";
import { accountName, CliproxyBadge, isLow, QuotaRow, resetLabel } from "./Quota";
import { Button, Card, Empty } from "./ui";

const OPEN_KEY = "fc-quota-open";

/**
 * 额度 (#/quota): one foldable entry per CLIProxyAPI connection. Unfolded, an entry lists only the accounts the user
 * follows; 管理 lists every account of that connection to pick from. A connection with nothing followed yet unfolds
 * straight into that list. Which entries are open is remembered on this device.
 */
export function QuotaPage({ onSelect, onNav }: { onSelect: (id: string) => void; onNav: (path: string) => void }) {
  const { cpx, setCpx, reloadCliproxy, toast, demo } = useData();
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}"); } catch { return {}; } });
  const [manage, setManage] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const starred = cpx.accounts.filter((a) => prefFor(a, cpx.prefs)?.starred);
  const needle = q.trim().toLowerCase();
  const match = (a: QuotaAccount) => !needle || `${accountName(a)} ${a.provider} ${a.plan ?? ""} ${a.note ?? ""}`.toLowerCase().includes(needle);
  const at = cpx.connections.map((c) => c.fetchedAt).filter(Boolean).sort().pop() ?? undefined;

  const toggle = (id: string, now: boolean) => setOpen((o) => {
    const n = { ...o, [id]: !now };
    localStorage.setItem(OPEN_KEY, JSON.stringify(n));
    return n;
  });
  const refresh = async () => {
    if (demo) return;
    setBusy(true);
    try { setCpx(await post<Cpx>("/api/cliproxyapi/refresh")); } catch (e) { toast((e as Error).message, "err"); await reloadCliproxy(); }
    setBusy(false);
  };

  return (
    <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="page flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">额度</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle">
              <CliproxyBadge />
              <span className="tnum">关注 {starred.length} · 共 {cpx.accounts.length} 个账号{at && resetLabel(at) ? ` · ${resetLabel(at)} 更新` : ""}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cpx.accounts.length > 0 && (
              <label className="flex h-8 w-[200px] items-center gap-2 rounded-sm border border-line bg-panel px-2.5 text-muted max-sm:w-[150px]">
                <Search size={14} className="shrink-0" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索账号" aria-label="搜索账号"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle" />
              </label>
            )}
            <Button icon={<RefreshCw size={14} className={clsx(busy && "animate-spin")} />} onClick={refresh} disabled={demo || busy || !cpx.connections.length} title="全部刷新" />
            <Button icon={<Settings2 size={14} />} onClick={() => onNav("/settings/cliproxyapi")} title="连接设置" />
          </div>
        </div>

        {!cpx.connections.length && (
          <Card>
            <Empty>还没有连接</Empty>
            <div className="px-4 pb-1"><Button variant="primary" onClick={() => onNav("/settings/cliproxyapi")}>添加连接</Button></div>
          </Card>
        )}

        {needle && !cpx.accounts.some(match) && cpx.connections.length > 0 && <p className="px-1 text-[13px] text-subtle">没有匹配的账号</p>}
        {cpx.connections.map((c) => {
          const all = cpx.accounts.filter((a) => a.connectionId === c.id);
          // a search looks through every account and shows only the connections that have a hit
          if (needle && !all.some(match)) return null;
          const mine = all.filter((a) => prefFor(a, cpx.prefs)?.starred);
          const isOpen = needle ? true : open[c.id] ?? mine.length > 0;
          // nothing followed here yet: the entry opens on the full list to pick from
          const managing = Boolean(manage[c.id]) || !mine.length || Boolean(needle);
          return (
            <Connection key={c.id} c={c} all={all} mine={mine} open={isOpen} managing={managing} match={match}
              onToggle={() => toggle(c.id, isOpen)}
              onManage={() => { setManage((m) => ({ ...m, [c.id]: !managing })); if (!isOpen) toggle(c.id, false); }}
              onSelect={onSelect} />
          );
        })}
      </div>
    </main>
  );
}

function Connection({ c, all, mine, open, managing, match, onToggle, onManage, onSelect }: {
  c: CliproxyConnection; all: QuotaAccount[]; mine: QuotaAccount[]; open: boolean; managing: boolean; match: (a: QuotaAccount) => boolean;
  onToggle: () => void; onManage: () => void; onSelect: (id: string) => void;
}) {
  const { cpx, assets } = useData();
  const rows = (managing ? all : mine).filter(match);
  const low = mine.filter(isLow).length;
  const bodyId = `cpx-body-${c.id}`;
  return (
    <section className="@container overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex min-h-12 items-center gap-1 pr-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch py-2 pl-3 text-left outline-none focus-visible:bg-field/60">
          <ChevronRight size={16} className={clsx("shrink-0 text-muted transition-transform", open && "rotate-90")} />
          <span className="shrink-0 text-[14px] font-semibold whitespace-nowrap">{c.name}</span>
          {c.note && <span className="min-w-0 truncate text-[13px] text-subtle max-sm:hidden">{c.note}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-3 pl-2 text-xs whitespace-nowrap text-subtle tnum">
            {c.lastError ? <span className="text-crit" title={c.lastError}>读取失败</span>
              : low > 0 && <span className="font-medium text-warn">{low} 个告急</span>}
            <span>关注 {mine.length} / {all.length}</span>
          </span>
        </button>
        <button type="button" onClick={onManage} aria-pressed={managing} aria-label={`管理「${c.name}」的关注账号`} title="管理关注"
          className={clsx("grid size-8 shrink-0 place-items-center rounded-[7px] hover:bg-field hover:text-ink", managing && open ? "bg-field text-ink" : "text-muted")}>
          <ListChecks size={16} />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="border-t border-line">
          {c.lastError && <p className="border-b border-line px-4 py-2 text-xs text-crit">{c.lastError}</p>}
          {rows.map((a) => <QuotaRow key={a.id} a={a} showConnection={false} onOpen={onSelect} links={linksForAccount(a, assets, cpx.prefs)} />)}
          {!rows.length && <p className="px-4 py-3 text-[13px] text-subtle">{c.fetchedAt ? "没有账号" : "还没读取过"}</p>}
        </div>
      )}
    </section>
  );
}
