import { buildAtollView, buildCloudflareView, DEFAULT_SETTINGS, normalizeAsset, renewAsset, restoreKomariField, markOverrides, type AtollSnapshot, type AtollView, type CfSection, type CfSectionState, type CfSnapshot, type CfView, type PingState, type Settings } from "@fangcun/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { demoAssets, demoAtollInfo, demoAtollSnapshot, demoCfInfo, demoCfSnapshot, demoKomariInfo, demoSettings, demoStatus, DEMO_TODAY } from "../data/mock";
import type { Asset, StatusMap } from "../data/types";
import { api, get, post } from "./api";
import { getToday, setToday } from "./fmt";

export interface KomariInfo { url: string; hasKey: boolean; version: string | null; lastSync: string | null; lastError: string | null; nodes: number | null }
export interface AtollInfo {
  enabled: boolean; url: string; hasKey: boolean; lastSync: string | null; lastError: string | null;
  projects: number | null; servers: number | null;
  key: { readOnly: boolean | null; permissions?: string[]; projectScoped?: boolean; checkedAt: string } | null;
}
export interface CfInfo {
  enabled: boolean; hasToken: boolean; hasAccountId: boolean; lastSync: string | null; lastError: string | null;
  token: { kind: "user" | "account"; status: string; expiresOn?: string | null; readOnly: boolean | null; permissions?: string[]; checkedAt: string } | null;
  sections: Record<CfSection, CfSectionState> | null;
  counts: { accounts: number; zones: number; records: number; tunnels: number } | null;
}
export interface Me { username: string; totpEnabled: boolean }

export const isDemo = () => new URLSearchParams(location.search).get("demo") === "1" || import.meta.env.VITE_DEMO === "1";

type WriteResult = { status: "applied" | "pending" | "unchanged"; assets?: Asset[]; message?: string };

