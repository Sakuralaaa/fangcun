import clsx from "clsx";
import { CreditCard, FileText, Globe, KeyRound, Mail, MoreHorizontal, Pin, Server, ShieldCheck, Smartphone, Sparkles, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AssetType } from "../data/types";
import type { Urgency } from "../lib/fmt";

export const typeMeta: Record<AssetType, { label: string; icon: typeof Server; text: string; bar: string }> = {
  server: { label: "服务器", icon: Server, text: "text-t-server", bar: "bg-t-server" },
  domain: { label: "域名", icon: Globe, text: "text-t-domain", bar: "bg-t-domain" },
  cert: { label: "证书", icon: ShieldCheck, text: "text-t-cert", bar: "bg-t-cert" },
  subscription: { label: "订阅", icon: Sparkles, text: "text-t-sub", bar: "bg-t-sub" },
  mail: { label: "邮箱", icon: Mail, text: "text-t-mail", bar: "bg-t-mail" },
  phone: { label: "号码", icon: Smartphone, text: "text-t-phone", bar: "bg-t-phone" },
  payment: { label: "支付", icon: CreditCard, text: "text-t-payment", bar: "bg-t-payment" },
  account: { label: "账号", icon: KeyRound, text: "text-t-account", bar: "bg-t-account" },
  document: { label: "文档", icon: FileText, text: "text-t-document", bar: "bg-t-document" },
};

export function TypeIcon({ type, size = "md" }: { type: AssetType; size?: "sm" | "md" | "lg" }) {
  const m = typeMeta[type] ?? typeMeta.document;
  const Icon = m.icon;
  const box = { sm: "size-7 rounded-[7px]", md: "size-9 rounded-[10px]", lg: "size-14 rounded-[14px]" }[size];
  const ic = { sm: 14, md: 17, lg: 26 }[size];
  return (
    <span className={clsx("grid shrink-0 place-items-center bg-field", box, m.text)}>
      <Icon size={ic} strokeWidth={1.9} />
    </span>
  );
}

