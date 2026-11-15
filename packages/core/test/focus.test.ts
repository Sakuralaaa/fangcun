import { describe, expect, it } from "vitest";
import {
  applyKomari, compareAssets, compareStarred, csvToInputs, DEFAULT_SETTINGS, focusPatch, jsonToInputs, migrateDoc, normalizeAsset, sortCosts, toCsv,
  SCHEMA_VERSION, type Asset, type KomariClient,
} from "../src";

const T = "2026-11-15";
const a = (id: string, x: Partial<Asset> = {}) => normalizeAsset({ id, type: "domain", name: id, price: 0, currency: "USD", cycle: "year", ...x } as Asset, T);

describe("关注 / 置顶：模型", () => {
  it("defaults to not starred and pinned implies starred", () => {
    expect(a("x")).toMatchObject({ starred: false, pinned: false });
    expect(a("y", { pinned: true })).toMatchObject({ starred: true, pinned: true });
    expect(a("z", { starred: true })).toMatchObject({ starred: true, pinned: false });
  });

  it("focusPatch: 取消关注 also 取消置顶, 置顶 also 关注", () => {
    expect(focusPatch({ starred: false })).toEqual({ starred: false, pinned: false });
    expect(focusPatch({ pinned: true })).toEqual({ pinned: true, starred: true });
    expect(focusPatch({ pinned: false })).toEqual({ pinned: false });
    expect(focusPatch({ name: "n" } as { name: string; starred?: boolean })).toEqual({ name: "n" });
    const pinned = a("p", { pinned: true });
    expect(normalizeAsset({ ...pinned, ...focusPatch({ starred: false }) })).toMatchObject({ starred: false, pinned: false });
    expect(normalizeAsset({ ...pinned, ...focusPatch({ pinned: false }) })).toMatchObject({ starred: true, pinned: false });
  });

  it("schema 2 → 3 migration defaults old assets to false", () => {
    const doc = migrateDoc({ schemaVersion: 2, assets: [{ id: "old", type: "domain", name: "old.dev", price: 1, currency: "USD", cycle: "year", tags: [], details: [], related: [], renewals: [], autoRenew: false }] });
    expect(SCHEMA_VERSION).toBe(3);
    expect(doc.schemaVersion).toBe(3);
    expect(doc.assets[0]).toMatchObject({ starred: false, pinned: false });
    const v1 = migrateDoc({ schemaVersion: 1, assets: [{ id: "s", type: "sub", name: "s", starred: true }] });
    expect(v1.assets[0]).toMatchObject({ type: "subscription", starred: true, pinned: false });
  });
});

describe("关注 / 置顶：排序", () => {
  it("list: pinned first, then by expiry (no expiry last), then name", () => {
    const list = [
      a("late", { expiresAt: "2027-06-01" }), a("none"), a("soon", { expiresAt: "2026-11-20" }),
      a("pin-late", { pinned: true, expiresAt: "2028-01-01" }), a("star-soon", { starred: true, expiresAt: "2026-11-18" }),
    ];
    expect(list.sort((x, y) => compareAssets(x, y, T)).map((x) => x.id)).toEqual(["pin-late", "star-soon", "soon", "late", "none"]);
  });

  it("overview 关注: due within 30 days first, then pinned, then by expiry", () => {
    const list = [
      a("pin-far", { pinned: true, expiresAt: "2027-09-01" }), a("star-far", { starred: true, expiresAt: "2027-01-01" }),
      a("star-due", { starred: true, expiresAt: "2026-11-25" }), a("pin-due", { pinned: true, expiresAt: "2026-12-10" }),
    ];
    expect(list.sort((x, y) => compareStarred(x, y, T)).map((x) => x.id)).toEqual(["star-due", "pin-due", "pin-far", "star-far"]);
  });
});

