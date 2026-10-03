"use client";

/**
 * Médical v2 — côté téléphone : position GPS au moment d'une action (jamais de suivi continu), file
 * d'actions hors connexion (IndexedDB) et visite en cours conservée localement (survit au rechargement
 * et à la fermeture de l'application).
 */
import type { GpsError } from "./gps-shared";

export type Fix = { lat: number; lng: number; accuracyM: number } | { error: GpsError };

/** Une seule lecture de position, haute précision, sans cache. */
export function capturePosition(timeoutS: number): Promise<Fix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve({ error: "NON_SUPPORTE" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      (e) => resolve({ error: e.code === 1 ? "REFUSE" : e.code === 3 ? "DELAI" : "INDISPONIBLE" }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: Math.max(5, timeoutS) * 1000 },
    );
  });
}

/** État de l'autorisation de localisation, quand le navigateur sait le dire (Safari ancien : « inconnu »). */
export async function geoPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return (p?.state as "granted" | "denied" | "prompt") ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export type QueuedAction = {
  clientEventId: string;
  type: "START" | "STOP" | "NON_EFFECTUEE";
  doctorId?: string | null;
  plannedVisitId?: string | null;
  startRef?: string | null;
  visitId?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  gpsError?: GpsError | null;
  deviceTime: string;
  reason?: string | null;
  /** Nom du médecin, pour l'affichage de la file (non envoyé au serveur). */
  label?: string;
  /** Passée par la file après un échec d'envoi. */
  queued?: boolean;
};

export type RunningVisit = {
  startRef: string;
  visitId: string | null;
  doctorId: string;
  doctorName: string;
  /** Heure de l'appareil au Démarrer (le chrono affiché ; l'heure officielle est celle du serveur). */
  startedAtMs: number;
};

const DB_NAME = "comanet-medical";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
      if (!d.objectStoreNames.contains("state")) d.createObjectStore("state");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function enqueue(a: QueuedAction): Promise<void> {
  await tx("queue", "readwrite", (s) => s.add(a));
}

export async function queued(): Promise<(QueuedAction & { seq: number })[]> {
  return ((await tx("queue", "readonly", (s) => s.getAll())) as (QueuedAction & { seq: number })[]) ?? [];
}

async function removeQueued(seqs: number[]) {
  if (!seqs.length) return;
  await tx("queue", "readwrite", (s) => {
    for (const k of seqs) s.delete(k);
  });
}

async function markQueued(seqs: number[]) {
  const all = await queued();
  await tx("queue", "readwrite", (s) => {
    for (const a of all) if (seqs.includes(a.seq) && !a.queued) s.put({ ...a, queued: true });
  });
}

export async function getRunning(): Promise<RunningVisit | null> {
  return ((await tx("state", "readonly", (s) => s.get("running"))) as RunningVisit | undefined) ?? null;
}

export async function setRunning(v: RunningVisit | null): Promise<void> {
  await tx("state", "readwrite", (s) => {
    if (v) s.put(v, "running");
    else s.delete("running");
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("medical-running-change"));
}

export type FlushResult = {
  sent: { clientEventId: string; type: QueuedAction["type"]; visitId: string; message?: string }[];
  rejected: { clientEventId: string; type: QueuedAction["type"]; message: string; code: string }[];
  offline: boolean;
};

let flushing: Promise<FlushResult> | null = null;

/**
 * Envoie la file dans l'ordre. Une action acceptée (ou déjà reçue) sort de la file ; une fin dont le
 * démarrage n'est pas encore arrivé reste ; une action refusée sort avec son message. Sans réseau, rien
 * ne bouge et la file réessaiera.
 */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const out: FlushResult = { sent: [], rejected: [], offline: false };
    const items = await queued();
    if (!items.length) return out;
    let res: Response;
    try {
      const sentAt = new Date().toISOString();
      res = await fetch("/api/medical/visit-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        body: JSON.stringify({ events: items.map(({ seq, label, ...a }) => ({ ...a, sentAt })) }),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      await markQueued(items.map((i) => i.seq));
      out.offline = true;
      return out;
    }
    if (!res.ok) {
      await markQueued(items.map((i) => i.seq));
      out.offline = true;
      return out;
    }
    const body = (await res.json()) as { results: { clientEventId: string; ok: boolean; visitId?: string; code?: string; message?: string }[] };
    const done: number[] = [];
    for (const item of items) {
      const r = body.results.find((x) => x.clientEventId === item.clientEventId);
      if (!r) continue;
      if (r.ok) {
        done.push(item.seq);
        out.sent.push({ clientEventId: item.clientEventId, type: item.type, visitId: r.visitId!, message: r.message });
      } else if (r.code === "WAIT_START") {
        // Le démarrage n'est pas encore arrivé ; s'il a été refusé, la fin n'a plus d'objet.
        const startRejected = out.rejected.some((x) => x.clientEventId === item.startRef);
        if (startRejected) {
          done.push(item.seq);
          out.rejected.push({ clientEventId: item.clientEventId, type: item.type, code: "START_REJECTED", message: "Démarrage refusé : fin ignorée." });
        }
      } else {
        done.push(item.seq);
        out.rejected.push({ clientEventId: item.clientEventId, type: item.type, code: r.code ?? "ERROR", message: r.message ?? "Action refusée." });
      }
    }
    await removeQueued(done);
    return out;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Durée écoulée lisible pour le chrono : « 12:04 » ou « 1:02:09 ». */
export function fmtElapsed(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
