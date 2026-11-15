import { describe, expect, it } from "vitest";
import { applyKomari, DEFAULT_SETTINGS, komariCycle, komariDate, mapClient, mapStatus, markOverrides, normalizeAsset, restoreKomariField, summarizePing, trafficUsed, type KomariClient } from "../src";

// Shaped like Komari 1.2.5 GET /api/admin/client/list
const client: KomariClient = {
  uuid: "7f3c-hk02", name: "hk-api-02", cpu_name: "AMD EPYC 7763", cpu_cores: 4, os: "Ubuntu 24.04", ipv4: "192.0.2.11", region: "🇭🇰",
  mem_total: 8 * 1024 ** 3, disk_total: 80 * 1024 ** 3, version: "1.5.11", price: 20, billing_cycle: 30, auto_renewal: false,
  currency: "$", expired_at: "2026-11-22T00:00:00+08:00", tags: "prod;hk", traffic_limit: 1024 ** 4, traffic_limit_type: "max",
};
const fields = DEFAULT_SETTINGS.komari;

describe("Komari 映射", () => {
  it("maps cycles, currency and dates", () => {
    expect(komariCycle(30)).toBe("month");
    expect(komariCycle(90)).toBe("quarter");
    expect(komariCycle(365)).toBe("year");
    expect(komariCycle(-1)).toBe("once");
    expect(komariDate("0001-01-01T00:00:00Z")).toBeNull();
    expect(komariDate("2099-12-31T00:00:00Z")).toBe("2099-12-31");
    expect(komariDate("2200-01-01T00:00:00Z")).toBeNull();
    const m = mapClient(client);
    expect(m).toMatchObject({ price: 20, currency: "USD", cycle: "month", expiresAt: "2026-11-22", "detail:内存": "8 GB", "detail:CPU": "4 核 · AMD EPYC 7763", tags: ["prod", "hk"] });
  });

  it("sync fills bound asset, respects toggles", () => {
    const a = normalizeAsset({ type: "server", name: "hk-api-02", price: 0, currency: "USD", cycle: "month", komari: { uuid: "7f3c-hk02" } } as never);
    const { asset, changed } = applyKomari(a, client, fields, "2026-11-15T03:00:00Z");
    expect(asset.price).toBe(20);
    expect(asset.expiresAt).toBe("2026-11-22");
    expect(asset.details.find((d) => d.label === "IPv4")).toMatchObject({ value: "192.0.2.11", mono: true });
    expect(asset.tags).toEqual([]); // tags toggle off by default
    expect(changed).toContain("price");
  });

  it("手动修改 is kept, Komari change is flagged, restore takes Komari's value", () => {
    const a0 = normalizeAsset({ type: "server", name: "hk", price: 0, currency: "USD", cycle: "month", komari: { uuid: "7f3c-hk02" } } as never);
    const synced = applyKomari(a0, client, fields, "t1").asset;
    const edited = markOverrides(synced, { ...synced, price: 24 }, fields);
    expect(edited.komari!.overridden!.price).toEqual({ komari: 20 });
    const again = applyKomari(edited, { ...client, price: 22 }, fields, "t2").asset;
    expect(again.price).toBe(24);
    expect(again.komari!.overridden!.price).toEqual({ komari: 22, changed: true });
    const restored = restoreKomariField(again, "price");
    expect(restored.price).toBe(22);
    expect(restored.komari!.overridden!.price).toBeUndefined();
    // editing back to Komari's value clears the mark
    const back = markOverrides(edited, { ...edited, price: 20 }, fields);
    expect(back.komari!.overridden!.price).toBeUndefined();
  });

  it("maps rpc2 common:getNodesLatestStatus records", () => {
    const s = mapStatus("7f3c-hk02", {
      client: "7f3c-hk02", cpu: 23.4, ram: 3e9, ram_total: 8e9, disk: 4e10, disk_total: 8e10, load: 0.42, load5: 0.5, load15: 0.47,
      net_in: 6_710_886, net_out: 1_887_436, net_total_up: 3e11, net_total_down: 7e11, connections: 430, connections_udp: 18, online: true, uptime: 86400 * 37,
    }, client);
    expect(s).toMatchObject({ online: true, cpu: 23.4, down: 6_710_886, up: 1_887_436, tcp: 412, udp: 18, trafficLimit: 1024 ** 4, trafficType: "max" });
    expect(trafficUsed(s)).toBe(7e11);
    expect(trafficUsed({ ...s, trafficType: "sum" })).toBe(1e12);
  });
});

describe("Komari 免费机", () => {
  it("price -1 (free) and missing price map to 0 instead of failing validation", () => {
    expect(mapClient({ uuid: "f", name: "free", price: -1, billing_cycle: -1 } as KomariClient).price).toBe(0);
    expect(mapClient({ uuid: "g", name: "unset" } as KomariClient).price).toBe(0);
    expect(mapClient({ uuid: "h", name: "paid", price: 12.5 } as KomariClient).price).toBe(12.5);
  });
});

describe("延迟/丢包汇总", () => {
  const from = Date.UTC(2026, 10, 15, 7, 0), to = from + 3_600_000;
  const t = (min: number) => new Date(from + min * 60_000).toISOString();
  it("picks the busiest task per node and fills time slots", () => {
    const p = summarizePing({
      tasks: [{ id: 1, name: "电信" }, { id: 2, name: "移动" }],
      records: [
        { task_id: 1, client: "a", time: t(1), value: 30 }, { task_id: 1, client: "a", time: t(2), value: 50 },
        { task_id: 1, client: "a", time: t(59), value: -1 }, { task_id: 2, client: "a", time: t(5), value: 300 },
        { task_id: 2, client: "b", time: t(30), value: -1 },
      ],
    }, from, to, 12);
    expect(p.a).toMatchObject({ task: "电信", latest: 50, avg: 40, loss: 33.3 });
    expect(p.a.buckets).toHaveLength(12);
    expect(p.a.buckets[0]).toEqual({ ms: 40, loss: 0 });
    expect(p.a.buckets[11]).toEqual({ ms: null, loss: 100 });
    expect(p.a.buckets[5]).toEqual({ ms: null, loss: null });
    expect(p.b).toMatchObject({ latest: null, avg: null, loss: 100 });
  });
  it("is empty without records", () => {
    expect(summarizePing(null, from, to)).toEqual({});
    expect(summarizePing({ records: [], tasks: [] }, from, to)).toEqual({});
  });
  it("maps group / cores / os / region into the status", () => {
    const s = mapStatus("7f3c-hk02", { online: true }, { ...client, group: " 主力 " });
    expect(s).toMatchObject({ group: "主力", cores: 4, os: "Ubuntu 24.04", region: "🇭🇰" });
  });
});
