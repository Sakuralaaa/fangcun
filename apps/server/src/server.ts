import { serve } from "@hono/node-server";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "@fangcun/core";
import { createApp } from "./app";
import { AtollService } from "./atoll";
import { BackupService } from "./backup";
import { openDb } from "./db";
import { KomariService } from "./komari";
import { RatesService } from "./rates";
import { Store } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.FANGCUN_DATA_DIR ?? process.env.DATA_DIR ?? "./data");
const backupDir = resolve(process.env.FANGCUN_BACKUP_DIR ?? join(dataDir, "backups"));
const webDir = resolve(process.env.FANGCUN_WEB_DIR ?? join(here, "../../web/dist"));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const store = new Store(openDb(join(dataDir, "fangcun.db")));
const komari = new KomariService(store);
const atoll = new AtollService(store);
const rates = new RatesService(store);
const backup = new BackupService(store, dataDir, backupDir);
const secure = process.env.COOKIE_SECURE === "1" ? true : process.env.COOKIE_SECURE === "0" ? false : undefined;
const app = createApp({ store, komari, backup, rates, atoll, webDir, secureCookie: secure });

komari.start();
atoll.start();
backup.start();
rates.start();

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`方寸 ${APP_VERSION} · http://${host}:${info.port} · 数据目录 ${dataDir}`);
  if (!process.env.KOMARI_API_KEY) console.log("提示：未设置 KOMARI_API_KEY，Komari 同步不可用");
  if (!process.env.ATOLL_API_KEY) console.log("提示：未设置 ATOLL_API_KEY，Atoll 只读接入不可用");
});

const shutdown = () => { komari.stop(); atoll.stop(); backup.stop(); rates.stop(); store.db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
