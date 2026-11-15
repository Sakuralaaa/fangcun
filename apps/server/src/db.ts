import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Ordered schema migrations. Never edit a shipped entry; append a new one. */
const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE assets (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL,
     updated_at TEXT NOT NULL, deleted_at TEXT
   );
   CREATE INDEX assets_type ON assets(type);
   CREATE TABLE users (
     id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL,
     totp_secret TEXT, totp_pending TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
     stepup_at TEXT, ua TEXT
   );
   CREATE TABLE tokens (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
     created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, last_used_at TEXT
   );
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
     asset_id TEXT, summary TEXT NOT NULL, before TEXT, after TEXT, changeset_id TEXT, undone_by INTEGER
   );
   CREATE INDEX audit_asset ON audit(asset_id);
   CREATE TABLE changesets (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL,
     ops TEXT NOT NULL, status TEXT NOT NULL, decided_at TEXT
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // v0.1.6: 关注 / 置顶. Existing assets default to not starred, not pinned.
  `UPDATE assets SET data = json_set(data, '$.starred', json('false')) WHERE json_type(data, '$.starred') IS NULL;
   UPDATE assets SET data = json_set(data, '$.pinned', json('false')) WHERE json_type(data, '$.pinned') IS NULL;`,
];

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: DB): number {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = db.prepare("SELECT MAX(version) AS v FROM _migrations").get() as { v: number | null };
  let v = row.v ?? 0;
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(v + 1, new Date().toISOString());
    });
    v++;
  }
  return v;
}

const depth = new WeakMap<DB, number>();

/** Run fn in a transaction; nested calls join the outer one. */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) {
    depth.set(db, d + 1);
    try { return fn(); } finally { depth.set(db, d); }
  }
  depth.set(db, 1);
  try { return outer(db, fn); } finally { depth.set(db, 0); }
}

function outer<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
