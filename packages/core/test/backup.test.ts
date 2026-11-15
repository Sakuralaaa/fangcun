import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildBackup, DEFAULT_SETTINGS, migrateDoc, normalizeAsset, planRestore, previewRestore, readBackup, SCHEMA_VERSION } from "../src";

const a1 = normalizeAsset({ id: "a1", type: "domain", name: "example.dev", price: 12, currency: "USD", cycle: "year", expiresAt: "2027-06-11" } as never, "2026-01-01T00:00:00.000Z");
const a2 = normalizeAsset({ id: "a2", type: "payment", name: "U 卡", price: 0, currency: "USD", cycle: "year", payment: { issuer: "平台", last4: "1234", status: "active", cardExpiry: "2029-01" } } as never, "2026-01-01T00:00:00.000Z");

describe("备份往返", () => {
  it("build → read keeps everything and verifies checksums", async () => {
    const bytes = await buildBackup({
      data: { schemaVersion: SCHEMA_VERSION, exportedAt: "x", assets: [a1, a2], settings: DEFAULT_SETTINGS },
      audit: [{ id: 1, at: "t", actor: "sak", action: "create", assetId: "a1", summary: "新建", before: null, after: a1 }],
      attachments: { "a1/合同.pdf": strToU8("%PDF-1.4 demo") },
    });
    const b = await readBackup(bytes);
    expect(b.data.assets).toEqual([a1, a2]);
    expect(b.audit).toHaveLength(1);
    expect(new TextDecoder().decode(b.attachments["a1/合同.pdf"])).toBe("%PDF-1.4 demo");
    expect(b.manifest.counts).toEqual({ assets: 2, audit: 1, attachments: 1 });
  });

  it("detects tampering", async () => {
    const bytes = await buildBackup({ data: { schemaVersion: SCHEMA_VERSION, exportedAt: "x", assets: [a1], settings: DEFAULT_SETTINGS }, audit: [] });
    const files = unzipSync(bytes);
    files["data.json"] = strToU8(new TextDecoder().decode(files["data.json"]).replace("example.dev", "evil.dev"));
    await expect(readBackup(zipSync(files))).rejects.toThrow(/校验和不匹配/);
  });

  it("migrates schema 1 (type sub → subscription)", () => {
    const doc = migrateDoc({ schemaVersion: 1, assets: [{ id: "s", type: "sub", name: "Plus", price: 20, currency: "USD", cycle: "month", tags: [], details: [], related: [], renewals: [], autoRenew: true }] });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.assets[0].type).toBe("subscription");
  });

  it("preview + merge / replace plans", () => {
    const changed = { ...a1, price: 15, updatedAt: "2026-06-01T00:00:00.000Z" };
    const a3 = { ...a2, id: "a3", name: "新卡" };
    const p = previewRestore([a1, a2], [changed, a3]);
    expect(p.added.map((x) => x.id)).toEqual(["a3"]);
    expect(p.conflicts[0]).toMatchObject({ id: "a1", fields: ["price"], incomingNewer: true });
    expect(p.missing.map((x) => x.id)).toEqual(["a2"]);
    expect(planRestore([a1, a2], [changed, a3], "merge").put.map((x) => x.id)).toEqual(["a1", "a3"]);
    expect(planRestore([a1, a2], [changed, a3], "merge", "current").put.map((x) => x.id)).toEqual(["a3"]);
    expect(planRestore([a1, a2], [changed, a3], "replace").remove.map((x) => x.id)).toEqual(["a2"]);
  });
});
