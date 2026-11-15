import { compareAssets, displayTotal, monthlyByCurrency, money, searchAssets, ASSET_TYPES } from "@fangcun/core";
import clsx from "clsx";
import { Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { daysUntil, dueLabel, getToday, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { StarButton, TypeIcon, typeMeta, urgencyText } from "./ui";
import { Pin } from "lucide-react";

/** Asset list filter: one type, all, or 关注 (starred, pinned included). */
export type ListFilter = AssetType | "all" | "starred";
export const matchFilter = (a: Asset, f: ListFilter) => f === "all" || (f === "starred" ? a.starred : a.type === f);

export function AssetList({ selected, filter, onSelect, onFilter, onAdd, className }: { selected?: string; filter: ListFilter; onSelect: (id: string) => void; onFilter: (t: ListFilter) => void; onAdd: () => void; className?: string }) {
  const { assets, status, settings, setFocus } = useData();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); } };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  const today = getToday();
  const list = searchAssets(assets.filter((a) => matchFilter(a, filter)), q).sort((a, b) => compareAssets(a, b, today));
  const pinned = list.filter((a) => a.pinned);
  const soon = list.filter((a) => !a.pinned && daysUntil(a.expiresAt) <= 30);
  const rest = list.filter((a) => !a.pinned && daysUntil(a.expiresAt) > 30);
  const starredCount = assets.filter((a) => a.starred).length;
  const row = (a: Asset) => <Row key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} on={a.id === selected} onClick={() => onSelect(a.id)} onStar={() => setFocus(a.id, { starred: !a.starred })} />;
  const counts = assets.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});
  const total = displayTotal(monthlyByCurrency(assets), settings.display);

  return (
    <section className={clsx("flex min-w-0 shrink-0 flex-col border-line bg-panel max-lg:flex-1 lg:w-[320px] lg:border-r xl:w-[384px]", className)}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">资产</h2>
          <button onClick={onAdd} title="添加资产" className="grid size-7 place-items-center rounded-[7px] bg-accent text-on-accent hover:brightness-110"><Plus size={16} /></button>
        </div>
        <p className="mt-0.5 text-xs text-subtle tnum">{assets.length} 项 · 每月约 {money(total.total, settings.display.currency, { free: false })}</p>
        <label className="mt-3 flex h-[34px] items-center gap-2 rounded-sm bg-field px-2.5 text-subtle">
          <Search size={15} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称、IP、标签、末四位" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle" />
          <kbd className="font-sans text-[11px]">⌘K</kbd>
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip on={filter === "all"} onClick={() => onFilter("all")}>全部<Count n={assets.length} on={filter === "all"} /></Chip>
          <Chip on={filter === "starred"} onClick={() => onFilter("starred")}>关注<Count n={starredCount} on={filter === "starred"} /></Chip>
          {ASSET_TYPES.filter((t) => counts[t]).map((t) => (
            <Chip key={t} on={filter === t} onClick={() => onFilter(t)}>{typeMeta[t].label}<Count n={counts[t]} on={filter === t} /></Chip>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {!list.length && <p className="px-4 pt-6 text-center text-[13px] text-subtle">{filter === "starred" && !q ? "还没有关注的资产。把鼠标移到资产上，点右侧的星标即可关注。" : assets.length ? "没有匹配的资产" : "还没有资产，点右上角 + 添加第一项"}</p>}
        {pinned.length > 0 && <Group title="置顶" count={pinned.length} />}
        {pinned.map(row)}
        {soon.length > 0 && <Group title="30 天内到期" count={soon.length} />}
        {soon.map(row)}
        {rest.length > 0 && <Group title={soon.length || pinned.length ? "之后" : "全部"} count={rest.length} />}
        {rest.map(row)}
      </div>
    </section>
  );
}

function Chip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-current={on ? "true" : undefined} className={clsx("inline-flex h-[26px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors",
      on ? "border-ink bg-ink font-medium text-bg" : "border-line text-muted hover:bg-field")}>{children}</button>
  );
}

function Count({ n, on }: { n: number; on: boolean }) {
  return <span className={clsx("tnum", on ? "text-bg/70" : "text-subtle")}>{n}</span>;
}

function Group({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-1.5 text-[11.5px] tracking-wide text-subtle">
      <span>{title}</span><span className="tnum">{count}</span>
    </div>
  );
}

function Row({ a, on, onClick, online, onStar }: { a: Asset; on: boolean; onClick: () => void; online?: boolean; onStar: () => void }) {
  const u = urgency(a);
  const card = a.payment;
  return (
    <div className={clsx("group/row flex w-full items-center border-l-[3px] transition-colors", on ? "border-accent bg-sel" : "border-transparent hover:bg-field/60")}>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-[13px] text-left outline-none focus-visible:bg-field/60">
        <TypeIcon type={a.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={clsx("truncate font-semibold", card?.status === "closed" && "text-subtle line-through")}>{a.name}</span>
            {a.komari && <span className={clsx("size-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-subtle")} />}
            {a.pinned && <Pin size={11} strokeWidth={2} className="shrink-0 text-subtle" aria-label="置顶" />}
          </div>
          <div className="truncate text-xs text-subtle">{a.subtitle || (card ? `${card.network ?? ""} ···· ${card.last4}` : a.provider)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={clsx("text-[12.5px] whitespace-nowrap tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{card?.status === "frozen" ? "冻结" : dueLabel(a)}</div>
        </div>
      </button>
      <StarButton on={a.starred} name={a.name} onToggle={onStar} reveal size={14} className="mr-2 ml-1 size-7" />
    </div>
  );
}
