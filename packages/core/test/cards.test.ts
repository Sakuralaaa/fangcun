import { describe, expect, it } from "vitest";
import { computeCardReserves, convertCurrency, DEFAULT_SETTINGS, findLinkedCards, normalizeAsset } from "../src";

const T = "2026-11-15";
const mk = (over: Record<string, unknown>) => normalizeAsset(over as never, "2026-01-01T00:00:00.000Z");

describe("卡片预留提醒", () => {
  const wiseCard = mk({
    id: "card-wise",
    type: "payment",
    name: "美元虚拟卡",
    price: 0,
    currency: "USD",
    cycle: "year",
    related: ["ai-code"],
    payment: {
      issuer: "Wise",
      network: "Visa",
      last4: "4242",
      cardExpiry: "2028-09",
      status: "active",
      balance: 85,
      balanceCurrency: "USD",
      balanceUpdatedAt: "2026-11-12",
      reserveBuffer: 20,
    },
  });

  const aiCode = mk({
    id: "ai-code",
    type: "subscription",
    name: "研发编程助手",
    price: 100,
    currency: "USD",
    cycle: "month",
    expiresAt: "2026-11-30",
    autoRenew: true,
  });

  const aiChat = mk({
    id: "ai-chat",
    type: "subscription",
    name: "对话助手",
    price: 20,
    currency: "USD",
    cycle: "month",
    expiresAt: "2026-12-08",
    autoRenew: true,
    related: ["card-wise"], // backlink only!
  });

  const manualServer = mk({
    id: "hk-02",
    type: "server",
    name: "hk-api-02",
    price: 24,
    currency: "USD",
    cycle: "month",
    expiresAt: "2026-11-22",
    autoRenew: false,
    related: ["card-wise"],
  });

  const unassigned = mk({
    id: "sg-pg",
    type: "server",
    name: "sg-pg-primary",
    price: 48,
    currency: "USD",
    cycle: "month",
    expiresAt: "2026-11-27",
    autoRenew: true,
  });

  it("supports bidirectional card links and calculates shortfall + chronological timeline", () => {
    const assets = [wiseCard, aiCode, aiChat, manualServer, unassigned];
    expect(findLinkedCards(aiCode, assets).map((c) => c.id)).toEqual(["card-wise"]);
    expect(findLinkedCards(aiChat, assets).map((c) => c.id)).toEqual(["card-wise"]);

    const rep = computeCardReserves(assets, T, DEFAULT_SETTINGS.display, { windowDays: 30, includeManual: true });
    expect(rep.cards).toHaveLength(1);
    const c = rep.cards[0];
    expect(c.status).toBe("shortfall");
    expect(c.autoByCurrency).toEqual({ USD: 120 });
    expect(c.manualByCurrency).toEqual({ USD: 24 });
    expect(c.selectedByCurrency).toEqual({ USD: 144 });
    expect(c.recommendedKeep).toBe(164); // 144 + 20 buffer
    expect(c.billShortfall).toBe(59); // 144 - 85
    expect(c.shortfall).toBe(79); // 164 - 85
    expect(c.projectedRemaining).toBe(-59);
    // Chronological: 11-22 hk-api-02 ($24 -> bal $61), 11-30 ai-code ($100 -> bal -$39, insufficient!)
    expect(c.timeline.map((x) => [x.assetId, x.runningBalance, x.insufficient])).toEqual([
      ["hk-02", 61, false],
      ["ai-code", -39, true],
      ["ai-chat", -59, true],
    ]);
    expect(c.firstShortfallCharge?.assetId).toBe("ai-code");

    // Unassigned upcoming charges catches sg-pg-primary
    expect(rep.unassignedCharges.map((x) => x.assetId)).toEqual(["sg-pg"]);
    expect(rep.unassignedByCurrency).toEqual({ USD: 48 });
  });

  it("filters out manual renewals when includeManual is false", () => {
    const rep = computeCardReserves([wiseCard, aiCode, aiChat, manualServer], T, DEFAULT_SETTINGS.display, {
      windowDays: 30,
      includeManual: false,
    });
    const c = rep.cards[0];
    expect(c.selectedByCurrency).toEqual({ USD: 120 });
    expect(c.recommendedKeep).toBe(140);
    expect(c.shortfall).toBe(55);
  });

  it("expands team subscription workspaces individually and handles cross-currency conversion", () => {
    const uCard = mk({
      id: "card-u",
      type: "payment",
      name: "U 卡",
      price: 1,
      currency: "USD",
      cycle: "month",
      purchasedAt: "2026-01-20",
      payment: {
        issuer: "U卡平台",
        last4: "8817",
        cardExpiry: "2026-12",
        status: "active",
        balance: 260,
        balanceCurrency: "USD",
        reserveBuffer: 50,
      },
    });
    const team = mk({
      id: "gpt-team",
      type: "subscription",
      name: "ChatGPT Team",
      autoRenew: true,
      related: ["card-u"],
      team: {
        owner: "o@x",
        workspaces: [
          { id: "w1", name: "研发空间", seats: 5, price: 820, currency: "CNY", cycle: "month", expiresAt: "2026-11-26", members: [] },
          { id: "w2", name: "内容空间", seats: 3, price: 560, currency: "CNY", cycle: "month", expiresAt: "2026-12-09", members: [] },
        ],
      },
    });

    const rep = computeCardReserves([uCard, team], T, DEFAULT_SETTINGS.display, { windowDays: 30 });
    const c = rep.cards[0];
    // 2 workspace charges + 1 card monthly fee on 11-20
    expect(c.charges.map((x) => [x.workspaceName ?? x.assetName, x.date, x.amount, x.currency])).toEqual([
      ["U 卡（卡片费用）", "2026-11-20", 1, "USD"],
      ["研发空间", "2026-11-26", 820, "CNY"],
      ["内容空间", "2026-12-09", 560, "CNY"],
    ]);
    // 1 USD + (1380 / 7.2) USD = 1 + 191.67 = 192.67
    expect(c.selectedInCardCurrency.total).toBeCloseTo(192.67, 1);
    expect(c.recommendedKeep).toBeCloseTo(242.67, 1);
    expect(c.status).toBe("ok");
    expect(c.shortfall).toBe(0);
  });

  it("flags frozen cards and cards expiring before linked charges as card-risk, and ignores closed cards", () => {
    const expiringCard = mk({
      id: "card-exp",
      type: "payment",
      name: "快过期卡",
      currency: "USD",
      payment: { issuer: "Bank", last4: "1111", cardExpiry: "2026-11", status: "active" },
    });
    const decSub = mk({
      id: "dec-sub",
      type: "subscription",
      name: "十二月扣费",
      price: 15,
      currency: "USD",
      cycle: "month",
      expiresAt: "2026-12-05",
      autoRenew: true,
      related: ["card-exp"],
    });
    const closedCard = mk({
      id: "card-closed",
      type: "payment",
      name: "已注销卡",
      currency: "USD",
      payment: { issuer: "Old", last4: "9999", status: "closed" },
    });

    const rep = computeCardReserves([expiringCard, decSub, closedCard], T, DEFAULT_SETTINGS.display, { windowDays: 30 });
    expect(rep.cards).toHaveLength(1);
    expect(rep.cards[0].expiresBeforeCharge).toBe(true);
    expect(rep.cards[0].status).toBe("card-risk");
  });

  it("counts multiple cycles inside 60-day windows and converts cross-currency accurately", () => {
    expect(convertCurrency(720, "CNY", "USD", DEFAULT_SETTINGS.display)).toBeCloseTo(100, 2);
    expect(convertCurrency(100, "USD", "CNY", DEFAULT_SETTINGS.display)).toBeCloseTo(720, 2);
    const noBalanceCard = mk({
      id: "c1",
      type: "payment",
      name: "无余额记录卡",
      currency: "USD",
      payment: { issuer: "Bank", last4: "3333", status: "active" },
      related: ["ai-code"],
    });
    const rep = computeCardReserves([noBalanceCard, aiCode], T, DEFAULT_SETTINGS.display, { windowDays: 60 });
    // 11-30 and 12-30 both fall within 60 days of 11-15
    expect(rep.cards[0].charges).toHaveLength(2);
    expect(rep.cards[0].selectedByCurrency).toEqual({ USD: 200 });
    expect(rep.cards[0].status).toBe("prepare");
    expect(rep.cards[0].shortfall).toBeNull();
  });
});
