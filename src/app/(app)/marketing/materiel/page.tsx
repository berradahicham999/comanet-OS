import Link from "next/link";
import { requireActivationAccess, activationScope, canDoActivation } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { listInventory, inventoryByBrand } from "@/lib/activations/inventory";
import { INVENTORY_STATUS_LABELS, INVENTORY_STATUS_TONES, safeTone } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Empty, Kpi } from "@/components/ui";
import { fmtMAD, fmtDateShort, iso, today } from "@/lib/format";
import { saveInventoryItem } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matériel" };

type SP = { brand?: string; category?: string; q?: string; statut?: string; inactifs?: string };

export default async function MaterielPage(props: { searchParams: Promise<SP> }) {
  await requireActivationAccess();
  const sp = await props.searchParams;
  const [refs, settings, scope, brands, canCreate] = await Promise.all([activationRefs(), getSettings(), activationScope(), listBrands(), canDoActivation("create")]);
  const todayIso = iso(today());
  const all = await listInventory({ brand: sp.brand, category: sp.category, q: sp.q, includeInactive: !!sp.inactifs }, todayIso, settings.activations.inventoryDormantDays);
  const items = sp.statut ? all.filter((i) => i.status === sp.statut) : all;
  const byBrand = inventoryByBrand(all);
  const totalValue = all.reduce((a, i) => a + i.value, 0);
  const low = all.filter((i) => i.status === "BAS" || i.status === "RUPTURE").length;
  const dormant = all.filter((i) => i.status === "DORMANT").length;
  const visibleBrands = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)));
  const href = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v); const s = p.toString(); return s ? `/marketing/materiel?${s}` : "/marketing/materiel"; };

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Matériel" subtitle="PLV, échantillons, goodies, print : ce qu'il reste, ce que ça vaut, ce qui dort. Une sortie vers une activation alimente son coût."
        actions={<><Link href="/imports/nouveau?type=INVENTORY" className="btn-ghost btn-sm">Importer l&apos;inventaire</Link>{canCreate && <a href="#nouvel-article" className="btn-primary btn-sm">Nouvel article</a>}</>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Articles" value={String(all.length)} sub={`${all.filter((i) => i.stock > 0).length} en stock`} />
        <Kpi label="Valeur du stock" value={fmtMAD(totalValue, { compact: true })} sub="au coût unitaire" />
        <Kpi label="Stock bas / rupture" value={String(low)} tone={low ? "orange" : "green"} href={href({ statut: "BAS" })} sub="seuil d'alerte atteint" />
        <Kpi label="Dormants" value={String(dormant)} tone={dormant ? "yellow" : "green"} href={href({ statut: "DORMANT" })} sub={`aucune sortie depuis ${settings.activations.inventoryDormantDays} j`} />
      </div>

      {byBrand.length > 0 && (
        <Card title="Par marque" className="mb-4" pad={false}>
          <div className="table-wrap"><table className="w-full text-[13px]">
            <thead><tr className="text-left text-muted"><th className="px-3 py-2">Marque</th><th className="px-3 py-2 text-right">Articles</th><th className="px-3 py-2 text-right">Valeur</th><th className="px-3 py-2 text-right">Sorties 90 j</th><th className="px-3 py-2 text-right">Stock bas</th><th className="px-3 py-2 text-right">Dormants</th></tr></thead>
            <tbody>{byBrand.map((b) => (
              <tr key={b.brand} className="border-t border-line"><td className="px-3 py-1.5"><Link href={href({ brand: b.brandId ?? undefined })} className="inline-flex items-center gap-1.5 hover:underline"><BrandDot color={b.color ?? "#999"} />{b.brand}</Link></td><td className="px-3 py-1.5 text-right tabular-nums">{b.items}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtMAD(b.value)}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.out90 || "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.low ? <Badge tone="orange">{b.low}</Badge> : "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{b.dormant ? <Badge tone="yellow">{b.dormant}</Badge> : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      <form className="card card-pad mb-4 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[13px]" method="get">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Article, référence, emplacement…" className="input h-9 col-span-2 sm:col-span-1" />
        <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9"><option value="">Toutes marques</option>{visibleBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ""} className="select h-9"><option value="">Toutes catégories</option>{refs.inventoryCategories.filter((c) => c.active).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <select name="statut" defaultValue={sp.statut ?? ""} className="select h-9"><option value="">Tous statuts</option>{(Object.keys(INVENTORY_STATUS_LABELS) as (keyof typeof INVENTORY_STATUS_LABELS)[]).map((k) => <option key={k} value={k}>{INVENTORY_STATUS_LABELS[k]}</option>)}</select>
        <div className="flex gap-1"><label className="inline-flex items-center gap-1 text-[12px] text-muted px-1"><input type="checkbox" name="inactifs" value="1" defaultChecked={!!sp.inactifs} /> inactifs</label><button className="btn-primary btn-sm h-9 ml-auto" type="submit">OK</button></div>
      </form>

      {items.length === 0 ? (
        <Empty title="Aucun article" hint={<>Importez votre inventaire initial (fichier Excel : article, catégorie, marque, quantité, coût) depuis <Link href="/imports/nouveau?type=INVENTORY" className="text-accent">Imports</Link>, ou créez un article ci-dessous.</>} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap"><table className="w-full text-[13px]">
            <thead><tr className="text-left text-muted"><th className="px-3 py-2">Article</th><th className="px-3 py-2">Catégorie</th><th className="px-3 py-2">Marque</th><th className="px-3 py-2 text-right">Stock</th><th className="px-3 py-2 text-right">Coût unit.</th><th className="px-3 py-2 text-right">Valeur</th><th className="px-3 py-2">Dernière sortie</th><th className="px-3 py-2">Statut</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} className={`border-t border-line hover:bg-surface-2/60 ${!i.active ? "opacity-50" : ""}`}>
                <td className="px-3 py-2"><Link href={`/marketing/materiel/${i.id}`} className="font-medium hover:underline inline-flex items-center gap-2">{i.photoId && <img src={`/marketing/activations/fichier/${i.photoId}`} alt="" className="h-7 w-7 rounded object-cover border border-line" />}{i.name}</Link>{i.sku && <div className="text-[11.5px] text-muted">{i.sku}{i.location ? ` · ${i.location}` : ""}</div>}</td>
                <td className="px-3 py-2">{i.category}</td>
                <td className="px-3 py-2">{i.brand ? <span className="inline-flex items-center gap-1.5"><BrandDot color={i.color ?? "#999"} />{i.brand}</span> : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.stock} <span className="text-muted">{i.unit}</span>{i.alertThreshold != null && <div className="text-[11px] text-muted">seuil {i.alertThreshold}</div>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMAD(i.unitCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMAD(i.value)}</td>
                <td className="px-3 py-2">{i.lastOutAt ? fmtDateShort(i.lastOutAt) : "jamais"}</td>
                <td className="px-3 py-2"><Badge tone={safeTone(INVENTORY_STATUS_TONES[i.status])}>{INVENTORY_STATUS_LABELS[i.status]}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      {canCreate && (
        <div id="nouvel-article" className="mt-4"><Card title="Nouvel article">
          <form action={saveInventoryItem} className="grid sm:grid-cols-4 gap-2 text-[13px]">
            <label className="block sm:col-span-2"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required placeholder="Présentoir comptoir Gamarde" /></label>
            <label className="block"><span className="label block mb-1">Catégorie</span><select name="categoryKey" className="select h-9">{refs.inventoryCategories.filter((c) => c.active).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" className="select h-9" defaultValue=""><option value="">—</option>{visibleBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Référence</span><input name="sku" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Unité</span><input name="unit" className="input h-9" defaultValue="pièce" /></label>
            <label className="block"><span className="label block mb-1">Coût unitaire (MAD)</span><input name="unitCost" inputMode="decimal" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Seuil d&apos;alerte</span><input name="alertThreshold" inputMode="numeric" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Stock initial</span><input name="initialStock" inputMode="numeric" className="input h-9" placeholder="0" /></label>
            <label className="block sm:col-span-2"><span className="label block mb-1">Emplacement</span><input name="location" className="input h-9" placeholder="Réserve Casablanca, étagère B" /></label>
            <div className="flex items-end"><button className="btn-primary btn-sm h-9" type="submit">Créer l&apos;article</button></div>
          </form>
        </Card></div>
      )}
    </>
  );
}
