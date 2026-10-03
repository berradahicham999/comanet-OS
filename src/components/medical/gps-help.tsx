"use client";

import { useState } from "react";
import { MapPinOff, X } from "lucide-react";

/** Aide pour réactiver la localisation (Android / Chrome et iPhone / Safari). La visite reste possible sans. */
export function GpsHelp({ onClose }: { onClose: () => void }) {
  const isIos = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [tab, setTab] = useState<"ios" | "android">(isIos ? "ios" : "android");
  return (
    <div className="rounded-2xl bg-yellow-soft border border-yellow/40 p-4 space-y-3 text-[13px] text-ink-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-ink"><MapPinOff size={18} /> Localisation refusée</div>
        <button onClick={onClose} className="btn-ghost h-7 w-7 p-0 rounded-lg" aria-label="Fermer"><X size={15} /></button>
      </div>
      <p>La visite est quand même enregistrée, mais elle sera signalée <b>« non vérifiée »</b>. Pour la réactiver :</p>
      <div className="flex gap-1.5">
        <button onClick={() => setTab("android")} className={`h-8 px-3 rounded-full text-[12px] border ${tab === "android" ? "bg-ink text-white border-ink" : "border-line-2"}`}>Android</button>
        <button onClick={() => setTab("ios")} className={`h-8 px-3 rounded-full text-[12px] border ${tab === "ios" ? "bg-ink text-white border-ink" : "border-line-2"}`}>iPhone</button>
      </div>
      {tab === "android" ? (
        <ol className="list-decimal pl-5 space-y-1">
          <li>Vérifiez que la <b>Localisation</b> du téléphone est activée (volet du haut, icône de position).</li>
          <li>Dans Chrome, touchez l&apos;icône à gauche de l&apos;adresse (cadenas ou réglages) → <b>Autorisations</b> → <b>Position</b> → <b>Autoriser</b>.</li>
          <li>Sinon : Paramètres du téléphone → Applications → Chrome → Autorisations → Position → <b>Autoriser seulement si l&apos;appli est en cours d&apos;utilisation</b>, et activez <b>Utiliser la position exacte</b>.</li>
          <li>Rechargez la page, puis refaites l&apos;action.</li>
        </ol>
      ) : (
        <ol className="list-decimal pl-5 space-y-1">
          <li>Réglages → <b>Confidentialité et sécurité</b> → <b>Service de localisation</b> : activé.</li>
          <li>Dans la même liste, <b>Sites web Safari</b> → <b>Lorsque l&apos;app est active</b>, et activez <b>Position exacte</b>.</li>
          <li>Réglages → <b>Apps</b> → <b>Safari</b> → <b>Position</b> → <b>Autoriser</b> (sinon Safari redemande à chaque visite).</li>
          <li>Rechargez la page, puis refaites l&apos;action.</li>
        </ol>
      )}
    </div>
  );
}
