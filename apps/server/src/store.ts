import {
  actorLabel, decide, diffAssets, markOverrides, mergeSettings, newId, normalizeAsset, publicAsset,
  type Actor, type Asset, type AssetInput, type AuditEntry, type Changeset, type Op, type Settings,
} from "@fangcun/core";
import { tx, type DB } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export const TRASH_DAYS = 30;

export type CommitResult =
  | { status: "applied"; assets: Asset[]; auditIds: number[] }
  | { status: "pending"; changeset: Changeset };

export class Store {
  constructor(public db: DB) {}

  // ---------- settings ----------
  settings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) raw[r.key] = JSON.parse(r.value);
    return mergeSettings(raw as Partial<Settings>);
  }
  saveSettings(s: Settings) {
    const st = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    tx(this.db, () => { for (const [k, v] of Object.entries(s)) st.run(k, JSON.stringify(v)); });
  }
  meta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }
  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // ---------- assets ----------
  get(id: string): Asset | undefined {
    const r = this.db.prepare("SELECT data FROM assets WHERE id = ?").get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Asset) : undefined;
  }
  mustGet(id: string, allowDeleted = false): Asset {
    const a = this.get(id);
    if (!a || (a.deletedAt && !allowDeleted)) throw new HttpError(404, `资产 ${id} 不存在`);
    return a;
  }
  /** Resolve an id, or a unique name match (CLI convenience). */
  resolve(ref: string): Asset {
    const a = this.get(ref);
    if (a && !a.deletedAt) return a;
    const hits = this.list().filter((x) => x.name.toLowerCase() === ref.toLowerCase());
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new HttpError(409, `「${ref}」匹配到 ${hits.length} 项，请用 id`);
    throw new HttpError(404, `资产 ${ref} 不存在`);
  }
  list(opts: { deleted?: boolean } = {}): Asset[] {
    const rows = this.db.prepare(`SELECT data FROM assets WHERE deleted_at IS ${opts.deleted ? "NOT NULL" : "NULL"} ORDER BY name`).all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Asset);
  }
  all(): Asset[] {
    return (this.db.prepare("SELECT data FROM assets ORDER BY name").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Asset);
  }
  private write(a: Asset) {
    const clean = { ...a, account: a.account ? { ...a.account, secret: null } : a.account };
    this.db.prepare(
      `INSERT INTO assets (id, type, name, data, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name, data = excluded.data,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
    ).run(a.id, a.type, a.name, JSON.stringify(clean), a.updatedAt, a.deletedAt ?? null);
  }
  private remove(id: string) {
    this.db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  }

  // ---------- building ops ----------
  /** Normalise a full asset, keeping Komari 「已手动修改」 marks in step with the edit. */
  prepare(input: AssetInput & Partial<Asset>, before: Asset | null): Asset {
    const now = new Date().toISOString();
    let a = normalizeAsset({ ...input, createdAt: before?.createdAt ?? now, deletedAt: before?.deletedAt ?? null } as Asset, now);
    if (before && before.komari && a.komari && before.komari.uuid === a.komari.uuid) {
      a.komari = { ...before.komari, ...a.komari, fields: before.komari.fields, overridden: a.komari.overridden ?? before.komari.overridden };
    }
    a = markOverrides(before, a, this.settings().komari);
    if (!before && this.get(a.id)) throw new HttpError(409, `id ${a.id} 已被占用`);
    return a;
  }

  createOp(input: AssetInput): Op {
    const a = this.prepare({ ...input, id: input.id || newId() }, null);
    return { op: "put", id: a.id, before: null, after: a };
  }
  updateOp(id: string, patch: Partial<Asset>): Op {
    const before = this.mustGet(id);
    const merged = { ...before, ...patch, id, type: patch.type ?? before.type } as Asset;
    const after = this.prepare(merged, before);
    return { op: "put", id, before, after };
  }
  putOp(after: Asset): Op {
    const before = this.get(after.id) ?? null;
    return { op: "put", id: after.id, before, after: { ...after, updatedAt: new Date().toISOString() } };
  }
  deleteOp(id: string): Op {
    return { op: "delete", id, before: this.mustGet(id) };
  }

  // ---------- commit: apply now, or park as a change plan ----------
  commit(actor: Actor, ops: Op[], summary: string, action = "update"): CommitResult {
    if (!ops.length) throw new HttpError(400, "没有任何改动");
    const mode = decide(actor, "write");
    if (mode === "deny") throw new HttpError(403, "此令牌只读，不能写入");
    if (mode === "plan") {
      const cs: Changeset = { id: newId("cs"), createdAt: new Date().toISOString(), actor: actorLabel(actor), summary, ops, status: "pending" };
      this.db.prepare("INSERT INTO changesets (id, created_at, actor, summary, ops, status) VALUES (?, ?, ?, ?, ?, ?)").run(
        cs.id, cs.createdAt, cs.actor, cs.summary, JSON.stringify(cs.ops), cs.status,
      );
      return { status: "pending", changeset: cs };
    }
    return tx(this.db, () => this.applyOps(actorLabel(actor), ops, action, summary, null));
  }

  /** Apply inside an open transaction. Refuses ops whose `before` no longer matches the library. */
  applyOps(actor: string, ops: Op[], action: string, summary: string, changesetId: string | null): CommitResult & { status: "applied" } {
    const assets: Asset[] = [];
    const auditIds: number[] = [];
    const now = new Date().toISOString();
    for (const op of ops) {
      const current = this.get(op.id) ?? null;
      const expected = op.before;
      if ((current?.updatedAt ?? null) !== (expected?.updatedAt ?? null)) {
        throw new HttpError(409, `「${(expected ?? current)?.name ?? op.id}」在计划生成后又被改过，请重新生成`, { conflict: op.id });
      }
      let after: Asset | null;
      let act = action;
      if (op.op === "put") {
        after = { ...op.after, updatedAt: now };
        if (!expected) act = action === "update" ? "create" : action;
        this.write(after);
      } else if (op.op === "delete") {
        after = { ...op.before, deletedAt: now, updatedAt: now };
        act = "delete";
        this.write(after);
      } else {
        after = null;
        act = "purge";
        this.remove(op.id);
      }
      if (after) assets.push(after);
      auditIds.push(this.audit(actor, act, op.id, opSummary(act, expected, after, summary), expected, after, changesetId));
    }
    return { status: "applied", assets, auditIds };
  }

  // ---------- audit ----------
  audit(actor: string, action: string, assetId: string | null, summary: string, before: Asset | null, after: Asset | null, changesetId: string | null = null): number {
    const r = this.db.prepare(
      "INSERT INTO audit (at, actor, action, asset_id, summary, before, after, changeset_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(new Date().toISOString(), actor, action, assetId, summary, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, changesetId);
    return Number(r.lastInsertRowid);
  }
  auditList(opts: { limit?: number; assetId?: string; full?: boolean } = {}): AuditEntry[] {
    const rows = (opts.assetId
      ? this.db.prepare("SELECT * FROM audit WHERE asset_id = ? ORDER BY id DESC LIMIT ?").all(opts.assetId, opts.limit ?? 100)
      : this.db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").all(opts.limit ?? 100)) as Record<string, unknown>[];
    return rows.map((r) => this.auditRow(r, opts.full));
  }
  auditAll(): AuditEntry[] {
    return (this.db.prepare("SELECT * FROM audit ORDER BY id").all() as Record<string, unknown>[]).map((r) => this.auditRow(r, true));
  }
  private auditRow(r: Record<string, unknown>, full = true): AuditEntry {
    const before = r.before ? (JSON.parse(String(r.before)) as Asset) : null;
    const after = r.after ? (JSON.parse(String(r.after)) as Asset) : null;
    return {
      id: Number(r.id), at: String(r.at), actor: String(r.actor), action: String(r.action), assetId: (r.asset_id as string) ?? null,
      summary: String(r.summary), changesetId: (r.changeset_id as string) ?? null, undoneBy: (r.undone_by as number) ?? null,
      before: full ? before : null, after: full ? after : null,
      ...(full ? {} : { changes: diffAssets(before, after).map((d) => d.field) }),
    } as AuditEntry;
  }

  /** Undo one audit entry: put the asset back the way it was before that change. */
  undo(actor: Actor, auditId: number): CommitResult {
    const r = this.db.prepare("SELECT * FROM audit WHERE id = ?").get(auditId) as Record<string, unknown> | undefined;
    if (!r) throw new HttpError(404, `日志 ${auditId} 不存在`);
    const e = this.auditRow(r);
    if (e.undoneBy) throw new HttpError(409, `这条改动已经被 #${e.undoneBy} 撤销过`);
    if (!e.assetId) throw new HttpError(400, "这条日志不能撤销");
    const current = this.get(e.assetId) ?? null;
    if ((current?.updatedAt ?? null) !== (e.after?.updatedAt ?? null)) throw new HttpError(409, "这项资产之后又有改动，请先撤销更晚的改动");
    let op: Op;
    if (e.before) op = { op: "put", id: e.assetId, before: current, after: e.before };
    else if (current) op = { op: "purge", id: e.assetId, before: current };
    else throw new HttpError(409, "无可撤销的内容");
    const res = this.commit(actor, [op], `撤销 #${auditId}：${e.summary}`, "undo");
    if (res.status === "applied") this.db.prepare("UPDATE audit SET undone_by = ? WHERE id = ?").run(res.auditIds[0], auditId);
    else this.db.prepare("UPDATE changesets SET summary = ? WHERE id = ?").run(`${res.changeset.summary} [undo:${auditId}]`, res.changeset.id);
    return res;
  }

  // ---------- change plans ----------
  changesets(status?: string): Changeset[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM changesets WHERE status = ? ORDER BY created_at DESC").all(status)
      : this.db.prepare("SELECT * FROM changesets ORDER BY created_at DESC LIMIT 100").all()) as Record<string, unknown>[];
    return rows.map((r) => ({ id: String(r.id), createdAt: String(r.created_at), actor: String(r.actor), summary: String(r.summary), ops: JSON.parse(String(r.ops)), status: r.status as Changeset["status"], decidedAt: (r.decided_at as string) ?? null }));
  }
  changeset(id: string): Changeset {
    const c = this.changesets().find((x) => x.id === id) ?? this.changesets("pending").find((x) => x.id === id);
    if (!c) throw new HttpError(404, `变更计划 ${id} 不存在`);
    return c;
  }
  approve(id: string, approver: string): CommitResult {
    const cs = this.changeset(id);
    if (cs.status !== "pending") throw new HttpError(409, `计划已是 ${cs.status} 状态`);
    try {
      const res = tx(this.db, () => {
        const r = this.applyOps(`${cs.actor}（${approver} 批准）`, cs.ops, "update", cs.summary, cs.id);
        this.db.prepare("UPDATE changesets SET status = 'applied', decided_at = ? WHERE id = ?").run(new Date().toISOString(), id);
        return r;
      });
      const undo = /\[undo:(\d+)\]$/.exec(cs.summary);
      if (undo) this.db.prepare("UPDATE audit SET undone_by = ? WHERE id = ?").run(res.auditIds[0], Number(undo[1]));
      return res;
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) this.db.prepare("UPDATE changesets SET status = 'conflict', decided_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      throw e;
    }
  }
  reject(id: string) {
    const cs = this.changeset(id);
    if (cs.status !== "pending") throw new HttpError(409, `计划已是 ${cs.status} 状态`);
    this.db.prepare("UPDATE changesets SET status = 'rejected', decided_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  /** Permanently remove items that have sat in 回收站 longer than 30 days. */
  purgeTrash(now = Date.now()): number {
    const cutoff = new Date(now - TRASH_DAYS * 86_400_000).toISOString();
    const old = (this.db.prepare("SELECT data FROM assets WHERE deleted_at IS NOT NULL AND deleted_at < ?").all(cutoff) as { data: string }[]).map((r) => JSON.parse(r.data) as Asset);
    if (!old.length) return 0;
    tx(this.db, () => this.applyOps("系统", old.map((a) => ({ op: "purge", id: a.id, before: a })), "purge", "回收站超过 30 天，永久删除", null));
    return old.length;
  }

  /** Replace the whole library (backup 整库替换). Runs in one transaction. */
  replaceAll(actor: string, assets: Asset[], audit: AuditEntry[] | null, settings: Settings | null, summary: string) {
    tx(this.db, () => {
      this.db.exec("DELETE FROM assets");
      for (const a of assets) this.write(a);
      if (audit) {
        this.db.exec("DELETE FROM audit");
        const st = this.db.prepare("INSERT INTO audit (id, at, actor, action, asset_id, summary, before, after, changeset_id, undone_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const e of audit) st.run(e.id, e.at, e.actor, e.action, e.assetId, e.summary, e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null, e.changesetId ?? null, e.undoneBy ?? null);
      }
      if (settings) { const s = this.settings(); this.saveSettings({ ...settings, komari: { ...settings.komari, url: settings.komari.url || s.komari.url } }); }
      this.audit(actor, "restore-backup", null, summary, null, null);
    });
  }
  /** Merge a set of assets (backup 合并 / import), one audit entry each. */
  putMany(actor: string, assets: Asset[], action: string, summary: string) {
    tx(this.db, () => {
      for (const a of assets) {
        const before = this.get(a.id) ?? null;
        this.write(a);
        this.audit(actor, action, a.id, `${summary}：${a.name}`, before, a);
      }
    });
  }
}

const VERB: Record<string, string> = { create: "新建", update: "修改", delete: "删除（进回收站）", purge: "永久删除", renew: "标记已续费", undo: "撤销", "komari-sync": "Komari 同步", import: "导入", restore: "从回收站恢复", tag: "改标签", link: "改关联" };

function opSummary(action: string, before: Asset | null, after: Asset | null, summary: string): string {
  const name = (after ?? before)?.name ?? "";
  if (action === "import") return `${before ? "导入并更新" : "导入"}「${name}」`;
  if (action === "komari-sync" && before && after) {
    const fields = diffAssets(before, after).map((d) => d.field).filter((f) => f !== "komari");
    return `Komari 同步「${name}」${fields.length ? "：" + fields.join("、") : ""}`;
  }
  if (action === "update" && before && after) {
    const fields = diffAssets(before, after).map((d) => d.field).filter((f) => f !== "komari");
    return `修改「${name}」${fields.length ? "：" + fields.join("、") : ""}`;
  }
  if (summary && action !== "create" && action !== "delete" && action !== "purge") return summary.includes(name) ? summary : `${summary}「${name}」`;
  return `${VERB[action] ?? action}「${name}」`;
}

export const toPublic = (a: Asset) => publicAsset(a);
