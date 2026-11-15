import { DEFAULT_SETTINGS, type AtollSnapshot, type CfSnapshot, type NodeStatus, type Settings } from "@fangcun/core";
import type { Asset, StatusMap } from "./types";

/** Demo mode (?demo=1 or VITE_DEMO=1): fixed sample data, nothing leaves the browser. */
export const DEMO_TODAY = "2026-11-15";
const T = "2026-11-15T03:00:00.000Z";

type Seed = Partial<Asset> & Pick<Asset, "id" | "type" | "name">;
const mk = (s: Seed): Asset => ({
  price: 0, currency: "USD", cycle: "month", autoRenew: false, tags: [], details: [], related: [], renewals: [], starred: false, pinned: false,
  createdAt: T, updatedAt: T, deletedAt: null, ...s,
});
const kom = (uuid: string, overridden: NonNullable<Asset["komari"]>["overridden"] = {}, trafficResetDay?: number): Asset["komari"] => ({
  uuid, agentVersion: "1.5.11", syncedAt: "2026-11-15T03:02:00.000Z", fields: {}, overridden, ...(trafficResetDay ? { trafficResetDay } : {}),
});

export const demoAssets: Asset[] = [
  mk({ id: "acc-cloud", type: "account", name: "演示云 控制台", subtitle: "云服务器子账号", provider: "演示云", cycle: "once", tags: ["星桥商城"],
    account: { username: "ops@starbridge.example", site: "console.democloud.example", hasTotp: true, websites: [{ label: "控制台", url: "console.democloud.example" }, { label: "工单", url: "support.democloud.example" }] },
    note: "子账号，只有香港和新加坡区权限；主账号在财务那边。" }),
  mk({ id: "acc-reg", type: "account", name: "域名注册商", subtitle: "域名管理", provider: "域名注册商", cycle: "once", account: { username: "sak@starbridge.example", site: "dash.registrar.example" } }),
  mk({ id: "acc-ai", type: "account", name: "AI 平台", subtitle: "订阅付款账号", provider: "AI 平台", cycle: "once", account: { username: "sak@starbridge.example", site: "platform.ai.example" } }),
  mk({ id: "acc-mail", type: "account", name: "企业邮箱后台", subtitle: "管理员", provider: "企业邮箱", cycle: "once", account: { username: "admin@starbridge.example", site: "mail.starbridge.example" } }),

  mk({ id: "hk-api-02", starred: true, type: "server", name: "hk-api-02", subtitle: "香港 API 副节点", provider: "演示云",
    price: 24, currency: "USD", cycle: "month", expiresAt: "2026-11-22", autoRenew: false, purchasedAt: "2025-11-22",
    tags: ["星桥商城", "production"], accountId: "acc-cloud", related: ["api-cert", "starbridge", "hk-api-01", "card-wise"],
    note: "星桥商城 API 的备用节点。到期前确认流量是否还需要两台，不需要就并到 hk-api-01。",
    details: [
      { label: "IPv4", value: "192.0.2.11", mono: true }, { label: "地区", value: "香港" },
      { label: "CPU", value: "4 核 · AMD EPYC" }, { label: "内存", value: "8 GB" },
      { label: "硬盘", value: "80 GB" }, { label: "系统", value: "Ubuntu 24.04" },
    ],
    renewals: [
      { date: "2026-10-22", amount: 24, note: "手动续费" }, { date: "2026-09-22", amount: 24, note: "手动续费" },
      { date: "2026-08-22", amount: 24, note: "手动续费" },
    ],
    komari: kom("7f3c-hk02", { price: { komari: 20 } }, 1) }),
  mk({ id: "hk-api-01", starred: true, pinned: true, type: "server", name: "hk-api-01", subtitle: "香港 API 主节点", provider: "演示云",
    price: 24, currency: "USD", cycle: "month", expiresAt: "2027-01-02", autoRenew: true, purchasedAt: "2025-01-02",
    tags: ["星桥商城", "production"], accountId: "acc-cloud", related: ["hk-api-02"],
    details: [{ label: "IPv4", value: "192.0.2.10", mono: true }, { label: "地区", value: "香港" }, { label: "CPU", value: "4 核" }, { label: "内存", value: "8 GB" }, { label: "硬盘", value: "80 GB" }, { label: "系统", value: "Ubuntu 24.04" }],
    renewals: [{ date: "2026-12-02", amount: 24, note: "自动扣费" }], komari: kom("2a91-hk01", {}, 2) }),
  mk({ id: "sg-pg", type: "server", name: "sg-pg-primary", subtitle: "新加坡 · 数据库主库", provider: "海峡主机",
    price: 48, currency: "USD", cycle: "month", expiresAt: "2026-11-27", autoRenew: true, purchasedAt: "2024-05-27",
    tags: ["星桥商城", "database"], accountId: "acc-cloud",
    details: [{ label: "IPv4", value: "198.51.100.7", mono: true }, { label: "地区", value: "新加坡" }, { label: "CPU", value: "8 核" }, { label: "内存", value: "16 GB" }, { label: "硬盘", value: "320 GB NVMe" }, { label: "系统", value: "Debian 12" }],
    komari: kom("c0de-sgpg", {}, 27) }),
  mk({ id: "la-lab", type: "server", name: "la-lab", subtitle: "洛杉矶 · 实验机", provider: "西岸云",
    price: 36, currency: "USD", cycle: "year", expiresAt: "2027-03-14", autoRenew: false, purchasedAt: "2026-03-14", tags: ["个人"],
    details: [{ label: "IPv4", value: "203.0.113.42", mono: true }, { label: "地区", value: "洛杉矶" }, { label: "CPU", value: "1 核" }, { label: "内存", value: "1 GB" }, { label: "硬盘", value: "20 GB" }, { label: "系统", value: "Alpine 3.20" }],
    komari: kom("9b2e-lalab"), atoll: { serverId: "srv_lalab" } }),
  mk({ id: "tyo-edge", type: "server", name: "tyo-edge", subtitle: "东京 · 博客与静态站", provider: "樱花云",
    price: 299, currency: "CNY", cycle: "year", expiresAt: "2027-08-09", autoRenew: true, purchasedAt: "2025-08-09", tags: ["个人", "CN2 GIA"],
    details: [{ label: "IPv4", value: "203.0.113.61", mono: true }, { label: "地区", value: "东京" }, { label: "CPU", value: "2 核" }, { label: "内存", value: "2 GB" }, { label: "硬盘", value: "40 GB" }, { label: "系统", value: "Debian 12" }],
    note: "不限流量套餐。", komari: kom("51aa-tyo") }),
  mk({ id: "fra-backup", type: "server", name: "fra-backup", subtitle: "法兰克福 · 异地备份", provider: "莱茵主机",
    price: 4.5, currency: "EUR", cycle: "month", expiresAt: "2026-11-19", autoRenew: false, purchasedAt: "2025-02-19", tags: ["备份"],
    details: [{ label: "IPv4", value: "198.51.100.88", mono: true }, { label: "地区", value: "法兰克福" }, { label: "CPU", value: "1 核" }, { label: "内存", value: "2 GB" }, { label: "硬盘", value: "500 GB HDD" }, { label: "系统", value: "Ubuntu 22.04" }],
    note: "备份盘快满了，续费前决定要不要换大盘。", komari: kom("e7f0-fra", {}, 19) }),
  mk({ id: "sjc-build", type: "server", name: "sjc-build", subtitle: "圣何塞 · 构建机", provider: "西岸云",
    price: 60, currency: "USD", cycle: "year", expiresAt: "2027-02-01", autoRenew: true, purchasedAt: "2026-02-01", tags: ["CI", "星桥商城"],
    details: [{ label: "IPv4", value: "192.0.2.150", mono: true }, { label: "地区", value: "圣何塞" }, { label: "CPU", value: "4 核" }, { label: "内存", value: "8 GB" }, { label: "硬盘", value: "100 GB" }, { label: "系统", value: "Rocky Linux 9" }],
    komari: kom("3c3c-sjc", {}, 1) }),
  mk({ id: "lon-relay", type: "server", name: "lon-relay", subtitle: "伦敦 · 中转", provider: "雾都主机",
    price: 3, currency: "GBP", cycle: "month", expiresAt: "2026-12-28", autoRenew: true, purchasedAt: "2026-06-28", tags: ["中转"],
    details: [{ label: "IPv4", value: "203.0.113.200", mono: true }, { label: "地区", value: "伦敦" }, { label: "CPU", value: "1 核" }, { label: "内存", value: "512 MB" }, { label: "硬盘", value: "10 GB" }, { label: "系统", value: "Alpine 3.20" }],
    komari: kom("8d8d-lon") }),
  mk({ id: "api-cert", type: "cert", name: "api.starbridge.example", subtitle: "TLS 证书 · Let's Encrypt", provider: "Let's Encrypt",
    price: 0, cycle: "quarter", expiresAt: "2026-11-19", purchasedAt: "2026-08-21",
    tags: ["星桥商城"], related: ["hk-api-02", "starbridge"], note: "自动续期脚本 10 月迁机后没恢复，要手动续。",
    details: [{ label: "域名", value: "api.starbridge.example", mono: true }, { label: "签发者", value: "R11" }, { label: "类型", value: "ECDSA P-256" }, { label: "部署在", value: "hk-api-01 / 02" }] }),
  mk({ id: "starbridge", starred: true, pinned: true, type: "domain", name: "starbridge.example", subtitle: "主域名", provider: "域名注册商",
    price: 88, currency: "CNY", cycle: "year", expiresAt: "2026-12-03", purchasedAt: "2021-12-03",
    tags: ["星桥商城"], accountId: "acc-reg", related: ["api-cert"],
    details: [{ label: "DNS", value: "Cloudflare" }, { label: "注册人", value: "个人" }, { label: "实名", value: "已完成" }, { label: "转移锁", value: "开启" }],
    renewals: [{ date: "2025-12-01", amount: 88, note: "手动续费" }] }),
  mk({ id: "sak-dev", type: "domain", name: "sak.dev", subtitle: "个人站", provider: "域名注册商",
    price: 12, cycle: "year", expiresAt: "2027-06-11", autoRenew: true, purchasedAt: "2023-06-11",
    tags: ["个人"], accountId: "acc-reg", details: [{ label: "DNS", value: "Cloudflare" }] }),
  mk({ id: "ai-code", starred: true, type: "subscription", name: "研发编程助手", subtitle: "AI 订阅 · Pro", provider: "AI 平台",
    price: 100, cycle: "month", expiresAt: "2026-11-30", autoRenew: true, purchasedAt: "2025-08-30",
    tags: ["工作"], accountId: "acc-ai", related: ["card-wise"],
    details: [{ label: "套餐", value: "Pro" }],
    quota: {
      observedAt: "2026-11-15 11:24",
      accounts: [
        { authIndex: "a1b2c3d4", provider: "codex", email: "sak@starbridge.example", plan: "Pro", status: "ready",
          windows: [{ label: "5 小时", usedPct: 62, resetAt: "2026-11-15 13:40" }, { label: "每周", usedPct: 38, resetAt: "2026-11-19 08:00" }] },
        { authIndex: "e5f6a7b8", provider: "claude", email: "dev@starbridge.example", plan: "Max 5x", status: "cooling",
          windows: [{ label: "5 小时", usedPct: 100, resetAt: "2026-11-15 12:10" }, { label: "每周", usedPct: 81, resetAt: "2026-11-17 02:00" }] },
      ],
    } }),
  mk({ id: "gpt-team", starred: true, type: "subscription", name: "ChatGPT Team", subtitle: "团队订阅 · 2 个工作空间", provider: "OpenAI",
    price: 1380, currency: "CNY", cycle: "month", expiresAt: "2026-11-26", autoRenew: true, purchasedAt: "2026-03-26",
    tags: ["工作", "号池"], accountId: "acc-ai", related: ["card-onekey"], details: [{ label: "母号", value: "owner@starbridge.example" }],
    team: {
      owner: "owner@starbridge.example",
      workspaces: [
        { id: "ws-dev", name: "研发空间", seats: 5, price: 820, currency: "CNY", cycle: "month", expiresAt: "2026-11-26", region: "土耳其区", discount: "年付 8 折",
          members: [
            { email: "owner@starbridge.example", role: "owner" },
            { email: "dev1@starbridge.example", role: "member", authIndex: "t1", quota: [{ label: "5 小时", usedPct: 45, resetAt: "2026-11-15 14:30" }, { label: "每周", usedPct: 22, resetAt: "2026-11-20 08:00" }] },
            { email: "dev2@starbridge.example", role: "member", authIndex: "t2", quota: [{ label: "5 小时", usedPct: 92, resetAt: "2026-11-15 12:50" }, { label: "每周", usedPct: 74, resetAt: "2026-11-18 08:00" }] },
            { email: "dev3@starbridge.example", role: "member" },
          ] },
        { id: "ws-ops", name: "内容空间", seats: 3, price: 560, currency: "CNY", cycle: "month", expiresAt: "2026-12-09", region: "美区",
          members: [
            { email: "owner@starbridge.example", role: "owner" },
            { email: "pool-a@starbridge.example", role: "member", authIndex: "t3", quota: [{ label: "5 小时", usedPct: 10, resetAt: "2026-11-15 16:00" }, { label: "每周", usedPct: 35, resetAt: "2026-11-21 08:00" }] },
            { email: "pool-b@starbridge.example", role: "member", authIndex: "t4", quota: [{ label: "5 小时", usedPct: 0, resetAt: "2026-11-15 17:00" }, { label: "每周", usedPct: 8, resetAt: "2026-11-22 08:00" }] },
          ] },
      ],
    } }),
  mk({ id: "ai-chat", type: "subscription", name: "对话助手", subtitle: "AI 订阅 · Plus", provider: "AI 平台",
    price: 20, cycle: "month", expiresAt: "2026-12-08", autoRenew: true, purchasedAt: "2024-02-08",
    tags: ["个人"], accountId: "acc-ai", related: ["card-wise"], details: [{ label: "套餐", value: "Plus" }] }),
  mk({ id: "mail", type: "mail", name: "admin@starbridge.example", subtitle: "企业邮箱 · 5 席位", provider: "企业邮箱",
    price: 300, currency: "CNY", cycle: "year", expiresAt: "2027-02-20", purchasedAt: "2024-02-20",
    tags: ["星桥商城"], accountId: "acc-mail", related: ["starbridge"], details: [{ label: "席位", value: "5" }] }),
  mk({ id: "phone", type: "phone", name: "+1 (555) 010-2233", subtitle: "美国号码 · 接码用", provider: "虚拟号码",
    price: 3, cycle: "month", expiresAt: "2026-12-01", autoRenew: true, purchasedAt: "2025-06-01", tags: ["个人"],
    phone: { number: "+1 (555) 010-2233", carrier: "虚拟号码平台", country: "美国", purpose: "海外服务注册验证" },
    note: "每 90 天至少收一条短信保号。" }),
  mk({ id: "card-wise", starred: true, type: "payment", name: "美元虚拟卡", subtitle: "Visa ···· 4242", provider: "示例数字银行",
    price: 0, cycle: "year", purchasedAt: "2025-03-02", tags: ["支付"], related: ["hk-api-02", "ai-code", "ai-chat"],
    payment: { issuer: "示例数字银行", network: "Visa", last4: "4242", cardExpiry: "2028-09", billingRegion: "美国", fees: "开卡免费 · 充值 0.5%", status: "active" },
    expiresAt: "2028-09-30" }),
  mk({ id: "card-onekey", type: "payment", name: "U 卡", subtitle: "Mastercard ···· 8817", provider: "示例 U 卡平台",
    price: 1, cycle: "month", purchasedAt: "2026-01-12", tags: ["支付", "号池"], related: ["gpt-team"],
    payment: { issuer: "示例 U 卡平台", network: "Mastercard", last4: "8817", cardExpiry: "2026-12", billingRegion: "香港", fees: "开卡 $10 · USDT 充值 1.5%", status: "active" },
    expiresAt: "2026-12-31", note: "只用来付团队订阅；余额低于 $50 记得充值。" }),
  // Sparse records, like real libraries: one or two fields, no note, no renewals, no purchase date, expiry in another year.
  mk({ id: "lab-xyz", type: "domain", name: "lab-sample.xyz", provider: "Cloudflare", price: 10.44, cycle: "year", expiresAt: "2027-08-06",
    details: [{ label: "DNS 托管", value: "Cloudflare" }] }),
  // Free domain: renewable only in the 180 days before expiry, so it is due when that window opens.
  mk({ id: "free-dom", type: "domain", name: "sample.dpdns.org", provider: "DigitalPlat", price: 0, cycle: "year", expiresAt: "2027-05-10", renewWindowDays: 180 }),
  mk({ id: "spare-vps", type: "server", name: "spare-vps", provider: "小鸡云", price: 4, cycle: "month", expiresAt: "2027-01-28",
    details: [{ label: "IPv4", value: "203.0.113.9", mono: true }] }),
  mk({ id: "notes-app", type: "subscription", name: "笔记应用", price: 96, currency: "CNY", cycle: "year", expiresAt: "2027-01-10", autoRenew: true }),
  mk({ id: "lab-cert", type: "cert", name: "*.lab-sample.xyz", provider: "Let's Encrypt", cycle: "quarter", expiresAt: "2027-02-02", autoRenew: true }),
  mk({ id: "lab-mail", type: "mail", name: "hi@lab-sample.xyz", cycle: "year" }),
  mk({ id: "doc-transfer", type: "document", name: "域名转移授权", cycle: "once" }),
];

