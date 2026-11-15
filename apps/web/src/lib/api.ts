export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) { super(message); this.status = status; this.data = data; }
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
/** The app registers a dialog that asks for a 2FA code; requests that need it retry once after. */
export const onStepUp = (h: StepUpHandler) => { stepUpHandler = h; };

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { raw?: boolean; contentType?: string; retried?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Fangcun": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) { payload = body as BodyInit; headers["Content-Type"] = opts.contentType ?? "application/octet-stream"; }
  else if (typeof body === "string") { payload = body; headers["Content-Type"] = opts.contentType ?? "text/plain"; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  if (opts.raw && res.ok) return (await res.blob()) as T;
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (data?.needStepUp && !opts.retried && stepUpHandler && (await stepUpHandler())) return api(method, path, body, { ...opts, retried: true });
    throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`, data ?? {});
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});

/** Download through fetch (so step-up can kick in), then save. */
export async function download(path: string, fallbackName: string) {
  const blob = await api<Blob>("GET", path, undefined, { raw: true });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
