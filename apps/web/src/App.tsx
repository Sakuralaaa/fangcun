import clsx from "clsx";
import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AssetDetail } from "./components/AssetDetail";
import { AssetForm } from "./components/AssetForm";
import { AssetList } from "./components/AssetList";
import { Costs } from "./components/Costs";
import { Login } from "./components/Login";
import { Overview } from "./components/Overview";
import { Rail, type Section } from "./components/Rail";
import { Servers } from "./components/Servers";
import { Settings } from "./components/Settings";
import { Button, Field, Modal, TextInput } from "./components/ui";
import type { AssetType } from "./data/types";
import { get, onStepUp, post } from "./lib/api";
import { daysUntil } from "./lib/fmt";
import { DataProvider, isDemo, useData, type Me } from "./lib/store";

/** Hash routes: #/overview · #/assets/<id>?type=server · #/servers · #/costs · #/settings/<tab> — plus ?theme=dark&demo=1. */
function parse() {
  const [path, q = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [section = "overview", id] = path.split("/");
  return { section: section as Section, id: id ? decodeURIComponent(id) : undefined, type: (new URLSearchParams(q).get("type") ?? "all") as AssetType | "all" };
}

export default function App() {
  const demo = isDemo();
  const [state, setState] = useState<{ loading: boolean; needsSetup?: boolean; me: Me | null }>({ loading: !demo, me: demo ? { username: "sak", totpEnabled: true } : null });
  const [dark, setDark] = useState(() => new URLSearchParams(location.search).get("theme") === "dark" || localStorage.getItem("fc-theme") === "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const toggleTheme = () => setDark((d) => { localStorage.setItem("fc-theme", d ? "light" : "dark"); return !d; });

  const check = useCallback(async () => {
    if (demo) return;
    try {
      const s = await get<{ needsSetup: boolean; user: Me | null }>("/api/auth/state");
      setState({ loading: false, needsSetup: s.needsSetup, me: s.user });
    } catch {
      setState({ loading: false, me: null });
    }
  }, [demo]);
  useEffect(() => { check(); }, [check]);

  if (state.loading) return <div className="grid h-full place-items-center text-subtle">加载中…</div>;
  if (!state.me) return <Login setup={Boolean(state.needsSetup)} onDone={check} />;
  return (
    <DataProvider me={state.me}>
      <Shell dark={dark} onTheme={toggleTheme} onLogout={async () => { await post("/api/auth/logout").catch(() => {}); setState({ loading: false, me: null }); }} />
    </DataProvider>
  );
}

function Shell({ dark, onTheme, onLogout }: { dark: boolean; onTheme: () => void; onLogout: () => void }) {
  const { assets, loading, me, demo } = useData();
  const [route, setRoute] = useState(parse);
  const [form, setForm] = useState<{ id?: string; type?: AssetType } | null>(null);
  const [stepUp, setStepUp] = useState<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    onStepUp(() => new Promise<boolean>((resolve) => setStepUp(() => resolve)));
  }, []);

  const go = (path: string) => { location.hash = path; };
  const nav = (s: Section) => {
    if (s === "accounts") return go("/assets?type=account");
    if (s === "docs") return go("/assets?type=document");
    go(`/${s}`);
  };
  const select = (id: string) => go(`/assets/${encodeURIComponent(id)}${route.section === "assets" && route.type !== "all" ? `?type=${route.type}` : ""}`);

  const filtered = assets.filter((a) => route.type === "all" || a.type === route.type).sort((a, b) => daysUntil(a.expiresAt) - daysUntil(b.expiresAt));
  const asset = assets.find((a) => a.id === route.id) ?? filtered[0];
  const active: Section = route.section === "assets" && route.type === "account" ? "accounts" : route.section === "assets" && route.type === "document" ? "docs" : route.section;
  const dot = assets.some((a) => daysUntil(a.expiresAt) <= 7);

  return (
    <div className="flex h-full max-md:pb-14">
      <Rail active={active} dark={dark} onNav={nav} onTheme={onTheme} dot={dot} user={me?.username} onLogout={demo ? undefined : onLogout} />
      {loading ? <main className="grid flex-1 place-items-center text-subtle">加载中…</main> : <>
        {route.section === "overview" && <Overview onSelect={(id) => go(`/assets/${encodeURIComponent(id)}`)} onAdd={() => setForm({})} onNav={go} />}
        {route.section === "assets" && (
          <>
            <AssetList className={clsx(route.id && "max-lg:hidden")} selected={asset?.id} filter={route.type} onSelect={select} onFilter={(t) => go(`/assets${t === "all" ? "" : `?type=${t}`}`)} onAdd={() => setForm({ type: route.type === "all" ? undefined : route.type })} />
            {asset ? <AssetDetail className={clsx(!route.id && "max-lg:hidden")} asset={asset} onSelect={(id) => go(`/assets/${encodeURIComponent(id)}`)} onEdit={() => setForm({ id: asset.id })}
                onBack={() => go(`/assets${route.type === "all" ? "" : `?type=${route.type}`}`)} />
              : <main className="grid flex-1 place-items-center max-lg:hidden text-[13px] text-subtle">{route.type === "document" ? "还没有文档。合同、发票可以作为「文档」资产保存附件。" : "选择左侧的资产查看详情"}</main>}
          </>
        )}
        {route.section === "servers" && <Servers onSelect={(id) => go(`/assets/${encodeURIComponent(id)}`)} />}
        {route.section === "costs" && <Costs onSelect={(id) => go(`/assets/${encodeURIComponent(id)}`)} />}
        {route.section === "settings" && <Settings tab={route.id} onTab={(t) => go(`/settings/${t}`)} />}
      </>}
      {form && (
        <AssetForm asset={form.id ? assets.find((a) => a.id === form.id) : undefined} initialType={form.type} onClose={() => setForm(null)}
          onSaved={(id) => { if (id) go(`/assets/${encodeURIComponent(id)}`); else if (form.id) go("/assets"); }} />
      )}
      {stepUp && <StepUpDialog onDone={(ok) => { stepUp(ok); setStepUp(null); }} />}
    </div>
  );
}

function StepUpDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    try { await post("/api/auth/step-up", { code }); onDone(true); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={<span className="flex items-center gap-2"><ShieldCheck size={17} />请先验证</span>} onClose={() => onDone(false)} width={380}
      footer={<><Button onClick={() => onDone(false)}>取消</Button><Button variant="primary" onClick={submit} disabled={code.length !== 6}>验证</Button></>}>
      <p className="mb-3 text-xs leading-relaxed text-subtle">备份、导出和恢复需要两步验证。验证后 10 分钟内不再询问。</p>
      <Field label="验证器动态码"><TextInput value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" mono autoFocus /></Field>
      {err && <p className="mt-2 text-xs text-crit">{err}</p>}
    </Modal>
  );
}