describe("关注 / 置顶：导入导出与同步", () => {
  it("CSV round trip keeps starred / pinned; an older CSV without the columns leaves them unset", () => {
    const csv = toCsv([a("s.dev", { starred: true }), a("p.dev", { pinned: true }), a("n.dev")]);
    expect(csv.split("\r\n")[0]).toContain("starred,pinned");
    const back = csvToInputs(csv).map((i) => normalizeAsset(i));
    expect(back.map((x) => [x.starred, x.pinned])).toEqual([[true, false], [true, true], [false, false]]);
    const old = csvToInputs("type,name\ndomain,o.dev\n");
    expect("starred" in old[0]).toBe(false);
    expect("pinned" in old[0]).toBe(false);
    expect(jsonToInputs(JSON.stringify([{ type: "domain", name: "j.dev", pinned: true }]))[0]).toMatchObject({ pinned: true });
  });

  it("Komari sync never touches starred / pinned", () => {
    const client: KomariClient = { uuid: "u1", name: "hk", price: 30, billing_cycle: 30, currency: "$", tags: "a;b", expired_at: "Sat 2026-11-21 4:00 PM UTC (UTC+00:00)" } as KomariClient;
    const all = { ...DEFAULT_SETTINGS.komari, fields: { ...DEFAULT_SETTINGS.komari.fields, tags: true } };
    const base = normalizeAsset({ type: "server", name: "hk", price: 1, currency: "USD", cycle: "month", komari: { uuid: "u1" }, starred: true, pinned: true } as Asset);
    const { asset } = applyKomari(base, client, all, "t1");
    expect(asset.price).toBe(30);
    expect(asset).toMatchObject({ starred: true, pinned: true });
    const plain = normalizeAsset({ ...base, starred: false, pinned: false });
    expect(applyKomari(plain, client, all, "t2").asset).toMatchObject({ starred: false, pinned: false });
  });
});

describe("费用表排序", () => {
  const d = { ...DEFAULT_SETTINGS.display, currency: "USD", rates: { USD: 1, CNY: 7, EUR: 0.5 } };
  const rows = [
    a("A-yearly", { type: "domain", price: 120, currency: "USD", cycle: "year", expiresAt: "2027-03-01" }),     // 10/mo, 实付 120
    a("B-cny", { type: "server", price: 70, currency: "CNY", cycle: "month", expiresAt: "2026-11-20" }),         // 10/mo, 实付 10 USD
    a("C-eur", { type: "server", price: 10, currency: "EUR", cycle: "month" }),                                  // 20/mo, 实付 20 USD, no expiry
    a("D-norate", { type: "subscription", price: 99, currency: "JPY", cycle: "month", expiresAt: "2026-12-01" }), // no rate
  ];
  const ids = (k: Parameters<typeof sortCosts>[1]) => sortCosts(rows, k, d).map((x) => x.id);

  it("每月 descending by default, converted with the display rates; missing rate last", () => {
    expect(ids({ key: "monthly", dir: "desc" })).toEqual(["C-eur", "A-yearly", "B-cny", "D-norate"]);
    expect(ids({ key: "monthly", dir: "asc" })).toEqual(["A-yearly", "B-cny", "C-eur", "D-norate"]);
  });

  it("实付 compares the converted amount, not the literal number", () => {
    expect(ids({ key: "price", dir: "desc" })).toEqual(["A-yearly", "C-eur", "B-cny", "D-norate"]);
    expect(ids({ key: "price", dir: "asc" })).toEqual(["B-cny", "C-eur", "A-yearly", "D-norate"]);
  });

  it("到期日: no date always last, in both directions", () => {
    expect(ids({ key: "expires", dir: "asc" })).toEqual(["B-cny", "D-norate", "A-yearly", "C-eur"]);
    expect(ids({ key: "expires", dir: "desc" })).toEqual(["A-yearly", "D-norate", "B-cny", "C-eur"]);
  });

  it("类型 groups by type with 每月 descending inside; 资产名 sorts by name", () => {
    expect(ids({ key: "type", dir: "asc" })).toEqual(["C-eur", "B-cny", "A-yearly", "D-norate"]);
    expect(ids({ key: "type", dir: "desc" })).toEqual(["D-norate", "A-yearly", "C-eur", "B-cny"]);
    expect(ids({ key: "name", dir: "desc" })).toEqual(["D-norate", "C-eur", "B-cny", "A-yearly"]);
  });
});
