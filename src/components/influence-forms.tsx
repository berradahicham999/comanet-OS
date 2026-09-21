"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/content-calendar";
import { COLLAB_STATUS } from "@/lib/marketing-shared";
import { normKey } from "@/lib/import/normalize";
import { fmtMAD, fmtNum } from "@/lib/format";

export type FormBrand = { id: string; name: string };
export type FormInfluencer = { id: string; name: string; instagram: string | null; tiktok: string | null; followers: number | null; engagement_rate: number | null; category: string | null; city: string | null; usual_rate: number | null; contact: string | null; notes: string | null; active: boolean };
export type FormCampaign = { id: string; name: string; brand_id: string };
export type FormProduct = { id: string; name: string; brand_id: string | null };
/** Filtres de la page, renvoyés à l'action pour revenir au même écran après l'enregistrement. */
export type ReturnParams = Record<string, string>;

export type CollabInitial = {
  id: string; influencer_id: string; brand_id: string; date: string; status: string; campaign_id: string | null; product_id: string | null;
  reels: number; stories: number; posts: number; fee: number; product_value: number;
  reach: number | null; impressions: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  link_clicks: number | null; promo_code: string | null; conversions: number | null; attributed_revenue: number | null; notes: string | null;
};

type Action = (formData: FormData) => void | Promise<void>;

function ReturnFields({ params }: { params: ReturnParams }) {
  return <>{Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={`return_${k}`} value={v} />)}</>;
}

const v = (x: number | string | null | undefined) => (x === null || x === undefined ? "" : String(x));

/**
 * Formulaire de collaboration, en création comme en modification. Campagnes et produits
 * sont filtrés par la marque choisie ; l'influenceuse se cherche par nom, réseau ou ville.
 */
