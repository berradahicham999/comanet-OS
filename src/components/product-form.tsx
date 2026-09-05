import type { Product, Brand } from "@/db/schema";
import { saveProduct } from "@/app/(app)/produits/actions";

export function ProductForm({ product, brands }: { product?: Product | null; brands: Brand[] }) {
  const p = product;
  return (
    <form action={saveProduct} className="space-y-3 text-[13px]">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid grid-cols-2 gap-2">
        <label className="block col-span-2"><span className="label block mb-1">Désignation</span><input name="name" defaultValue={p?.name ?? ""} className="input h-9" required /></label>
        <label className="block"><span className="label block mb-1">Marque</span>
          <select name="brandId" defaultValue={p?.brandId ?? ""} className="select h-9"><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Code article</span><input name="sku" defaultValue={p?.sku ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Nom court</span><input name="shortName" defaultValue={p?.shortName ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Catégorie</span><input name="category" defaultValue={p?.category ?? ""} className="input h-9" placeholder="Sérum, Crème…" /></label>
        <label className="block"><span className="label block mb-1">Prix pharmacien (PPH)</span><input name="priceWholesale" defaultValue={p?.priceWholesale ?? ""} className="input h-9" inputMode="decimal" /></label>
        <label className="block"><span className="label block mb-1">Prix public (PPV)</span><input name="priceRetail" defaultValue={p?.priceRetail ?? ""} className="input h-9" inputMode="decimal" /></label>
        <label className="block"><span className="label block mb-1">Coût de revient</span><input name="costPrice" defaultValue={p?.costPrice ?? ""} className="input h-9" inputMode="decimal" /></label>
        <label className="block"><span className="label block mb-1">Lead time (jours)</span><input name="leadTimeDays" defaultValue={p?.leadTimeDays ?? 60} className="input h-9" inputMode="numeric" /></label>
        <label className="block"><span className="label block mb-1">Stock sécurité (jours)</span><input name="safetyStockDays" defaultValue={p?.safetyStockDays ?? 30} className="input h-9" inputMode="numeric" /></label>
        <label className="block"><span className="label block mb-1">MOQ</span><input name="moq" defaultValue={p?.moq ?? ""} className="input h-9" inputMode="numeric" /></label>
      </div>
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer font-medium text-[13px]">Fiche marketing (bénéfices, claims, actifs, cible, angle)</summary>
        <div className="mt-2 space-y-2">
          <label className="block"><span className="label block mb-1">Bénéfices</span><textarea name="benefits" defaultValue={p?.benefits ?? ""} className="textarea min-h-[60px]" /></label>
          <label className="block"><span className="label block mb-1">Claims autorisés</span><textarea name="claims" defaultValue={p?.claims ?? ""} className="textarea min-h-[60px]" /></label>
          <label className="block"><span className="label block mb-1">Ingrédients / actifs</span><textarea name="actives" defaultValue={p?.actives ?? ""} className="textarea min-h-[60px]" /></label>
          <label className="block"><span className="label block mb-1">Cible</span><input name="target" defaultValue={p?.target ?? ""} className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">Angle marketing</span><input name="marketingAngle" defaultValue={p?.marketingAngle ?? ""} className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">URL photo</span><input name="imageUrl" defaultValue={p?.imageUrl ?? ""} className="input h-9" placeholder="https://…" /></label>
        </div>
      </details>
      <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Produit actif</label>
      <button className="btn-primary btn-sm w-full" type="submit">{p ? "Enregistrer" : "Créer le produit"}</button>
    </form>
  );
}
