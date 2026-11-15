import { describe, expect, it } from "vitest";
import { csvToInputs, doctor, looksLikeCardNumber, normalizeAsset, toCsv, toIcs, ValidationError } from "../src";

describe("支付类型", () => {
  const card = { type: "payment", name: "Wise 虚拟卡", price: 0, currency: "USD", cycle: "year", payment: { issuer: "Wise", network: "Visa", last4: "4242", cardExpiry: "2028-09", billingRegion: "美国", fees: "开卡 $9", status: "active" } };
  it("card expiry drives the reminder date", () => {
    const a = normalizeAsset(card as never);
    expect(a.expiresAt).toBe("2028-09-30");
    expect(a.payment).toMatchObject({ last4: "4242", status: "active" });
    expect(a.provider).toBe("Wise");
  });
  it("closed card stops reminding", () => {
    expect(normalizeAsset({ ...card, payment: { ...card.payment, status: "closed" } } as never).expiresAt).toBeNull();
  });
  it("rejects anything but four digits", () => {
    expect(() => normalizeAsset({ ...card, payment: { ...card.payment, last4: "42" } } as never)).toThrow(ValidationError);
    expect(() => normalizeAsset({ ...card, payment: { ...card.payment, last4: "4111111111111111" } } as never)).toThrow(/完整卡号/);
  });
  it("refuses full card numbers or CVV anywhere", () => {
    expect(() => normalizeAsset({ ...card, note: "卡号 4111 1111 1111 1111" } as never)).toThrow(/完整卡号/);
    expect(() => normalizeAsset({ ...card, payment: { ...card.payment, cvv: "123" } } as never)).toThrow(/CVV/);
    expect(looksLikeCardNumber("+86 138 0013 8000")).toBe(false);
    expect(looksLikeCardNumber("订单号 2026111500001")).toBe(false);
  });
});

describe("号码类型", () => {
  it("keeps number / carrier / country / purpose and keep-alive expiry", () => {
    const a = normalizeAsset({ type: "phone", name: "美国号码", price: 3, currency: "USD", cycle: "month", expiresAt: "2026-12-01", phone: { number: "+1 555 010 2233", carrier: "某虚拟运营商", country: "美国", purpose: "接码" } } as never);
    expect(a.phone).toEqual({ number: "+1 555 010 2233", carrier: "某虚拟运营商", country: "美国", purpose: "接码" });
    expect(a.expiresAt).toBe("2026-12-01");
  });
});

describe("导入导出", () => {
  it("CSV round trip incl. payment and phone", () => {
    const list = [
      normalizeAsset({ type: "payment", name: "U 卡", price: 1, currency: "USD", cycle: "month", tags: ["支付"], payment: { issuer: "平台", network: "Mastercard", last4: "0001", cardExpiry: "2027-02", status: "frozen" } } as never),
      normalizeAsset({ type: "phone", name: "+44 7700 900123", price: 0, currency: "GBP", cycle: "month", phone: { number: "+44 7700 900123", country: "英国" }, note: "含,逗号\n和换行" } as never),
    ];
    const back = csvToInputs(toCsv(list)).map((i) => normalizeAsset(i));
    expect(back[0].payment).toMatchObject({ last4: "0001", network: "Mastercard", status: "frozen", cardExpiry: "2027-02" });
    expect(back[1].phone?.number).toBe("+44 7700 900123");
    expect(back[1].note).toBe("含,逗号\n和换行");
    expect(back[0].id).toBe(list[0].id);
  });
  it("ICS has one event per expiry", () => {
    const a = normalizeAsset({ type: "domain", name: "example.dev", price: 12, currency: "USD", cycle: "year", expiresAt: "2027-06-11" } as never);
    const ics = toIcs([a]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20270611");
    expect(ics).toContain("TRIGGER:-P7D");
  });
  it("doctor finds lapsed, duplicate and broken links", () => {
    const a = normalizeAsset({ id: "x", type: "domain", name: "a.dev", price: 1, currency: "USD", cycle: "year", expiresAt: "2026-10-01", related: ["missing"] } as never);
    const b = normalizeAsset({ id: "y", type: "domain", name: "A.dev", price: 1, currency: "USD", cycle: "year", expiresAt: "2027-10-01" } as never);
    const codes = doctor([a, b], "2026-11-15").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["expired", "broken-link", "duplicate"]));
  });
});
