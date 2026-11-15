import type { Store } from "./store";

/**
 * Automatic exchange rates for the overview's 约 totals only — asset prices stay as typed.
 * Primary: Frankfurter (ECB reference rates, ~30 currencies, updated each working day).
 * Fallback / fill-in: open.er-api.com (daily, 160+ currencies). No API key needed for either.
 * Read-only GETs; failures keep the last good rates.
 */
const SOURCES = {
  frankfurter: "https://api.frankfurter.dev/v1/latest?base=USD",
  erapi: "https://open.er-api.com/v6/latest/USD",
};
const EVERY_MS = 6 * 3600_000;

type FetchFn = typeof fetch;

async function getJson(f: FetchFn, url: string): Promise<any> {
  const r = await f(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

/** USD-based table: units of each currency per 1 USD. */
export async function fetchUsdRates(f: FetchFn = fetch): Promise<{ usd: Record<string, number>; source: string }> {
  const usd: Record<string, number> = { USD: 1 };
  const used: string[] = [];
  try {
    const j = await getJson(f, SOURCES.frankfurter);
    for (const [k, v] of Object.entries(j?.rates ?? {})) if (Number(v) > 0) usd[k] = Number(v);
    used.push("ECB (Frankfurter)");
  } catch { /* fall through */ }
  try {
    const j = await getJson(f, SOURCES.erapi);
    let filled = 0;
    for (const [k, v] of Object.entries(j?.rates ?? {})) if (!(k in usd) && Number(v) > 0) { usd[k] = Number(v); filled++; }
    if (filled) used.push("open.er-api");
  } catch { /* ignore */ }
  if (used.length === 0) throw new Error("汇率源都无法访问");
  return { usd, source: used.join(" + ") };
}

/** Re-base a USD table onto the display currency, keeping only currencies the user actually needs plus common ones. */
export function rebase(usd: Record<string, number>, display: string, want: Iterable<string>): Record<string, number> {
  const base = usd[display];
  if (!base) throw new Error(`汇率源没有 ${display}`);
  const out: Record<string, number> = {};
  for (const c of new Set([display, ...want])) {
    if (usd[c]) out[c] = Number((usd[c] / base).toPrecision(6));
  }
  return out;
}

const COMMON = ["USD", "CNY", "HKD", "EUR", "GBP", "JPY"];

export class RatesService {
  private timer?: ReturnType<typeof setInterval>;
  lastError?: string;
  constructor(private store: Store, private f: FetchFn = fetch) {}

  async refresh(): Promise<void> {
    const s = this.store.settings();
    if (!s.display.autoRates) return;
    try {
      const { usd, source } = await fetchUsdRates(this.f);
      const want = new Set([...COMMON, ...Object.keys(s.display.rates), ...this.store.list().map((a) => a.currency).filter(Boolean)]);
      const rates = rebase(usd, s.display.currency, want);
      const cur = this.store.settings(); // re-read: settings may have changed while fetching
      if (!cur.display.autoRates || cur.display.currency !== s.display.currency) return;
      this.store.saveSettings({ ...cur, display: { ...cur.display, rates, ratesUpdatedAt: new Date().toISOString(), ratesSource: source } });
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message;
    }
  }

  start() {
    this.stop();
    const s = this.store.settings().display;
    const age = s.ratesUpdatedAt ? Date.now() - Date.parse(s.ratesUpdatedAt) : Infinity;
    if (age > EVERY_MS) void this.refresh();
    this.timer = setInterval(() => void this.refresh(), EVERY_MS);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
