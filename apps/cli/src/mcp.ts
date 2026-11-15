import { createInterface } from "node:readline";
import { APP_VERSION, ASSET_TYPES, CYCLES } from "@fangcun/core";
import type { Client } from "./client";
import { ops } from "./commands";

/**
 * Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * Exposes the same abilities as the CLI; permissions are whatever the access token allows.
 */
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (c: Client, a: any) => Promise<unknown> };

const id = { type: "string", description: "资产 id（或唯一名称）" };
const assetFields = {
  type: { type: "string", enum: [...ASSET_TYPES] },
  name: { type: "string" }, subtitle: { type: "string" }, provider: { type: "string" },
  price: { type: "number", description: "实付价，手填，不做汇率换算" }, currency: { type: "string", description: "USD / CNY / …" },
  cycle: { type: "string", enum: [...CYCLES] }, expiresAt: { type: "string", description: "YYYY-MM-DD" },
  autoRenew: { type: "boolean" }, purchasedAt: { type: "string" }, region: { type: "string" }, discount: { type: "string" },
  tags: { type: "array", items: { type: "string" } }, related: { type: "array", items: { type: "string" } },
  note: { type: "string" }, details: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } } } },
  payment: { type: "object", description: "支付卡：issuer, network, last4（只存末四位，绝不传完整卡号/CVV）, cardExpiry(YYYY-MM), fees, billingRegion, status(active|frozen|closed)" },
  phone: { type: "object", description: "号码：number, carrier, country, purpose" },
  account: { type: "object", description: "账号：username, site, websites[]（不含密码）" },
};

export const TOOLS: Tool[] = [
  { name: "list_assets", description: "列出资产，按到期日排序。可按类型、标签、N 天内到期筛选。", inputSchema: { type: "object", properties: { type: { type: "string", enum: [...ASSET_TYPES] }, tag: { type: "string" }, due_within_days: { type: "number" } } },
    run: (c, a) => ops.list(c, { type: a.type, tag: a.tag, due: a.due_within_days }) },
  { name: "search_assets", description: "全文搜索资产（名称、IP、标签、邮箱、卡号末四位…）", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: (c, a) => ops.list(c, { q: a.query }) },
  { name: "get_asset", description: "查看一项资产的全部字段", inputSchema: { type: "object", properties: { id }, required: ["id"] }, run: (c, a) => ops.show(c, a.id) },
  { name: "create_asset", description: "新建资产。可写令牌会生成待审批的变更计划。", inputSchema: { type: "object", properties: assetFields, required: ["type", "name"] }, run: (c, a) => ops.create(c, a) },
  { name: "update_asset", description: "修改资产字段（只传要改的字段）", inputSchema: { type: "object", properties: { id, patch: { type: "object", properties: assetFields } }, required: ["id", "patch"] }, run: (c, a) => ops.update(c, a.id, a.patch) },
  { name: "tag_asset", description: "增删标签", inputSchema: { type: "object", properties: { id, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } }, required: ["id"] }, run: (c, a) => ops.tag(c, a.id, a.add ?? [], a.remove ?? []) },
  { name: "link_assets", description: "建立或取消双向关联（例如订阅 ↔ 付款用的支付卡）", inputSchema: { type: "object", properties: { id, to: { type: "array", items: { type: "string" } }, unlink: { type: "boolean" } }, required: ["id", "to"] }, run: (c, a) => ops.link(c, a.id, a.to, a.unlink) },
  { name: "renew_asset", description: "标记已续费：到期日推进一个周期并记一条续费记录", inputSchema: { type: "object", properties: { id, amount: { type: "number" }, note: { type: "string" } }, required: ["id"] }, run: (c, a) => ops.renew(c, a.id, { amount: a.amount, note: a.note }) },
  { name: "delete_asset", description: "删除到回收站（30 天内可恢复）", inputSchema: { type: "object", properties: { id }, required: ["id"] }, run: (c, a) => ops.remove(c, a.id) },
  { name: "doctor", description: "检查缺字段、重复、过期未处理、无关联的资产", inputSchema: { type: "object", properties: {} }, run: (c) => ops.doctor(c) },
  { name: "audit_log", description: "最近的操作日志", inputSchema: { type: "object", properties: { asset_id: { type: "string" }, limit: { type: "number" } } }, run: (c, a) => ops.log(c, { assetId: a.asset_id, limit: a.limit }) },
  { name: "undo", description: "撤销一条操作日志对应的改动", inputSchema: { type: "object", properties: { audit_id: { type: "number" } }, required: ["audit_id"] }, run: (c, a) => ops.undo(c, a.audit_id) },
  { name: "import_assets", description: "批量导入（CSV 文本或 JSON 数组文本）", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["csv", "json"] }, content: { type: "string" } }, required: ["format", "content"] }, run: (c, a) => ops.importText(c, a.content, a.format) },
  { name: "pending_plans", description: "列出等待在网页里批准的变更计划", inputSchema: { type: "object", properties: {} }, run: (c) => ops.plans(c) },
];

export async function handle(client: Client, msg: any): Promise<unknown | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fangcun", version: APP_VERSION },
        instructions: "方寸个人资产台账。价格按实付手填、不换算；支付卡只存末四位；写操作在可写令牌下会生成待审批计划。",
      });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ run: _r, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `unknown tool ${msg.params?.name}`);
      try {
        const out = await tool.run(client, msg.params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `错误：${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (msg.id === undefined) return undefined; // notification
      return error(-32601, `method not found: ${msg.method}`);
  }
}

export function runMcp(client: Client): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.on("line", async (line) => {
      if (!line.trim()) return;
      let msg: any;
      try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); return; }
      const res = await handle(client, msg);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    });
    rl.on("close", () => resolve());
  });
}
