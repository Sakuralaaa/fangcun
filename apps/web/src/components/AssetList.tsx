import { displayTotal, monthlyByCurrency, money, searchAssets, ASSET_TYPES } from "@fangcun/core";
import clsx from "clsx";
import { Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { daysUntil, dueLabel, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { TypeIcon, typeMeta, urgencyText } from "./ui";

export function AssetList({ selected, filter, onSelect, onFilter, onAdd }: { selected?: string; filter: AssetType | "all"; onSelect: (id: string) => void; onFilter: (t: AssetType | "all") => void; onAdd: () => void }) {
  const { assets, status, settings } = useData();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); } };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  const list = searchAssets(assets.filter((a) => filter === "all" || a.type === filter), q).sort((a, b) => daysUntil(a.expiresAt) - daysUntil(b.expiresAt) || a.name.localeCompare(b.name));
  const soon = list.filter((a) => daysUntil(a.expiresAt) <= 30);
  const rest = list.filter((a) => daysUntil(a.expiresAt) > 30);
  const counts = assets.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});
  const total = displayTotal(monthlyByCurrency(assets), settings.display);

  return (
    <section className="flex w-[384px] shrink-0 flex-col border-r border-line bg-panel">
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
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          <Chip on={filter === "all"} onClick={() => onFilter("all")}>全部 {assets.length}</Chip>
          {ASSET_TYPES.filter((t) => counts[t]).map((t) => (
            <Chip key={t} on={filter === t} onClick={() => onFilter(t)}>{typeMeta[t].label} {counts[t]}</Chip>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {!list.length && <p className="px-4 pt-6 text-center text-[13px] text-subtle">{assets.length ? "没有匹配的资产" : "还没有资产，点右上角 + 添加第一项"}</p>}
        {soon.length > 0 && <Group title="30 天内到期" count={soon.length} />}
        {soon.map((a) => <Row key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} on={a.id === selected} onClick={() => onSelect(a.id)} />)}
        {rest.length > 0 && <Group title={soon.length ? "之后" : "全部"} count={rest.length} />}
        {rest.map((a) => <Row key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} on={a.id === selected} onClick={() => onSelect(a.id)} />)}
      </div>
    </section>
  );
}

function Chip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx("inline-flex h-[26px] shrink-0 items-center rounded-full border px-2.5 text-xs whitespace-nowrap tnum transition-colors",
      on ? "border-ink bg-ink font-medium text-bg" : "border-line text-muted hover:bg-field")}>{children}</button>
  );
}

function Group({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3 pb-1.5 text-[11.5px] tracking-wide text-subtle">
      <span>{title}</span><span className="tnum">{count}</span>
    </div>
  );
}

function Row({ a, on, onClick, online }: { a: Asset; on: boolean; onClick: () => void; online?: boolean }) {
  const u = urgency(a);
  const card = a.payment;
  return (
    <button onClick={onClick}
      className={clsx("flex w-full items-center gap-3 border-l-[3px] py-2.5 pr-4 pl-[13px] text-left transition-colors",
        on ? "border-accent bg-sel" : "border-transparent hover:bg-field/60")}>
      <TypeIcon type={a.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx("truncate font-semibold", card?.status === "closed" && "text-subtle line-through")}>{a.name}</span>
          {a.komari && <span className={clsx("size-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-subtle")} />}
        </div>
        <div className="truncate text-xs text-subtle">{a.subtitle || (card ? `${card.network ?? ""} ···· ${card.last4}` : a.provider)}</div>
      </div>
      <div className="text-right">
        <div className={clsx("text-[12.5px] tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{card?.status === "frozen" ? "冻结" : dueLabel(a)}</div>
      </div>
    </button>
  );
}
