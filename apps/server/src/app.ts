import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { renderSVG } from "uqr";
import { strToU8, zipSync } from "fflate";
import {
  csvToInputs, decide, diffAssets, doctor, jsonToInputs, mergeSettings, renewAsset, restoreKomariField, searchAssets,
  SCOPE_LABEL, todayIso, toCsv, toCsvByType, toIcs, ValidationError, ASSET_TYPES, APP_VERSION,
  type Actor, type Asset, type AssetInput, type Capability, type Op, type Settings,
} from "@fangcun/core";
import {
  createAccessToken, createSession, findAccessToken, findSession, getUser, hashPassword, Limiter, newTotpSecret,
  sha256, STEPUP_MS, verifyPassword, verifyTotp, type SessionRow, type TokenRow,
} from "./auth";
import type { AtollService } from "./atoll";
import type { BackupService } from "./backup";
import type { CliproxyService } from "./cliproxyapi";
import type { CloudflareService } from "./cloudflare";
import type { KomariService } from "./komari";
import type { RatesService } from "./rates";
import { HttpError, toPublic, type CommitResult, type Store } from "./store";

type Env = { Variables: { actor: Actor; session?: SessionRow } };
const COOKIE = "fc_session";

export interface AppDeps { store: Store; komari: KomariService; backup: BackupService; rates?: RatesService; atoll?: AtollService; cloudflare?: CloudflareService; cliproxy?: CliproxyService; webDir?: string; secureCookie?: boolean }