const st = (s: Partial<NodeStatus> & Pick<NodeStatus, "uuid">): NodeStatus => ({
  online: true, cpu: 0, ram: [0, 0], swap: [0, 0], disk: [0, 0], load: [0, 0, 0], up: 0, down: 0, totalUp: 0, totalDown: 0,
  trafficLimit: 0, trafficType: "max", uptimeSec: 0, tcp: 0, udp: 0, process: 0, netHistory: [], ...s,
});
const D = 86_400;
const G = 1024 ** 3;
const T1 = 1024 ** 4;
/** Deterministic hour of ping slots: base ms plus a wobble; `lost` slots carry loss, `gaps` have no sample. */
function ping(task: string, base: number, wobble: number, lost: Record<number, number> = {}, gaps: number[] = []): NonNullable<NodeStatus["ping"]> {
  const buckets = Array.from({ length: 24 }, (_, i) => {
    if (gaps.includes(i)) return { ms: null, loss: null };
    const l = lost[i] ?? 0;
    return { ms: l >= 100 ? null : Math.round(base + wobble * Math.abs(Math.sin(i * 1.3 + base))), loss: l };
  });
  const ok = buckets.filter((b) => b.ms !== null);
  const seen = buckets.filter((b) => b.loss !== null);
  return {
    task, buckets,
    latest: ok.length ? ok[ok.length - 1].ms : null,
    avg: ok.length ? Math.round(ok.reduce((x, b) => x + (b.ms ?? 0), 0) / ok.length) : null,
    loss: seen.length ? Math.round((seen.reduce((x, b) => x + (b.loss ?? 0), 0) / seen.length) * 10) / 10 : 0,
  };
}
const wave = (base: number, amp: number, phase = 0) => Array.from({ length: 24 }, (_, i) => Math.max(0, Math.round(base + amp * Math.sin(i / 2.2 + phase) + (amp / 2) * Math.sin(i * 1.7 + phase))));
export const demoStatus: StatusMap = {
  "7f3c-hk02": st({ uuid: "7f3c-hk02", group: "主力", cores: 4, os: "Ubuntu 24.04", region: "🇭🇰", cpu: 23, ram: [3328599654, 8589934592], disk: [44023414784, 85899345920], load: [0.42, 0.51, 0.47], up: 1887436, down: 6710886, totalUp: 335007449088, totalDown: 734439407616, trafficLimit: T1, trafficType: "max", uptimeSec: 37 * D, tcp: 412, udp: 18, process: 141,
    netHistory: [3, 4, 4, 5, 6, 5, 4, 3, 3, 2, 2, 3, 5, 7, 9, 8, 7, 8, 9, 10, 8, 7, 8, 8], upHistory: wave(1800000, 700000), downHistory: wave(6500000, 2500000, 1), ping: ping("电信 CN2", 32, 14) }),
  "2a91-hk01": st({ uuid: "2a91-hk01", group: "主力", cores: 4, os: "Ubuntu 24.04", region: "🇭🇰", cpu: 41, ram: [5583457484, 8589934592], disk: [55834574848, 85899345920], load: [1.12, 1.12, 1.12], up: 3355443, down: 10276044, totalUp: 558345748480, totalDown: 923417968640, trafficLimit: T1, trafficType: "max", uptimeSec: 88 * D, tcp: 960, udp: 4, process: 188,
    netHistory: [5, 6, 7, 6, 8, 9, 8, 7, 9, 10, 11, 9, 8, 9, 10, 12, 11, 10, 9, 10, 11, 12, 10, 9], upHistory: wave(3300000, 900000, 2), downHistory: wave(10000000, 3000000, 0.5), ping: ping("电信 CN2", 28, 10) }),
  "c0de-sgpg": st({ uuid: "c0de-sgpg", group: "主力", cores: 8, os: "Debian 12", region: "🇸🇬", cpu: 12, ram: [12240656793, 17179869184], disk: [201863462912, 343597383680], load: [0.36, 0.36, 0.36], up: 419430, down: 943718, totalUp: 103079215104, totalDown: 152471339008, trafficLimit: 2 * T1, trafficType: "sum", uptimeSec: 201 * D, tcp: 120, udp: 4, process: 96,
    netHistory: [2, 2, 1, 2, 3, 2, 2, 1, 1, 2, 2, 3, 2, 2, 3, 2, 2, 2, 1, 2, 2, 3, 2, 2], upHistory: wave(400000, 150000, 3), downHistory: wave(900000, 300000, 1.5) }),
  "51aa-tyo": st({ uuid: "51aa-tyo", group: "建站", cores: 2, os: "Debian 12", region: "🇯🇵", cpu: 6.4, ram: [612368384, 2147483648], disk: [9663676416, 42949672960], load: [0.08, 0.11, 0.09], up: 96256, down: 31744, totalUp: 1.42 * T1, totalDown: 0.31 * T1, trafficLimit: 0, trafficType: "max", uptimeSec: 64 * D, tcp: 58, udp: 2, process: 72,
    netHistory: wave(120000, 60000), upHistory: wave(90000, 50000, 0.7), downHistory: wave(30000, 15000, 2.2), ping: ping("联通 9929", 62, 18) }),
  "e7f0-fra": st({ uuid: "e7f0-fra", group: "备用", cores: 1, os: "Ubuntu 22.04", region: "🇩🇪", cpu: 3.1, ram: [905969664, 2147483648], disk: [467077693440, 536870912000], load: [0.21, 0.18, 0.2], up: 2150, down: 640, totalUp: 41 * G, totalDown: 389 * G, trafficLimit: 2 * T1, trafficType: "max", uptimeSec: 12 * D, tcp: 14, udp: 1, process: 61,
    netHistory: wave(3000, 2000), upHistory: wave(2000, 1500, 1.1), downHistory: wave(800, 600, 0.3), ping: ping("电信 163", 212, 40, { 7: 6, 15: 4 }) }),
  "3c3c-sjc": st({ uuid: "3c3c-sjc", group: "备用", cores: 4, os: "Rocky Linux 9", region: "🇺🇸", cpu: 93.4, ram: [6012954214, 8589934592], disk: [60129542144, 107374182400], load: [3.92, 3.41, 2.77], up: 22020096, down: 41943040, totalUp: 352 * G, totalDown: 518 * G, trafficLimit: 1 * T1, trafficType: "sum", uptimeSec: 5 * D + 7200, tcp: 233, udp: 9, process: 312,
    netHistory: wave(60000000, 20000000), upHistory: wave(21000000, 8000000, 0.4), downHistory: wave(40000000, 15000000, 1.9), ping: ping("移动 CMI", 158, 60, { 3: 10, 4: 25, 18: 8 }, [11]) }),
  "9b2e-lalab": st({ uuid: "9b2e-lalab", online: false, group: "建站", cores: 1, os: "Alpine 3.20", region: "🇺🇸", totalUp: 61 * G, totalDown: 104 * G, trafficLimit: 500 * G }),
  "8d8d-lon": st({ uuid: "8d8d-lon", online: false, group: "建站", cores: 1, os: "Alpine 3.20", region: "🇬🇧", totalUp: 12 * G, totalDown: 9 * G, trafficLimit: 0 }),
};

