import { DEFAULT_SETTINGS, type NodeStatus, type Settings } from "@fangcun/core";
import type { Asset, StatusMap } from "./types";

/** Demo mode (?demo=1 or VITE_DEMO=1): fixed sample data, nothing leaves the browser. */
export const DEMO_TODAY = "2026-11-15";
const T = "2026-11-15T03:00:00.000Z";

type Seed = Partial<Asset> & Pick<Asset, "id" | "type" | "name">;
const mk = (s: Seed): Asset => ({
  price: 0, currency: "USD", cycle: "month", autoRenew: false, tags: [], details: [], related: [], renewals: [],
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

  mk({ id: "hk-api-02", type: "server", name: "hk-api-02", subtitle: "香港 API 副节点", provider: "演示云",
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
  mk({ id: "hk-api-01", type: "server", name: "hk-api-01", subtitle: "香港 API 主节点", provider: "演示云",
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
    komari: kom("9b2e-lalab") }),
  mk({ id: "api-cert", type: "cert", name: "api.starbridge.example", subtitle: "TLS 证书 · Let's Encrypt", provider: "Let's Encrypt",
    price: 0, cycle: "quarter", expiresAt: "2026-11-19", purchasedAt: "2026-08-21",
    tags: ["星桥商城"], related: ["hk-api-02", "starbridge"], note: "自动续期脚本 10 月迁机后没恢复，要手动续。",
    details: [{ label: "域名", value: "api.starbridge.example", mono: true }, { label: "签发者", value: "R11" }, { label: "类型", value: "ECDSA P-256" }, { label: "部署在", value: "hk-api-01 / 02" }] }),
  mk({ id: "starbridge", type: "domain", name: "starbridge.example", subtitle: "主域名", provider: "域名注册商",
    price: 88, currency: "CNY", cycle: "year", expiresAt: "2026-12-03", purchasedAt: "2021-12-03",
    tags: ["星桥商城"], accountId: "acc-reg", related: ["api-cert"],
    details: [{ label: "DNS", value: "Cloudflare" }, { label: "注册人", value: "个人" }, { label: "实名", value: "已完成" }, { label: "转移锁", value: "开启" }],
    renewals: [{ date: "2025-12-01", amount: 88, note: "手动续费" }] }),
  mk({ id: "sak-dev", type: "domain", name: "sak.dev", subtitle: "个人站", provider: "域名注册商",
    price: 12, cycle: "year", expiresAt: "2027-06-11", autoRenew: true, purchasedAt: "2023-06-11",
    tags: ["个人"], accountId: "acc-reg", details: [{ label: "DNS", value: "Cloudflare" }] }),
  mk({ id: "ai-code", type: "subscription", name: "研发编程助手", subtitle: "AI 订阅 · Pro", provider: "AI 平台",
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
  mk({ id: "gpt-team", type: "subscription", name: "ChatGPT Team", subtitle: "团队订阅 · 2 个工作空间", provider: "OpenAI",
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
  mk({ id: "card-wise", type: "payment", name: "美元虚拟卡", subtitle: "Visa ···· 4242", provider: "示例数字银行",
    price: 0, cycle: "year", purchasedAt: "2025-03-02", tags: ["支付"], related: ["hk-api-02", "ai-code", "ai-chat"],
    payment: { issuer: "示例数字银行", network: "Visa", last4: "4242", cardExpiry: "2028-09", billingRegion: "美国", fees: "开卡免费 · 充值 0.5%", status: "active" },
    expiresAt: "2028-09-30" }),
  mk({ id: "card-onekey", type: "payment", name: "U 卡", subtitle: "Mastercard ···· 8817", provider: "示例 U 卡平台",
    price: 1, cycle: "month", purchasedAt: "2026-01-12", tags: ["支付", "号池"], related: ["gpt-team"],
    payment: { issuer: "示例 U 卡平台", network: "Mastercard", last4: "8817", cardExpiry: "2026-12", billingRegion: "香港", fees: "开卡 $10 · USDT 充值 1.5%", status: "active" },
    expiresAt: "2026-12-31", note: "只用来付团队订阅；余额低于 $50 记得充值。" }),
];

const st = (s: Partial<NodeStatus> & Pick<NodeStatus, "uuid">): NodeStatus => ({
  online: true, cpu: 0, ram: [0, 0], swap: [0, 0], disk: [0, 0], load: [0, 0, 0], up: 0, down: 0, totalUp: 0, totalDown: 0,
  trafficLimit: 0, trafficType: "max", uptimeSec: 0, tcp: 0, udp: 0, process: 0, netHistory: [], ...s,
});
const D = 86_400;
export const demoStatus: StatusMap = {
  "7f3c-hk02": st({ uuid: "7f3c-hk02", cpu: 23, ram: [3328599654, 8589934592], disk: [44023414784, 85899345920], load: [0.42, 0.51, 0.47], up: 1887436, down: 6710886, totalUp: 335007449088, totalDown: 734439407616, trafficLimit: 1099511627776, trafficType: "max", uptimeSec: 37 * D, tcp: 412, udp: 18, netHistory: [3, 4, 4, 5, 6, 5, 4, 3, 3, 2, 2, 3, 5, 7, 9, 8, 7, 8, 9, 10, 8, 7, 8, 8] }),
  "2a91-hk01": st({ uuid: "2a91-hk01", cpu: 41, ram: [5583457484, 8589934592], disk: [55834574848, 85899345920], load: [1.12, 1.12, 1.12], up: 3355443, down: 10276044, totalUp: 558345748480, totalDown: 923417968640, trafficLimit: 1099511627776, trafficType: "max", uptimeSec: 88 * D, tcp: 960, udp: 4, netHistory: [5, 6, 7, 6, 8, 9, 8, 7, 9, 10, 11, 9, 8, 9, 10, 12, 11, 10, 9, 10, 11, 12, 10, 9] }),
  "c0de-sgpg": st({ uuid: "c0de-sgpg", cpu: 12, ram: [12240656793, 17179869184], disk: [201863462912, 343597383680], load: [0.36, 0.36, 0.36], up: 419430, down: 943718, totalUp: 103079215104, totalDown: 152471339008, trafficLimit: 2199023255552, trafficType: "sum", uptimeSec: 201 * D, tcp: 120, udp: 4, netHistory: [2, 2, 1, 2, 3, 2, 2, 1, 1, 2, 2, 3, 2, 2, 3, 2, 2, 2, 1, 2, 2, 3, 2, 2] }),
  "9b2e-lalab": st({ uuid: "9b2e-lalab", online: false }),
};

export const demoSettings: Settings = { ...DEFAULT_SETTINGS, komari: { ...DEFAULT_SETTINGS.komari, url: "https://probe.sak.example" } };
export const demoKomariInfo = { url: "https://probe.sak.example", hasKey: true, version: "1.2.5 (e446bee)", lastSync: "2026-11-15T03:02:00.000Z", lastError: null, nodes: 4 };
