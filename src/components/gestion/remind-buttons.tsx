"use client";

import { useState, useTransition } from "react";

/** Enregistre la relance, puis ouvre WhatsApp ou l'e-mail pré-rempli (le message part depuis le téléphone ou la messagerie). */
export function RemindButtons({ clientId, level, wa, email, subject, text, invoices, record }: {
  clientId: string; level: number; wa: string | null; email: string | null; subject: string; text: string;
  invoices: { id: string; number: string; dueDate: string | null; balance: string }[];
  record: (clientId: string, level: number, channel: "WHATSAPP" | "EMAIL" | "TELEPHONE" | "COURRIER", invoices: { id: string; number: string; dueDate: string | null; balance: string }[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const go = (channel: "WHATSAPP" | "EMAIL" | "TELEPHONE", url?: string) => start(async () => {
    const r = await record(clientId, level, channel, invoices);
    if (!r.ok) { setMsg(r.error ?? "Relance non enregistrée."); return; }
    setMsg("Relance enregistrée.");
    if (url) window.open(url, "_blank", "noopener");
  });
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button type="button" className="btn-primary btn-sm" disabled={pending} onClick={() => go("WHATSAPP", `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(text)}`)}>WhatsApp{wa ? "" : " (choisir)"}</button>
      <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => go("EMAIL", `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`)}>E-mail</button>
      <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => go("TELEPHONE")}>Appelé</button>
      {msg && <span className="text-[12px] text-muted">{msg}</span>}
    </div>
  );
}
