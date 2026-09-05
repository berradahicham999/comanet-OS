import type { RegulatoryFile } from "@/db/schema";
import { saveRegulatoryFile } from "@/app/(app)/reglementaire/actions";

export const REG_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "orange" | "red" }> = {
  A_DEPOSER: { label: "À déposer", tone: "gray" },
  EN_COURS: { label: "En cours d'instruction", tone: "blue" },
  VALIDE: { label: "Valide", tone: "green" },
  RENOUVELLEMENT: { label: "Renouvellement à lancer", tone: "orange" },
  EXPIRE: { label: "Expiré", tone: "red" },
};

export function RegulatoryForm({ file, products, brands, users, defaults }: {
  file?: RegulatoryFile | null;
  products: { id: string; name: string; brandId: string | null }[];
  brands: { id: string; name: string }[];
  users: { id: string; name: string; role: string }[];
  defaults?: { productId?: string };
}) {
  const f = file;
  return (
    <form action={saveRegulatoryFile} className="space-y-2 text-[13px]">
      {f && <input type="hidden" name="id" value={f.id} />}
      <label className="block"><span className="label block mb-1">Produit</span>
        <select name="productId" defaultValue={f?.productId ?? defaults?.productId ?? ""} className="select h-9"><option value="">— (dossier marque)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label block mb-1">Marque</span>
          <select name="brandId" defaultValue={f?.brandId ?? ""} className="select h-9"><option value="">Auto (marque du produit)</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Statut</span>
          <select name="status" defaultValue={f?.status ?? "EN_COURS"} className="select h-9">{Object.entries(REG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label className="block col-span-2"><span className="label block mb-1">Dossier / type d&apos;autorisation</span><input name="dossier" defaultValue={f?.dossier ?? ""} className="input h-9" placeholder="ex: Enregistrement produit cosmétique, Autorisation complément alimentaire…" required /></label>
        <label className="block col-span-2"><span className="label block mb-1">N° d&apos;autorisation</span><input name="authorizationNumber" defaultValue={f?.authorizationNumber ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Date de dépôt</span><input type="date" name="filingDate" defaultValue={f?.filingDate ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Date de validation</span><input type="date" name="validationDate" defaultValue={f?.validationDate ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Date d&apos;expiration</span><input type="date" name="expiryDate" defaultValue={f?.expiryDate ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Responsable</span>
          <select name="responsibleId" defaultValue={f?.responsibleId ?? users.find((u) => u.role === "REGLEMENTAIRE")?.id ?? ""} className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </label>
      </div>
      <label className="block"><span className="label block mb-1">Documents manquants</span><input name="missingDocuments" defaultValue={f?.missingDocuments ?? ""} className="input h-9" placeholder="ex: CPSR, certificat de vente libre…" /></label>
      <label className="block"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={f?.notes ?? ""} className="textarea min-h-[60px]" /></label>
      <button className="btn-primary btn-sm w-full" type="submit">{f ? "Enregistrer" : "Créer le dossier"}</button>
    </form>
  );
}
