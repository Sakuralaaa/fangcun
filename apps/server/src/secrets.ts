/**
 * Clean API keys read from the environment. Real-world values often carry junk: a trailing newline from `echo >> .env`,
 * quotes kept by the docker-compose list form (`- CLOUDFLARE_API_TOKEN="…"` passes the quotes through), or a pasted
 * `Bearer ` prefix. Never logs or returns the secret itself.
 */
export interface CleanSecret {
  value: string;
  /** What was stripped, in plain words (for diagnostics only). */
  stripped: string[];
}

export function cleanSecret(raw: string | undefined | null): CleanSecret {
  const stripped: string[] = [];
  let v = String(raw ?? "");
  const trim = () => {
    const t = v.trim();
    if (t !== v) { if (!stripped.includes("首尾空白/换行")) stripped.push("首尾空白/换行"); v = t; }
  };
  trim();
  for (let i = 0; i < 3; i++) {
    const m = /^(["'])([\s\S]*)\1$/.exec(v);
    if (!m) break;
    v = m[2];
    if (!stripped.includes("包裹的引号")) stripped.push("包裹的引号");
    trim();
  }
  const b = /^bearer\s+/i.exec(v);
  if (b) { v = v.slice(b[0].length); stripped.push("Bearer 前缀"); trim(); }
  return { value: v, stripped };
}

/** Account / zone ids: same cleaning, lower-cased. */
export const cleanId = (raw: string | undefined | null) => cleanSecret(raw).value.toLowerCase();

/** Token kind from its prefix. Shows at most the first five characters, never more. */
export function cloudflareTokenHint(token: string): { prefix: string; kind: "account" | "user" | "legacy" | "unknown"; label: string; length: number; odd: string | null } {
  const prefix = token.slice(0, 5);
  const kind = prefix === "cfat_" ? "account" : prefix === "cfut_" ? "user" : /^[A-Za-z0-9_-]{40}$/.test(token) ? "legacy" : "unknown";
  const label = { account: "账户令牌", user: "用户令牌", legacy: "旧格式用户令牌", unknown: "无法识别的格式" }[kind];
  let odd: string | null = null;
  if (/\s/.test(token)) odd = "令牌中间含有空白字符，可能是复制时断行了";
  else if (/["']/.test(token)) odd = "令牌里含有引号";
  else if (token.length < 30) odd = `长度只有 ${token.length}，可能没复制完整`;
  else if (kind === "unknown" && token.length !== 40) odd = `长度 ${token.length}，与常见格式不符`;
  return { prefix, kind, label, length: token.length, odd };
}
