"use client";

/** Côté téléphone : activer, couper et oublier les notifications de ce navigateur. */
export type PushAvailability = "OK" | "ACTIVE" | "DENIED" | "INSTALL_FIRST" | "UNSUPPORTED";

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function pushAvailability(): Promise<PushAvailability> {
  if (typeof window === "undefined") return "UNSUPPORTED";
  // Sur iPhone, Safari n'offre les notifications qu'à une app installée sur l'écran d'accueil.
  if (isIos() && !standalone()) return "INSTALL_FIRST";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "UNSUPPORTED";
  if (Notification.permission === "denied") return "DENIED";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "ACTIVE" : "OK";
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** `null` : activé. Sinon, la phrase à afficher. Doit être appelé depuis un geste de la personne. */
export async function enablePush(): Promise<string | null> {
  const res = await fetch("/api/m/push", { cache: "no-store" }).catch(() => null);
  const key = res?.ok ? ((await res.json()) as { publicKey: string | null }).publicKey : null;
  if (!key) return "Les notifications ne sont pas encore configurées sur le serveur.";
  if ((await Notification.requestPermission()) !== "granted") return "Autorisation refusée : elle se change dans les réglages du téléphone.";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const saved = await fetch("/api/m/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) }).catch(() => null);
  return saved?.ok ? null : "Enregistrement impossible : réessayez avec du réseau.";
}

/** Déconnexion ou désactivation : ce téléphone cesse de recevoir les notifications de ce compte. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await fetch("/api/m/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
