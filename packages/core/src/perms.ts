import type { TokenScope } from "./types";

export type Actor =
  | { kind: "user"; name: string; stepUpOk: boolean }
  | { kind: "token"; id: string; name: string; scope: TokenScope };

export type Capability = "read" | "write" | "backup" | "admin";

/**
 * How a request may proceed:
 *  - "direct": apply now (signed-in user, or 完全权限 token)
 *  - "plan":   write becomes a change plan that waits for approval in the web UI (可写 token)
 *  - "deny"
 */
export function decide(actor: Actor, cap: Capability): "direct" | "plan" | "deny" {
  if (actor.kind === "user") return "direct";
  const s = actor.scope;
  switch (cap) {
    case "read": return "direct";
    case "write": return s === "full" ? "direct" : s === "write" ? "plan" : "deny";
    case "backup": return s === "full" ? "direct" : "deny";
    case "admin": return "deny"; // tokens never manage tokens, approve plans, or change sign-in
  }
}

export const actorLabel = (a: Actor) => (a.kind === "user" ? a.name : `令牌「${a.name}」`);
