"use client";

import { useMemo, useState } from "react";

export type ReassignClient = { id: string; name: string; legalName: string | null; city: string | null; ice: string | null; entities: { id: string; legalName: string; ice: string | null }[] };

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Changer le client d'une pièce validée (BL ou commande) : recherche du bon client, raison sociale,
 * motif. Choisir le même client reprend l'identité actuelle de sa fiche (ICE ou adresse corrigés).
 */
export function ReassignClientForm({ id, currentClientId, clients, cascadeNote, action }: {
  id: string;
  currentClientId: string;
  clients: ReassignClient[];
  cascadeNote?: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const picked = clients.find((c) => c.id === clientId) ?? null;
  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return [];
    return clients.filter((c) => norm(`${c.name} ${c.legalName ?? ""} ${c.city ?? ""} ${c.ice ?? ""}`).includes(q)).slice(0, 8);
  }, [query, clients]);

  return (
    <form action={action} className="space-y-2 text-[13px]">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="clientId" value={clientId} />
      {picked ? (
        <div className="rounded-xl border border-line px-3 py-2">
          <div className="font-medium">{picked.name}{picked.city && <span className="text-muted font-normal"> · {picked.city}</span>}</div>
          <div className="text-[11.5px] text-muted">{picked.legalName ?? picked.name} · ICE {picked.ice ?? "manquant"}</div>
          {picked.id === currentClientId && <div className="text-[11.5px] text-faint">Même fiche : la pièce reprend son identité actuelle.</div>}
          <button type="button" className="btn-ghost btn-sm mt-1" onClick={() => { setClientId(""); setLegalEntityId(""); }}>Choisir un autre client</button>
        </div>
      ) : (
        <div className="relative">
          <input className="input h-9" placeholder="Rechercher le bon client (nom, ville, ICE)…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 card p-1 max-h-72 overflow-auto shadow-lg">
              {matches.map((c) => (
                <li key={c.id}><button type="button" className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2" onClick={() => { setClientId(c.id); setQuery(""); setLegalEntityId(""); }}>
                  <span className="font-medium">{c.name}</span>{c.city && <span className="text-faint"> · {c.city}</span>}
                  <span className="block text-[11px] text-muted">{c.legalName && c.legalName !== c.name ? `${c.legalName} · ` : ""}ICE {c.ice ?? "manquant"}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {picked && picked.entities.length > 0 && (
        <label className="block">
          <span className="label block mb-1">Au nom de (raison sociale)</span>
          <select name="legalEntityId" className="select h-9" value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
            <option value="">{picked.legalName ?? picked.name} — fiche client</option>
            {picked.entities.map((e) => <option key={e.id} value={e.id}>{e.legalName}{e.ice ? ` — ICE ${e.ice}` : " — ICE manquant"}</option>)}
          </select>
        </label>
      )}
      <input name="reason" className="input h-9" placeholder="Motif du changement *" required />
      <button className="btn-secondary btn-sm" type="submit" disabled={!clientId}>Changer de client</button>
      <p className="text-[11.5px] text-faint">
        Nom, ICE, adresse et code client sont repris de la fiche choisie ; les ventes de la pièce passent sur ce client. Lignes, montants, numéro et stock ne bougent pas.
        Le PDF est régénéré, l&apos;ancien reste archivé et le changement figure dans l&apos;historique.{cascadeNote ? ` ${cascadeNote}` : ""}
      </p>
    </form>
  );
}
