import clsx from "clsx";
import { CreditCard, FileText, Globe, KeyRound, Mail, Server, ShieldCheck, Smartphone, Sparkles, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
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

export function Card({ title, extra, children, className, flush, scroll }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; flush?: boolean; scroll?: boolean }) {
  return (
    <section className={clsx("flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel", className)}>
      {title && (
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
          <h3 className="truncate text-[13.5px] font-semibold">{title}</h3>
          {extra && <div className="flex shrink-0 items-center gap-2 text-xs text-subtle">{extra}</div>}
        </header>
      )}
      <div className={clsx(flush ? "" : title ? "px-4 pb-4" : "p-4", scroll && "min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]")}>{children}</div>
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
