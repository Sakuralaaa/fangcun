/** Shared pieces of the probe views (服务器页节点卡、详情页运行状态卡). */
import clsx from "clsx";
import { Terminal } from "lucide-react";
import type { ReactNode } from "react";
import type { Asset, NodeStatus } from "../data/types";

// ---------- numbers ----------

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
/** Bytes → [number, unit] with three significant digits (1.11 GB, 14.1 GB, 362 MB). */
export function bytesParts(b: number): [string, string] {
  let v = Math.max(0, b || 0), i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const n = i === 0 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return [n, UNITS[i]];
}
export const bytes = (b: number) => bytesParts(b).join(" ");
export const speedParts = (b: number): [string, string] => { const [n, u] = bytesParts(b); return [n, `${u}/s`]; };
export const speedText = (b: number) => speedParts(b).join(" ");

/** Big value with a small unit, as in 「9.29 KB/s」. */
export function Num({ v, u, className, unitClass }: { v: ReactNode; u?: string; className?: string; unitClass?: string }) {
  return (
    <span className={clsx("tnum whitespace-nowrap", className)}>
      {v}{u && <span className={clsx("ml-0.5 text-[0.72em] font-medium text-subtle", unitClass)}>{u}</span>}
    </span>
  );
}

export function uptimeParts(sec: number): [string, string] {
  if (sec >= 86400) return [String(Math.floor(sec / 86400)), "天"];
  if (sec >= 3600) return [String(Math.floor(sec / 3600)), "小时"];
  return [String(Math.max(0, Math.floor(sec / 60))), "分钟"];
}

export const pct = (a: number, b: number) => (b > 0 ? Math.min(100, (a / b) * 100) : 0);
export const pctLabel = (p: number) => (p >= 10 ? p.toFixed(0) : p.toFixed(1));

/** Usage colour: the metric's own hue, orange from 80 %, red from 90 %. */
export function usageTone(p: number, hue: string) {
  return p >= 90 ? "bg-crit" : p >= 80 ? "bg-warn" : hue;
}
export function usageText(p: number) {
  return p >= 90 ? "text-crit" : p >= 80 ? "text-warn" : "";
}

/** Latency colour: green when quick, olive when middling, orange only when really slow. */
export function latencyTone(ms: number | null) {
  if (ms === null) return "bg-p-track";
  return ms >= 300 ? "bg-warn" : ms >= 150 ? "bg-p-mid" : "bg-ok";
}
export function latencyText(ms: number | null) {
  if (ms === null) return "text-subtle";
  return ms >= 300 ? "text-warn" : ms >= 150 ? "text-p-mid" : "text-ok";
}
export function lossTone(l: number | null) {
  if (l === null) return "bg-p-track";
  return l >= 20 ? "bg-crit" : l >= 5 ? "bg-warn" : "bg-ok";
}
export function lossText(l: number | null) {
  if (l === null) return "text-subtle";
  return l >= 20 ? "text-crit" : l >= 5 ? "text-warn" : "text-ok";
}

/** Total bandwidth in words. */
export function bandwidthLabel(bps: number): string {
  if (bps < 128 * 1024) return "闲置";
  if (bps < 4 * 1024 ** 2) return "平稳";
  if (bps < 32 * 1024 ** 2) return "繁忙";
  return "高负载";
}

// ---------- bars ----------

/** Segmented block bar: `pct` of `n` blocks lit. */
export function SegBar({ value, tone, n = 20, className, h = "h-[7px]" }: { value: number; tone: string; n?: number; className?: string; h?: string }) {
  const lit = value <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, value) / 100) * n));
  return (
    <div className={clsx("flex gap-[3px]", className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => <span key={i} className={clsx("min-w-0 flex-1 rounded-[2px]", h, i < lit ? tone : "bg-p-track")} />)}
    </div>
  );
}

/** Dot trend of recent speeds: each dot's weight follows the sample. */
export function DotTrend({ data, n = 16, className }: { data?: number[]; n?: number; className?: string }) {
  const d = (data ?? []).slice(-n);
  const pad = Array.from({ length: n - d.length }, () => -1);
  const all = [...pad, ...d];
  const max = Math.max(1, ...d);
  return (
    <div className={clsx("flex h-2.5 items-center justify-between", className)} aria-hidden>
      {all.map((v, i) => {
        const r = v < 0 ? 0 : v / max;
        return <span key={i} className={clsx("rounded-full", v < 0 ? "size-[3px] bg-p-track" : r < 0.05 ? "size-[3px] bg-subtle/40" : "bg-ok")}
          style={v >= 0 && r >= 0.05 ? { width: 3 + r * 3, height: 3 + r * 3, opacity: 0.35 + r * 0.65 } : undefined} />;
      })}
    </div>
  );
}

