"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { DuplicateCandidate } from "@/lib/gestion/clients-shared";

/**
 * Création d'un client, avec détection des doublons pendant la saisie (ICE, nom, téléphone) :
 * on montre les fiches qui ressemblent avant de créer, plutôt qu'après.
 */
export function NewClientForm({ action, check, sectors }: {
  action: (fd: FormData) => Promise<void>;
  check: (input: { name: string; legalName?: string; ice?: string; phone?: string; city?: string }) => Promise<DuplicateCandidate[]>;
  sectors: readonly string[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const [dups, setDups] = useState<DuplicateCandidate[]>([]);
  const [pending, start] = useTransition();
  const recheck = () => {
    const f = form.current;
    if (!f) return;
    const v = (k: string) => String(new FormData(f).get(k) ?? "");
    start(async () => setDups(await check({ name: v("name"), legalName: v("legalName"), ice: v("ice"), phone: v("phone"), city: v("city") })));
  };
  const field = (name: string, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label block mb-1">{label}</span><input name={name} className="input h-9" onBlur={recheck} {...extra} /></label>
  );
  return (
    <form ref={form} action={action} className="space-y-4 text-[13px]">
      <div className="grid sm:grid-cols-2 gap-2">
        {field("name", "Nom commercial (point de vente) *", { required: true })}
        {field("legalName", "Raison sociale")}
        {field("ice", "ICE (15 chiffres)", { inputMode: "numeric" })}
        {field("accountCode", "Code client Sage COMANET")}
        <label className="block"><span className="label block mb-1">Type</span>
          <select name="type" defaultValue="PHARMACIE" className="select h-9"><option value="PHARMACIE">Pharmacie</option><option value="PARAPHARMACIE">Parapharmacie</option><option value="GROSSISTE">Grossiste</option><option value="AUTRE">Autre</option></select>
        </label>
        {field("city", "Ville")}
        <label className="block"><span className="label block mb-1">Secteur</span>
          <select name="sector" defaultValue="" className="select h-9"><option value="">Auto — d&apos;après la ville</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        {field("phone", "Téléphone", { inputMode: "tel" })}
        <label className="block sm:col-span-2"><span className="label block mb-1">Adresse de facturation</span><input name="billingAddress" className="input h-9" /></label>
      </div>

      {pending && <div className="text-[12px] text-muted">Recherche de doublons…</div>}
      {dups.length > 0 && (
        <div className="rounded-xl border border-orange/30 bg-orange-soft px-3 py-2 text-[12.5px] space-y-1">
          <div className="font-medium text-orange">Ce client existe peut-être déjà :</div>
          <ul className="space-y-0.5">
            {dups.map((d) => (
              <li key={d.id}><Link href={`/clients/${d.id}`} className="font-medium underline" target="_blank">{d.name}</Link>{!d.active && " (archivé)"} <span className="text-muted">— {d.reasons.join(", ")}</span></li>
            ))}
          </ul>
          <label className="flex items-center gap-2 pt-1"><input type="checkbox" name="confirmNotDuplicate" required /> Ce n&apos;est aucun de ces clients : créer une nouvelle fiche</label>
        </div>
      )}
      <button className="btn-primary btn-sm" type="submit">Créer le client</button>
      <p className="text-[11.5px] text-faint">Les autres informations (IF, RC, conditions de paiement, adresses de livraison, remises par marque) se complètent ensuite sur la fiche, onglet « Identité &amp; conditions ».</p>
    </form>
  );
}
