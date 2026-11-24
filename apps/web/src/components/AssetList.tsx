import { ASSET_TYPES, compareAssets, displayTotal, isBilled, monthlyByCurrency, money, searchAssets } from "@fangcun/core";
import clsx from "clsx";
import { ChevronDown, Hash, Pin, Plus, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Asset, AssetType } from "../data/types";
import { dueLabel, getToday, perCycle, remindDays, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { StarButton, TypeIcon, typeMeta, urgencyText } from "./ui";

/** Asset list filter: one type, all, or 关注 (starred, pinned included). */
export type ListFilter = AssetType | "all" | "starred";
export const matchFilter = (a: Asset, f: ListFilter) => f === "all" || (f === "starred" ? a.starred : a.type === f);

export function AssetList({ selected, filter, onSelect, onFilter, onAdd, className }: { selected?: string; filter: ListFilter; onSelect: (id: string) => void; onFilter: (t: ListFilter) => void; onAdd: () => void; className?: string }) {
  const { assets, settings, status, setFocus } = useData();
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const today = getToday();
  const inType = assets.filter((a) => matchFilter(a, filter));
  // tags present in the current type filter, most used first; selected ones always shown
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of inType) for (const t of a.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  }, [inType]);
  const active = tags.filter((t) => tagCounts.some(([x]) => x === t));
  const TAG_LIMIT = 10;
  const shownTags = allTags ? tagCounts : tagCounts.filter(([t], i) => i < TAG_LIMIT || active.includes(t));
  const toggleTag = (t: string) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const list = searchAssets(inType.filter((a) => active.every((t) => a.tags.includes(t))), q).sort((a, b) => compareAssets(a, b, today));
  const pinned = list.filter((a) => a.pinned);
  const soon = list.filter((a) => !a.pinned && remindDays(a) <= 30);
  const rest = list.filter((a) => !a.pinned && remindDays(a) > 30);
  const starredCount = assets.filter((a) => a.starred).length;
  const monthly = displayTotal(monthlyByCurrency(inType.filter(isBilled)), settings.display).total;
  const row = (a: Asset) => <Row key={a.id} a={a} online={a.komari ? status[a.komari.uuid]?.online : undefined} on={a.id === selected} onClick={() => onSelect(a.id)} onStar={() => setFocus(a.id, { starred: !a.starred })} />;
  const counts = assets.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (!list.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = list.findIndex((x) => x.id === selected);
      const next = e.key === "ArrowDown" ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
      onSelect(list[next].id);
    }
  };

  return (
    <section className={clsx("flex min-w-0 shrink-0 flex-col border-line bg-panel max-lg:flex-1 lg:w-[330px] lg:border-r xl:w-[388px]", className)}>
      <div className="border-b border-line/70 px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[18px] leading-tight font-bold tracking-tight">资产</h2>
            <p className="mt-0.5 text-xs text-subtle tnum">
              {list.length} 项{monthly > 0 ? ` · 每月约 ${money(Math.round(monthly), settings.display.currency, { free: false })}` : ""}
            </p>
          </div>
          <button onClick={onAdd} title="添加资产" className="grid size-8 cursor-pointer place-items-center rounded-[8px] bg-accent text-on-accent shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[filter,transform] hover:brightness-110 active:scale-95">
            <Plus size={16} />
          </button>
        </div>

        <label className="mt-3 flex h-[34px] items-center gap-2 rounded-sm border border-transparent bg-field px-2.5 text-muted transition-[border-color,background-color] focus-within:border-ink/35 focus-within:bg-panel">
          <Search size={14} className="shrink-0" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleSearchKey} placeholder="筛选名称、IP、#标签、末四位" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle" />
          {q && (
            <button type="button" onClick={() => setQ("")} className="grid size-5 cursor-pointer place-items-center rounded text-subtle hover:bg-field hover:text-ink" aria-label="清空搜索">
              <X size={13} />
            </button>
          )}
        </label>

        <div className="mt-2 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">类型</span>
            <select value={filter} onChange={(e) => onFilter(e.target.value as ListFilter)}
              className="h-8 w-full cursor-pointer appearance-none rounded-sm border border-line bg-panel pr-8 pl-2.5 text-[13px] text-ink outline-none hover:bg-field focus:border-ink/40">
              <option value="all">全部 · {assets.length}</option>
              <option value="starred">关注 · {starredCount}</option>
              {ASSET_TYPES.filter((t) => counts[t] || t === filter).map((t) => <option key={t} value={t}>{typeMeta[t].label} · {counts[t] ?? 0}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted" />
          </label>
          {tagCounts.length > 0 && (
            <button onClick={() => setShowTags((v) => !v)} aria-expanded={showTags}
              className={clsx("inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-sm border px-2.5 text-[13px] whitespace-nowrap transition-colors",
                active.length ? "border-ink bg-ink text-bg" : "border-line text-muted hover:bg-field hover:text-ink")}>
              <Hash size={13} />标签{active.length > 0 && <span className="tnum">{active.length}</span>}
              <ChevronDown size={13} className={clsx("transition-transform", showTags && "rotate-180")} />
            </button>
          )}
        </div>
        {tagCounts.length > 0 && (showTags || active.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(showTags ? shownTags : shownTags.filter(([t]) => active.includes(t))).map(([t, n]) => (
              <TagChip key={t} on={active.includes(t)} onClick={() => toggleTag(t)}>#{t}<Count n={n} on={active.includes(t)} /></TagChip>
            ))}
            {showTags && tagCounts.length > TAG_LIMIT && (
              <button onClick={() => setAllTags((v) => !v)} className="h-[24px] cursor-pointer px-1.5 text-xs text-muted hover:text-ink">{allTags ? "收起" : `更多 ${tagCounts.length - shownTags.length}`}</button>
            )}
            {active.length > 0 && (
              <button onClick={() => setTags([])} className="inline-flex h-[24px] cursor-pointer items-center gap-0.5 px-1.5 text-xs text-muted hover:text-ink"><X size={12} />清除</button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pb-4">
        {!list.length && <p className="px-4 pt-8 text-center text-[13px] text-subtle">{filter === "starred" && !q ? "还没有关注的资产。把鼠标移到资产上，点右侧的星标即可关注。" : assets.length ? "没有匹配的资产" : "还没有资产，点右上角 + 添加第一项"}</p>}
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

function TagChip({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={clsx("inline-flex h-[24px] shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-xs whitespace-nowrap transition-colors",
      on ? "bg-ink font-medium text-bg" : "bg-field text-muted hover:text-ink")}>{children}</button>
  );
}

function Count({ n, on }: { n: number; on: boolean }) {
  return <span className={clsx("tnum", on ? "text-bg/70" : "text-subtle")}>{n}</span>;
}

function Group({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-1 text-[11.5px] font-medium text-muted">
      <span>{title}</span><span className="text-subtle tnum">{count}</span>
    </div>
  );
}

function Row({ a, on, onClick, online, onStar }: { a: Asset; on: boolean; onClick: () => void; online?: boolean; onStar: () => void }) {
  const u = urgency(a);
  const card = a.payment;
  const sub = card
    ? `${card.network ? `${card.network} ` : ""}···· ${card.last4}${card.balance != null ? ` · 余 ${money(card.balance, card.balanceCurrency || a.currency, { free: false })}` : ""}`
    : [a.subtitle || a.provider, a.price > 0 ? perCycle(a) : null].filter(Boolean).join(" · ");

  return (
    <div className={clsx("group/row flex w-full items-center border-l-[3px] transition-colors", on ? "border-accent bg-sel" : "border-transparent hover:bg-field/60")}>
      <button onClick={onClick} title={a.subtitle || undefined} className="flex min-h-[52px] min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2 pl-[13px] text-left outline-none focus-visible:bg-field/60">
        <TypeIcon type={a.type} size="sm" tinted />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={clsx("truncate text-[13px] font-medium", a.type === "server" && "font-mono text-[12.5px]", card?.status === "closed" && "text-subtle line-through")}>{a.name}</span>
            {a.komari && <span className={clsx("size-1.5 shrink-0 rounded-full", online ? "bg-ok" : "bg-subtle")} title={online ? "在线" : "离线"} />}
            {a.pinned && <Pin size={11} strokeWidth={2} className="shrink-0 text-muted" aria-label="置顶" />}
          </span>
          {sub && <span className="mt-0.5 block truncate text-[11.5px] text-subtle tnum">{sub}</span>}
        </span>
        <span className={clsx("shrink-0 text-[12px] whitespace-nowrap tnum", u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{card?.status === "frozen" ? "冻结" : dueLabel(a)}</span>
      </button>
      <StarButton on={a.starred} name={a.name} onToggle={onStar} reveal size={14} className="mr-2 ml-1 size-7" />
    </div>
  );
}
