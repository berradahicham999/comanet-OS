import type { RegulatoryFile } from "@/db/schema";
import { saveRegulatoryFile } from "@/app/(app)/reglementaire/actions";
import { CERTIFICATE_STATUS, DOCUMENT_TYPES, PACKAGINGS, VARIANT_TYPES } from "@/lib/regulatory";

export const REG_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "orange" | "red" }> = {
  A_DEPOSER: { label: "Non déposé", tone: "gray" },
  EN_COURS: { label: "Déposé — en instruction", tone: "blue" },
  VALIDE: { label: "Enregistré", tone: "green" },
  RENOUVELLEMENT: { label: "Redépôt en cours", tone: "orange" },
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
    <form action={saveRegulatoryFile} className="space-y-3 text-[13px]">
      {f && <input type="hidden" name="id" value={f.id} />}

      <div className="grid grid-cols-2 gap-2">
        <label className="block col-span-2"><span className="label block mb-1">Référence déposée <span className="text-red">*</span></span>
          <input name="reference" defaultValue={f?.reference ?? f?.dossier ?? ""} className="input h-9" placeholder="ex : ALPHABRIGHT SERUM" required />
        </label>
        <label className="block"><span className="label block mb-1">Type de dépôt</span>
          <select name="variantType" defaultValue={f?.variantType ?? "MODELE_VENTE"} className="select h-9">{Object.entries(VARIANT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Contenance</span><input name="size" defaultValue={f?.size ?? ""} className="input h-9" placeholder="30 ml" /></label>
        <label className="block"><span className="label block mb-1">Format</span>
          <select name="packaging" defaultValue={f?.packaging ?? ""} className="select h-9"><option value="">—</option>{Object.entries(PACKAGINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Marque</span>
          <select name="brandId" defaultValue={f?.brandId ?? ""} className="select h-9"><option value="">Auto (marque du produit)</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="block col-span-2"><span className="label block mb-1">Produit du référentiel (facultatif)</span>
          <select name="productId" defaultValue={f?.productId ?? defaults?.productId ?? ""} className="select h-9"><option value="">— non rattaché</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span className="text-[11px] text-faint block mt-0.5">Le rattachement permet de retrouver le dossier depuis la fiche produit.</span>
        </label>
      </div>

      <div className="border-t border-line pt-3 grid grid-cols-2 gap-2">
        <div className="col-span-2 label">Dépôt DMP</div>
        <label className="block"><span className="label block mb-1">État</span>
          <select name="status" defaultValue={f?.status ?? "EN_COURS"} className="select h-9">{Object.entries(REG_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Pièce délivrée</span>
          <select name="documentType" defaultValue={f?.documentType ?? "ATD"} className="select h-9">{Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">Date de dépôt</span><input type="date" name="filingDate" defaultValue={f?.filingDate ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Fin de validité</span><input type="date" name="expiryDate" defaultValue={f?.expiryDate ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">N° ATD / autorisation</span><input name="authorizationNumber" defaultValue={f?.authorizationNumber ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Échantillon physique</span>
          <select name="physicalProduct" defaultValue={f?.physicalProduct === null || f?.physicalProduct === undefined ? "" : String(f.physicalProduct)} className="select h-9">
            <option value="">Inconnu</option><option value="true">Oui</option><option value="false">Non</option>
          </select>
        </label>
      </div>

      <div className="border-t border-line pt-3 grid grid-cols-2 gap-2">
        <div className="col-span-2 label">Certificat d&apos;enregistrement (CE)</div>
        <label className="block col-span-2"><span className="label block mb-1">Étape</span>
          <select name="certificateStatus" defaultValue={f?.certificateStatus ?? "A_DEMANDER"} className="select h-9">{Object.entries(CERTIFICATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </label>
        <label className="block"><span className="label block mb-1">N° de CE</span><input name="certificateNumber" defaultValue={f?.certificateNumber ?? ""} className="input h-9" /></label>
        <label className="block"><span className="label block mb-1">Date du CE</span><input type="date" name="certificateDate" defaultValue={f?.certificateDate ?? ""} className="input h-9" /></label>
      </div>

      <div className="border-t border-line pt-3 space-y-2">
        <label className="block"><span className="label block mb-1">Documents manquants</span><input name="missingDocuments" defaultValue={f?.missingDocuments ?? ""} className="input h-9" placeholder="ex : CVL légalisé, formule quantitative, étiquetage…" /></label>
        <label className="block"><span className="label block mb-1">Responsable</span>
          <select name="responsibleId" defaultValue={f?.responsibleId ?? users.find((u) => u.role === "REGLEMENTAIRE")?.id ?? ""} className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </label>
        <label className="flex items-start gap-2"><input type="checkbox" name="blocked" defaultChecked={f?.blocked ?? false} className="mt-1" /><span><b>Dossier bloqué</b> — enregistrement impossible en l&apos;état (formule ou ingrédient non conforme). Le dossier sort des alertes d&apos;échéance et reste listé à part.</span></label>
        <label className="block"><span className="label block mb-1">Motif du blocage</span><input name="blockedReason" defaultValue={f?.blockedReason ?? ""} className="input h-9" placeholder="ex : présence d'un ingrédient non autorisé" /></label>
        <label className="block"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={f?.notes ?? ""} className="textarea min-h-[70px]" /></label>
        <input type="hidden" name="dossier" value={f?.dossier ?? ""} />
      </div>

      <button className="btn-primary btn-sm w-full" type="submit">{f ? "Enregistrer" : "Créer le dossier"}</button>
    </form>
  );
}
