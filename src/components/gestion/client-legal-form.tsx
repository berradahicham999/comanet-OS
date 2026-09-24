import type { Client } from "@/db/schema";
import type { PaymentMode } from "@/lib/gestion/refs";
import { SECTORS, cityToSector } from "@/lib/sectors";

/**
 * Identité légale et conditions commerciales d'un client (onglet « Identité & conditions »).
 * Formulaire serveur : chaque enregistrement ne journalise que les champs modifiés.
 */
export function ClientLegalForm({ client, users, paymentModes, action, readOnly, maxPaymentDays, defaultPaymentDays }: {
  client: Client;
  users: { id: string; name: string }[];
  paymentModes: PaymentMode[];
  action: (fd: FormData) => Promise<void>;
  readOnly: boolean;
  maxPaymentDays: number;
  defaultPaymentDays: number;
}) {
  const c = client;
  const input = (name: keyof Client, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, span = false) => (
    <label className={span ? "block sm:col-span-2" : "block"}>
      <span className="label block mb-1">{label}</span>
      <input name={name} defaultValue={(c[name] as string | number | null) ?? ""} className="input h-9" {...extra} />
    </label>
  );
  return (
    <form action={action} className="space-y-5 text-[13px]">
      <input type="hidden" name="id" value={c.id} />
      <fieldset disabled={readOnly} className="space-y-5">
        <div>
          <div className="text-[13px] font-semibold mb-2">Identité légale <span className="font-normal text-muted">— imprimée sur les pièces</span></div>
          <div className="grid sm:grid-cols-2 gap-2">
            {input("legalName", "Raison sociale *", { placeholder: "ex. PHARMACIE AL AMAL SARL" })}
            {input("name", "Nom commercial (point de vente) *", { required: true })}
            {input("accountCode", "Code client Sage COMANET", { placeholder: "ex. 056" })}
            {input("ice", "ICE * (15 chiffres)", { inputMode: "numeric", pattern: "[0-9 .\\-]*", title: "15 chiffres (espaces et points tolérés)" })}
            {input("ifNumber", "Identifiant fiscal (IF)")}
            {input("rc", "RC")}
            {input("patente", "Patente / TP")}
            <label className="block"><span className="label block mb-1">Type</span>
              <select name="type" defaultValue={c.type} className="select h-9"><option value="PHARMACIE">Pharmacie</option><option value="PARAPHARMACIE">Parapharmacie</option><option value="GROSSISTE">Grossiste</option><option value="AUTRE">Autre</option></select>
            </label>
            {input("billingAddress", "Adresse de facturation *", {}, true)}
            {input("postalCode", "Code postal")}
            {input("city", "Ville *")}
            <label className="block"><span className="label block mb-1">Secteur</span>
              <select name="sector" defaultValue={c.sector ?? ""} className="select h-9">
                <option value="">{cityToSector(c.city) ? `Auto (${cityToSector(c.city)})` : "Auto — d'après la ville"}</option>
                {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div>
          <div className="text-[13px] font-semibold mb-2">Contact</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {input("contactName", "Contact")}
            {input("phone", "Téléphone", { inputMode: "tel" })}
            {input("email", "E-mail", { type: "email" }, true)}
          </div>
        </div>
        <div>
          <div className="text-[13px] font-semibold mb-2">Conditions commerciales</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="block"><span className="label block mb-1">Commercial attitré</span>
              <select name="accountManagerId" defaultValue={c.accountManagerId ?? ""} className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
            {input("defaultDiscountPct", "Remise par défaut (%)", { type: "number", min: 0, max: 99.99, step: 0.01, placeholder: "ex. 25" })}
            <label className="block"><span className="label block mb-1">Mode de paiement</span>
              <select name="paymentModeKey" defaultValue={c.paymentModeKey ?? ""} className="select h-9"><option value="">—</option>{paymentModes.filter((m) => m.active || m.key === c.paymentModeKey).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
            </label>
            {input("paymentDays", `Délai de paiement (jours, ≤ ${maxPaymentDays})`, { type: "number", min: 0, max: maxPaymentDays, step: 1, placeholder: `défaut : ${defaultPaymentDays}` })}
            {input("creditLimit", "Plafond d'encours (MAD TTC)", { type: "number", min: 0, step: 0.01 })}
          </div>
          <p className="text-[11.5px] text-faint mt-1">La remise par défaut se préremplira sur les bons de livraison (lot 2) ; une remise par marque, plus bas, la remplace pour les articles de cette marque.</p>
        </div>
      </fieldset>
      {!readOnly && <button className="btn-primary btn-sm" type="submit">Enregistrer</button>}
    </form>
  );
}