export const urgencyText: Record<Urgency, string> = {
  crit: "text-crit", warn: "text-warn", ok: "text-muted", none: "text-subtle",
};
const urgencyPill: Record<Urgency, string> = {
  crit: "bg-crit-soft text-crit", warn: "bg-warn-soft text-warn", ok: "bg-field text-muted", none: "bg-field text-muted",
};
export function Pill({ tone, children, dot }: { tone: Urgency; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", urgencyPill[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

type BtnProps = { children?: ReactNode; variant?: "default" | "primary" | "ghost" | "danger"; icon?: ReactNode; className?: string; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; title?: string };
export function Button({ children, variant = "default", icon, className, onClick, disabled, type = "button", title }: BtnProps) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-on-accent hover:brightness-110",
        variant === "default" && "border border-line bg-panel text-ink hover:bg-field",
        variant === "ghost" && "text-muted hover:bg-field hover:text-ink",
        variant === "danger" && "border border-line bg-panel text-crit hover:bg-crit-soft",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A card. The body is a size container (`@container`), so rows inside lay out by the card's own width, not the window's.
 * The header keeps the title whole: when title + extra do not fit on one line, the extra wraps under it.
 */
export function Card({ title, extra, children, className, flush, scroll, fill }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; flush?: boolean; scroll?: boolean; fill?: boolean }) {
  return (
    <section className={clsx("@container flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel", className)}>
      {title && (
        <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
          <h3 className="max-w-full min-w-0 shrink-0 truncate text-[13.5px] font-semibold whitespace-nowrap">{title}</h3>
          {extra && <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs whitespace-nowrap text-subtle">{extra}</div>}
        </header>
      )}
      <div className={clsx(flush ? "" : title ? "px-4 pb-4" : "p-4", scroll && "min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]", fill && "flex min-h-0 flex-1 flex-col")}>{children}</div>
    </section>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full border border-line px-2.5 text-xs text-muted">{children}</span>;
}

export function KomariBadge({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex h-[18px] items-center gap-1 rounded-[5px] bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent", className)}>
      Komari
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="方寸">
      <rect x="3" y="3" width="26" height="26" rx="7" fill="none" stroke="var(--color-accent)" strokeWidth="3.2" />
      <rect x="16.5" y="16.5" width="7.5" height="7.5" rx="2" fill="var(--color-spark)" />
    </svg>
  );
}

export function Modal({ title, onClose, children, footer, width = 520 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl" style={{ maxWidth: width }}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-7 place-items-center rounded-[7px] text-subtle hover:bg-field hover:text-ink"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-sm border border-line bg-field px-3 text-[13px] outline-none placeholder:text-subtle focus:border-ink/40";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs text-muted">{label}{hint && <span className="ml-1.5 text-subtle">{hint}</span>}</span>
      {children}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, mono, type = "text", className, autoFocus, maxLength, inputMode }: { value: string | number | undefined | null; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string; className?: string; autoFocus?: boolean; maxLength?: number; inputMode?: "numeric" | "decimal" | "text" }) {
  return <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} maxLength={maxLength} inputMode={inputMode}
    className={clsx(inputCls, mono && "font-mono text-[12.5px]", className)} />;
}

export function Select<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: [T, string][]; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={clsx(inputCls, "pr-8", className)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function TextArea({ value, onChange, rows = 3, placeholder }: { value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea value={value ?? ""} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
    className="w-full resize-y rounded-sm border border-line bg-field px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-subtle focus:border-ink/40" />;
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange?.(!on)} aria-pressed={on}
      className={clsx("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-accent" : "bg-line")}>
      <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-4 text-[13px] text-subtle">{children}</p>;
}

/**
 * A single row of chips or tabs that never clips silently: it scrolls sideways (wheel works too, scrollbar hidden),
 * fades out at whichever edge has more to show, and brings the active item (`aria-current`) into view.
 */
export function ScrollRow({ children, className, activeKey }: { children: ReactNode; className?: string; activeKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const l = el.scrollLeft > 2;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="true"]');
    if (active) {
      const left = active.offsetLeft - el.offsetLeft;
      if (left < el.scrollLeft || left + active.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 24);
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [update, activeKey]);
  const fade = 28;
  const mask = `linear-gradient(to right, transparent 0, #000 ${edge.l ? fade : 0}px, #000 calc(100% - ${edge.r ? fade : 0}px), transparent 100%)`;
  return (
    <div ref={ref} onScroll={update}
      onWheel={(e) => { const el = ref.current; if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY; }}
      className={clsx("flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  );
}

/**
 * 关注 star. Ink / neutral only (orange and red stay reserved for the logo and for due dates).
 * Filled when starred; outline otherwise. `reveal` hides an unstarred star until its row is hovered or the button is focused
 * (rows mark themselves with `group/row`); on touch screens it is always shown.
 */
export function StarButton({ on, onToggle, name, size = 15, reveal, className }: { on: boolean; onToggle: () => void; name: string; size?: number; reveal?: boolean; className?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} onKeyDown={(e) => e.stopPropagation()}
      aria-pressed={on} aria-label={on ? `取消关注「${name}」` : `关注「${name}」`} title={on ? "取消关注" : "关注"}
      className={clsx("grid shrink-0 place-items-center rounded-[6px] transition-[color,opacity] hover:bg-field focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ink/30",
        on ? "text-ink" : "text-muted hover:text-ink",
        reveal && !on && "opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100",
        className ?? "size-7")}>
      <Star size={size} strokeWidth={1.9} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** `fill` (above): the body is a flex column that takes the card's remaining height, so a textarea inside can grow with it. */

/** Read-only 关注 / 置顶 mark next to a name. */
export function FocusMark({ starred, pinned, size = 12, className }: { starred?: boolean; pinned?: boolean; size?: number; className?: string }) {
  if (!starred && !pinned) return null;
  return (
    <span className={clsx("inline-flex shrink-0 items-center gap-0.5 text-muted", className)} title={pinned ? "置顶 · 已关注" : "已关注"} aria-label={pinned ? "置顶，已关注" : "已关注"} role="img">
      {pinned && <Pin size={size - 1} strokeWidth={2} />}
      <Star size={size} strokeWidth={1.9} fill="currentColor" />
    </span>
  );
}

/** Small "更多" menu: a button that opens a list of actions. Escape / outside click closes; arrow keys move between items. */
export function MoreMenu({ items, label = "更多操作" }: { items: { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    addEventListener("mousedown", close);
    addEventListener("keydown", key);
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", key); };
  }, [open]);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <div ref={box} className="relative">
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        className="grid size-8 place-items-center rounded-sm border border-line bg-panel text-muted hover:bg-field hover:text-ink">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" onKeyDown={move} className="absolute right-0 z-40 mt-1 min-w-[148px] rounded-sm border border-line bg-panel py-1 shadow-lg">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onSelect(); }}
              className={clsx("flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] whitespace-nowrap outline-none hover:bg-field focus:bg-field", it.danger ? "text-crit" : "text-ink")}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
