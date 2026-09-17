"use client";

import { useMemo, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import { normKey } from "@/lib/import/normalize";

/**
 * SAISIE RAPIDE — pour le rôle Animatrice uniquement.
 *
 * Le formulaire d'origine (`AnimationForm`) fait choisir un produit dans une liste
 * alphabétique de 157 entrées, répétée à chaque ligne. Ici, un seul menu « Ajouter un
 * produit » groupé par marque : l'animatrice choisit ses produits un par un, puis ne
 * saisit que des nombres sur chaque ligne ajoutée.
 *
 * Les champs envoyés (`product_i`, `qty_i`, `stock_i`, `clientId`, `date`…) sont EXACTEMENT
 * ceux que lit `readForm()` côté serveur : ce composant ne change aucune règle de saisie,
 * seulement la façon d'amener le doigt sur le bon champ.
 */

export type QuickProduct = { id: string; name: string; brandId: string | null; brandName: string | null };
export type QuickClient = { id: string; name: string; city: string | null };

type Row = { productId: string; name: string; qty: string; stock: string };

export function AnimationQuickForm({
  action, clients, catalog, defaultClientId, today, id,
}: {
  action: (formData: FormData) => void | Promise<void>;
  clients: QuickClient[];
  /** Le catalogue réellement animé, pour le menu « Ajouter un produit », groupé par marque. */
  catalog: QuickProduct[];
  defaultClientId?: string | null;
  today: string;
  /** Présent en modification (rare pour ce formulaire, prévu pour rester cohérent). */
  id?: string;
}) {
  const [clientQuery, setClientQuery] = useState("");
  const [clientSearchOpen, setClientSearchOpen] = useState(!defaultClientId);
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [showMore, setShowMore] = useState(false);

  const usedIds = useMemo(() => new Set(rows.map((r) => r.productId)), [rows]);
  /** Le reste du catalogue, groupé par marque — plus rapide à parcourir qu'une recherche
   * quand on sait ce qu'on cherche. « Sans marque » toujours en dernier. */
  const catalogByBrand = useMemo(() => {
    const groups = new Map<string, QuickProduct[]>();
    for (const p of catalog) {
      if (usedIds.has(p.id)) continue;
      const key = p.brandName ?? "Sans marque";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "Sans marque" ? 1 : b === "Sans marque" ? -1 : a.localeCompare(b, "fr")));
  }, [catalog, usedIds]);

  const filteredClients = useMemo(() => {
    if (!clientSearchOpen) return [];
    const q = normKey(clientQuery);
    const list = q ? clients.filter((c) => normKey(c.name).includes(q) || normKey(c.city ?? "").includes(q)) : clients;
    return list.slice(0, 80);
  }, [clientSearchOpen, clientQuery, clients]);
  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  function patchRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addProduct(p: QuickProduct) {
    setRows((rs) => [...rs, { productId: p.id, name: p.name, qty: "", stock: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
  }

  return (
    <form action={action} className="space-y-4">
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="status" value="DONE" />

      <label className="block text-[13px]">
        <span className="label block mb-1">Date</span>
        <input type="date" name="date" defaultValue={today} className="input h-12 text-[15px]" required />
      </label>

      <div className="text-[13px]">
        <span className="label block mb-1">Point de vente</span>
        {selectedClient && !clientSearchOpen ? (
          <button
            type="button"
            onClick={() => setClientSearchOpen(true)}
            className="w-full h-12 rounded-xl border border-line bg-surface px-3 flex items-center justify-between text-[15px] font-medium"
          >
            <span className="truncate">{selectedClient.name}{selectedClient.city ? ` — ${selectedClient.city}` : ""}</span>
            <ChevronDown size={16} className="text-faint shrink-0" />
          </button>
        ) : (
          <>
            <input
              autoFocus={!selectedClient}
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Nom ou ville du point de vente…"
              className="input h-12 text-[15px] mb-1.5"
            />
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line">
              {filteredClients.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">Aucun résultat.</div>}
              {filteredClients.map((c) => (
                <button
                  key={c.id} type="button"
                  onClick={() => { setClientId(c.id); setClientQuery(""); setClientSearchOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-[14px] hover:bg-sunk"
                >
                  {c.name}{c.city ? <span className="text-muted"> — {c.city}</span> : null}
                </button>
              ))}
            </div>
          </>
        )}
        <input type="hidden" name="clientId" value={clientId} required />
      </div>

      <div>
        <span className="label block mb-2">Mes produits</span>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.productId} className="grid grid-cols-[1fr_76px_76px_28px] gap-1.5 items-center">
              <div className="text-[13px] truncate py-2">{r.name}</div>
              <input
                name={`qty_${i}`} value={r.qty} onChange={(e) => patchRow(i, { qty: e.target.value })}
                inputMode="numeric" placeholder="0" aria-label={`Vendu — ${r.name}`}
                className="input h-11 px-2 text-center text-[15px] font-medium"
              />
              <input
                name={`stock_${i}`} value={r.stock} onChange={(e) => patchRow(i, { stock: e.target.value })}
                inputMode="numeric" placeholder="rayon" aria-label={`Reste en rayon — ${r.name}`}
                className="input h-11 px-2 text-center text-[12px] text-muted"
              />
              <button type="button" onClick={() => removeRow(i)} className="btn-ghost h-11 w-7 p-0 rounded-lg shrink-0" aria-label={`Retirer ${r.name}`}>
                <X size={14} />
              </button>
              <input type="hidden" name={`product_${i}`} value={r.productId} />
            </div>
          ))}
          {rows.length === 0 && <div className="text-[13px] text-muted py-2">Ajoutez un produit ci-dessous pour commencer.</div>}
        </div>

        <div className="mt-2">
          <select
            value=""
            onChange={(e) => {
              const p = catalog.find((c) => c.id === e.target.value);
              if (p) addProduct(p);
            }}
            className="select h-11 text-[14px]"
            aria-label="Ajouter un produit"
          >
            <option value="">+ Ajouter un produit…</option>
            {catalogByBrand.map(([brand, prods]) => (
              <optgroup key={brand} label={brand}>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-faint mt-1.5">Vendu = unités vendues pendant l&apos;animation · Rayon (facultatif) = ce qu&apos;il reste en stock</div>
      </div>

      <div>
        <button type="button" onClick={() => setShowMore((v) => !v)} className="text-[13px] text-muted flex items-center gap-1">
          <ChevronDown size={14} className={showMore ? "rotate-180" : ""} /> {showMore ? "Moins de détails" : "Plus de détails (facultatif)"}
        </button>
        {showMore && (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[13px]"><span className="label block mb-1">Clientes conseillées</span><input name="customersAdvised" inputMode="numeric" className="input h-11" /></label>
              <label className="block text-[13px]"><span className="label block mb-1">Échantillons</span><input name="samples" inputMode="numeric" className="input h-11" /></label>
            </div>
            <label className="block text-[13px]"><span className="label block mb-1">Commentaire</span><textarea name="comment" className="textarea" placeholder="Affluence, remarques…" /></label>
            <label className="block text-[13px]"><span className="label block mb-1">Photo (lien)</span><input name="photoUrl" className="input h-11" placeholder="https://… (WhatsApp / Drive)" /></label>
          </div>
        )}
      </div>

      <button type="submit" className="btn-primary w-full h-12 text-[16px]">Enregistrer</button>
    </form>
  );
}
