import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActivationAccess, activationScope, canDoActivation } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { getInventoryItem, itemMovements, MOVEMENT_LABELS } from "@/lib/activations/inventory";
import { INVENTORY_STATUS_LABELS, INVENTORY_STATUS_TONES, safeTone } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { listAssets } from "@/lib/content/assets";
import { PageHeader, Card, Badge, BrandDot, Facts } from "@/components/ui";
import { AssetUpload } from "@/components/asset-upload";
import { fmtMAD, fmtDate, iso, today } from "@/lib/format";
import { saveInventoryItem, addMovement, beginItemAsset, appendItemChunk, finishItemAsset, deleteItemAsset } from "../actions";

export const dynamic = "force-dynamic";

export default async function MaterielItemPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string }> }) {
  await requireActivationAccess();
  const { id } = await props.params;
  const { erreur } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [refs, settings, scope, brands, canEdit] = await Promise.all([activationRefs(), getSettings(), activationScope(), listBrands(), canDoActivation("edit")]);
  const todayIso = iso(today());
  const item = await getInventoryItem(id, todayIso, settings.activations.inventoryDormantDays);
  if (!item) notFound();
  const [moves, photos, products, clients] = await Promise.all([
    itemMovements(id), listAssets({ inventoryItemId: id }),
    db.execute<{ id: string; name: string }>(sql`select id, name from products where active ${item.brandId ? sql`and brand_id = ${item.brandId}::uuid` : sql``} order by name`),
    db.execute<{ id: string; name: string; city: string | null }>(sql`select id, name, city from clients where active order by name limit 600`),
  ]);
  const photo = photos.find((p) => p.kind === "PHOTO");
  const visibleBrands = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)) || b.id === item.brandId);
  const uploadActions = { begin: beginItemAsset, append: appendItemChunk, finish: finishItemAsset };
  const ro = !canEdit;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/materiel" className="hover:underline">Matériel</Link>} title={item.name}
        subtitle={<span className="inline-flex items-center gap-2 flex-wrap">{item.brand && <span className="inline-flex items-center gap-1"><BrandDot color={item.color ?? "#999"} />{item.brand}</span>}<span>· {item.category}</span>{item.sku && <span>· {item.sku}</span>}{item.location && <span>· {item.location}</span>}</span>}
        actions={<Badge tone={safeTone(INVENTORY_STATUS_TONES[item.status])}>{INVENTORY_STATUS_LABELS[item.status]}</Badge>} />
      {erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{erreur}</div>}

      <div className="grid lg:grid-cols-[1fr_360px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Stock">
            <Facts cols={4} items={[
              { label: "En stock", value: `${item.stock} ${item.unit}` }, { label: "Valeur", value: fmtMAD(item.value) },
              { label: "Sorties 90 j", value: item.outQty90 || "—" }, { label: "Dernière sortie", value: item.lastOutAt ? fmtDate(item.lastOutAt) : "jamais" },
            ]} />
            {canEdit && (
              <form action={addMovement} className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-1.5 items-end text-[12.5px] rounded-xl border border-dashed border-line-2 p-2">
                <input type="hidden" name="itemId" value={item.id} />
                <label className="block"><span className="label block">Mouvement</span><select name="type" className="select h-8 text-[12px]"><option value="ENTREE">Entrée (réception)</option><option value="SORTIE">Sortie libre</option><option value="AJUSTEMENT">Ajustement (±)</option></select></label>
                <label className="block"><span className="label block">Quantité</span><input name="quantity" inputMode="numeric" className="input h-8 text-[12px]" required placeholder="ex : 50 ou -3" /></label>
                <label className="block"><span className="label block">Coût unit. (entrée)</span><input name="unitCost" inputMode="decimal" className="input h-8 text-[12px]" placeholder={String(item.unitCost)} /></label>
                <label className="block"><span className="label block">Date</span><input type="date" name="date" defaultValue={todayIso} className="input h-8 text-[12px]" /></label>
                <label className="block sm:col-span-2"><span className="label block">Motif / client (sortie libre)</span><div className="flex gap-1"><input name="reason" className="input h-8 text-[12px]" placeholder="Réception fournisseur, dotation Karim…" /><select name="clientId" className="select h-8 text-[12px] w-[140px]" defaultValue=""><option value="">Client…</option>{clients.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></label>
                <div className="col-span-2 sm:col-span-6 flex items-center gap-2"><button className="btn-primary btn-sm h-8" type="submit">Enregistrer le mouvement</button><span className="text-[11px] text-muted">Une sortie vers une activation se fait depuis la fiche de l&apos;activation, bloc « Matériel ».</span></div>
              </form>
            )}
          </Card>

          <Card title={`Mouvements (${moves.length})`} pad={false}>
            <div className="table-wrap"><table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-muted"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Quantité</th><th className="px-3 py-2 text-right">Coût unit.</th><th className="px-3 py-2">Lié à</th><th className="px-3 py-2">Motif</th><th className="px-3 py-2">Par</th></tr></thead>
              <tbody>{moves.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="px-3 py-1.5"><Badge tone={m.type === "ENTREE" ? "green" : m.type === "SORTIE" ? "orange" : "gray"}>{MOVEMENT_LABELS[m.type as keyof typeof MOVEMENT_LABELS] ?? m.type}</Badge></td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${m.quantity < 0 ? "text-red" : ""}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m.unitCost != null ? fmtMAD(m.unitCost) : "—"}</td>
                  <td className="px-3 py-1.5">{m.activationId ? <Link href={`/marketing/activations/${m.activationId}`} className="hover:underline">{m.activation}</Link> : m.client ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.reason ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted">{m.createdBy ?? "—"}</td>
                </tr>
              ))}{moves.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-muted">Aucun mouvement.</td></tr>}</tbody>
            </table></div>
          </Card>
        </div>

        <div className="space-y-4 order-first lg:order-none">
          <Card title="Photo" action={canEdit ? <AssetUpload ownerId={item.id} kind="PHOTO" label={photo ? "Remplacer" : "Photo"} camera actions={uploadActions} /> : undefined}>
            {photo ? <div className="relative"><img src={`/marketing/activations/fichier/${photo.id}`} alt={item.name} className="w-full max-h-[260px] object-contain rounded-xl border border-line bg-black/5" />{canEdit && <form action={deleteItemAsset} className="absolute top-1 right-1"><input type="hidden" name="id" value={photo.id} /><button className="h-6 w-6 rounded bg-surface/90 text-faint hover:text-red" type="submit" title="Supprimer">×</button></form>}</div>
              : <p className="text-[13px] text-muted">Aucune photo. Sur téléphone, « Photo » ouvre l&apos;appareil.</p>}
          </Card>

          <Card title="Fiche article">
            <form action={saveInventoryItem} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={item.id} />
              <fieldset disabled={ro} className="contents">
              <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={item.name} className="input h-9" required /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Catégorie</span><select name="categoryKey" defaultValue={item.categoryKey} className="select h-9">{refs.inventoryCategories.filter((c) => c.active || c.key === item.categoryKey).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" defaultValue={item.brandId ?? ""} className="select h-9"><option value="">—</option>{visibleBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="block col-span-2"><span className="label block mb-1">Produit lié</span><select name="productId" defaultValue={item.productId ?? ""} className="select h-9"><option value="">—</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Référence</span><input name="sku" defaultValue={item.sku ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Unité</span><input name="unit" defaultValue={item.unit} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Coût unitaire (MAD)</span><input name="unitCost" defaultValue={item.unitCost} inputMode="decimal" className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Seuil d&apos;alerte</span><input name="alertThreshold" defaultValue={item.alertThreshold ?? ""} inputMode="numeric" className="input h-9" /></label>
                <label className="block col-span-2"><span className="label block mb-1">Emplacement</span><input name="location" defaultValue={item.location ?? ""} className="input h-9" /></label>
                <label className="block col-span-2"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={item.notes ?? ""} className="textarea min-h-[50px]" /></label>
                <label className="inline-flex items-center gap-2 col-span-2"><input type="checkbox" name="active" defaultChecked={item.active} /> Article actif</label>
              </div>
              </fieldset>
              {canEdit && <div className="flex items-center gap-2"><button className="btn-primary btn-sm" type="submit">Enregistrer</button><span className="text-[11px] text-muted">Le stock ne se modifie que par un mouvement.</span></div>}
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
