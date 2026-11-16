import type { Asset as CoreAsset, NodeStatus } from "@fangcun/core";

export type { AssetType, Cycle, Detail, KomariLink, NodePing, NodeStatus, PingState, QuotaAccount, QuotaWindow, Renewal, Settings, Team, TeamMember, Workspace } from "@fangcun/core";

/** A CLIProxyAPI connection as the server shows it (the feed token never reaches the browser). */
export interface CliproxyConnection { id: string; name: string; note: string; url: string; createdAt: string; fetchedAt: string | null; lastError: string | null; accounts: number }

export type Asset = CoreAsset;
export type StatusMap = Record<string, NodeStatus>;
