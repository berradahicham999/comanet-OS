"use client";

import { sendable, settle, wireEvent, type MutationResult, type OutboxItem } from "./outbox-shared";

/**
 * Stockage local de l'app mobile : UNE base IndexedDB par compte, donc rien d'une personne n'est lisible par une autre sur
 * un téléphone partagé. Deux magasins : `outbox` (saisies à envoyer) et `ref` (référentiels et brouillon).
 */
const VERSION = 1;
const LAST_USER = "comanet_user";

function open(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`comanet-m-${userId}`, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox", { keyPath: "clientEventId" });
      if (!d.objectStoreNames.contains("ref")) d.createObjectStore("ref");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(userId: string, store: "outbox" | "ref", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await open(userId);
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => { d.close(); resolve(r ? r.result : undefined); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}

export const readRef = async <T>(userId: string, key: string) => (await tx<T>(userId, "ref", "readonly", (s) => s.get(key))) ?? null;
export const writeRef = (userId: string, key: string, value: unknown) => tx(userId, "ref", "readwrite", (s) => { s.put(value, key); });
export const deleteRef = (userId: string, key: string) => tx(userId, "ref", "readwrite", (s) => { s.delete(key); });
export const clearRefs = (userId: string) => tx(userId, "ref", "readwrite", (s) => { s.clear(); });

export const listOutbox = async (userId: string) => (await tx<OutboxItem[]>(userId, "outbox", "readonly", (s) => s.getAll())) ?? [];
export const putOutbox = (item: OutboxItem) => tx(item.userId, "outbox", "readwrite", (s) => { s.put(item); });
export const removeOutbox = (userId: string, id: string) => tx(userId, "outbox", "readwrite", (s) => { s.delete(id); });

/** Dernier compte connu sur ce téléphone : permet d'ouvrir ses données sans réseau. */
export function lastUser(): string | null {
  try { return localStorage.getItem(LAST_USER); } catch { return null; }
}

export function rememberUser(userId: string) {
  try { localStorage.setItem(LAST_USER, userId); } catch { /* navigation privée : la session reste utilisable en ligne */ }
}

export function forgetUser() {
  try { localStorage.removeItem(LAST_USER); } catch { /* idem */ }
}

export type FlushOutcome = { state: "OK" | "OFFLINE" | "AUTH"; sent: number; toFix: number };

let flushing: Promise<FlushOutcome> | null = null;

/** Envoie la file dans l'ordre. Une seule envoi à la fois : un rejeu concurrent ne ferait qu'une requête de plus. */
export function flushOutbox(userId: string): Promise<FlushOutcome> {
  if (flushing) return flushing;
  flushing = (async (): Promise<FlushOutcome> => {
    const items = sendable(await listOutbox(userId), userId, Date.now()).slice(0, 50);
    if (!items.length) return { state: "OK", sent: 0, toFix: 0 };
    let res: Response;
    try {
      const sentAt = new Date().toISOString();
      res = await fetch("/api/m/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: items.map((i) => wireEvent(i, sentAt)) }),
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      return { state: "OFFLINE", sent: 0, toFix: 0 };
    }
    if (res.status === 401) return { state: "AUTH", sent: 0, toFix: 0 };
    if (!res.ok) return { state: "OFFLINE", sent: 0, toFix: 0 };
    const { results } = (await res.json()) as { results: MutationResult[] };
    const s = settle(items, results);
    for (const id of s.remove) await removeOutbox(userId, id);
    for (const f of s.toFix) {
      const item = items.find((i) => i.clientEventId === f.clientEventId);
      if (item) await putOutbox({ ...item, state: "A_CORRIGER", error: f.error });
    }
    return { state: "OK", sent: s.remove.length, toFix: s.toFix.length };
  })().finally(() => { flushing = null; });
  return flushing;
}
