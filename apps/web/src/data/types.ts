import type { Asset as CoreAsset, NodeStatus } from "@fangcun/core";

export type { AssetType, Cycle, Detail, KomariLink, NodeStatus, Renewal, Settings, Team, TeamMember, Workspace } from "@fangcun/core";

export interface QuotaWindow { label: string; usedPct: number; resetAt: string }
export interface QuotaAccount { authIndex: string; provider: "codex" | "claude" | "gemini"; email: string; plan: string; status: "ready" | "cooling" | "error"; windows: QuotaWindow[] }
/** Read-only quota preview (CPA plugin, roadmap). Demo data only in v0.1. */
export interface QuotaLink { observedAt: string; accounts: QuotaAccount[] }

export type Asset = CoreAsset & { quota?: QuotaLink };
export type StatusMap = Record<string, NodeStatus>;
