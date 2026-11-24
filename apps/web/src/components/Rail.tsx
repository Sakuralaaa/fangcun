import clsx from "clsx";
import { Boxes, FileText, Gauge, KeyRound, LayoutDashboard, LogOut, Moon, Search, Server, Settings, Sun, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./ui";

export type Section = "overview" | "assets" | "servers" | "quota" | "costs" | "accounts" | "docs" | "settings";

/** `wide`: only on the side rail; the phone's bottom bar has room for one less (文档 stays reachable from 资产). */
const items: { id: Section; icon: typeof Boxes; label: string; wide?: boolean }[] = [
  { id: "overview", icon: LayoutDashboard, label: "总览" },
  { id: "assets", icon: Boxes, label: "资产" },
  { id: "servers", icon: Server, label: "服务器" },
  { id: "quota", icon: Gauge, label: "额度" },
  { id: "costs", icon: Wallet, label: "费用" },
  { id: "accounts", icon: KeyRound, label: "账号" },
  { id: "docs", icon: FileText, label: "文档", wide: true },
];

export function Rail({
  active,
  dark,
  onNav,
  onTheme,
  onSearch,
  dot,
  costDot,
  user,
  onLogout,
}: {
  active: Section;
  dark: boolean;
  onNav: (s: Section) => void;
  onTheme: () => void;
  onSearch?: () => void;
  dot?: boolean;
  costDot?: boolean;
  user?: string;
  onLogout?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    addEventListener("mousedown", onClick);
    addEventListener("keydown", onKey);
    return () => { removeEventListener("mousedown", onClick); removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-4 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-14 max-md:w-full max-md:flex-row max-md:justify-around max-md:gap-0 max-md:border-t max-md:border-r-0 max-md:bg-rail/92 max-md:px-1 max-md:py-0 max-md:backdrop-blur-md">
      <button type="button" onClick={() => onNav("overview")} title="方寸 · 总览" className="mb-3 cursor-pointer rounded-[10px] p-1 transition-transform hover:scale-105 max-md:hidden">
        <Logo />
      </button>

      {items.map(({ id, icon: Icon, label, wide }) => {
        const isOn = active === id;
        const showDot = (id === "overview" && dot) || (id === "costs" && costDot);
        return (
          <button
            key={id}
            onClick={() => onNav(id)}
            title={id === "costs" && costDot ? `${label}（有卡片余额不足或风险）` : label}
            aria-label={label}
            aria-current={isOn ? "page" : undefined}
            className={clsx(
              wide && "max-md:hidden",
              "relative flex w-[52px] shrink-0 cursor-pointer flex-col items-center gap-1 rounded-[10px] py-2 text-[10.5px] whitespace-nowrap transition-[background-color,color] duration-150 max-md:w-11 max-md:py-1.5",
              isOn ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-field hover:text-ink",
            )}
          >
            <Icon size={18} strokeWidth={isOn ? 2.1 : 1.8} />
            <span className={clsx(isOn && "font-semibold")}>{label}</span>
            {showDot && (
              <span
                className={clsx(
                  "absolute top-1.5 right-3 size-[7px] rounded-full border-[1.5px] border-rail",
                  id === "costs" ? "bg-crit" : "bg-spark",
                )}
              />
            )}
          </button>
        );
      })}

      <div className="flex-1 max-md:hidden" />

      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          title="快捷搜索 (⌘K)"
          aria-label="快捷搜索"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted transition-colors hover:bg-field hover:text-ink max-md:hidden"
        >
          <Search size={17} />
        </button>
      )}
      <button
        type="button"
        onClick={onTheme}
        className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted transition-colors hover:bg-field hover:text-ink"
        title={dark ? "切换浅色" : "切换深色"}
      >
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <button
        type="button"
        onClick={() => onNav("settings")}
        title="设置"
        className={clsx(
          "grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] transition-colors",
          active === "settings" ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-field hover:text-ink",
        )}
      >
        <Settings size={17} />
      </button>

      <div ref={menuRef} className="relative mt-2 max-md:hidden">
        <button
          type="button"
          onClick={() => onLogout && setMenuOpen((v) => !v)}
          title={user}
          className="grid size-8 cursor-pointer place-items-center rounded-full border border-line bg-panel text-xs font-bold uppercase text-ink transition-colors hover:bg-field"
        >
          {(user ?? "S").slice(0, 1)}
        </button>
        {onLogout && menuOpen && (
          <div className="fc-animate-pop absolute bottom-0 left-11 z-50 rounded-sm border border-line bg-panel p-1" style={{ boxShadow: "var(--shadow-float)" }}>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onLogout(); }}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 text-xs whitespace-nowrap text-muted hover:bg-field hover:text-ink"
            >
              <LogOut size={13} />退出 {user}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
