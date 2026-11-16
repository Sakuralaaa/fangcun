import clsx from "clsx";
import { Boxes, FileText, Gauge, KeyRound, LayoutDashboard, LogOut, Moon, Server, Settings, Sun, Wallet } from "lucide-react";
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

export function Rail({ active, dark, onNav, onTheme, dot, user, onLogout }: { active: Section; dark: boolean; onNav: (s: Section) => void; onTheme: () => void; dot?: boolean; user?: string; onLogout?: () => void }) {
  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-rail py-4 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-14 max-md:w-full max-md:flex-row max-md:justify-around max-md:gap-0 max-md:border-t max-md:border-r-0 max-md:px-1 max-md:py-0">
      <div className="mb-4 max-md:hidden"><Logo /></div>
      {items.map(({ id, icon: Icon, label, wide }) => (
        <button key={id} onClick={() => onNav(id)} title={label} aria-label={label} aria-current={active === id ? "page" : undefined}
          className={clsx(wide && "max-md:hidden", "relative flex w-[52px] shrink-0 flex-col items-center gap-1 rounded-[10px] py-2 text-[10.5px] whitespace-nowrap transition-colors max-md:w-11 max-md:py-1.5",
            active === id ? "bg-accent-soft text-accent" : "text-muted hover:bg-field hover:text-ink")}>
          <Icon size={19} strokeWidth={1.8} />
          <span className={clsx(active === id && "font-semibold")}>{label}</span>
          {id === "overview" && dot && <span className="absolute top-1.5 right-3 size-[7px] rounded-full border-2 border-rail bg-spark" />}
        </button>
      ))}
      <div className="flex-1 max-md:hidden" />
      <button onClick={onTheme} className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-field" title={dark ? "浅色" : "深色"}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button onClick={() => onNav("settings")} title="设置"
        className={clsx("grid size-9 shrink-0 place-items-center rounded-[10px]", active === "settings" ? "bg-accent-soft text-accent" : "text-muted hover:bg-field")}>
        <Settings size={18} />
      </button>
      <div className="group relative mt-2 max-md:hidden">
        <div className="grid size-8 place-items-center rounded-full bg-field text-xs font-bold uppercase" title={user}>{(user ?? "S").slice(0, 1)}</div>
        {onLogout && (
          <button onClick={onLogout} className="absolute bottom-0 left-10 hidden h-8 items-center gap-1.5 rounded-sm border border-line bg-panel px-2.5 text-xs whitespace-nowrap text-muted shadow group-hover:flex hover:text-ink">
            <LogOut size={13} />退出 {user}
          </button>
        )}
      </div>
    </nav>
  );
}
