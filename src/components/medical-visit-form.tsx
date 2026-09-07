"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { normKey } from "@/lib/import/normalize";

export type FormDoctor = { id: string; name: string; city: string | null };
export type FormProduct = { id: string; name: string };

type SampleLine = { productId: string; qty: string };

export function MedicalVisitForm({
  action, doctors, products, initial, today, submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  doctors: FormDoctor[];
  products: FormProduct[];
  initial?: {
    id?: string; doctorId?: string; date?: string; status?: string; durationMinutes?: number | null;
    visitType?: string; objective?: string | null; result?: string | null; doctorInterest?: string | null;
    comment?: string | null; nextAction?: string | null; nextVisitDate?: string | null;
    objections?: string | null;
    documentation?: string | null;
    productIds?: string[]; samples?: SampleLine[];
  };
  today: string;
  submitLabel?: string;
}) {
  const [doctorQuery, setDoctorQuery] = useState("");
  const [doctorId, setDoctorId] = useState(initial?.doctorId ?? "");
  const [productIds, setProductIds] = useState<string[]>(initial?.productIds ?? []);
  const [samples, setSamples] = useState<SampleLine[]>(initial?.samples?.length ? initial.samples : []);

  const filteredDoctors = useMemo(() => {
    const q = normKey(doctorQuery);
    const list = q ? doctors.filter((d) => normKey(d.name).includes(q) || normKey(d.city ?? "").includes(q)) : doctors;
    return list.slice(0, 80);
  }, [doctorQuery, doctors]);

  function toggleProduct(id: string) {
    setProductIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  function setSampleLine(i: number, patch: Partial<SampleLine>) {
    setSamples((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  return (
    <form action={action} className="space-y-4">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {productIds.map((id) => <input key={id} type="hidden" name="productId" value={id} />)}

      <div className="text-[13px]">
        <span className="label block mb-1">Médecin</span>
        <input value={doctorQuery} onChange={(e) => setDoctorQuery(e.target.value)} placeholder="Filtrer par nom ou ville…" className="input h-11 mb-1.5" />
        <select name="doctorId" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="select h-11" required>
          <option value="">Choisir…</option>
          {doctorId && !filteredDoctors.some((d) => d.id === doctorId) && doctors.filter((d) => d.id === doctorId).map((d) => <option key={d.id} value={d.id}>{d.name}{d.city ? ` — ${d.city}` : ""}</option>)}
          {filteredDoctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.city ? ` — ${d.city}` : ""}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[13px]"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={initial?.date ?? today} className="input h-11" required /></label>
        <label className="block text-[13px]"><span className="label block mb-1">Statut</span>
          <select name="status" defaultValue={initial?.status ?? "REALISEE"} className="select h-11">
            <option value="REALISEE">Réalisée</option><option value="PLANIFIEE">Planifiée</option>
            <option value="REPORTEE">Reportée</option><option value="ANNULEE">Annulée</option><option value="NON_EFFECTUEE">Non effectuée</option>
          </select>
        </label>
        <label className="block text-[13px]"><span className="label block mb-1">Durée (min)</span><input name="durationMinutes" defaultValue={initial?.durationMinutes ?? ""} inputMode="numeric" className="input h-11" /></label>
        <label className="block text-[13px]"><span className="label block mb-1">Type de visite</span><input name="visitType" defaultValue={initial?.visitType ?? "VISITE"} className="input h-11" /></label>
      </div>

      <label className="block text-[13px]"><span className="label block mb-1">Objectif de la visite</span><input name="objective" defaultValue={initial?.objective ?? ""} className="input h-11" /></label>

      <div className="text-[13px]">
        <span className="label block mb-1">Produits présentés</span>
        <div className="flex flex-wrap gap-2">
          {products.map((p) => (
            <button key={p.id} type="button" onClick={() => toggleProduct(p.id)} className={`rounded-full px-3 h-8 text-[12.5px] border ${productIds.includes(p.id) ? "bg-ink text-white border-ink" : "bg-surface border-line-2 text-ink-2"}`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1"><span className="label">Échantillons remis</span><button type="button" onClick={() => setSamples((ls) => [...ls, { productId: "", qty: "" }])} className="btn-ghost btn-sm"><Plus size={14} /> Ligne</button></div>
        <div className="space-y-2">
          {samples.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_32px] gap-1.5 items-center">
              <select name={`sample_product_${i}`} value={l.productId} onChange={(e) => setSampleLine(i, { productId: e.target.value })} className="select h-11 text-[13px]">
                <option value="">Produit…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input name={`sample_qty_${i}`} value={l.qty} onChange={(e) => setSampleLine(i, { qty: e.target.value })} inputMode="numeric" placeholder="Qté" className="input h-11 px-2 text-center" />
              <button type="button" onClick={() => setSamples((ls) => ls.filter((_, j) => j !== i))} className="btn-ghost h-11 w-8 p-0 rounded-lg" aria-label="Supprimer"><Trash2 size={15} /></button>
            </div>
          ))}
          <input type="hidden" name="sampleCount" value={samples.length} />
        </div>
      </div>

      <label className="block text-[13px]"><span className="label block mb-1">Intérêt du médecin</span>
        <select name="doctorInterest" defaultValue={initial?.doctorInterest ?? ""} className="select h-11">
          <option value="">—</option><option value="FAIBLE">Faible</option><option value="MOYEN">Moyen</option><option value="FORT">Fort</option>
        </select>
      </label>
      <label className="block text-[13px]"><span className="label block mb-1">Résultat</span><textarea name="result" defaultValue={initial?.result ?? ""} className="textarea" /></label>
      <label className="block text-[13px]"><span className="label block mb-1">Objections rencontrées</span><textarea name="objections" defaultValue={initial?.objections ?? ""} className="textarea" placeholder="Prix, habitude d’une autre marque, doute sur l’efficacité…" /></label>
      <label className="block text-[13px]"><span className="label block mb-1">Documentation laissée</span><input name="documentation" defaultValue={initial?.documentation ?? ""} className="input h-11" placeholder="Brochure gamme, fiche produit, argumentaire…" /></label>
      <label className="block text-[13px]"><span className="label block mb-1">Commentaire</span><textarea name="comment" defaultValue={initial?.comment ?? ""} className="textarea" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[13px]"><span className="label block mb-1">Prochaine action</span><input name="nextAction" defaultValue={initial?.nextAction ?? ""} className="input h-11" /></label>
        <label className="block text-[13px]"><span className="label block mb-1">Prochaine visite (date)</span><input type="date" name="nextVisitDate" defaultValue={initial?.nextVisitDate ?? ""} className="input h-11" /></label>
      </div>

      <button type="submit" className="btn-primary w-full h-12 text-[15px]">{submitLabel ?? "Enregistrer la visite"}</button>
    </form>
  );
}