export const demoSettings: Settings = { ...DEFAULT_SETTINGS, komari: { ...DEFAULT_SETTINGS.komari, url: "https://probe.sak.example" }, atoll: { enabled: true, url: "https://atoll.sak.example", intervalMin: 15 }, cloudflare: { enabled: true } };
export const demoKomariInfo = { url: "https://probe.sak.example", hasKey: true, version: "1.2.5 (e446bee)", lastSync: "2026-11-15T03:02:00.000Z", lastError: null, nodes: 8 };

// Atoll (read-only container panel) — demo snapshot. hk-api-01/02 and sg-pg match by public IP;
// la-lab sits behind NAT on Atoll (no public IPv4 reported) and is bound by hand; fra-edge is not in 方寸.
const AT = "2026-11-15T03:05:00.000Z";
const dom = (id: string, service_id: string, hostname: string, status = "active", proxied = true) => ({ id, service_id, hostname, status, proxied });
export const demoAtollSnapshot: AtollSnapshot = {
  syncedAt: AT,
  servers: [
    { id: "srv_hk01", name: "hk-api-01", status: "online", public_ipv4: "192.0.2.10", provider: "演示云", region: "香港" },
    { id: "srv_hk02", name: "hk-api-02", status: "online", public_ipv4: "192.0.2.11", provider: "演示云", region: "香港" },
    { id: "srv_sgpg", name: "sg-db", status: "online", public_ipv4: "198.51.100.7", provider: "海峡主机", region: "新加坡" },
    { id: "srv_lalab", name: "lab", status: "online", public_ipv6: "2001:db8:42::1", provider: "西岸云", region: "洛杉矶" },
    { id: "srv_fra", name: "fra-edge", status: "offline", public_ipv4: "203.0.113.80", region: "法兰克福" },
  ],
  projects: [
    { id: "prj_api", name: "starbridge-api", display_name: "星桥商城 API", server_id: "srv_hk02", services: [
      { id: "svc_api", name: "api", kind: "image", image: "ghcr.io/starbridge/api:2.14.1", status: "running", domains: [dom("d1", "svc_api", "api.starbridge.example")] },
      { id: "svc_admin", name: "admin", kind: "image", image: "ghcr.io/starbridge/admin:2.14.1", status: "running", domains: [dom("d2", "svc_admin", "admin.starbridge.example", "active", false)] },
      { id: "svc_worker", name: "worker", kind: "image", image: "ghcr.io/starbridge/worker:2.14.1", status: "deploying", domains: [] },
      { id: "svc_redis", name: "redis", kind: "redis", image: "redis:7.4-alpine", status: "running", domains: [] },
    ] },
    { id: "prj_web", name: "starbridge-web", display_name: "星桥官网", server_id: "srv_hk01", services: [
      { id: "svc_web", name: "web", kind: "image", image: "ghcr.io/starbridge/web:1.8.0", status: "running", domains: [dom("d3", "svc_web", "starbridge.example"), dom("d4", "svc_web", "www.starbridge.example")] },
    ] },
    { id: "prj_data", name: "starbridge-data", display_name: "星桥数据", server_id: "srv_sgpg", services: [
      { id: "svc_pg", name: "postgres", kind: "postgres", image: "postgres:17.2", status: "running", domains: [] },
      { id: "svc_metabase", name: "metabase", kind: "image", image: "metabase/metabase:v0.52", status: "running", domains: [dom("d5", "svc_metabase", "bi.starbridge.example")] },
    ] },
    { id: "prj_blog", name: "blog", display_name: "个人博客", server_id: "srv_lalab", services: [
      { id: "svc_ghost", name: "ghost", kind: "image", image: "ghost:5.105-alpine", status: "running", domains: [dom("d6", "svc_ghost", "blog.sak.dev")] },
      { id: "svc_mysql", name: "mysql", kind: "mysql", image: "mysql:8.4", status: "running", domains: [] },
    ] },
    { id: "prj_kuma", name: "uptime", display_name: "状态页", server_id: "srv_lalab", services: [
      { id: "svc_kuma", name: "uptime-kuma", kind: "image", image: "louislam/uptime-kuma:1.23", status: "stopped", domains: [dom("d7", "svc_kuma", "status.sak.dev", "pending", false)] },
    ] },
    { id: "prj_edge", name: "edge-cache", server_id: "srv_fra", services: [
      { id: "svc_varnish", name: "varnish", kind: "image", image: "varnish:7.6", status: "unknown", domains: [dom("d8", "svc_varnish", "cdn.example.net")] },
    ] },
  ],
};
export const demoAtollInfo = {
  enabled: true, url: "https://atoll.sak.example", hasKey: true, lastSync: AT, lastError: null, projects: 6, servers: 5,
  key: { readOnly: true, permissions: ["read"], projectScoped: false, checkedAt: AT },
};

