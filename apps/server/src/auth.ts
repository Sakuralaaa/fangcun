import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DB } from "./db";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt$N$r$p$salt$hash (base64) */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scryptAsync(pw.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(expected, got);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): boolean {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(now / 30_000);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, counter + i)), Buffer.from(c))) return true;
  }
  return false;
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

// ---- users & sessions ----
export interface UserRow { id: number; username: string; pw_hash: string; totp_secret: string | null; totp_pending: string | null; totp_enabled: number }
export interface SessionRow { id: string; user_id: number; created_at: string; expires_at: string; stepup_at: string | null }

export const SESSION_DAYS = 30;
export const STEPUP_MS = 10 * 60_000;

export function getUser(db: DB): UserRow | undefined {
  return db.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get() as UserRow | undefined;
}

export function createSession(db: DB, userId: number, ua = "", stepUp = false): string {
  const token = randomToken();
  const now = new Date();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, stepup_at, ua) VALUES (?, ?, ?, ?, ?, ?)").run(
    sha256(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    stepUp ? now.toISOString() : null, ua.slice(0, 200),
  );
  return token;
}

export function findSession(db: DB, token: string | undefined): SessionRow | undefined {
  if (!token) return undefined;
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sha256(token)) as SessionRow | undefined;
  if (!s || s.expires_at < new Date().toISOString()) return undefined;
  return s;
}

// ---- access tokens ----
export interface TokenRow { id: string; name: string; prefix: string; hash: string; scope: "read" | "write" | "full"; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null }

export function createAccessToken(db: DB, name: string, scope: TokenRow["scope"], expiresInDays?: number | null) {
  const secret = `fc_${randomToken(24)}`;
  const id = `tok_${randomToken(6)}`;
  const expires = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;
  db.prepare("INSERT INTO tokens (id, name, prefix, hash, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id, name, secret.slice(0, 9), sha256(secret), scope, new Date().toISOString(), expires,
  );
  return { id, token: secret };
}

export function findAccessToken(db: DB, secret: string): TokenRow | undefined {
  const t = db.prepare("SELECT * FROM tokens WHERE hash = ?").get(sha256(secret)) as TokenRow | undefined;
  if (!t || t.revoked_at) return undefined;
  if (t.expires_at && t.expires_at < new Date().toISOString()) return undefined;
  db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), t.id);
  return t;
}

/** Simple fixed-window limiter for sign-in attempts. */
export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) { this.hits.set(key, { n: 1, reset: now + this.windowMs }); return true; }
    h.n++;
    return h.n <= this.max;
  }
}