interface Ctx {
  demo: boolean;
  me: Me | null;
  assets: Asset[];
  settings: Settings;
  status: StatusMap;
  statusAt: string | null;
  /** Whether Komari gave latency data; null until the first status answer. */
  pingState: PingState | null;
  komari: KomariInfo | null;
  atoll: AtollInfo | null;
  atollSnap: AtollSnapshot | null;
  /** Links between assets and Atoll, derived on the fly (never stored on assets). */
  atollView: AtollView;
  reloadAtoll: () => Promise<void>;
  cf: CfInfo | null;
  cfSnap: CfSnapshot | null;
  /** Links between assets and Cloudflare (zones, records, tunnels), derived on the fly; never stored on assets. */
  cfView: CfView;
  reloadCloudflare: () => Promise<void>;
  loading: boolean;
  backupError: string | null;
  reload: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  create: (a: Partial<Asset>) => Promise<Asset | null>;
  update: (id: string, patch: Partial<Asset>) => Promise<Asset | null>;
  renew: (id: string, opts?: { amount?: number; note?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restoreField: (id: string, key: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  toast: (msg: string, tone?: "ok" | "err") => void;
  setMe: (m: Me | null) => void;
}

const C = createContext<Ctx | null>(null);
export const useData = () => {
  const c = useContext(C);
  if (!c) throw new Error("DataProvider missing");
  return c;
};

export function DataProvider({ me: initialMe, children }: { me: Me | null; children: ReactNode }) {
  const demo = isDemo();
  if (demo) setToday(DEMO_TODAY);
  const [me, setMe] = useState<Me | null>(initialMe);
  const [assets, setAssets] = useState<Asset[]>(demo ? demoAssets : []);
  const [settings, setSettings] = useState<Settings>(demo ? demoSettings : DEFAULT_SETTINGS);
  const [status, setStatus] = useState<StatusMap>(demo ? demoStatus : {});
  const [statusAt, setStatusAt] = useState<string | null>(demo ? demoKomariInfo.lastSync : null);
  const [pingState, setPingState] = useState<PingState | null>(demo ? "ok" : null);
  const [komari, setKomari] = useState<KomariInfo | null>(demo ? demoKomariInfo : null);
  const [atoll, setAtoll] = useState<AtollInfo | null>(demo ? demoAtollInfo : null);
  const [atollSnap, setAtollSnap] = useState<AtollSnapshot | null>(demo ? demoAtollSnapshot : null);
  const [cf, setCf] = useState<CfInfo | null>(demo ? demoCfInfo : null);
  const [cfSnap, setCfSnap] = useState<CfSnapshot | null>(demo ? demoCfSnapshot : null);
  const [loading, setLoading] = useState(!demo);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: "ok" | "err" }[]>([]);

  const toast = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "err" ? 6000 : 3500);
  }, []);

  const reloadAtoll = useCallback(async () => {
    if (demo) return;
    const [i, s] = await Promise.all([
      get<AtollInfo>("/api/atoll/info").catch(() => null),
      get<{ snapshot: AtollSnapshot | null }>("/api/atoll/snapshot").catch(() => null),
    ]);
    setAtoll(i);
    setAtollSnap(s?.snapshot ?? null);
  }, [demo]);

  const reloadCloudflare = useCallback(async () => {
    if (demo) return;
    const [i, s] = await Promise.all([
      get<CfInfo>("/api/cloudflare/info").catch(() => null),
      get<{ snapshot: CfSnapshot | null }>("/api/cloudflare/snapshot").catch(() => null),
    ]);
    setCf(i);
    setCfSnap(s?.snapshot ?? null);
  }, [demo]);

  const reload = useCallback(async () => {
    if (demo) return;
    reloadAtoll().catch(() => {});
    reloadCloudflare().catch(() => {});
    const [a, s, k, b] = await Promise.all([
      get<{ assets: Asset[]; today: string }>("/api/assets"),
      get<{ settings: Settings }>("/api/settings"),
      get<KomariInfo>("/api/komari/info").catch(() => null),
      get<{ lastError: string | null }>("/api/backup/status").catch(() => null),
    ]);
    setToday(a.today);
    setAssets(a.assets);
    setSettings(s.settings);
    setKomari(k);
    setBackupError(b?.lastError ?? null);
    setLoading(false);
  }, [demo, reloadAtoll, reloadCloudflare]);

  const refreshStatus = useCallback(async () => {
    if (demo) return;
    if (!assets.some((a) => a.komari)) return;
    try {
      const r = await get<{ at: string; nodes: StatusMap; ping?: PingState | null }>("/api/komari/status");
      setStatus(r.nodes);
      setStatusAt(r.at);
      setPingState(r.ping ?? null);
    } catch { /* probe unreachable: keep last values */ }
  }, [demo, assets]);

  useEffect(() => { reload().catch((e) => { toast(e.message, "err"); setLoading(false); }); }, [reload, toast]);

  const applyResult = useCallback((r: WriteResult) => {
    if (r.status === "pending") { toast(r.message ?? "已生成变更计划，等待批准"); return null; }
    if (r.assets?.length) {
      setAssets((list) => {
        const next = [...list];
        for (const a of r.assets!) {
          const i = next.findIndex((x) => x.id === a.id);
          if (a.deletedAt) { if (i >= 0) next.splice(i, 1); }
          else if (i >= 0) next[i] = a;
          else next.push(a);
        }
        return next;
      });
      return r.assets[0];
    }
    return null;
  }, [toast]);

  // ---- demo mode: same operations, in memory ----
  const demoPut = (a: Asset) => { setAssets((l) => (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a])); return a; };

  const create = useCallback(async (input: Partial<Asset>) => {
    if (demo) return demoPut(normalizeAsset(input as Asset));
    return applyResult(await post<WriteResult>("/api/assets", input));
  }, [demo, applyResult]);

  const update = useCallback(async (id: string, patch: Partial<Asset>) => {
    if (demo) {
      const before = assets.find((a) => a.id === id)!;
      return demoPut(markOverrides(before, normalizeAsset({ ...before, ...patch } as Asset), demoSettings.komari) as Asset);
    }
    return applyResult(await api<WriteResult>("PATCH", `/api/assets/${encodeURIComponent(id)}`, patch));
  }, [demo, assets, applyResult]);

  const renew = useCallback(async (id: string, opts: { amount?: number; note?: string } = {}) => {
    if (demo) { demoPut(renewAsset(assets.find((a) => a.id === id)!, getToday(), opts)); toast("已标记续费"); return; }
    const r = applyResult(await post<WriteResult>(`/api/assets/${encodeURIComponent(id)}/renew`, opts));
    if (r) toast(`已续费，下次到期 ${r.expiresAt ?? "长期"}`);
  }, [demo, assets, applyResult, toast]);

  const remove = useCallback(async (id: string) => {
    if (demo) { setAssets((l) => l.filter((a) => a.id !== id)); toast("已移到回收站"); return; }
    await api<WriteResult>("DELETE", `/api/assets/${encodeURIComponent(id)}`);
    setAssets((l) => l.filter((a) => a.id !== id));
    toast("已移到回收站，30 天内可恢复");
  }, [demo, toast]);

  const restoreField = useCallback(async (id: string, key: string) => {
    if (demo) { demoPut(restoreKomariField(assets.find((a) => a.id === id)!, key) as Asset); return; }
    applyResult(await post<WriteResult>(`/api/assets/${encodeURIComponent(id)}/komari/restore`, { key }));
    toast("已恢复为 Komari 的值");
  }, [demo, assets, applyResult, toast]);

  const saveSettings = useCallback(async (s: Settings) => {
    if (demo) { setSettings(s); return; }
    const r = await api<{ settings: Settings }>("PUT", "/api/settings", s);
    setSettings(r.settings);
    toast("设置已保存");
  }, [demo, toast]);

  const atollView = useMemo(() => buildAtollView(assets, settings.atoll.enabled ? atollSnap : null), [assets, atollSnap, settings.atoll.enabled]);
  const cfView = useMemo(() => buildCloudflareView(assets, settings.cloudflare.enabled ? cfSnap : null, atollView), [assets, cfSnap, settings.cloudflare.enabled, atollView]);

  const value = useMemo<Ctx>(() => ({
    demo, me, assets, settings, status, statusAt, pingState, komari, atoll, atollSnap, atollView, reloadAtoll, cf, cfSnap, cfView, reloadCloudflare, loading, backupError, reload, refreshStatus,
    create, update, renew, remove, restoreField, saveSettings, toast, setMe,
  }), [demo, me, assets, settings, status, statusAt, pingState, komari, atoll, atollSnap, atollView, reloadAtoll, cf, cfSnap, cfView, reloadCloudflare, loading, backupError, reload, refreshStatus, create, update, renew, remove, restoreField, saveSettings, toast]);

  return (
    <C.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-[420px] rounded-sm px-3.5 py-2.5 text-[13px] shadow-lg ${t.tone === "err" ? "bg-crit text-white" : "bg-ink text-bg"}`}>{t.msg}</div>
        ))}
      </div>
    </C.Provider>
  );
}

/** Components showing live node data call this while mounted: 10-second polling while the tab is visible. */
export function useLiveStatus() {
  const { refreshStatus } = useData();
  const ref = useRef(refreshStatus);
  ref.current = refreshStatus;
  useEffect(() => {
    ref.current();
    const t = setInterval(() => { if (document.visibilityState === "visible") ref.current(); }, 10_000);
    return () => clearInterval(t);
  }, []);
}
