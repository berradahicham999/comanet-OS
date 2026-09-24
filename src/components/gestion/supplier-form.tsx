import type { Brand } from "@/db/schema";
import type { PaymentMode } from "@/lib/gestion/refs";
import { SUPPLIER_NATURES } from "@/lib/gestion/suppliers";

type SupplierValues = {
  id?: string; code?: string | null; legalName?: string; nature?: string; ice?: string | null; ifNumber?: string | null; rc?: string | null;
  country?: string; currency?: string; address?: string | null; city?: string | null; contactName?: string | null; email?: string | null; phone?: string | null;
  paymentDays?: number | null; paymentModeKey?: string | null; notes?: string | null; brandIds?: string[];
};

/** Formulaire fournisseur (création et modification), rendu côté serveur. */
export function SupplierForm({ action, supplier, brands, paymentModes, readOnly = false, withDuplicateCheck = false }: {
  action: (fd: FormData) => Promise<void>;
  supplier?: SupplierValues;
  brands: Brand[];
  paymentModes: PaymentMode[];
  readOnly?: boolean;
  withDuplicateCheck?: boolean;
}) {
  const s = supplier ?? {};
  const field = (name: keyof SupplierValues, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label block mb-1">{label}</span><input name={name} defaultValue={(s[name] as string | number | null | undefined) ?? ""} className="input h-9" disabled={readOnly} {...extra} /></label>
  );
  return (
    <form action={action} className="space-y-4 text-[13px]">
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <fieldset className="grid sm:grid-cols-2 gap-2" disabled={readOnly}>
        <label className="block sm:col-span-2"><span className="label block mb-1">Raison sociale *</span><input name="legalName" defaultValue={s.legalName ?? ""} className="input h-9" required /></label>
        <label className="block"><span className="label block mb-1">Nature</span>
          <select name="nature" defaultValue={s.nature ?? "MARCHANDISES"} className="select h-9">
            {Object.entries(SUPPLIER_NATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {field("code", "Code fournisseur", { placeholder: "ex. F001" })}
        {field("ice", "ICE", { inputMode: "numeric" })}
        {field("ifNumber", "Identifiant fiscal (IF)")}
        {field("rc", "RC")}
        {field("country", "Pays")}
        <label className="block"><span className="label block mb-1">Devise</span>
          <select name="currency" defaultValue={s.currency ?? "MAD"} className="select h-9">{["MAD", "EUR", "USD", "GBP", "CHF"].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        {field("city", "Ville")}
        <label className="block sm:col-span-2"><span className="label block mb-1">Adresse</span><input name="address" defaultValue={s.address ?? ""} className="input h-9" /></label>
        {field("contactName", "Contact")}
        {field("phone", "Téléphone", { inputMode: "tel" })}
        {field("email", "E-mail", { type: "email" })}
        {field("paymentDays", "Délai de paiement (jours)", { inputMode: "numeric" })}
        <label className="block"><span className="label block mb-1">Mode de paiement</span>
          <select name="paymentModeKey" defaultValue={s.paymentModeKey ?? ""} className="select h-9">
            <option value="">—</option>
            {paymentModes.filter((m) => m.active || m.key === s.paymentModeKey).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </fieldset>
      <fieldset disabled={readOnly}>
        <span className="label block mb-1">Marques fournies</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {brands.filter((b) => b.active && !b.mergedIntoId).map((b) => (
            <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" name="brandIds" value={b.id} defaultChecked={s.brandIds?.includes(b.id)} /> {b.name}</label>
          ))}
        </div>
      </fieldset>
      <label className="block"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={s.notes ?? ""} className="textarea min-h-[60px]" disabled={readOnly} /></label>
      {withDuplicateCheck && <label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" name="confirmDuplicate" /> Créer quand même si un fournisseur au nom ou à l&apos;ICE identique existe</label>}
      {!readOnly && <button className="btn-primary btn-sm" type="submit">{s.id ? "Enregistrer" : "Créer le fournisseur"}</button>}
    </form>
  );
}
