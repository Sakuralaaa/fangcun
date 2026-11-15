import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { diffAssets, normalizeAsset } from "./asset";
import { APP_VERSION, DEFAULT_SETTINGS, SCHEMA_VERSION, type Asset, type AuditEntry, type DataDoc, type Settings } from "./types";

/**
 * .fangcun backup = zip:
 *   manifest.json   { format, schemaVersion, appVersion, createdAt, counts, files: { path: sha256 } }
 *   data.json       DataDoc (assets incl. 回收站, settings)
 *   audit.jsonl     audit log, one entry per line
 *   attachments/<assetId>/<name>
 */
export const BACKUP_FORMAT = "fangcun-backup";

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  counts: { assets: number; audit: number; attachments: number };
  files: Record<string, string>;
}

export interface BackupContents {
  manifest: BackupManifest;
  data: DataDoc;
  audit: AuditEntry[];
  attachments: Record<string, Uint8Array>;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? strToU8(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildBackup(input: { data: DataDoc; audit: AuditEntry[]; attachments?: Record<string, Uint8Array>; createdAt?: string }): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    "data.json": strToU8(JSON.stringify(input.data, null, 2)),
    "audit.jsonl": strToU8(input.audit.map((e) => JSON.stringify(e)).join("\n")),
  };
  for (const [path, bytes] of Object.entries(input.attachments ?? {})) {
    if (path.includes("..")) throw new Error(`bad attachment path ${path}`);
    files[`attachments/${path}`] = bytes;
  }
  const checksums: Record<string, string> = {};
  for (const [p, b] of Object.entries(files)) checksums[p] = await sha256Hex(b);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    schemaVersion: input.data.schemaVersion,
    appVersion: APP_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    counts: { assets: input.data.assets.length, audit: input.audit.length, attachments: Object.keys(input.attachments ?? {}).length },
    files: checksums,
  };
  const zip: Zippable = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [p, b] of Object.entries(files)) zip[p] = b;
  return zipSync(zip, { level: 6 });
}

export class BackupError extends Error {
  constructor(message: string) { super(message); this.name = "BackupError"; }
}

/** Unpack and verify every checksum, then migrate data.json to the current schema. */
export async function readBackup(bytes: Uint8Array): Promise<BackupContents> {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new BackupError("不是有效的 .fangcun 备份（zip 无法解开）"); }
  const mf = entries["manifest.json"];
  if (!mf) throw new BackupError("备份缺少 manifest.json");
  const manifest = JSON.parse(strFromU8(mf)) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError("不是方寸备份文件");
  if (manifest.schemaVersion > SCHEMA_VERSION) throw new BackupError(`备份来自更新的版本（schema ${manifest.schemaVersion}），请先升级方寸`);
  for (const [path, sum] of Object.entries(manifest.files)) {
    const b = entries[path];
    if (!b) throw new BackupError(`备份缺少文件 ${path}`);
    if ((await sha256Hex(b)) !== sum) throw new BackupError(`校验和不匹配：${path}（文件可能已损坏或被改动）`);
  }
  const data = migrateDoc(JSON.parse(strFromU8(entries["data.json"])));
  const auditText = entries["audit.jsonl"] ? strFromU8(entries["audit.jsonl"]) : "";
  const audit = auditText.split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditEntry);
  const attachments: Record<string, Uint8Array> = {};
  for (const [p, b] of Object.entries(entries)) if (p.startsWith("attachments/") && !p.endsWith("/")) attachments[p.slice(12)] = b;
  return { manifest, data, audit, attachments };
}

/** Bring an older data document up to SCHEMA_VERSION. */
export function migrateDoc(raw: unknown): DataDoc {
  const doc = raw as Partial<DataDoc> & { schemaVersion?: number; assets?: unknown[] };
  if (!doc || !Array.isArray(doc.assets)) throw new BackupError("data.json 结构无效");
  let v = Number(doc.schemaVersion ?? 1);
  let assets = doc.assets as Record<string, unknown>[];
  if (v < 2) {
    // v1 → v2: 订阅类型改名 "sub" → "subscription"；新增「支付」类型与 phone/payment 结构
    assets = assets.map((a) => (a.type === "sub" ? { ...a, type: "subscription" } : a));
    v = 2;
  }
  if (v < 3) {
    // v2 → v3: 新增「关注」starred 与「置顶」pinned，旧数据默认都不关注
    assets = assets.map((a) => ({ ...a, starred: Boolean(a.starred), pinned: Boolean(a.pinned) }));
    v = 3;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: doc.exportedAt ?? new Date().toISOString(),
    assets: assets.map((a) => normalizeAsset(a as unknown as Asset, (a as unknown as Asset).updatedAt)),
    settings: mergeSettings(doc.settings),
  };
}

export function mergeSettings(s?: Partial<Settings>): Settings {
  const d = structuredClone(DEFAULT_SETTINGS);
  if (!s) return d;
  return {
    komari: { ...d.komari, ...s.komari, fields: { ...d.komari.fields, ...s.komari?.fields } },
    display: { ...d.display, ...s.display, rates: { ...d.display.rates, ...s.display?.rates } },
    backup: { ...d.backup, ...s.backup },
    atoll: { ...d.atoll, ...s.atoll },
    cloudflare: { ...d.cloudflare, ...s.cloudflare },
  };
}

export interface RestorePreview {
  added: { id: string; name: string; type: string }[];
  conflicts: { id: string; name: string; fields: string[]; incomingNewer: boolean }[];
  same: number;
  /** Present in the current library but not in the backup (only removed by 整库替换). */
  missing: { id: string; name: string; type: string }[];
}

export function previewRestore(current: Asset[], incoming: Asset[]): RestorePreview {
  const cur = new Map(current.map((a) => [a.id, a]));
  const inc = new Set(incoming.map((a) => a.id));
  const p: RestorePreview = { added: [], conflicts: [], same: 0, missing: [] };
  for (const a of incoming) {
    const c = cur.get(a.id);
    if (!c) { p.added.push({ id: a.id, name: a.name, type: a.type }); continue; }
    const fields = diffAssets(c, a).map((d) => d.field);
    if (!fields.length) p.same++;
    else p.conflicts.push({ id: a.id, name: a.name, fields, incomingNewer: a.updatedAt > c.updatedAt });
  }
  for (const c of current) if (!inc.has(c.id)) p.missing.push({ id: c.id, name: c.name, type: c.type });
  return p;
}

/**
 * 合并: add new assets; on conflict keep whichever side was updated last (or force a side).
 * 整库替换: the backup becomes the library.
 */
export function planRestore(current: Asset[], incoming: Asset[], mode: "merge" | "replace", prefer: "newer" | "incoming" | "current" = "newer"): { put: Asset[]; remove: Asset[] } {
  if (mode === "replace") {
    const inc = new Set(incoming.map((a) => a.id));
    return { put: incoming.filter((a) => { const c = current.find((x) => x.id === a.id); return !c || diffAssets(c, a).length > 0 || c.deletedAt !== a.deletedAt; }), remove: current.filter((c) => !inc.has(c.id)) };
  }
  const cur = new Map(current.map((a) => [a.id, a]));
  const put: Asset[] = [];
  for (const a of incoming) {
    const c = cur.get(a.id);
    if (!c) put.push(a);
    else if (diffAssets(c, a).length) {
      const take = prefer === "incoming" || (prefer === "newer" && a.updatedAt > c.updatedAt);
      if (take) put.push(a);
    }
  }
  return { put, remove: [] };
}