/** Latency columns: height follows ms, colour follows the latency level; a gap shows as a flat grey tick. */
export function LatencyBars({ buckets, className, h = 16 }: { buckets: { ms: number | null }[]; className?: string; h?: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.ms ?? 0));
  return (
    <div className={clsx("flex items-end gap-[2px]", className)} style={{ height: h }} aria-hidden>
      {buckets.map((b, i) => (
        <span key={i} className={clsx("min-w-0 flex-1 rounded-[1.5px]", latencyTone(b.ms))}
          style={{ height: b.ms === null ? 2 : Math.max(4, Math.round((0.35 + 0.65 * (b.ms / max)) * h)) }} />
      ))}
    </div>
  );
}

/** Loss columns: full-height blocks coloured by that slot's loss. */
export function LossBars({ buckets, className, h = 16 }: { buckets: { loss: number | null }[]; className?: string; h?: number }) {
  return (
    <div className={clsx("flex items-end gap-[2px]", className)} style={{ height: h }} aria-hidden>
      {buckets.map((b, i) => <span key={i} className={clsx("min-w-0 flex-1 rounded-[1.5px]", lossTone(b.loss))} style={{ height: b.loss === null ? 2 : h }} />)}
    </div>
  );
}

// ---------- node facts ----------

export const detail = (a: Asset, label: string) => a.details.find((d) => d.label === label)?.value ?? "";
export const nodeRegion = (a: Asset, s?: NodeStatus) => s?.region || detail(a, "地区");
export const nodeOs = (a: Asset, s?: NodeStatus) => s?.os || detail(a, "系统");
export function nodeCores(a: Asset, s?: NodeStatus): number | null {
  if (s?.cores) return s.cores;
  const m = /(\d+)\s*核/.exec(detail(a, "CPU"));
  return m ? Number(m[1]) : null;
}

// ---------- flags ----------

const REGION_CODES: [RegExp, string][] = [
  [/香港|hong ?kong|^hk$/i, "HK"], [/澳门|macao|macau/i, "MO"], [/台湾|台北|taiwan|^tw$/i, "TW"],
  [/新加坡|singapore|^sg$/i, "SG"], [/日本|东京|大阪|japan|tokyo|osaka|^jp$/i, "JP"], [/韩国|首尔|korea|seoul|^kr$/i, "KR"],
  [/美国|洛杉矶|圣何塞|硅谷|西雅图|纽约|达拉斯|芝加哥|迈阿密|阿什本|凤凰城|united states|los angeles|san jose|seattle|new york|dallas|^us$|^usa$/i, "US"],
  [/加拿大|多伦多|温哥华|蒙特利尔|canada|^ca$/i, "CA"], [/德国|法兰克福|柏林|纽伦堡|germany|frankfurt|^de$/i, "DE"],
  [/英国|伦敦|united kingdom|london|^uk$|^gb$/i, "GB"], [/法国|巴黎|france|paris|^fr$/i, "FR"], [/荷兰|阿姆斯特丹|netherlands|amsterdam|^nl$/i, "NL"],
  [/俄罗斯|莫斯科|russia|moscow|^ru$/i, "RU"], [/澳大利亚|澳洲|悉尼|墨尔本|australia|sydney|^au$/i, "AU"], [/印度|孟买|india|mumbai|^in$/i, "IN"],
  [/土耳其|伊斯坦布尔|turkey|türkiye|istanbul|^tr$/i, "TR"], [/中国|大陆|北京|上海|广州|深圳|杭州|成都|china|^cn$/i, "CN"],
];

/** Region text → ISO code: an emoji flag, a two-letter code, or a common place name. */
export function regionCode(region?: string): string | null {
  const t = (region ?? "").trim();
  if (!t) return null;
  const cps = [...t].map((c) => c.codePointAt(0)!).filter((c) => c >= 0x1f1e6 && c <= 0x1f1ff);
  if (cps.length >= 2) return String.fromCharCode(cps[0] - 0x1f1e6 + 65, cps[1] - 0x1f1e6 + 65);
  for (const [re, code] of REGION_CODES) if (re.test(t)) return code;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return null;
}

const star = (cx: number, cy: number, r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
};
const bands = (cols: string[], vertical = false) => cols.map((c, i) =>
  vertical ? <rect key={i} x={(30 / cols.length) * i} y="0" width={30 / cols.length} height="20" fill={c} />
    : <rect key={i} x="0" y={(20 / cols.length) * i} width="30" height={20 / cols.length} fill={c} />);

