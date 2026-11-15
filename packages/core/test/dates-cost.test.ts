import { describe, expect, it } from "vitest";
import {
  addMonths, daysUntil, displayTotal, dueLabel, monthlyByCurrency, monthlyCost, nextExpiry, normalizeAsset, paidSoFar,
  renewAsset, urgency, DEFAULT_SETTINGS,
} from "../src";

const T = "2026-11-15";
const asset = (over: Record<string, unknown> = {}) => normalizeAsset({ type: "server", name: "hk-01", price: 24, currency: "USD", cycle: "month", ...over } as never, "2026-01-01T00:00:00.000Z");

describe("到期计算", () => {
  it("daysUntil / urgency thresholds: 红 ≤7、橙 ≤14", () => {
    expect(daysUntil("2026-11-22", T)).toBe(7);
    expect(urgency("2026-11-22", T)).toBe("crit");
    expect(urgency("2026-11-29", T)).toBe("warn");
    expect(urgency("2026-11-30", T)).toBe("ok");
    expect(urgency("2026-11-10", T)).toBe("crit");
    expect(urgency(null, T)).toBe("none");
    expect(daysUntil(undefined, T)).toBe(Infinity);
  });
  it("dueLabel", () => {
    expect(dueLabel("2026-11-15", T)).toBe("今天");
    expect(dueLabel("2026-11-12", T)).toBe("已过期 3 天");
    expect(dueLabel("2026-12-03", T)).toBe("18 天");
    expect(dueLabel("2027-06-11", T)).toBe("7 个月");
    expect(dueLabel(null, T)).toBe("长期");
  });
  it("addMonths clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("nextExpiry advances one cycle, and from today when long lapsed", () => {
    expect(nextExpiry({ expiresAt: "2026-11-22", cycle: "month" }, T)).toBe("2026-12-22");
    expect(nextExpiry({ expiresAt: "2026-11-22", cycle: "year" }, T)).toBe("2027-11-22");
    expect(nextExpiry({ expiresAt: "2026-05-01", cycle: "month" }, T)).toBe("2026-12-15");
    expect(nextExpiry({ expiresAt: null, cycle: "quarter" }, T)).toBe("2027-02-15");
  });
  it("renewAsset pushes expiry and records the renewal", () => {
    const a = asset({ expiresAt: "2026-11-22" });
    const r = renewAsset(a, T);
    expect(r.expiresAt).toBe("2026-12-22");
    expect(r.renewals[0]).toMatchObject({ date: T, amount: 24, from: "2026-11-22", to: "2026-12-22" });
    expect(a.expiresAt).toBe("2026-11-22"); // input untouched
  });
  it("team renewal only renews the earliest workspace", () => {
    const a = asset({
      type: "subscription", name: "ChatGPT Team",
      team: { owner: "o@x", workspaces: [
        { id: "a", name: "研发", seats: 5, price: 820, currency: "CNY", cycle: "month", expiresAt: "2026-11-26", members: [] },
        { id: "b", name: "内容", seats: 3, price: 560, currency: "CNY", cycle: "month", expiresAt: "2026-12-09", members: [] },
      ] },
    });
    expect(a.price).toBe(1380);
    expect(a.currency).toBe("CNY");
    expect(a.expiresAt).toBe("2026-11-26");
    const r = renewAsset(a, T);
    expect(r.team!.workspaces[0].expiresAt).toBe("2026-12-26");
    expect(r.team!.workspaces[1].expiresAt).toBe("2026-12-09");
    expect(r.expiresAt).toBe("2026-12-09");
    expect(r.renewals[0].amount).toBe(820);
  });
});

describe("费用计算", () => {
  it("monthly cost per cycle, no conversion", () => {
    expect(monthlyCost({ price: 24, cycle: "month" })).toBe(24);
    expect(monthlyCost({ price: 36, cycle: "year" })).toBe(3);
    expect(monthlyCost({ price: 30, cycle: "quarter" })).toBe(10);
    expect(monthlyCost({ price: 99, cycle: "once" })).toBe(0);
  });
  it("totals stay per currency; display total only uses hand-typed rates", () => {
    const list = [asset(), asset({ id: "b", price: 72, currency: "CNY", cycle: "month" }), asset({ id: "c", price: 10, currency: "XYZ" })];
    const by = monthlyByCurrency(list);
    expect(by).toEqual({ USD: 24, CNY: 72, XYZ: 10 });
    const d = displayTotal(by, DEFAULT_SETTINGS.display);
    expect(d.total).toBeCloseTo(34);
    expect(d.unconverted).toEqual({ XYZ: 10 });
  });
  it("closed payment cards are not billed", () => {
    const card = normalizeAsset({ type: "payment", name: "U 卡", price: 2, currency: "USD", cycle: "month", payment: { issuer: "某平台", last4: "4242", status: "closed" } } as never);
    expect(monthlyByCurrency([card])).toEqual({});
  });
  it("paidSoFar counts started cycles", () => {
    expect(paidSoFar({ price: 24, cycle: "month", purchasedAt: "2026-08-15" }, T)).toBe(72);
    expect(paidSoFar({ price: 36, cycle: "year", purchasedAt: "2026-03-14" }, T)).toBe(36);
  });
});
