"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { disablePush, enablePush, pushAvailability, type PushAvailability } from "@/lib/mobile/push-client";

const DISMISSED = "comanet-push-dismissed";

/** Réglage des notifications de ce téléphone, sur la page Notifications. */
export function PushToggle() {
  const [state, setState] = useState<PushAvailability | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void pushAvailability().then(setState); }, []);
  if (!state || state === "UNSUPPORTED") return null;
  if (state === "INSTALL_FIRST") return <p className="card px-4 py-3 text-[13.5px] text-muted">Sur iPhone, les notifications demandent d&apos;abord d&apos;<Link href="/app" className="text-accent">installer l&apos;application</Link>.</p>;
  if (state === "DENIED") return <p className="card px-4 py-3 text-[13.5px] text-muted">Notifications refusées sur ce téléphone : elles se réactivent dans ses réglages.</p>;
  const on = state === "ACTIVE";
  return (
    <div className="card px-4 py-3 flex items-center justify-between gap-3">
      <span className="text-[14px] text-ink-2">{message ?? (on ? "Notifications activées sur ce téléphone." : "Recevez vos alertes sur ce téléphone.")}</span>
      <button type="button" className={`${on ? "btn-secondary" : "btn-primary"} h-11 px-4 text-[13.5px] shrink-0`} onClick={async () => {
        if (on) await disablePush();
        else setMessage(await enablePush());
        setState(await pushAvailability());
      }}>{on ? "Couper" : "Activer"}</button>
    </div>
  );
}

/** Proposition d'activation dans l'app, une fois : l'autorisation du téléphone ne se demande qu'à la suite d'un geste. */
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void pushAvailability().then(async (s) => {
      let dismissed = false;
      try { dismissed = localStorage.getItem(DISMISSED) === "1"; } catch { /* navigation privée */ }
      if (s !== "OK" || dismissed) return;
      const res = await fetch("/api/m/push", { cache: "no-store" }).catch(() => null);
      if (res?.ok && ((await res.json()) as { publicKey: string | null }).publicKey) setShow(true);
    });
  }, []);
  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* idem */ } setShow(false); };
  return (
    <div className="card px-3 py-2 mb-3 flex items-center gap-2">
      <Bell size={18} className="text-accent shrink-0" />
      <span className="flex-1 text-[13.5px] text-ink-2">{message ?? "Recevoir vos alertes sur ce téléphone ?"}</span>
      <button type="button" className="btn-primary h-11 px-3 text-[13.5px] shrink-0" onClick={async () => { const m = await enablePush(); if (m) setMessage(m); else dismiss(); }}>Activer</button>
      <button type="button" onClick={dismiss} className="h-11 w-11 flex items-center justify-center text-muted shrink-0" aria-label="Plus tard"><X size={16} /></button>
    </div>
  );
}