// Cloudflare (read-only) — demo snapshot. starbridge.example was renewed at Cloudflare but the ledger still says 2026-12-03
// (so a suggestion shows); admin.starbridge.example points at hk-api-01 while Atoll runs it on hk-api-02; status.sak.dev
// has no record yet; bi.* goes through the sg-data tunnel (cloudflared on sg-pg-primary); sak-lab.net and shop-preview.io
// have no domain asset (importable).
const CF = "Sun 2026-11-15 3:06 AM UTC (UTC+00:00)";
const ACC = "4f1c9a7e2b6d4c0f8a3e5b7d9c1e2f30";
const ZS = "9a1f3c5e7b2d4f6a8c0e1b3d5f7a9c2e";
const ZD = "1c3e5a7f9b2d4e6f8a0c2e4b6d8f0a1c";
const TUN_SG = "6f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";
const TUN_HOME = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ns = ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"];
const r = (zoneId: string, name: string, type: "A" | "AAAA" | "CNAME", content: string, proxied = true) => ({ zoneId, name, type, content, proxied, ttl: 1 });
export const demoCfSnapshot: CfSnapshot = {
  syncedAt: CF,
  accounts: [{ id: ACC, name: "sak 的账户" }],
  zones: [
    { id: ZS, name: "starbridge.example", status: "active", paused: false, accountId: ACC, nameServers: ns, originalRegistrar: "域名注册商", plan: "Free Website" },
    { id: ZD, name: "sak.dev", status: "active", paused: false, accountId: ACC, nameServers: ns, plan: "Free Website" },
    { id: "7e9c1a3b5d7f9e1c3a5b7d9f1e3c5a7b", name: "sak-lab.net", status: "active", paused: false, accountId: ACC, nameServers: ns, plan: "Free Website" },
    { id: "2b4d6f8a0c2e4a6c8e0b2d4f6a8c0e2b", name: "shop-preview.io", status: "pending", paused: false, accountId: ACC, nameServers: ["kim.ns.cloudflare.com", "tom.ns.cloudflare.com"], originalRegistrar: "其他注册商", plan: "Free Website" },
  ],
  records: [
    r(ZS, "starbridge.example", "A", "192.0.2.10"),
    r(ZS, "www.starbridge.example", "CNAME", "starbridge.example"),
    r(ZS, "api.starbridge.example", "A", "192.0.2.11"),
    r(ZS, "admin.starbridge.example", "A", "192.0.2.10", false),
    r(ZS, "bi.starbridge.example", "CNAME", `${TUN_SG}.cfargotunnel.com`),
    r(ZS, "ci.starbridge.example", "A", "192.0.2.150", false),
    r(ZS, "docs.starbridge.example", "CNAME", "starbridge-docs.pages.dev"),
    r(ZD, "sak.dev", "CNAME", "sak-dev.pages.dev"),
    r(ZD, "www.sak.dev", "CNAME", "sak-dev.pages.dev"),
    r(ZD, "blog.sak.dev", "AAAA", "2001:db8:42::1"),
    r(ZD, "static.sak.dev", "A", "203.0.113.61"),
    r(ZD, "nas.sak.dev", "CNAME", `${TUN_HOME}.cfargotunnel.com`),
  ],
  registrations: [
    { name: "starbridge.example", accountId: ACC, status: "active", expiresAt: "2027-12-03", autoRenew: true, locked: true },
    { name: "sak.dev", accountId: ACC, status: "active", expiresAt: "2027-06-11", autoRenew: true, locked: true },
    { name: "sak-lab.net", accountId: ACC, status: "active", expiresAt: "2027-02-14", autoRenew: true, locked: true },
  ],
  tunnels: [
    { id: TUN_SG, name: "sg-data", status: "healthy", accountId: ACC, hostnames: ["bi.starbridge.example"], originIps: ["198.51.100.7"], connections: 4 },
    { id: TUN_HOME, name: "home-lab", status: "healthy", accountId: ACC, hostnames: ["nas.sak.dev"], originIps: ["203.0.113.99"], connections: 2 },
    { id: "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", name: "old-relay", status: "inactive", accountId: ACC, hostnames: [], originIps: [], connections: 0 },
  ],
  workers: [
    { name: "edge-router", accountId: ACC, modifiedOn: "2026-10-28", domains: ["edge.sak.dev"] },
    { name: "og-image", accountId: ACC, modifiedOn: "2026-09-02", domains: [] },
  ],
  pages: [
    { name: "sak-dev", accountId: ACC, subdomain: "sak-dev.pages.dev", domains: ["sak.dev", "www.sak.dev"] },
    { name: "starbridge-docs", accountId: ACC, subdomain: "starbridge-docs.pages.dev", domains: ["docs.starbridge.example"] },
  ],
  r2: [
    { name: "starbridge-assets", accountId: ACC, location: "APAC", createdAt: "2025-03-02" },
    { name: "fra-backup-archive", accountId: ACC, location: "WEUR", createdAt: "2025-02-20" },
  ],
  sections: { accounts: { state: "ok" }, zones: { state: "ok" }, dns: { state: "ok" }, registrar: { state: "ok" }, tunnels: { state: "ok" }, workers: { state: "ok" }, pages: { state: "ok" }, r2: { state: "ok" } },
};
export const demoCfInfo = {
  enabled: true, hasToken: true, hasAccountId: false, lastSync: CF, lastError: null,
  token: { kind: "user" as const, status: "active", expiresOn: null, readOnly: true, checkedAt: CF,
    permissions: ["Account Settings Read", "Zone Read", "DNS Read", "Registrar Domains Read", "Cloudflare Tunnel Read", "Workers Scripts Read", "Pages Read", "Workers R2 Storage Read", "API Tokens Read"] },
  sections: demoCfSnapshot.sections,
  counts: { accounts: 1, zones: 4, records: 12, tunnels: 3 },
};