export function CollabForm({ action, brands, influencers, campaigns, products, initial, seeCosts, returnParams, defaultBrandId, onDone }: {
  action: Action; brands: FormBrand[]; influencers: FormInfluencer[]; campaigns: FormCampaign[]; products: FormProduct[];
  initial?: CollabInitial; seeCosts: boolean; returnParams: ReturnParams; defaultBrandId?: string | null; onDone?: () => void;
}) {
  const [brandId, setBrandId] = useState(initial?.brand_id ?? defaultBrandId ?? "");
  const [influencerId, setInfluencerId] = useState(initial?.influencer_id ?? "");
  const [query, setQuery] = useState("");
  const brandCampaigns = useMemo(() => campaigns.filter((c) => c.brand_id === brandId), [campaigns, brandId]);
  const brandProducts = useMemo(() => products.filter((p) => !p.brand_id || p.brand_id === brandId), [products, brandId]);
  const hits = useMemo(() => {
    const k = normKey(query);
    const list = k ? influencers.filter((i) => [i.name, i.instagram, i.tiktok, i.city, i.category].some((f) => f && normKey(f).includes(k))) : influencers;
    const chosen = influencers.find((i) => i.id === influencerId);
    const top = list.slice(0, 60);
    return chosen && !top.some((i) => i.id === chosen.id) ? [chosen, ...top] : top;
  }, [query, influencers, influencerId]);

  return (
    <form action={action} className="grid sm:grid-cols-2 gap-2 text-[13px]" onSubmit={() => onDone?.()}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <ReturnFields params={returnParams} />
      <label className="block sm:col-span-2"><span className="label block mb-1">Influenceuse *</span>
        <div className="grid grid-cols-2 gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input h-9" placeholder="Rechercher (nom, @compte, ville)…" aria-label="Rechercher une influenceuse" />
          <select name="influencerId" value={influencerId} onChange={(e) => setInfluencerId(e.target.value)} className="select h-9" required>
            <option value="">— choisir —</option>
            {hits.map((i) => <option key={i.id} value={i.id}>{i.name}{i.instagram ? ` · ${i.instagram}` : ""}{!i.active ? " (inactive)" : ""}</option>)}
          </select>
        </div>
        {hits.length === 0 && <span className="text-[11.5px] text-faint">Aucune influenceuse ne correspond : ajoutez-la d&apos;abord au répertoire.</span>}
      </label>
      <label className="block"><span className="label block mb-1">Marque *</span>
        <select name="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="select h-9" required><option value="">— choisir —</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      </label>
      <label className="block"><span className="label block mb-1">Date *</span><input type="date" name="date" defaultValue={initial?.date ?? ""} className="input h-9" required /></label>
      <label className="block"><span className="label block mb-1">Statut</span><select name="status" className="select h-9" defaultValue={initial?.status ?? "CONFIRMEE"}>{Object.entries(COLLAB_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></label>
      <label className="block"><span className="label block mb-1">Campagne</span>
        <select name="campaignId" className="select h-9" defaultValue={initial?.campaign_id ?? ""} disabled={!brandId}><option value="">{brandId ? (brandCampaigns.length ? "— aucune —" : "— aucune campagne influence pour cette marque —") : "— choisir d'abord la marque —"}</option>{brandCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label className="block sm:col-span-2"><span className="label block mb-1">Produit poussé</span>
        <select name="productId" className="select h-9" defaultValue={initial?.product_id ?? ""} disabled={!brandId}><option value="">{brandId ? "— aucun —" : "— choisir d'abord la marque —"}</option>{brandProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <div className="sm:col-span-2 grid grid-cols-3 gap-2">
        <label className="block"><span className="label block mb-1">Reels</span><input name="reels" inputMode="numeric" defaultValue={v(initial?.reels)} className="input h-9" placeholder="0" /></label>
        <label className="block"><span className="label block mb-1">Stories</span><input name="stories" inputMode="numeric" defaultValue={v(initial?.stories)} className="input h-9" placeholder="0" /></label>
        <label className="block"><span className="label block mb-1">Posts</span><input name="posts" inputMode="numeric" defaultValue={v(initial?.posts)} className="input h-9" placeholder="0" /></label>
      </div>
      {seeCosts && <label className="block"><span className="label block mb-1">Cachet (MAD)</span><input name="fee" inputMode="decimal" defaultValue={v(initial?.fee)} className="input h-9" placeholder="0" /></label>}
      <label className="block"><span className="label block mb-1">Valeur produits offerts (MAD)</span><input name="productValue" inputMode="decimal" defaultValue={v(initial?.product_value)} className="input h-9" placeholder="0" /></label>
      <div className="sm:col-span-2 border-t border-line pt-2 mt-1"><span className="label">Après publication</span></div>
      <label className="block"><span className="label block mb-1">Reach</span><input name="reach" inputMode="numeric" defaultValue={v(initial?.reach)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Impressions</span><input name="impressions" inputMode="numeric" defaultValue={v(initial?.impressions)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Vues</span><input name="views" inputMode="numeric" defaultValue={v(initial?.views)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Likes</span><input name="likes" inputMode="numeric" defaultValue={v(initial?.likes)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Commentaires</span><input name="comments" inputMode="numeric" defaultValue={v(initial?.comments)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Partages</span><input name="shares" inputMode="numeric" defaultValue={v(initial?.shares)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Enregistrements</span><input name="saves" inputMode="numeric" defaultValue={v(initial?.saves)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Clics sur le lien</span><input name="linkClicks" inputMode="numeric" defaultValue={v(initial?.link_clicks)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Code promo</span><input name="promoCode" defaultValue={v(initial?.promo_code)} className="input h-9" placeholder="Ex : SARAH15" /></label>
      <label className="block"><span className="label block mb-1">Commandes avec le code</span><input name="conversions" inputMode="numeric" defaultValue={v(initial?.conversions)} className="input h-9" /></label>
      <label className="block sm:col-span-2"><span className="label block mb-1">CA du code promo (MAD)</span><input name="attributedRevenue" inputMode="decimal" defaultValue={v(initial?.attributed_revenue)} className="input h-9" /></label>
      <label className="block sm:col-span-2"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={v(initial?.notes)} className="input min-h-16" rows={2} /></label>
      <button className="btn-primary sm:col-span-2" type="submit">{initial ? "Enregistrer les modifications" : "Enregistrer la collaboration"}</button>
      <p className="text-[11.5px] text-faint sm:col-span-2">Le CA n&apos;est retenu comme attribué que si un code promo est renseigné avec son chiffre d&apos;affaires. Sans cela, la collaboration reste comparable sur le reach et l&apos;engagement uniquement.</p>
    </form>
  );
}

/** Actions d'une ligne du tableau : modifier (modale), changer le statut, supprimer (avec confirmation). */
export function CollabRowActions({ row, label, canEdit, canDelete, statusAction, deleteAction, returnParams, ...formProps }: {
  row: CollabInitial; label: string; canEdit: boolean; canDelete: boolean; statusAction: Action; deleteAction: Action; returnParams: ReturnParams;
  action: Action; brands: FormBrand[]; influencers: FormInfluencer[]; campaigns: FormCampaign[]; products: FormProduct[]; seeCosts: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {canEdit ? (
        <form action={statusAction} className="flex items-center gap-1">
          <input type="hidden" name="id" value={row.id} />
          <ReturnFields params={returnParams} />
          <select name="status" defaultValue={row.status} className="select h-7 text-[11.5px] w-32">{Object.entries(COLLAB_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select>
          <button className="text-[11px] text-accent" type="submit">OK</button>
        </form>
      ) : <span className="text-[11.5px]">{COLLAB_STATUS[row.status]?.label ?? row.status}</span>}
      {canEdit && <button type="button" onClick={() => setOpen(true)} className="btn-ghost h-7 w-7 p-0 rounded-lg" title="Modifier" aria-label="Modifier"><Pencil size={13} /></button>}
      {canDelete && (
        <form action={deleteAction} onSubmit={(e) => { if (!confirm(`Supprimer définitivement la collaboration « ${label} » ?`)) e.preventDefault(); }}>
          <input type="hidden" name="id" value={row.id} />
          <ReturnFields params={returnParams} />
          <button className="btn-ghost h-7 w-7 p-0 rounded-lg text-faint hover:text-red" type="submit" title="Supprimer" aria-label="Supprimer"><Trash2 size={13} /></button>
        </form>
      )}
      {open && (
        <Modal title={`Modifier — ${label}`} onClose={() => setOpen(false)} wide>
          <CollabForm {...formProps} initial={row} returnParams={returnParams} onDone={() => setOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

function InfluencerForm({ action, initial, returnParams, onDone }: { action: Action; initial?: FormInfluencer; returnParams: ReturnParams; onDone?: () => void }) {
  return (
    <form action={action} className="grid sm:grid-cols-2 gap-2 text-[13px]" onSubmit={() => onDone?.()}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <ReturnFields params={returnParams} />
      <label className="block sm:col-span-2"><span className="label block mb-1">Nom *</span><input name="name" defaultValue={v(initial?.name)} className="input h-9" required /></label>
      <label className="block"><span className="label block mb-1">Instagram</span><input name="instagram" defaultValue={v(initial?.instagram)} className="input h-9" placeholder="@compte" /></label>
      <label className="block"><span className="label block mb-1">TikTok</span><input name="tiktok" defaultValue={v(initial?.tiktok)} className="input h-9" placeholder="@compte" /></label>
      <label className="block"><span className="label block mb-1">Abonnés</span><input name="followers" inputMode="numeric" defaultValue={v(initial?.followers)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Taux d&apos;engagement (%)</span><input name="engagementRate" inputMode="decimal" defaultValue={v(initial?.engagement_rate)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Catégorie</span><input name="category" defaultValue={v(initial?.category)} className="input h-9" placeholder="Beauté, lifestyle, médical…" /></label>
      <label className="block"><span className="label block mb-1">Ville</span><input name="city" defaultValue={v(initial?.city)} className="input h-9" placeholder="Casablanca" /></label>
      <label className="block"><span className="label block mb-1">Tarif habituel (MAD)</span><input name="usualRate" inputMode="decimal" defaultValue={v(initial?.usual_rate)} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Contact</span><input name="contact" defaultValue={v(initial?.contact)} className="input h-9" placeholder="Téléphone / e-mail" /></label>
      <label className="block sm:col-span-2"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={v(initial?.notes)} className="input min-h-16" rows={2} /></label>
      {initial && <label className="flex items-center gap-2 sm:col-span-2 text-[12.5px]"><input type="checkbox" name="active" value="on" defaultChecked={initial.active} /> Profil actif<input type="hidden" name="active" value="off" /></label>}
      <button className={initial ? "btn-primary sm:col-span-2" : "btn-secondary sm:col-span-2"} type="submit">{initial ? "Enregistrer la fiche" : "Ajouter au répertoire"}</button>
    </form>
  );
}

/** Répertoire : recherche, fiche modifiable en modale, ajout. */
export function InfluencerDirectory({ influencers, action, canEdit, canCreate, returnParams }: { influencers: FormInfluencer[]; action: Action; canEdit: boolean; canCreate: boolean; returnParams: ReturnParams }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<FormInfluencer | null>(null);
  const list = useMemo(() => {
    const k = normKey(q);
    return (k ? influencers.filter((i) => [i.name, i.instagram, i.tiktok, i.city, i.category].some((f) => f && normKey(f).includes(k))) : influencers).slice(0, 100);
  }, [q, influencers]);
  return (
    <div>
      {influencers.length > 0 && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input h-9 mb-2" placeholder={`Rechercher parmi ${influencers.length} profils…`} aria-label="Rechercher dans le répertoire" />
          <div className="max-h-72 overflow-auto mb-3">
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Nom</th><th>Réseaux</th><th className="num">Abonnés</th><th className="num">Tarif</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className={i.active ? "" : "opacity-50"}>
                    <td>{i.name}<div className="text-[11px] text-faint">{[i.category, i.city].filter(Boolean).join(" · ")}</div></td>
                    <td className="text-muted text-[11.5px]">{[i.instagram, i.tiktok].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="num">{i.followers ? fmtNum(i.followers) : "—"}</td>
                    <td className="num">{i.usual_rate ? fmtMAD(i.usual_rate, { suffix: false }) : "—"}</td>
                    {canEdit && <td><button type="button" onClick={() => setEditing(i)} className="btn-ghost h-7 w-7 p-0 rounded-lg" title="Modifier la fiche" aria-label="Modifier la fiche"><Pencil size={13} /></button></td>}
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={5} className="text-muted text-center py-3">Aucun profil ne correspond.</td></tr>}
              </tbody>
            </table>
          </div>
          {list.length === 100 && <p className="text-[11px] text-faint mb-2">100 premiers profils affichés : affinez la recherche.</p>}
        </>
      )}
      {canCreate && <div className="border-t border-line pt-3"><InfluencerForm action={action} returnParams={returnParams} /></div>}
      {editing && (
        <Modal title={`Fiche — ${editing.name}`} onClose={() => setEditing(null)}>
          <InfluencerForm action={action} initial={editing} returnParams={returnParams} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