/** Simplified flags (drawn here, no image files) for the usual VPS regions. */
const FLAGS: Record<string, ReactNode> = {
  CN: <><rect width="30" height="20" fill="#de2910" /><polygon points={star(6, 6, 3.6)} fill="#ffde00" /><polygon points={star(11, 2.6, 1)} fill="#ffde00" /><polygon points={star(12.8, 5, 1)} fill="#ffde00" /><polygon points={star(12.8, 8, 1)} fill="#ffde00" /><polygon points={star(11, 10.2, 1)} fill="#ffde00" /></>,
  HK: <><rect width="30" height="20" fill="#de2910" />{[0, 72, 144, 216, 288].map((r) => <ellipse key={r} cx="15" cy="6.6" rx="2" ry="3.4" fill="#fff" transform={`rotate(${r} 15 10)`} />)}</>,
  MO: <><rect width="30" height="20" fill="#00785e" /><circle cx="15" cy="11" r="3.6" fill="#fff" /><polygon points={star(15, 4.6, 1.4)} fill="#ffde00" /></>,
  TW: <><rect width="30" height="20" fill="#fe0000" /><rect width="15" height="10" fill="#000095" /><circle cx="7.5" cy="5" r="2.6" fill="#fff" /></>,
  SG: <><rect width="30" height="20" fill="#fff" /><rect width="30" height="10" fill="#ef3340" /><circle cx="6.8" cy="5" r="3.2" fill="#fff" /><circle cx="8.2" cy="5" r="3.1" fill="#ef3340" /><circle cx="11" cy="3.4" r=".7" fill="#fff" /><circle cx="12.6" cy="5" r=".7" fill="#fff" /><circle cx="11" cy="6.6" r=".7" fill="#fff" /></>,
  JP: <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="5.6" fill="#bc002d" /></>,
  KR: <><rect width="30" height="20" fill="#fff" /><path d="M10 10a5 5 0 0 1 10 0z" fill="#cd2e3a" /><path d="M10 10a5 5 0 0 0 10 0z" fill="#0047a0" /><g fill="#000"><rect x="3.4" y="3.2" width="4" height=".9" transform="rotate(-34 5.4 3.6)" /><rect x="22.6" y="15.9" width="4" height=".9" transform="rotate(-34 24.6 16.3)" /><rect x="22.6" y="3.2" width="4" height=".9" transform="rotate(34 24.6 3.6)" /><rect x="3.4" y="15.9" width="4" height=".9" transform="rotate(34 5.4 16.3)" /></g></>,
  US: <>{Array.from({ length: 13 }, (_, i) => <rect key={i} x="0" y={(20 / 13) * i} width="30" height={20 / 13 + 0.05} fill={i % 2 ? "#fff" : "#b22234"} />)}<rect width="13" height={(20 / 13) * 7} fill="#3c3b6e" />{[2, 5, 8, 11].flatMap((x) => [2.2, 5.4, 8.6].map((y) => <circle key={`${x}-${y}`} cx={x + (y === 5.4 ? 1.2 : 0)} cy={y} r=".55" fill="#fff" />))}</>,
  CA: <><rect width="30" height="20" fill="#fff" /><rect width="7.5" height="20" fill="#d80621" /><rect x="22.5" width="7.5" height="20" fill="#d80621" /><polygon points="15,4.5 16.4,7.6 18.6,7 17.4,10.4 19,11.2 15.6,13.4 15.6,15.6 14.4,15.6 14.4,13.4 11,11.2 12.6,10.4 11.4,7 13.6,7.6" fill="#d80621" /></>,
  DE: <>{bands(["#000", "#dd0000", "#ffce00"])}</>,
  GB: <><rect width="30" height="20" fill="#012169" /><path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" /><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" strokeWidth="1.4" /><path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" /><path d="M15 0v20M0 10h30" stroke="#c8102e" strokeWidth="3.4" /></>,
  FR: <>{bands(["#0055a4", "#fff", "#ef4135"], true)}</>,
  NL: <>{bands(["#ae1c28", "#fff", "#21468b"])}</>,
  RU: <>{bands(["#fff", "#0039a6", "#d52b1e"])}</>,
  IN: <>{bands(["#ff9933", "#fff", "#138808"])}<circle cx="15" cy="10" r="2.2" fill="none" stroke="#000080" strokeWidth=".7" /></>,
  AU: <><rect width="30" height="20" fill="#012169" /><path d="M0 0L13 10M13 0L0 10" stroke="#fff" strokeWidth="2" /><path d="M6.5 0v10M0 5h13" stroke="#fff" strokeWidth="3" /><path d="M6.5 0v10M0 5h13" stroke="#c8102e" strokeWidth="1.6" /><polygon points={star(6.5, 15, 2)} fill="#fff" /><polygon points={star(22, 5, 1.1)} fill="#fff" /><polygon points={star(25.5, 9, 1.1)} fill="#fff" /><polygon points={star(22, 16, 1.1)} fill="#fff" /><polygon points={star(19, 10, 1.1)} fill="#fff" /></>,
  TR: <><rect width="30" height="20" fill="#e30a17" /><circle cx="11" cy="10" r="5" fill="#fff" /><circle cx="12.3" cy="10" r="4" fill="#e30a17" /><polygon points={star(17.4, 10, 2.2)} fill="#fff" transform="rotate(-18 17.4 10)" /></>,
};

