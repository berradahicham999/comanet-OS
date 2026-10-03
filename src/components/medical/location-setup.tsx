"use client";

import { useEffect, useState } from "react";
import { MapPin, CheckCircle2 } from "lucide-react";
import { capturePosition, geoPermission } from "@/lib/medical/field-client";

/**
 * Autorisation de localisation donnée une bonne fois pour toutes.
 *
 * Android (Chrome) : l'autorisation du site est mémorisée si l'on choisit « Autoriser lorsque vous consultez le
 * site » (et non « cette fois uniquement »). iPhone (Safari) : un site ne peut pas l'imposer ; tant que le réglage
 * Safari → Position est sur « Demander », Safari repose la question. Il faut le passer une fois sur « Autoriser ».
 * La carte s'affiche tant que le navigateur ne dit pas « autorisé », et disparaît ensuite d'elle-même.
 */
export function isIphone(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Déclenche la demande d'autorisation (une lecture de position, sans rien enregistrer). */
export async function askLocationOnce(timeoutS: number): Promise<boolean> {
  const fix = await capturePosition(timeoutS);
  return !("error" in fix);
}

const HIDE_KEY = "comanet-gps-setup-hidden";

export function LocationSetup({ timeoutS }: { timeoutS: number }) {
  const [state, setState] = useState<"granted" | "denied" | "prompt" | "unknown" | null>(null);
  const [hidden, setHidden] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const iphone = isIphone();

  useEffect(() => {
    let alive = true;
    const refresh = () => geoPermission().then((s) => alive && setState(s));
    refresh();
    // Retour des Réglages : l'état est relu quand l'écran revient au premier plan.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (state === "granted") return <div className="flex items-center gap-1.5 text-[12px] text-green"><CheckCircle2 size={14} /> Localisation autorisée</div>;
  if (state === null || hidden) return null;

  async function test() {
    setBusy(true);
    const ok = await askLocationOnce(timeoutS);
    const s = await geoPermission();
    setState(s);
    setBusy(false);
    if (s === "granted") return;
    if (ok && iphone) setMsg("La position fonctionne. Si l'iPhone vous a encore posé la question, le réglage Safari n'est pas encore sur « Autoriser » : refaites l'étape ci-dessus.");
    else if (ok) setMsg("La position fonctionne. Si le téléphone vous a posé la question, choisissez bien « Autoriser lorsque vous consultez le site ».");
    else setMsg("La position est encore bloquée : suivez les étapes ci-dessus, puis réessayez.");
  }

  function hide() {
    try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* stockage indisponible */ }
    setHidden(true);
  }

  return (
    <div className="rounded-2xl bg-blue-soft border border-blue/30 p-4 space-y-3 text-[13px] text-ink-2">
      <div className="flex items-center gap-2 font-semibold text-ink"><MapPin size={18} /> Autoriser la localisation une fois pour toutes</div>
      {iphone ? (
        <>
          <p>Sur iPhone, Safari repose la question à chaque visite tant que ce réglage n&apos;est pas fait. À faire une seule fois :</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Ouvrez l&apos;application <b>Réglages</b> de l&apos;iPhone.</li>
            <li>Touchez <b>Apps</b> → <b>Safari</b> (sur les iPhone plus anciens : directement <b>Safari</b> dans Réglages).</li>
            <li>Dans « Réglages des sites web », touchez <b>Position</b> et choisissez <b>Autoriser</b>.</li>
            <li>Vérifiez aussi : Réglages → <b>Confidentialité et sécurité</b> → <b>Service de localisation</b> activé, et <b>Sites web Safari</b> sur « Lorsque l&apos;app est active » avec <b>Position exacte</b>.</li>
            <li>Revenez ici et touchez « Vérifier ».</li>
          </ol>
        </>
      ) : (
        <>
          <p>Touchez « Activer maintenant ». Quand le téléphone demande l&apos;accès à la position, choisissez <b>Autoriser lorsque vous consultez le site</b> (pas « Uniquement cette fois »). Il ne vous le redemandera plus.</p>
          {state === "denied" && (
            <p className="text-red">La position a été refusée pour ce site : touchez l&apos;icône à gauche de l&apos;adresse → <b>Autorisations</b> → <b>Position</b> → <b>Autoriser</b>, puis revenez ici.</p>
          )}
        </>
      )}
      {msg && <p className="font-medium">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={test} disabled={busy} className="btn-primary h-10 px-4 disabled:opacity-60">{busy ? "Localisation…" : iphone ? "Vérifier" : "Activer maintenant"}</button>
        <button onClick={hide} className="btn-ghost h-10 px-3">C&apos;est fait, masquer</button>
      </div>
    </div>
  );
}
