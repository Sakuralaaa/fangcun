import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@fangcun/core";
import { openDb } from "../src/db";
import { fetchUsdRates, RatesService, rebase } from "../src/rates";
import { Store } from "../src/store";

const fake = (fail: string[] = []) => (async (url: string) => {
  const host = new URL(url).host;
  if (fail.includes(host)) throw new Error("down");
  if (host === "api.frankfurter.dev") return Response.json({ base: "USD", rates: { CNY: 7, EUR: 0.9, HKD: 7.8 } });
  return Response.json({ result: "success", rates: { USD: 1, CNY: 7.1, TWD: 32, VND: 25000 } });
}) as unknown as typeof fetch;

describe("汇率", () => {
  it("ECB first, er-api only fills missing currencies", async () => {
    const { usd, source } = await fetchUsdRates(fake());
    expect(usd.CNY).toBe(7);
    expect(usd.TWD).toBe(32);
    expect(source).toContain("ECB");
  });
  it("falls back when Frankfurter is down; errors when both are", async () => {
    expect((await fetchUsdRates(fake(["api.frankfurter.dev"]))).usd.CNY).toBe(7.1);
    await expect(fetchUsdRates(fake(["api.frankfurter.dev", "open.er-api.com"]))).rejects.toThrow();
  });
  it("rebases onto the display currency", () => {
    const r = rebase({ USD: 1, CNY: 7, EUR: 0.9 }, "CNY", ["USD", "EUR"]);
    expect(r.CNY).toBe(1);
    expect(r.USD).toBeCloseTo(1 / 7, 5);
  });
  it("refresh saves rates and a timestamp; keeps old rates on failure; skips when off", async () => {
    const store = new Store(openDb(":memory:"));
    await new RatesService(store, fake()).refresh();
    const s = store.settings().display;
    expect(s.rates.CNY).toBe(7);
    expect(s.ratesUpdatedAt).toBeTruthy();
    const svc = new RatesService(store, fake(["api.frankfurter.dev", "open.er-api.com"]));
    await svc.refresh();
    expect(svc.lastError).toBeTruthy();
    expect(store.settings().display.rates.CNY).toBe(7);
    store.saveSettings({ ...store.settings(), display: { ...DEFAULT_SETTINGS.display, autoRates: false, rates: { USD: 1, CNY: 8 } } });
    await new RatesService(store, fake()).refresh();
    expect(store.settings().display.rates.CNY).toBe(8);
  });
});
