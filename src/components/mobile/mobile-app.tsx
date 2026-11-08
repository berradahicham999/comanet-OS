"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { capturePosition, newId } from "@/lib/medical/field-client";
import { clearUserCache, syncLocalUser, wipeSessionData } from "@/lib/mobile/local-data";
import { clearRefs, flushOutbox, lastUser, listOutbox, putOutbox, readRef, removeOutbox, writeRef } from "@/lib/mobile/outbox";
import { snapshotExpired, type AnimationPayload, type OutboxItem, type OutboxKind, type StockPayload } from "@/lib/mobile/outbox-shared";
import { hasMobileScreens, screenAllowed } from "@/lib/mobile/persona";
import { sheetsToPreload, type ClientSheet, type MobileSnapshot } from "@/lib/mobile/snapshot-shared";

/**
 * Cœur de l'app mobile : ce que le téléphone sait, ce qu'il doit encore envoyer.
 * Lecture locale d'abord (l'écran s'affiche sans réseau), puis rafraîchissement ; l'envoi part dès que le réseau revient.
 */
type Phase = "LOADING" | "READY" | "NO_DATA";

type Mobile = {
  phase: Phase;
  snapshot: MobileSnapshot | null;
  online: boolean;
  /** Session expirée ou appareil révoqué : les saisies restent ici, elles partiront après reconnexion. */
  authLost: boolean;
  pending: OutboxItem[];
  toFix: OutboxItem[];
  submit: (kind: OutboxKind, payload: AnimationPayload | StockPayload, label: string) => Promise<void>;
  abandon: (clientEventId: string) => Promise<void>;
  retry: () => Promise<void>;
  acceptNotice: () => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<Mobile | null>(null);

export function useMobile(): Mobile {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMobile hors de MobileApp");
  return v;
}

/** Fiche courte d'un client : réseau, puis copie locale. `null` : ni réseau, ni copie. */
export async function loadClientSheet(userId: string, clientId: string): Promise<ClientSheet | null> {
  try {
    const res = await fetch(`/api/m/clients/${clientId}`, { cache: "no-store", credentials: "same-origin" });
    if (res.ok) {
      const sheet = (await res.json()) as ClientSheet;
      await writeRef(userId, `client:${clientId}`, sheet);
      return sheet;
    }
    if (res.status === 403 || res.status === 404) return null;
  } catch { /* pas de réseau : copie locale */ }
  return readRef<ClientSheet>(userId, `client:${clientId}`).catch(() => null);
}

let preloading = false;

/** Fiches du début du portefeuille, une à la fois : un téléphone en 3G ne doit jamais attendre ce téléchargement. */
async function preloadSheets(userId: string, clientIds: string[]) {
  if (preloading) return;
  preloading = true;
  try {
    const known = new Map<string, string | null>();
    for (const id of clientIds) known.set(id, (await readRef<ClientSheet>(userId, `client:${id}`).catch(() => null))?.fetchedAt ?? null);
    for (const id of sheetsToPreload(clientIds, (x) => known.get(x) ?? null, Date.now())) {
      if (!navigator.onLine) break;
      await loadClientSheet(userId, id);
    }
  } finally {
    preloading = false;
  }
}

export function MobileApp({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [authLost, setAuthLost] = useState(false);
  const uid = useRef<string | null>(null);
  // Lu au moment voulu : changer d'écran ne doit pas retélécharger les référentiels.
  const pathRef = useRef(path);
  useEffect(() => { pathRef.current = path; }, [path]);

  const reload = useCallback(async () => {
    if (uid.current) setItems(await listOutbox(uid.current));
  }, []);

  const refreshRef = useRef<(hasLocal: boolean) => Promise<void>>(async () => {});

  const flush = useCallback(async () => {
    if (!uid.current) return;
    const r = await flushOutbox(uid.current);
    if (r.state === "AUTH") setAuthLost(true);
    await reload();
    // Saisie arrivée au serveur : le réalisé, le dernier point de vente et les relevés affichés changent.
    if (r.sent > 0) await refreshRef.current(true);
  }, [reload]);

  const refresh = useCallback(async (hasLocal: boolean) => {
    let res: Response;
    try {
      res = await fetch("/api/m/bootstrap", { cache: "no-store", credentials: "same-origin" });
    } catch {
      setOnline(false);
      setPhase(hasLocal ? "READY" : "NO_DATA");
      return;
    }
    setOnline(true);
    if (res.status === 401) {
      // Session expirée ou appareil révoqué : plus aucune donnée lisible, mais les saisies en attente restent en file.
      await clearUserCache();
      if (uid.current) await clearRefs(uid.current).catch(() => {});
      window.location.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
      return;
    }
    if (!res.ok) {
      setPhase(hasLocal ? "READY" : "NO_DATA");
      return;
    }
    const fresh = (await res.json()) as MobileSnapshot;
    // Les autres métiers n'ont pas encore leurs écrans ici : ils gardent leur accueil habituel.
    if (!hasMobileScreens(fresh.persona)) {
      await syncLocalUser(fresh.user.id);
      window.location.replace(fresh.home);
      return;
    }
    await syncLocalUser(fresh.user.id);
    uid.current = fresh.user.id;
    await writeRef(fresh.user.id, "snapshot", fresh);
    setSnapshot(fresh);
    setAuthLost(false);
    setPhase("READY");
    if (!screenAllowed(fresh.persona, pathRef.current)) window.location.replace("/m");
    await flush();
    if (fresh.commercial) void preloadSheets(fresh.user.id, fresh.commercial.clients.map((c) => c.id));
  }, [flush]);

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = lastUser();
      let local: MobileSnapshot | null = null;
      if (id) {
        uid.current = id;
        local = await readRef<MobileSnapshot>(id, "snapshot").catch(() => null);
        if (local && snapshotExpired(local.generatedAt, Date.now())) {
          await clearRefs(id).catch(() => {});
          local = null;
        }
        if (!alive) return;
        if (local) {
          setSnapshot(local);
          setPhase("READY");
        }
        await reload().catch(() => {});
      }
      await refresh(!!local);
    })();
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { alive = false; };
  }, [refresh, reload]);

  useEffect(() => {
    const goOnline = () => { setOnline(true); void flush(); };
    const goOffline = () => setOnline(false);
    const onShow = () => { if (document.visibilityState === "visible") void flush(); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onShow);
    // `online` ne se déclenche pas toujours sur un réseau qui revient faiblement : nouvel essai régulier.
    const t = setInterval(() => void flush(), 30000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onShow);
      clearInterval(t);
    };
  }, [flush]);

  const submit = useCallback<Mobile["submit"]>(async (kind, payload, label) => {
    const userId = uid.current;
    if (!userId) return;
    const withGps = kind === "ANIMATION" && !!snapshot?.gpsNoticeAccepted;
    const item: OutboxItem = { clientEventId: newId(), kind, userId, payload, label, deviceTime: new Date().toISOString(), state: "PENDING", gpsPending: withGps };
    // La saisie est en sécurité avant toute attente : un téléphone qui s'éteint maintenant ne perd rien.
    await putOutbox(item);
    await reload();
    if (!withGps) {
      void flush();
      return;
    }
    void capturePosition(snapshot?.gpsTimeoutS ?? 8).then(async (fix) => {
      const gps = "error" in fix ? { lat: null, lng: null, accuracyM: null, error: fix.error } : { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, error: null };
      await putOutbox({ ...item, gps, gpsPending: false });
      await flush();
    });
  }, [flush, reload, snapshot]);

  const abandon = useCallback(async (id: string) => {
    if (!uid.current) return;
    await removeOutbox(uid.current, id);
    await reload();
  }, [reload]);

  const acceptNotice = useCallback(async () => {
    const res = await fetch("/api/m/notice", { method: "POST", credentials: "same-origin" });
    if (!res.ok || !snapshot) return;
    const next = { ...snapshot, gpsNoticeAccepted: true };
    setSnapshot(next);
    await writeRef(next.user.id, "snapshot", next);
    // L'autorisation du téléphone se demande ici, à froid, et non pendant une saisie.
    void capturePosition(next.gpsTimeoutS);
  }, [snapshot]);

  const logout = useCallback(() => {
    void wipeSessionData().finally(() => window.location.replace("/api/m/logout"));
  }, []);

  const value = useMemo<Mobile>(() => ({
    phase, snapshot, online, authLost,
    pending: items.filter((i) => i.state === "PENDING"),
    toFix: items.filter((i) => i.state === "A_CORRIGER"),
    submit, abandon, retry: flush, acceptNotice, logout,
  }), [phase, snapshot, online, authLost, items, submit, abandon, flush, acceptNotice, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