export function createApp({ store, komari, backup, rates, atoll, cloudflare, cliproxy, webDir, secureCookie }: AppDeps) {
  const app = new Hono<Env>();
  const loginLimit = new Limiter(10, 15 * 60_000);
  const db = store.db;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status as 400);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "请求内容不是有效的 JSON" }, 400);
    console.error(err);
    return c.json({ error: "服务器内部错误" }, 500);
  });

  // ---------- who is calling ----------
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("authorization");
    if (auth?.startsWith("Bearer ")) {
      const t = findAccessToken(db, auth.slice(7).trim());
      if (!t) return c.json({ error: "令牌无效、已过期或已吊销" }, 401);
      c.set("actor", { kind: "token", id: t.id, name: t.name, scope: t.scope });
      return next();
    }
    const s = findSession(db, getCookie(c, COOKIE));
    if (s) {
      const u = getUser(db);
      if (!u) return c.json({ error: "未登录" }, 401);
      // Cookie-authenticated writes must carry our header (blocks cross-site form posts).
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-fangcun") !== "1") return c.json({ error: "缺少 X-Fangcun 请求头" }, 403);
      const stepUpOk = !u.totp_enabled || Boolean(s.stepup_at && Date.now() - Date.parse(s.stepup_at) < STEPUP_MS);
      c.set("actor", { kind: "user", name: u.username, stepUpOk });
      c.set("session", s);
      return next();
    }
    const open = ["/api/auth/state", "/api/auth/setup", "/api/auth/login", "/api/health"];
    if (open.includes(c.req.path)) return next();
    return c.json({ error: "未登录" }, 401);
  });

  const actor = (c: Context<Env>) => c.get("actor");
  const need = (c: Context<Env>, cap: Capability) => {
    const a = actor(c);
    if (!a) throw new HttpError(401, "未登录");
    const d = decide(a, cap);
    if (d === "deny") {
      const msg = cap === "backup" ? "备份 / 恢复需要「完全权限」令牌" : cap === "admin" ? "只能在网页里登录后操作" : `令牌权限（${a.kind === "token" ? SCOPE_LABEL[a.scope] : ""}）不够`;
      throw new HttpError(403, msg);
    }
    return a;
  };
  /** Web backup / export / restore needs a fresh 2FA code when 2FA is on. */
  const stepUp = (c: Context<Env>) => {
    const a = actor(c);
    if (a.kind === "user" && !a.stepUpOk) throw new HttpError(403, "需要先输入动态码验证", { needStepUp: true });
  };
  const respond = (c: Context<Env>, r: CommitResult) =>
    r.status === "applied"
      ? c.json({ status: "applied", assets: r.assets.map(toPublic), auditIds: r.auditIds })
      : c.json({ status: "pending", changeset: { id: r.changeset.id, summary: r.changeset.summary }, message: "已生成变更计划，等待在网页「变更审批」里批准" }, 202);
  const body = async <T>(c: Context<Env>): Promise<T> => (await c.req.json().catch(() => { throw new SyntaxError(); })) as T;

  // ---------- auth ----------
  app.get("/api/health", (c) => c.json({ ok: true, version: APP_VERSION }));

  app.get("/api/auth/state", (c) => {
    const u = getUser(db);
    const a = c.get("actor");
    return c.json({
      needsSetup: !u,
      user: a?.kind === "user" && u ? { username: u.username, totpEnabled: Boolean(u.totp_enabled) } : null,
      token: a?.kind === "token" ? { name: a.name, scope: a.scope } : null,
      stepUpOk: a?.kind === "user" ? a.stepUpOk : false,
      version: APP_VERSION,
    });
  });

  const cookieOpts = (c: Context<Env>) => ({
    httpOnly: true, sameSite: "Lax" as const, path: "/", maxAge: 30 * 86_400,
    secure: secureCookie ?? c.req.header("x-forwarded-proto") === "https",
  });

  app.post("/api/auth/setup", async (c) => {
    if (getUser(db)) throw new HttpError(409, "管理员账号已经设置过了");
    const { username, password } = await body<{ username: string; password: string }>(c);
    if (!username?.trim() || !/^[\w.@-]{2,40}$/.test(username.trim())) throw new HttpError(400, "用户名 2–40 位，字母、数字或 . _ - @");
    if (!password || password.length < 10) throw new HttpError(400, "密码至少 10 位");
    const r = db.prepare("INSERT INTO users (username, pw_hash, created_at) VALUES (?, ?, ?)").run(username.trim(), await hashPassword(password), new Date().toISOString());
    setCookie(c, COOKIE, createSession(db, Number(r.lastInsertRowid), c.req.header("user-agent")), cookieOpts(c));
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!loginLimit.take(ip)) throw new HttpError(429, "尝试次数过多，请 15 分钟后再试");
    const { username, password, code } = await body<{ username: string; password: string; code?: string }>(c);
    const u = getUser(db);
    if (!u || u.username !== username || !(await verifyPassword(String(password ?? ""), u.pw_hash))) throw new HttpError(401, "用户名或密码不对");
    if (u.totp_enabled) {
      if (!code) return c.json({ needTotp: true }, 401);
      if (!verifyTotp(u.totp_secret!, code)) throw new HttpError(401, "动态码不对", { needTotp: true });
    }
    setCookie(c, COOKIE, createSession(db, u.id, c.req.header("user-agent"), Boolean(u.totp_enabled)), cookieOpts(c));
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    const s = c.get("session");
    if (s) db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.post("/api/auth/password", async (c) => {
    need(c, "admin");
    const { old, password } = await body<{ old: string; password: string }>(c);
    const u = getUser(db)!;
    if (!(await verifyPassword(old ?? "", u.pw_hash))) throw new HttpError(400, "当前密码不对");
    if (!password || password.length < 10) throw new HttpError(400, "新密码至少 10 位");
    db.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").run(await hashPassword(password), u.id);
    db.prepare("DELETE FROM sessions WHERE id != ?").run(c.get("session")!.id);
    return c.json({ ok: true });
  });

  app.post("/api/auth/2fa/begin", (c) => {
    need(c, "admin");
    const u = getUser(db)!;
    if (u.totp_enabled) throw new HttpError(409, "已经绑定了两步验证");
    const secret = newTotpSecret();
    db.prepare("UPDATE users SET totp_pending = ? WHERE id = ?").run(secret, u.id);
    const uri = `otpauth://totp/${encodeURIComponent(`方寸:${u.username}`)}?secret=${secret}&issuer=${encodeURIComponent("方寸")}&algorithm=SHA1&digits=6&period=30`;
    return c.json({ secret, uri, svg: renderSVG(uri, { border: 1 }) });
  });
  app.post("/api/auth/2fa/enable", async (c) => {
    need(c, "admin");
    const { code } = await body<{ code: string }>(c);
    const u = getUser(db)!;
    if (!u.totp_pending || !verifyTotp(u.totp_pending, code)) throw new HttpError(400, "动态码不对，请用验证器里最新的 6 位数字");
    db.prepare("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1 WHERE id = ?").run(u.id);
    db.prepare("UPDATE sessions SET stepup_at = ? WHERE id = ?").run(new Date().toISOString(), c.get("session")!.id);
    return c.json({ ok: true });
  });
  app.post("/api/auth/2fa/disable", async (c) => {
    need(c, "admin");
    const { code } = await body<{ code: string }>(c);
    const u = getUser(db)!;
    if (!u.totp_enabled || !verifyTotp(u.totp_secret!, code)) throw new HttpError(400, "动态码不对");
    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?").run(u.id);
    return c.json({ ok: true });
  });
  app.post("/api/auth/step-up", async (c) => {
    need(c, "admin");
    const { code } = await body<{ code: string }>(c);
    const u = getUser(db)!;
    if (u.totp_enabled && !verifyTotp(u.totp_secret!, code)) throw new HttpError(400, "动态码不对");
    db.prepare("UPDATE sessions SET stepup_at = ? WHERE id = ?").run(new Date().toISOString(), c.get("session")!.id);
    return c.json({ ok: true, validForSec: STEPUP_MS / 1000 });
  });

  // ---------- assets ----------
  app.get("/api/assets", (c) => {
    need(c, "read");
    const { type, q, deleted, tag, starred, pinned } = c.req.query();
    let list = store.list({ deleted: deleted === "1" });
    if (type) list = list.filter((a) => a.type === type);
    if (starred === "1") list = list.filter((a) => a.starred);
    if (pinned === "1") list = list.filter((a) => a.pinned);
    if (tag) list = list.filter((a) => a.tags.includes(tag));
    if (q) list = searchAssets(list, q);
    return c.json({ assets: list.map(toPublic), today: todayIso() });
  });
  app.get("/api/assets/:id", (c) => {
    need(c, "read");
    return c.json({ asset: toPublic(store.resolve(c.req.param("id"))) });
  });
  app.post("/api/assets", async (c) => {
    const a = need(c, "write");
    const input = await body<AssetInput>(c);
    const op = store.createOp(input);
    return respond(c, store.commit(a, [op], `新建「${input.name}」`, "create"));
  });
  app.patch("/api/assets/:id", async (c) => {
    const a = need(c, "write");
    const id = store.resolve(c.req.param("id")).id;
    const patch = await body<Partial<Asset>>(c);
    delete (patch as Record<string, unknown>).id;
    const op = store.updateOp(id, patch);
    if (op.op === "put" && !diffAssets(op.before, op.after).length) return c.json({ status: "unchanged", assets: [toPublic(op.after)] });
    return respond(c, store.commit(a, [op], `修改「${op.op === "put" ? op.after.name : id}」`, "update"));
  });
  app.delete("/api/assets/:id", (c) => {
    const a = need(c, "write");
    const target = store.resolve(c.req.param("id"));
    return respond(c, store.commit(a, [store.deleteOp(target.id)], `删除「${target.name}」`, "delete"));
  });
  app.post("/api/assets/:id/renew", async (c) => {
    const a = need(c, "write");
    const before = store.resolve(c.req.param("id"));
    const opts = await c.req.json().catch(() => ({})) as { amount?: number; note?: string; workspaceId?: string };
    const after = store.prepare(renewAsset(before, todayIso(), opts), before);
    return respond(c, store.commit(a, [{ op: "put", id: before.id, before, after }], `标记已续费「${before.name}」→ ${after.expiresAt ?? "长期"}`, "renew"));
  });
  app.post("/api/assets/:id/tags", async (c) => {
    const a = need(c, "write");
    const before = store.resolve(c.req.param("id"));
    const { add = [], remove = [] } = await body<{ add?: string[]; remove?: string[] }>(c);
    const tags = [...before.tags.filter((t) => !remove.includes(t)), ...add.filter((t) => !before.tags.includes(t))];
    const op = store.updateOp(before.id, { tags });
    return respond(c, store.commit(a, [op], `改标签「${before.name}」`, "tag"));
  });
  /** 关注 / 置顶 — one asset per call; 可写令牌 makes a change plan like any other write. */
  app.post("/api/assets/:id/focus", async (c) => {
    const a = need(c, "write");
    const before = store.resolve(c.req.param("id"));
    const { starred, pinned } = await body<{ starred?: boolean; pinned?: boolean }>(c);
    const patch: { starred?: boolean; pinned?: boolean } = {};
    if (typeof starred === "boolean") patch.starred = starred;
    if (typeof pinned === "boolean") patch.pinned = pinned;
    if (!Object.keys(patch).length) throw new HttpError(400, "需要 starred 或 pinned（true / false）");
    const op = store.updateOp(before.id, patch);
    if (op.op === "put" && !diffAssets(op.before, op.after).length) return c.json({ status: "unchanged", assets: [toPublic(op.after)] });
    const after = op.op === "put" ? op.after : before;
    const what = after.pinned && !before.pinned ? "置顶" : !after.pinned && before.pinned && after.starred ? "取消置顶" : after.starred && !before.starred ? "关注" : "取消关注";
    return respond(c, store.commit(a, [op], `${what}「${before.name}」`, "focus"));
  });
  app.post("/api/assets/:id/link", async (c) => {
    const a = need(c, "write");
    const from = store.resolve(c.req.param("id"));
    const { to = [], unlink = false, both = true } = await body<{ to: string[]; unlink?: boolean; both?: boolean }>(c);
    const targets = to.map((t) => store.resolve(t));
    const ops: Op[] = [];
    const edit = (x: Asset, ids: string[]) => {
      const related = unlink ? x.related.filter((r) => !ids.includes(r)) : [...new Set([...x.related, ...ids])];
      if (related.join() !== x.related.join()) ops.push(store.updateOp(x.id, { related }));
    };
    edit(from, targets.map((t) => t.id));
    if (both) for (const t of targets) edit(t, [from.id]);
    if (!ops.length) return c.json({ status: "unchanged" });
    return respond(c, store.commit(a, ops, `${unlink ? "取消关联" : "关联"}「${from.name}」↔ ${targets.map((t) => t.name).join("、")}`, "link"));
  });
  app.post("/api/assets/:id/komari/restore", async (c) => {
    const a = need(c, "write");
    const before = store.resolve(c.req.param("id"));
    const { key } = await body<{ key: string }>(c);
    const after = { ...restoreKomariField(before, key), updatedAt: new Date().toISOString() };
    return respond(c, store.commit(a, [{ op: "put", id: before.id, before, after }], `恢复 Komari 的值「${before.name}」${key}`, "update"));
  });

  // trash
  app.post("/api/assets/:id/restore", (c) => {
    const a = need(c, "write");
    const before = store.mustGet(c.req.param("id"), true);
    if (!before.deletedAt) throw new HttpError(400, "这项资产不在回收站");
    return respond(c, store.commit(a, [{ op: "put", id: before.id, before, after: { ...before, deletedAt: null } }], `从回收站恢复「${before.name}」`, "restore"));
  });
  app.delete("/api/trash/:id", (c) => {
    const a = need(c, "write");
    const before = store.mustGet(c.req.param("id"), true);
    if (!before.deletedAt) throw new HttpError(400, "先删除到回收站");
    return respond(c, store.commit(a, [{ op: "purge", id: before.id, before }], `永久删除「${before.name}」`, "purge"));
  });

  // attachments (documents)
  app.get("/api/assets/:id/attachments/:name", (c) => {
    need(c, "read");
    const a = store.mustGet(c.req.param("id"), true);
    const name = c.req.param("name");
    const meta = a.attachments?.find((x) => x.name === name);
    const p = backup.attachmentPath(a.id, name);
    if (!meta || !existsSync(p)) throw new HttpError(404, "附件不存在");
    return new Response(readFileSync(p), { headers: { "content-type": meta.mime || "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
  });
  app.post("/api/assets/:id/attachments", async (c) => {
    const actorV = need(c, "write");
    if (decide(actorV, "write") === "plan") throw new HttpError(403, "上传附件需要网页登录或完全权限令牌");
    const before = store.resolve(c.req.param("id"));
    const name = (c.req.query("name") ?? "").replace(/[\\/]/g, "_").trim();
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (!name || name.startsWith(".")) throw new HttpError(400, "缺少文件名");
    if (buf.byteLength > 25 * 1024 * 1024) throw new HttpError(413, "附件不能超过 25 MB");
    const p = backup.attachmentPath(before.id, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
    const meta = { name, size: buf.byteLength, sha256: sha256(Buffer.from(buf).toString("binary")), addedAt: new Date().toISOString(), mime: c.req.header("content-type") ?? undefined };
    const attachments = [...(before.attachments ?? []).filter((x) => x.name !== name), meta];
    return respond(c, store.commit(actorV, [store.updateOp(before.id, { attachments })], `上传附件「${name}」到「${before.name}」`, "update"));
  });
  app.delete("/api/assets/:id/attachments/:name", (c) => {
    const actorV = need(c, "write");
    if (decide(actorV, "write") === "plan") throw new HttpError(403, "删除附件需要网页登录或完全权限令牌");
    const before = store.resolve(c.req.param("id"));
    const name = c.req.param("name");
    rmSync(backup.attachmentPath(before.id, name), { force: true });
    const attachments = (before.attachments ?? []).filter((x) => x.name !== name);
    return respond(c, store.commit(actorV, [store.updateOp(before.id, { attachments })], `删除附件「${name}」`, "update"));
  });

  // import & doctor
  app.post("/api/import", async (c) => {
    const a = need(c, "write");
    const ct = c.req.header("content-type") ?? "";
    let inputs: AssetInput[];
    if (ct.includes("text/csv")) inputs = csvToInputs(await c.req.text());
    else {
      const raw = await c.req.text();
      inputs = jsonToInputs(raw);
    }
    if (!inputs.length) throw new HttpError(400, "没有可导入的资产");
    const ops = inputs.map((i) => (i.id && store.get(i.id) && !store.get(i.id)!.deletedAt ? store.updateOp(i.id, i as Partial<Asset>) : store.createOp(i)));
    const real = ops.filter((o) => o.op !== "put" || diffAssets(o.before, o.after).length);
    if (!real.length) return c.json({ status: "unchanged" });
    return respond(c, store.commit(a, real, `导入 ${real.length} 项`, "import"));
  });
  app.get("/api/doctor", (c) => {
    need(c, "read");
    return c.json({ issues: doctor(store.all(), todayIso()) });
  });

  // ---------- settings ----------
  app.get("/api/settings", (c) => {
    need(c, "read");
    return c.json({ settings: store.settings() });
  });
  app.put("/api/settings", async (c) => {
    need(c, "admin");
    const next = mergeSettings(await body<Partial<Settings>>(c));
    const cur = store.settings();
    if (JSON.stringify(cur.backup) !== JSON.stringify(next.backup)) stepUp(c);
    next.backup.keep = Math.min(365, Math.max(1, Math.floor(next.backup.keep)));
    next.backup.hour = Math.min(23, Math.max(0, Math.floor(next.backup.hour)));
    next.komari.intervalMin = Math.min(1440, Math.max(5, Math.floor(next.komari.intervalMin)));
    next.atoll.intervalMin = [5, 15, 30, 60].includes(Number(next.atoll.intervalMin)) ? Number(next.atoll.intervalMin) : 15;
    next.atoll.enabled = Boolean(next.atoll.enabled);
    next.atoll.url = String(next.atoll.url ?? "").trim().slice(0, 300);
    next.cloudflare = { enabled: Boolean(next.cloudflare?.enabled) };
    // the server owns the fetched-at stamp; a client can't fake it
    next.display.ratesUpdatedAt = cur.display.ratesUpdatedAt;
    next.display.ratesSource = cur.display.ratesSource;
    if (next.display.autoRates) next.display.rates = cur.display.currency === next.display.currency ? cur.display.rates : next.display.rates;
    store.saveSettings(next);
    if (next.display.autoRates && (!cur.display.autoRates || cur.display.currency !== next.display.currency)) await rates?.refresh();
    if (cur.komari.url !== next.komari.url || cur.komari.intervalMin !== next.komari.intervalMin) { komari.resetCache(); komari.start(); }
    if (JSON.stringify(cur.atoll) !== JSON.stringify(next.atoll)) atoll?.start();
    if (cur.cloudflare.enabled !== next.cloudflare.enabled) cloudflare?.start();
    return c.json({ settings: store.settings() });
  });
  app.post("/api/settings/rates/refresh", async (c) => {
    need(c, "admin");
    if (!rates) throw new HttpError(503, "汇率服务未启用");
    if (!store.settings().display.autoRates) throw new HttpError(400, "自动汇率已关闭");
    await rates.refresh();
    if (rates.lastError) throw new HttpError(502, `汇率更新失败：${rates.lastError}`);
    return c.json({ settings: store.settings() });
  });

  // ---------- Komari (read-only proxy) ----------
  app.get("/api/komari/info", async (c) => {
    need(c, "read");
    const s = store.settings().komari;
    const st = komari.state;
    return c.json({
      url: s.url, hasKey: Boolean(process.env.KOMARI_API_KEY) || st.hasKey, version: st.version ?? null,
      lastSync: st.lastSync ?? store.meta("komari_last_sync") ?? null, lastError: st.lastError ?? null, nodes: st.nodes ?? null, ping: st.ping ?? null,
    });
  });
  app.get("/api/komari/nodes", async (c) => {
    need(c, "read");
    const clients = await komari.listClients(c.req.query("fresh") === "1" ? 0 : 60_000);
    const bound = new Map(store.list().filter((a) => a.komari).map((a) => [a.komari!.uuid, a]));
    return c.json({
      nodes: clients.map((n) => ({
        uuid: n.uuid, name: n.name, region: n.region, version: n.version, os: n.os, hidden: n.hidden,
        assetId: bound.get(n.uuid)?.id ?? null, assetName: bound.get(n.uuid)?.name ?? null,
        overridden: Object.keys(bound.get(n.uuid)?.komari?.overridden ?? {}).length,
      })),
    });
  });
  app.get("/api/komari/status", async (c) => {
    need(c, "read");
    // Someone is looking: refresh if older than 8 s. Background keeps a 5-minute cadence.
    return c.json(await komari.status(8_000));
  });
  app.post("/api/komari/sync", async (c) => {
    need(c, "write");
    if (actor(c).kind === "token" && decide(actor(c), "write") !== "direct") throw new HttpError(403, "同步需要完全权限令牌");
    const r = await komari.sync();
    await komari.version();
    return c.json({ updated: r.updated.length, nodes: r.nodes, unbound: r.unbound.map((u) => ({ uuid: u.uuid, name: u.name })) });
  });
  app.post("/api/komari/bind", async (c) => {
    const a = need(c, "write");
    const { uuid, assetId } = await body<{ uuid: string; assetId?: string }>(c);
    const { op, asset } = await komari.bindOp(uuid, assetId);
    return respond(c, store.commit(a, [op], `绑定 Komari 节点 ${uuid.slice(0, 8)} →「${asset.name}」`, assetId ? "update" : "create"));
  });
  app.post("/api/komari/unbind", async (c) => {
    const a = need(c, "write");
    const { assetId } = await body<{ assetId: string }>(c);
    const before = store.resolve(assetId);
    if (!before.komari) throw new HttpError(400, "没有绑定节点");
    return respond(c, store.commit(a, [{ op: "put", id: before.id, before, after: { ...before, komari: null } }], `解除 Komari 绑定「${before.name}」`, "update"));
  });

  // ---------- Atoll (read-only snapshot; links to assets are derived in the client, never stored) ----------
  const needAtoll = () => { if (!atoll) throw new HttpError(503, "Atoll 接入未启用"); return atoll; };
  app.get("/api/atoll/info", (c) => {
    need(c, "read");
    const s = store.settings().atoll;
    const snap = atoll?.snapshot() ?? null;
    return c.json({
      enabled: s.enabled, url: s.url, hasKey: atoll?.hasKey ?? false,
      lastSync: atoll?.lastSync() ?? null, lastError: atoll?.state.lastError ?? null,
      projects: snap ? snap.projects.length : null, servers: snap ? snap.servers.length : null,
      key: atoll?.state.key ?? null,
    });
  });
  app.get("/api/atoll/snapshot", (c) => {
    need(c, "read");
    if (!store.settings().atoll.enabled) return c.json({ snapshot: null });
    return c.json({ snapshot: atoll?.snapshot() ?? null });
  });
  app.post("/api/atoll/sync", async (c) => {
    need(c, "write");
    if (actor(c).kind === "token" && decide(actor(c), "write") !== "direct") throw new HttpError(403, "同步需要完全权限令牌");
    const svc = needAtoll();
    if (!store.settings().atoll.enabled) throw new HttpError(400, "Atoll 接入已关闭");
    const snap = await svc.sync();
    return c.json({ servers: snap.servers.length, projects: snap.projects.length, syncedAt: snap.syncedAt, key: svc.state.key ?? null });
  });

  // ---------- Cloudflare (read-only snapshot; links to assets are derived in the client, never stored) ----------
  app.get("/api/cloudflare/info", (c) => {
    need(c, "read");
    const s = store.settings().cloudflare;
    const snap = cloudflare?.snapshot() ?? null;
    return c.json({
      enabled: s.enabled, hasToken: cloudflare?.hasToken ?? false, hasAccountId: cloudflare?.hasAccountId ?? false,
      lastSync: cloudflare?.lastSync() ?? null, lastError: cloudflare?.state.lastError ?? null,
      token: cloudflare?.state.token ?? null, sections: snap?.sections ?? null,
      counts: snap ? { accounts: snap.accounts.length, zones: snap.zones.length, records: snap.records.length, tunnels: snap.tunnels.length } : null,
    });
  });
  app.get("/api/cloudflare/snapshot", (c) => {
    need(c, "read");
    if (!store.settings().cloudflare.enabled) return c.json({ snapshot: null });
    return c.json({ snapshot: cloudflare?.snapshot() ?? null });
  });
  app.post("/api/cloudflare/sync", async (c) => {
    need(c, "write");
    if (actor(c).kind === "token" && decide(actor(c), "write") !== "direct") throw new HttpError(403, "同步需要完全权限令牌");
    if (!cloudflare) throw new HttpError(503, "Cloudflare 接入未启用");
    if (!store.settings().cloudflare.enabled) throw new HttpError(400, "Cloudflare 接入已关闭");
    const snap = await cloudflare.sync({ manual: true });
    return c.json({ zones: snap.zones.length, records: snap.records.length, syncedAt: snap.syncedAt, sections: snap.sections, token: cloudflare.state.token ?? null });
  });

  // ---------- CLIProxyAPI (read-only quota; feed tokens never leave the server) ----------
  const needCpx = () => { if (!cliproxy) throw new HttpError(503, "CLIProxyAPI 接入未启用"); return cliproxy; };
  app.get("/api/cliproxyapi", (c) => {
    need(c, "read");
    const svc = needCpx();
    return c.json({ connections: svc.list(), accounts: svc.accounts(), prefs: svc.prefs() });
  });
  /** 关注 / 手动绑定 one account. Stored in 方寸 only; CLIProxyAPI is never written to. */
  app.put("/api/cliproxyapi/accounts/:conn/:account", async (c) => {
    need(c, "write");
    if (actor(c).kind === "token" && decide(actor(c), "write") !== "direct") throw new HttpError(403, "需要网页登录或完全权限令牌");
    const svc = needCpx();
    const before = svc.prefs();
    const { pref, account } = svc.setPref(c.req.param("conn"), c.req.param("account"), await body(c));
    const old = before.find((p) => p.connectionId === pref.connectionId && p.accountId === pref.accountId);
    const who = account.email ?? account.label ?? account.id;
    const parts: string[] = [];
    if ((old?.starred ?? false) !== pref.starred) parts.push(pref.starred ? "关注" : "取消关注");
    if ((old?.assetId ?? null) !== (pref.assetId ?? null) || (old?.member ?? null) !== (pref.member ?? null)) {
      const a = pref.assetId ? store.get(pref.assetId) : null;
      parts.push(a ? `绑定到「${a.name}」${pref.member ? `成员 ${pref.member}` : ""}` : "解除绑定");
    }
    if (parts.length) store.audit(actor(c).name, "cliproxyapi-account", null, `CLIProxyAPI 账号 ${who}：${parts.join("，")}`, null, null);
    return c.json({ prefs: svc.prefs() });
  });
  app.post("/api/cliproxyapi/connections", async (c) => {
    need(c, "admin");
    const conn = await needCpx().add(await body(c));
    store.audit(actor(c).name, "cliproxyapi-add", null, `添加 CLIProxyAPI 连接「${conn.name}」`, null, null);
    return c.json({ connection: conn });
  });
  app.post("/api/cliproxyapi/test", async (c) => {
    need(c, "admin");
    const { connection } = await body<{ connection: string }>(c);
    return c.json(await needCpx().test(connection));
  });
  app.patch("/api/cliproxyapi/connections/:id", async (c) => {
    need(c, "admin");
    return c.json({ connection: await needCpx().update(c.req.param("id"), await body(c)) });
  });
  app.delete("/api/cliproxyapi/connections/:id", (c) => {
    need(c, "admin");
    needCpx().remove(c.req.param("id"));
    store.audit(actor(c).name, "cliproxyapi-remove", null, `删除 CLIProxyAPI 连接 ${c.req.param("id")}`, null, null);
    return c.json({ ok: true });
  });
  app.post("/api/cliproxyapi/refresh", async (c) => {
    need(c, "write");
    if (actor(c).kind === "token" && decide(actor(c), "write") !== "direct") throw new HttpError(403, "刷新需要完全权限令牌");
    const svc = needCpx();
    const id = c.req.query("id");
    if (id) await svc.refresh(id, true); else await svc.refreshAll(true);
    return c.json({ connections: svc.list(), accounts: svc.accounts(), prefs: svc.prefs() });
  });

  // ---------- tokens (web only) ----------
  app.get("/api/tokens", (c) => {
    need(c, "admin");
    const rows = db.prepare("SELECT id, name, prefix, scope, created_at, expires_at, revoked_at, last_used_at FROM tokens ORDER BY created_at DESC").all() as Omit<TokenRow, "hash">[];
    return c.json({ tokens: rows.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, scope: t.scope, createdAt: t.created_at, expiresAt: t.expires_at, revokedAt: t.revoked_at, lastUsedAt: t.last_used_at })) });
  });
  app.post("/api/tokens", async (c) => {
    need(c, "admin");
    const { name, scope, expiresInDays } = await body<{ name: string; scope: TokenRow["scope"]; expiresInDays?: number | null }>(c);
    if (!name?.trim()) throw new HttpError(400, "给令牌起个名字，比如 Claude Code");
    if (!["read", "write", "full"].includes(scope)) throw new HttpError(400, "权限只能是 read / write / full");
    const t = createAccessToken(db, name.trim().slice(0, 60), scope, expiresInDays ?? null);
    store.audit(actor(c).name, "token-create", null, `创建令牌「${name}」（${SCOPE_LABEL[scope]}）`, null, null);
    return c.json({ id: t.id, token: t.token, message: "令牌只显示这一次，请立即复制保存" });
  });
  app.delete("/api/tokens/:id", (c) => {
    need(c, "admin");
    const r = db.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), c.req.param("id"));
    if (!r.changes) throw new HttpError(404, "令牌不存在或已吊销");
    store.audit(actor(c).name, "token-revoke", null, `吊销令牌 ${c.req.param("id")}`, null, null);
    return c.json({ ok: true });
  });

  // ---------- change plans ----------
  const withDiff = (cs: ReturnType<Store["changeset"]>) => ({
    ...cs,
    ops: cs.ops.map((o) => ({
      op: o.op, id: o.id, name: (o.op === "put" ? o.after.name : o.before.name),
      type: (o.op === "put" ? o.after.type : o.before.type),
      changes: o.op === "put" ? diffAssets(o.before, o.after).map((d) => ({ ...d, before: d.before, after: d.after })) : [],
    })),
  });
  app.get("/api/changesets", (c) => {
    need(c, "read");
    return c.json({ changesets: store.changesets(c.req.query("status")).map(withDiff) });
  });
  app.get("/api/changesets/:id", (c) => {
    need(c, "read");
    return c.json({ changeset: withDiff(store.changeset(c.req.param("id"))) });
  });
  app.post("/api/changesets/:id/approve", (c) => {
    need(c, "admin");
    return respond(c, store.approve(c.req.param("id"), actor(c).name));
  });
  app.post("/api/changesets/:id/reject", (c) => {
    need(c, "admin");
    store.reject(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ---------- audit & undo ----------
  app.get("/api/audit", (c) => {
    need(c, "read");
    const limit = Math.min(500, Number(c.req.query("limit") ?? 100));
    return c.json({ entries: store.auditList({ limit, assetId: c.req.query("assetId"), full: false }) });
  });
  app.post("/api/audit/:id/undo", (c) => {
    const a = need(c, "write");
    return respond(c, store.undo(a, Number(c.req.param("id"))));
  });

  // ---------- backup & export ----------
  const download = (data: Uint8Array | string, name: string, type: string) =>
    new Response(typeof data === "string" ? data : (data as BodyInit), { headers: { "content-type": type, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
  const stamp = () => todayIso();

  app.get("/api/backup/download", async (c) => {
    need(c, "backup"); stepUp(c);
    store.audit(actor(c).kind === "user" ? actor(c).name : `令牌「${actor(c).name}」`, "backup", null, "下载完整备份", null, null);
    return download(await backup.build(), `fangcun-${stamp()}.fangcun`, "application/zip");
  });
  app.post("/api/backup/preview", async (c) => {
    need(c, "backup"); stepUp(c);
    return c.json(await backup.preview(new Uint8Array(await c.req.arrayBuffer())));
  });
  app.post("/api/backup/restore", async (c) => {
    need(c, "backup"); stepUp(c);
    const mode = c.req.query("mode") === "replace" ? "replace" : "merge";
    const prefer = (["incoming", "current"].includes(c.req.query("prefer") ?? "") ? c.req.query("prefer") : "newer") as "newer";
    const r = await backup.restore(new Uint8Array(await c.req.arrayBuffer()), mode, actor(c).kind === "user" ? actor(c).name : `令牌「${actor(c).name}」`, prefer);
    return c.json({ ok: true, mode, ...r });
  });
  app.get("/api/backup/status", (c) => {
    need(c, "read");
    return c.json(backup.status());
  });
  app.post("/api/backup/run", async (c) => {
    need(c, "backup"); stepUp(c);
    return c.json({ name: await backup.writeFile("manual") });
  });
  app.get("/api/backup/files/:name", (c) => {
    need(c, "backup"); stepUp(c);
    return download(readFileSync(backup.filePath(c.req.param("name"))), c.req.param("name"), "application/zip");
  });

  app.get("/api/export/:format", (c) => {
    need(c, "read"); stepUp(c);
    const fmt = c.req.param("format");
    const type = c.req.query("type");
    const assets = store.list().filter((a) => !type || a.type === type).map(toPublic);
    if (type && !ASSET_TYPES.includes(type as Asset["type"])) throw new HttpError(400, "未知类型");
    if (fmt === "json") return download(JSON.stringify({ ...backup.dataDoc(), assets }, null, 2), `fangcun-${stamp()}.json`, "application/json");
    if (fmt === "ics") return download(toIcs(assets), `fangcun-renewals-${stamp()}.ics`, "text/calendar; charset=utf-8");
    if (fmt === "csv") {
      if (type) return download(toCsv(assets), `fangcun-${type}-${stamp()}.csv`, "text/csv; charset=utf-8");
      const files = toCsvByType(assets);
      const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
      return download(zip, `fangcun-csv-${stamp()}.zip`, "application/zip");
    }
    throw new HttpError(400, "格式只能是 json / csv / ics");
  });

  // ---------- web UI ----------
  if (webDir && existsSync(join(webDir, "index.html"))) {
    const index = readFileSync(join(webDir, "index.html"));
    const types: Record<string, string> = { js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2", woff: "font/woff", html: "text/html; charset=utf-8", ico: "image/x-icon", json: "application/json" };
    app.get("*", (c) => {
      const path = decodeURIComponent(new URL(c.req.url).pathname);
      if (path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
      const file = join(webDir, path);
      if (file.startsWith(webDir) && path !== "/" && existsSync(file) && !file.endsWith("/")) {
        try {
          const data = readFileSync(file);
          const ext = file.split(".").pop() ?? "";
          return new Response(data, { headers: { "content-type": types[ext] ?? "application/octet-stream", "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
        } catch { /* directory */ }
      }
      return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    });
  }

  return app;
}
