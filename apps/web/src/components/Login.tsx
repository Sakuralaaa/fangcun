import { useState } from "react";
import { ApiError, post } from "../lib/api";
import { Button, Field, Logo, TextInput } from "./ui";

export function Login({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [p2, setP2] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (setup && p !== p2) return setErr("两次输入的密码不一样");
    setBusy(true);
    try {
      await post(setup ? "/api/auth/setup" : "/api/auth/login", { username: u, password: p, ...(needCode ? { code } : {}) });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.data.needTotp) { setNeedCode(true); setErr(code ? e.message : null); }
      else setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div
      className="grid h-full place-items-center bg-bg px-6"
      style={{
        backgroundImage: "radial-gradient(color-mix(in srgb, var(--color-ink) 7%, transparent) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <form
        onSubmit={submit}
        className="fc-animate-pop w-full max-w-[390px] rounded-lg border border-line bg-panel p-7"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <div className="text-[19px] leading-tight font-bold tracking-tight">方寸</div>
            <div className="mt-0.5 text-xs text-subtle">个人资产台账 · 到期与预留管理</div>
          </div>
        </div>
        <h1 className="mt-6 text-[15px] font-semibold">{setup ? "第一次使用：设置管理员账号" : needCode ? "输入两步验证动态码" : "登录"}</h1>
        <div className="mt-4 flex flex-col gap-3">
          {!needCode && <>
            <Field label="用户名"><TextInput value={u} onChange={setU} autoFocus /></Field>
            <Field label="密码" hint={setup ? "至少 10 位" : undefined}><TextInput type="password" value={p} onChange={setP} /></Field>
            {setup && <Field label="再输一次"><TextInput type="password" value={p2} onChange={setP2} /></Field>}
          </>}
          {needCode && <Field label="验证器里的 6 位数字"><TextInput value={code} onChange={setCode} inputMode="numeric" maxLength={6} mono autoFocus /></Field>}
        </div>
        {err && <p className="mt-3 rounded-sm bg-crit-soft px-3 py-2 text-xs text-crit">{err}</p>}
        <Button type="submit" variant="primary" className="mt-5 h-9 w-full justify-center" disabled={busy || !u || !p || (needCode && code.length !== 6)}>{setup ? "创建并进入" : needCode ? "验证" : "登录"}</Button>
      </form>
    </div>
  );
}
