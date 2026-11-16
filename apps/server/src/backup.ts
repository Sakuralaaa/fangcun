import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildBackup, planRestore, previewRestore, readBackup, SCHEMA_VERSION, todayIso,
  type BackupManifest, type DataDoc, type RestorePreview,
} from "@fangcun/core";
import { importCpaPrefs, readCpaPrefs } from "./cliproxyapi";
import { HttpError, type Store } from "./store";

export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  constructor(private store: Store, public dataDir: string, public backupDir: string) {
    mkdirSync(this.attachmentsDir, { recursive: true });
    mkdirSync(backupDir, { recursive: true });
  }

  get attachmentsDir() { return join(this.dataDir, "attachments"); }

  attachmentPath(assetId: string, name: string): string {
    if (!/^[\w.-]+$/.test(assetId) || !name || name.includes("/") || name.includes("\\") || name.startsWith(".")) throw new HttpError(400, "文件名无效");
    const p = resolve(this.attachmentsDir, assetId, name);
    if (!p.startsWith(resolve(this.attachmentsDir) + "/")) throw new HttpError(400, "文件名无效");
    return p;
  }

  readAttachments(): Record<string, Uint8Array> {
    const out: Record<string, Uint8Array> = {};
    if (!existsSync(this.attachmentsDir)) return out;
    for (const dir of readdirSync(this.attachmentsDir)) {
      const d = join(this.attachmentsDir, dir);
      if (!statSync(d).isDirectory()) continue;
      for (const f of readdirSync(d)) out[`${dir}/${f}`] = readFileSync(join(d, f));
    }
    return out;
  }

  dataDoc(): DataDoc {
    // CLIProxyAPI: only 关注 and binds (connection id + name, account id, provider, email); never a token or an address
    const cliproxyapi = readCpaPrefs(this.store);
    return { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), assets: this.store.all(), settings: this.store.settings(), ...(cliproxyapi.length ? { cliproxyapi } : {}) };
  }

  async build(): Promise<Uint8Array> {
    return buildBackup({ data: this.dataDoc(), audit: this.store.auditAll(), attachments: this.readAttachments() });
  }

  async preview(bytes: Uint8Array): Promise<{ manifest: BackupManifest; preview: RestorePreview }> {
    const b = await readBackup(bytes).catch((e) => { throw new HttpError(400, (e as Error).message); });
    return { manifest: b.manifest, preview: previewRestore(this.store.all(), b.data.assets) };
  }

  /** 整库替换 snapshots the current library first; 合并 keeps whichever side changed last. */
  async restore(bytes: Uint8Array, mode: "merge" | "replace", actor: string, prefer: "newer" | "incoming" | "current" = "newer") {
    const b = await readBackup(bytes).catch((e) => { throw new HttpError(400, (e as Error).message); });
    let snapshot: string | null = null;
    let applied = b.data.assets.length;
    if (mode === "replace") {
      snapshot = await this.writeFile("pre-restore");
      this.store.replaceAll(actor, b.data.assets, b.audit, b.data.settings, `整库替换为 ${b.manifest.createdAt} 的备份（替换前快照：${snapshot}）`);
      rmSync(this.attachmentsDir, { recursive: true, force: true });
      mkdirSync(this.attachmentsDir, { recursive: true });
    } else {
      const plan = planRestore(this.store.all(), b.data.assets, "merge", prefer);
      applied = plan.put.length;
      if (plan.put.length) this.store.putMany(actor, plan.put, "restore-backup", "从备份合并");
    }
    // 关注 / 绑定 of CLIProxyAPI accounts: replace swaps them, merge adds the backup's on top
    if (mode === "replace" || b.data.cliproxyapi?.length) importCpaPrefs(this.store, b.data.cliproxyapi ?? [], mode);
    for (const [p, data] of Object.entries(b.attachments)) {
      const [assetId, name] = p.split("/");
      const target = this.attachmentPath(assetId, name);
      if (mode === "merge" && existsSync(target)) continue;
      mkdirSync(join(this.attachmentsDir, assetId), { recursive: true });
      writeFileSync(target, data);
    }
    return { snapshot, applied };
  }

  /** Write a backup file into the backup directory. kind: auto | manual | pre-restore */
  async writeFile(kind: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = kind === "auto" ? `auto-${todayIso()}.fangcun` : `${kind}-${stamp}.fangcun`;
    writeFileSync(join(this.backupDir, name), await this.build());
    return name;
  }

  files(): { name: string; size: number; at: string; kind: string }[] {
    if (!existsSync(this.backupDir)) return [];
    return readdirSync(this.backupDir).filter((f) => f.endsWith(".fangcun")).map((name) => {
      const s = statSync(join(this.backupDir, name));
      return { name, size: s.size, at: s.mtime.toISOString(), kind: name.replace(/-\d{4}-.*$/, "") };
    }).sort((a, b) => b.at.localeCompare(a.at));
  }

  filePath(name: string): string {
    if (!/^[\w.-]+\.fangcun$/.test(name)) throw new HttpError(400, "文件名无效");
    const p = join(this.backupDir, name);
    if (!existsSync(p)) throw new HttpError(404, "备份不存在");
    return p;
  }

  /** Keep only the newest N automatic backups. */
  prune(keep: number) {
    const auto = this.files().filter((f) => f.kind === "auto");
    for (const f of auto.slice(keep)) rmSync(join(this.backupDir, f.name), { force: true });
  }

  async runDaily(force = false): Promise<string | null> {
    const s = this.store.settings().backup;
    const today = todayIso();
    if (!force && (this.store.meta("backup_last_day") === today || new Date().getHours() < s.hour)) return null;
    try {
      const name = await this.writeFile("auto");
      this.prune(s.keep);
      this.store.setMeta("backup_last_day", today);
      this.store.setMeta("backup_last_ok", new Date().toISOString());
      this.store.setMeta("backup_last_error", "");
      return name;
    } catch (e) {
      this.store.setMeta("backup_last_error", `${new Date().toISOString()} ${(e as Error).message}`);
      return null;
    }
  }

  status() {
    return {
      dir: this.backupDir,
      lastOk: this.store.meta("backup_last_ok") ?? null,
      lastError: this.store.meta("backup_last_error") || null,
      files: this.files(),
    };
  }

  start() {
    const tick = () => { this.runDaily().catch(() => {}); this.store.purgeTrash(); };
    tick();
    this.timer = setInterval(tick, 10 * 60_000);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
