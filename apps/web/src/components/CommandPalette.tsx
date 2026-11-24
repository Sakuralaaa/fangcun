import { searchAssets, TYPE_LABEL } from "@fangcun/core";
import clsx from "clsx";
import { Boxes, CreditCard, FileText, Gauge, KeyRound, LayoutDashboard, Moon, Plus, Search, Server, Settings, Sun, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dueLabel, perCycle, urgency } from "../lib/fmt";
import { useData } from "../lib/store";
import { Kbd, TypeIcon, urgencyText } from "./ui";

type CommandItem = {
  id: string;
  group: "操作" | "页面" | "资产";
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  icon: React.ReactNode;
  keywords: string;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onNav,
  onSelectAsset,
  onAddAsset,
  dark,
  onTheme,
}: {
  open: boolean;
  onClose: () => void;
  onNav: (path: string) => void;
  onSelectAsset: (id: string) => void;
  onAddAsset: () => void;
  dark: boolean;
  onTheme: () => void;
}) {
  const { assets } = useData();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const trimmed = q.trim().toLowerCase();
    const actions: CommandItem[] = [
      {
        id: "act-add",
        group: "操作",
        title: "添加新资产",
        subtitle: "服务器、域名、订阅、支付卡…",
        icon: <span className="grid size-7 place-items-center rounded-[8px] bg-accent text-on-accent"><Plus size={14} /></span>,
        keywords: "add new create 添加 新建 资产",
        onSelect: () => { onClose(); onAddAsset(); },
      },
      {
        id: "act-theme",
        group: "操作",
        title: dark ? "切换为浅色主题" : "切换为深色主题",
        subtitle: "立即切换界面配色",
        icon: <span className="grid size-7 place-items-center rounded-[8px] bg-field text-muted">{dark ? <Sun size={14} /> : <Moon size={14} />}</span>,
        keywords: "theme dark light 主题 浅色 深色 夜间",
        onSelect: () => { onTheme(); onClose(); },
      },
    ];

    const pages: CommandItem[] = [
      { id: "pg-overview", group: "页面", title: "总览", subtitle: "即将到期与卡片预留概览", icon: <PageIcon icon={LayoutDashboard} />, keywords: "overview home 总览 首页", onSelect: () => { onNav("/overview"); onClose(); } },
      { id: "pg-cards", group: "页面", title: "卡片预留提醒", subtitle: "查看每张卡需要留多少钱与扣费推演", icon: <PageIcon icon={CreditCard} />, keywords: "card reserve balance payment 卡片 预留 余额 充值 扣费 留多少钱", onSelect: () => { onNav("/costs/cards"); onClose(); } },
      { id: "pg-costs", group: "页面", title: "费用明细", subtitle: "按币种与类型汇总每月支出", icon: <PageIcon icon={Wallet} />, keywords: "costs billing expense 费用 支出 账单", onSelect: () => { onNav("/costs"); onClose(); } },
      { id: "pg-assets", group: "页面", title: "全部资产", subtitle: `共 ${assets.length} 项资产`, icon: <PageIcon icon={Boxes} />, keywords: "assets 资产 列表", onSelect: () => { onNav("/assets"); onClose(); } },
      { id: "pg-servers", group: "页面", title: "服务器探针", subtitle: "Komari 节点状态与带宽", icon: <PageIcon icon={Server} />, keywords: "servers vps komari 服务器 探针", onSelect: () => { onNav("/servers"); onClose(); } },
      { id: "pg-quota", group: "页面", title: "额度监控", subtitle: "CLIProxyAPI 账号剩余额度", icon: <PageIcon icon={Gauge} />, keywords: "quota cliproxyapi 额度 用量", onSelect: () => { onNav("/quota"); onClose(); } },
      { id: "pg-accounts", group: "页面", title: "账号", subtitle: "控制台与登录账号", icon: <PageIcon icon={KeyRound} />, keywords: "accounts 账号 登录", onSelect: () => { onNav("/assets?type=account"); onClose(); } },
      { id: "pg-docs", group: "页面", title: "文档", subtitle: "合同、发票与附件", icon: <PageIcon icon={FileText} />, keywords: "docs documents 文档 附件", onSelect: () => { onNav("/assets?type=document"); onClose(); } },
      { id: "pg-settings", group: "页面", title: "设置", subtitle: "汇率、备份、集成与令牌", icon: <PageIcon icon={Settings} />, keywords: "settings 设置 汇率 备份", onSelect: () => { onNav("/settings"); onClose(); } },
    ];

    const matchedAssets = (trimmed ? searchAssets(assets, trimmed) : assets.slice(0, 8)).slice(0, 12).map<CommandItem>((a) => {
      const u = urgency(a);
      return {
        id: `asset-${a.id}`,
        group: "资产",
        title: a.name,
        subtitle: [TYPE_LABEL[a.type], a.payment?.last4 ? `···· ${a.payment.last4}` : null, a.subtitle || a.provider].filter(Boolean).join(" · "),
        right: (
          <span className="flex items-center gap-2.5 text-xs tnum">
            {a.price > 0 && <span className="text-muted">{perCycle(a)}</span>}
            {a.expiresAt && <span className={clsx(u === "crit" || u === "warn" ? "font-semibold" : "", urgencyText[u])}>{dueLabel(a)}</span>}
          </span>
        ),
        icon: <TypeIcon type={a.type} size="sm" tinted />,
        keywords: "",
        onSelect: () => { onSelectAsset(a.id); onClose(); },
      };
    });

    if (!trimmed) return [...matchedAssets.slice(0, 6), ...pages.slice(0, 5), ...actions];

    const matchCmd = (it: CommandItem) =>
      `${it.title} ${it.subtitle ?? ""} ${it.keywords}`.toLowerCase().includes(trimmed);

    return [
      ...matchedAssets,
      ...pages.filter(matchCmd),
      ...actions.filter(matchCmd),
    ];
  }, [q, assets, dark, onAddAsset, onClose, onNav, onSelectAsset, onTheme]);

  useEffect(() => { setIdx(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const activeEl = listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (items.length ? (i + 1) % items.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0)); }
    else if (e.key === "Enter" && items[idx]) { e.preventDefault(); items[idx].onSelect(); }
  };

  let lastGroup: string | null = null;

  return (
    <div className="fc-animate-fade fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="快捷搜索与命令" onKeyDown={onKeyDown}
        className="fc-animate-pop flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-line bg-panel" style={{ boxShadow: "var(--shadow-float)" }}>
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-muted" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="搜索资产名称、IP、标签、卡号末四位，或跳转页面…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-subtle" />
          {q && (
            <button type="button" onClick={() => setQ("")} className="grid size-6 cursor-pointer place-items-center rounded text-subtle hover:bg-field hover:text-ink" aria-label="清空">
              <X size={14} />
            </button>
          )}
          <Kbd>ESC</Kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {!items.length && <p className="px-4 py-10 text-center text-[13px] text-subtle">没有匹配的资产或命令</p>}
          {items.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            const active = i === idx;
            return (
              <div key={it.id}>
                {showGroup && <div className="px-4 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-subtle">{it.group}</div>}
                <button type="button" data-idx={i} onMouseEnter={() => setIdx(i)} onClick={it.onSelect}
                  className={clsx("flex h-11 w-full cursor-pointer items-center gap-3 px-4 text-left transition-colors", active ? "bg-sel text-ink" : "text-ink hover:bg-field/60")}>
                  {it.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{it.title}</span>
                    {it.subtitle && <span className="block truncate text-[11.5px] text-subtle">{it.subtitle}</span>}
                  </span>
                  {it.right}
                </button>
              </div>
            );
          })}
        </div>

        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-line bg-bg/60 px-4 text-[11.5px] text-subtle">
          <span className="flex items-center gap-2"><Kbd>↑↓</Kbd> 选择 <Kbd>↵</Kbd> 打开</span>
          <span>方寸 · 快捷跳转</span>
        </footer>
      </div>
    </div>
  );
}

function PageIcon({ icon: Icon }: { icon: typeof LayoutDashboard }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-field text-muted">
      <Icon size={14} strokeWidth={1.9} />
    </span>
  );
}
