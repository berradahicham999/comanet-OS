"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { AnimationPeriodFields } from "@/components/animation-period-fields";

export type FormProduct = { id: string; name: string; brandId: string | null };
export type FormClient = { id: string; name: string; city: string | null };
export type FormUser = { id: string; name: string };
export type FormBrand = { id: string; name: string };

type Line = { productId: string; qty: string; stock: string };

export function AnimationForm({ action, clients, products, brands, animatrices, initial, isAnimatrice, today, submitLabel }: {
  action: (formData: FormData) => void | Promise<void>;
  clients: FormClient[];
  products: FormProduct[];
  brands: FormBrand[];
  animatrices: FormUser[];
  initial?: { id?: string; clientId?: string; date?: string; startDate?: string | null; days?: number; brandId?: string | null; animatriceId?: string | null; status?: string; cost?: string; durationHours?: string | null; customersAdvised?: number; samples?: number; comment?: string | null; photoUrl?: string | null; lines?: Line[] };
  isAnimatrice: boolean;
  today: string;
  submitLabel?: string;
}) {
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [brandId, setBrandId] = useState(initial?.brandId ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [{ productId: "", qty: "", stock: "" }]);

  const filteredClients = useMemo(() => {
    const q = normKey(clientQuery);
    const list = q ? clients.filter((c) => normKey(c.name).includes(q) || normKey(c.city ?? "").includes(q)) : clients;
    return list.slice(0, 80);
  }, [clientQuery, clients]);
  const brandProducts = useMemo(() => (brandId ? products.filter((p) => p.brandId === brandId) : products), [brandId, products]);

  function setLine(i: number, patch: Partial<Line>) { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }

  return (
    <form action={action} className="space-y-4">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <AnimationPeriodFields initialStart={initial?.startDate} initialEnd={initial?.date ?? today} initialDays={initial?.days} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[13px] col-span-2"><span className="label block mb-1">Statut</span>
          <select name="status" defaultValue={initial?.status ?? "DONE"} className="select h-11"><option value="DONE">Réalisée</option><option value="PLANNED">Prévue</option><option value="CANCELLED">Annulée</option></select>
        </label>
        {!isAnimatrice && (
          <label className="block text-[13px] col-span-2"><span className="label block mb-1">Animatrice</span>
            <select name="animatriceId" defaultValue={initial?.animatriceId ?? ""} className="select h-11"><option value="">—</option>{animatrices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
        )}
      </div>

      <div className="text-[13px]">
        <span className="label block mb-1">Point de vente</span>
        <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Filtrer par nom ou ville…" className="input h-11 mb-1.5" />
        <select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} className="select h-11" required>
          <option value="">Choisir…</option>
          {clientId && !filteredClients.some((c) => c.id === clientId) && clients.filter((c) => c.id === clientId).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</option>)}
          {filteredClients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</option>)}
        </select>
      </div>

      <label className="block text-[13px]"><span className="label block mb-1">Marque animée</span>
        <select name="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="select h-11"><option value="">Toutes / multi-marques</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </label>

      <div>
        <div className="flex items-center justify-between mb-1"><span className="label">Produits vendus</span><button type="button" onClick={() => setLines((ls) => [...ls, { productId: "", qty: "", stock: "" }])} className="btn-ghost btn-sm"><Plus size={14} /> Ligne</button></div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px_72px_32px] gap-1.5 items-center">
              <select name={`product_${i}`} value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} className="select h-11 text-[13px]">
                <option value="">Produit…</option>
                {brandProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input name={`qty_${i}`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" placeholder="Vendu" className="input h-11 px-2 text-center" />
              <input name={`stock_${i}`} value={l.stock} onChange={(e) => setLine(i, { stock: e.target.value })} inputMode="numeric" placeholder="Stock" className="input h-11 px-2 text-center" />
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="btn-ghost h-11 w-8 p-0 rounded-lg" aria-label="Supprimer"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-faint mt-1">Vendu = unités vendues pendant l&apos;animation · Stock = stock rayon constaté</div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block text-[13px]"><span className="label block mb-1">Clientes conseillées</span><input name="customersAdvised" defaultValue={initial?.customersAdvised ?? ""} inputMode="numeric" className="input h-11" /></label>
        <label className="block text-[13px]"><span className="label block mb-1">Échantillons</span><input name="samples" defaultValue={initial?.samples ?? ""} inputMode="numeric" className="input h-11" /></label>
        <label className="block text-[13px]"><span className="label block mb-1">Durée (h)</span><input name="durationHours" defaultValue={initial?.durationHours ?? ""} inputMode="decimal" className="input h-11" /></label>
      </div>
      {!isAnimatrice && <label className="block text-[13px]"><span className="label block mb-1">Coût de l&apos;animation (MAD)</span><input name="cost" defaultValue={initial?.cost ?? ""} inputMode="decimal" className="input h-11" /></label>}
      <label className="block text-[13px]"><span className="label block mb-1">Commentaire</span><textarea name="comment" defaultValue={initial?.comment ?? ""} className="textarea" placeholder="Affluence, rayon, remarques…" /></label>
      <label className="block text-[13px]"><span className="label block mb-1">Photo (lien)</span><input name="photoUrl" defaultValue={initial?.photoUrl ?? ""} className="input h-11" placeholder="https://… (WhatsApp / Drive)" /></label>
      <button type="submit" className="btn-primary w-full h-12 text-[15px]">{submitLabel ?? "Enregistrer l'animation"}</button>
    </form>
  );
}
