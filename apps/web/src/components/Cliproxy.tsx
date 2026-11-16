import { parseConnectionString } from "@fangcun/core";
import clsx from "clsx";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CliproxyConnection } from "../data/types";
import { api, post } from "../lib/api";
import { useData } from "../lib/store";
import { resetLabel } from "./Quota";
import { Button, Card, Empty, Field, TextInput } from "./ui";

type Form = { id?: string; name: string; note: string; connection: string };

export function CliproxySettings() {
  const { cpx, setCpx, reloadCliproxy, toast, demo } = useData();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const save = async () => {
    if (!form) return;
    if (form.connection) {
      try { parseConnectionString(form.connection); } catch (e) { toast((e as Error).message, "err"); return; }
    }
    if (demo) { toast("演示模式不连接服务端"); setForm(null); return; }
    setBusy("save");
    try {
      if (form.id) await api("PATCH", `/api/cliproxyapi/connections/${form.id}`, { name: form.name, note: form.note, ...(form.connection ? { connection: form.connection } : {}) });
      else await post("/api/cliproxyapi/connections", form);
      setForm(null);
      await reloadCliproxy();
    } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };
  const test = async () => {
    if (!form?.connection || demo) return;
    setBusy("test");
    try { const r = await post<{ accounts: number }>("/api/cliproxyapi/test", { connection: form.connection }); toast(`连接成功，${r.accounts} 个账号`); } catch (e) { toast((e as Error).message, "err"); }
    setBusy(null);
  };
  const del = async (c: CliproxyConnection) => {
    if (!confirm(`删除连接「${c.name}」？`)) return;
    if (demo) return;
    try { await api("DELETE", `/api/cliproxyapi/connections/${c.id}`); await reloadCliproxy(); } catch (e) { toast((e as Error).message, "err"); }
  };
  const refresh = async (id?: string) => {
    if (demo) return;
    setBusy(id ?? "all");
    try { setCpx(await post(`/api/cliproxyapi/refresh${id ? `?id=${encodeURIComponent(id)}` : ""}`)); } catch (e) { toast((e as Error).message, "err"); await reloadCliproxy(); }
    setBusy(null);
  };

  return (
    <>
      <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">CLIProxyAPI</h1>
      {demo && <p className="rounded-sm bg-field px-3 py-2 text-xs text-muted">演示模式：这里的操作不会连接服务端。</p>}
      <Card title="连接" extra={<div className="flex gap-2">
        <Button icon={<RefreshCw size={14} className={clsx(busy === "all" && "animate-spin")} />} onClick={() => refresh()} disabled={demo || !cpx.connections.length || Boolean(busy)}>全部刷新</Button>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setForm({ name: "", note: "", connection: "" })}>添加</Button>
      </div>} flush>
        {!cpx.connections.length && !form && <Empty>还没有连接</Empty>}
        {cpx.connections.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-3 text-[13px] first:border-t-0">
            <span className="font-semibold whitespace-nowrap">{c.name}</span>
            {c.note && <span className="min-w-0 truncate text-muted">{c.note}</span>}
            <span className="min-w-0 truncate font-mono text-[12px] text-muted">{c.url}</span>
            <span className={clsx("ml-auto text-xs whitespace-nowrap", c.lastError ? "text-crit" : "text-muted")} title={c.lastError ?? undefined}>
              {c.lastError ? "读取失败" : c.fetchedAt ? `${c.accounts} 个账号 · ${resetLabel(c.fetchedAt)}` : "还没读取过"}
            </span>
            <Button icon={<RefreshCw size={13} className={clsx(busy === c.id && "animate-spin")} />} onClick={() => refresh(c.id)} disabled={demo || Boolean(busy)} title="刷新" />
            <Button icon={<Pencil size={13} />} onClick={() => setForm({ id: c.id, name: c.name, note: c.note, connection: "" })} title="编辑" />
            <Button icon={<Trash2 size={13} />} onClick={() => del(c)} title="删除" />
            {c.lastError && <p className="basis-full text-xs text-crit">{c.lastError}</p>}
          </div>
        ))}
        {form && (
          <div className="grid gap-3 border-t border-line bg-field/40 px-4 py-4 @lg:grid-cols-2">
            <Field label="名称"><TextInput value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="家里 NAS" /></Field>
            <Field label="备注"><TextInput value={form.note} onChange={(v) => setForm({ ...form, note: v })} /></Field>
            <Field label={form.id ? "连接串（留空不改）" : "连接串"} className="@lg:col-span-2">
              <textarea value={form.connection} onChange={(e) => setForm({ ...form, connection: e.target.value })} rows={3} spellCheck={false}
                placeholder="fangcun-cliproxyapi:…" className="w-full rounded-sm border border-line bg-field px-3 py-2 font-mono text-[12px] break-all outline-none" />
            </Field>
            <div className="flex justify-end gap-2 @lg:col-span-2">
              <Button onClick={() => setForm(null)}>取消</Button>
              <Button onClick={test} disabled={!form.connection || Boolean(busy)}>测试</Button>
              <Button variant="primary" onClick={save} disabled={!form.name.trim() || (!form.id && !form.connection.trim()) || Boolean(busy)}>保存</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