export function Flag({ region, className }: { region?: string; className?: string }) {
  const code = regionCode(region);
  const f = code ? FLAGS[code] : null;
  if (f) {
    return (
      <svg viewBox="0 0 30 20" className={clsx("h-[14px] w-[21px] shrink-0 overflow-hidden rounded-[3px] ring-1 ring-ink/10", className)} role="img" aria-label={region}>
        <title>{region}</title>{f}
      </svg>
    );
  }
  return (
    <span title={region || "地区未知"} className={clsx("inline-grid h-[14px] w-[21px] shrink-0 place-items-center rounded-[3px] bg-field font-mono text-[8.5px] font-semibold text-muted ring-1 ring-ink/10", className)}>
      {code ?? "··"}
    </span>
  );
}

// ---------- OS marks (monochrome) ----------

type OsKind = "debian" | "ubuntu" | "alpine" | "windows" | "arch" | "redhat" | "freebsd" | "apple" | "linux";
export function osKind(os?: string): OsKind {
  const t = (os ?? "").toLowerCase();
  if (/debian/.test(t)) return "debian";
  if (/ubuntu/.test(t)) return "ubuntu";
  if (/alpine/.test(t)) return "alpine";
  if (/windows/.test(t)) return "windows";
  if (/arch|manjaro/.test(t)) return "arch";
  if (/centos|rocky|alma|red ?hat|rhel|fedora|oracle|anolis|opencloud/.test(t)) return "redhat";
  if (/bsd/.test(t)) return "freebsd";
  if (/mac|darwin/.test(t)) return "apple";
  return "linux";
}

const OS_SVG: Record<Exclude<OsKind, "linux">, ReactNode> = {
  debian: <path d="M13.6 4.6a6 6 0 1 0-1.8 8.4M13.6 4.6A4.2 4.2 0 1 0 9.6 11a2.6 2.6 0 0 1-2-4.2 1.8 1.8 0 0 1 2.6 2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  ubuntu: <><circle cx="9" cy="9" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="4.2" cy="9" r="1.7" fill="currentColor" /><circle cx="11.4" cy="4.8" r="1.7" fill="currentColor" /><circle cx="11.4" cy="13.2" r="1.7" fill="currentColor" /></>,
  alpine: <path d="M1.8 13.6 6.6 5.4l2.8 4.6 1.8-2.8 5 6.4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />,
  windows: <path d="M2.5 4.2 8 3.4v5.2H2.5zM9 3.2l6.5-.9v6.3H9zM2.5 9.6H8v5.2l-5.5-.8zM9 9.6h6.5v6.2L9 14.9z" fill="currentColor" />,
  arch: <path d="M9 2 15.6 15.6c-1.4-.9-3-1.6-4.3-1.9.2-.9 0-2.2-.6-3.2-.6-1-1.1-1.4-1.7-1.4s-1.1.4-1.7 1.4c-.6 1-.8 2.3-.6 3.2-1.3.3-2.9 1-4.3 1.9z" fill="currentColor" />,
  redhat: <><circle cx="9" cy="9" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5.2 9.6c1.6 1.2 6 1.2 7.6 0l-1.4-3.4H6.6z" fill="currentColor" /></>,
  freebsd: <><circle cx="9" cy="9.6" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.4 2.6c1.4.2 2.4 1 2.8 2M14.6 2.6c-1.4.2-2.4 1-2.8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>,
  apple: <path d="M11.8 2.4c.1 1-.3 2-1 2.6-.6.6-1.5 1-2.3.9-.1-1 .4-2 1-2.6.7-.6 1.6-1 2.3-.9zM14.6 12.2c-.4.9-.6 1.3-1.1 2.1-.7 1.1-1.7 2.4-2.9 2.4-1.1 0-1.4-.7-2.8-.7s-1.8.7-2.8.7c-1.2 0-2.1-1.2-2.8-2.3C.4 11.4.2 7.8 1.4 6c.9-1.3 2.2-2 3.4-2 1.3 0 2 .7 3 .7s1.6-.7 3-.7c1.1 0 2.2.6 3 1.6-2.6 1.4-2.2 5.2.8 6.6z" fill="currentColor" />,
};

export function OsMark({ os, className }: { os?: string; className?: string }) {
  const k = osKind(os);
  return (
    <span title={os || "系统未知"} className={clsx("grid size-8 shrink-0 place-items-center rounded-full border border-line text-muted", className)}>
      {k === "linux" ? <Terminal size={14} strokeWidth={2} /> : <svg viewBox="0 0 18 18" width="15" height="15">{OS_SVG[k]}</svg>}
    </span>
  );
}
