import type { AuditRow } from "@/lib/audit";
import { fmtDate, fmtTime } from "@/lib/format";

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Création", UPDATE: "Modification", ARCHIVE: "Archivage", RESTORE: "Restauration", DELETE: "Suppression",
  BLOCK: "Blocage", UNBLOCK: "Déblocage", ADD_ADDRESS: "Adresse de livraison ajoutée", REMOVE_ADDRESS: "Adresse de livraison retirée",
  BRAND_DISCOUNT: "Remise par marque", SET_NEXT_NUMBER: "Prochain numéro réglé", MOVEMENT: "Mouvement de stock", SETTINGS: "Paramètres",
  VALIDATE: "Validation", DELIVER: "Livraison confirmée", CANCEL: "Annulation", APPROVAL_REQUESTED: "Déblocage demandé",
  RENAME_CLIENT: "Nom du client corrigé", START: "Démarrage du comptage", ZERO_UNCOUNTED: "Non comptés mis à zéro", CLOSE: "Solde",
};

/** Libellés des champs pour un historique lisible. */
const FIELD_LABELS: Record<string, string> = {
  name: "nom", legalName: "raison sociale", accountCode: "code client", ice: "ICE", ifNumber: "IF", rc: "RC", patente: "patente",
  billingAddress: "adresse", postalCode: "code postal", city: "ville", sector: "secteur", phone: "téléphone", email: "e-mail", contactName: "contact",
  accountManagerId: "commercial attitré", defaultDiscountPct: "remise", paymentModeKey: "mode de paiement", paymentDays: "délai de paiement",
  creditLimit: "plafond d'encours", type: "type", blocked: "blocage", reason: "motif", code: "code", nature: "nature", currency: "devise",
  country: "pays", notes: "notes", brandIds: "marques", pct: "remise", next: "prochain numéro", ean: "EAN", kind: "nature",
  taxRateKey: "TVA", unit: "unité", packSize: "colisage", trackLots: "suivi des lots", address: "adresse",
  lines: "lignes", netHtMad: "HT MAD", netHt: "net HT", ttc: "TTC",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? `${v.length} élément(s)` : typeof v === "object" ? "…" : String(v));

function summary(row: AuditRow): string | null {
  const after = (row.newValue ?? {}) as Record<string, unknown>;
  const before = (row.oldValue ?? {}) as Record<string, unknown>;
  if (row.action === "RENAME_CLIENT") {
    const a = after as { legalName?: string; reason?: string }, b = before as { legalName?: string };
    return `${b.legalName ?? "—"} → ${a.legalName ?? "—"}${a.reason ? ` (motif : ${a.reason})` : ""}`;
  }
  if (row.action !== "UPDATE" && row.action !== "BRAND_DISCOUNT" && row.action !== "SET_NEXT_NUMBER" && row.action !== "BLOCK" && row.action !== "UNBLOCK") return null;
  const keys = Object.keys(after);
  if (!keys.length) return null;
  return keys.slice(0, 6).map((k) => `${FIELD_LABELS[k] ?? k} : ${show(before[k])} → ${show(after[k])}`).join(" · ") + (keys.length > 6 ? ` · +${keys.length - 6}` : "");
}

/** Historique d'une fiche (journal d'audit), du plus récent au plus ancien. */
export function AuditTrail({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <div className="text-[13px] text-muted">Aucune modification enregistrée depuis l&apos;ouverture de la gestion commerciale.</div>;
  return (
    <ol className="space-y-2 text-[12.5px]">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-line pl-3">
          <div><b>{ACTION_LABELS[r.action] ?? r.action}</b> <span className="text-muted">par {r.actorName}, le {fmtDate(r.createdAt)} à {fmtTime(r.createdAt)}</span></div>
          {summary(r) && <div className="text-muted mt-0.5 break-words">{summary(r)}</div>}
        </li>
      ))}
    </ol>
  );
}
