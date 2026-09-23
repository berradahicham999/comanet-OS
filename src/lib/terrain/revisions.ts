/**
 * HISTORIQUE D'UN RAPPORT D'ANIMATION — décision pure, sans base de données.
 *
 * Compare deux photos d'un rapport (avant / après correction) et rend la liste lisible des
 * champs modifiés : « Vendu — Gamarde crème : 8 → 6 ». Les valeurs sont mises en forme ici,
 * une fois pour toutes : l'historique affiche ce qui était écrit à l'époque, même si un
 * produit ou un point de vente est renommé ensuite.
 */
import { fmtAnimationPeriod } from "@/lib/animations-shared";

export type RevisionAction = "CREATION" | "MODIFICATION" | "SUPPRESSION";
export type RevisionChange = { label: string; before: string | null; after: string | null };

/** Photo d'un rapport, noms résolus. */
export type AnimationSnapshot = {
  startDate: string | null;
  date: string;
  days: number;
  status: string;
  clientName: string;
  animatriceName: string | null;
  brandName: string | null;
  cost: number;
  durationHours: number | null;
  customersAdvised: number;
  samples: number;
  comment: string | null;
  photoUrl: string | null;
  /** Par produit (nom) : vendu et stock rayon. */
  lines: Record<string, { sold: number; stock: number | null }>;
};

const STATUS_LABEL: Record<string, string> = { DONE: "Réalisée", PLANNED: "Prévue", CANCELLED: "Annulée" };

const txt = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : String(v));

/** Rappel d'une ligne : « LA GLOIRE — 18 sept. → 20 sept. · 3 j — Meriem ». */
export function snapshotSummary(s: AnimationSnapshot): string {
  return [s.clientName, fmtAnimationPeriod(s.startDate, s.date, s.days), s.animatriceName].filter(Boolean).join(" — ");
}

/** Champs modifiés entre deux photos, dans l'ordre du formulaire. Vide si rien n'a changé. */
export function diffAnimation(before: AnimationSnapshot, after: AnimationSnapshot): RevisionChange[] {
  const out: RevisionChange[] = [];
  const push = (label: string, b: string | null, a: string | null) => { if (b !== a) out.push({ label, before: b, after: a }); };

  push("Période", fmtAnimationPeriod(before.startDate, before.date, before.days), fmtAnimationPeriod(after.startDate, after.date, after.days));
  push("Statut", STATUS_LABEL[before.status] ?? before.status, STATUS_LABEL[after.status] ?? after.status);
  push("Point de vente", before.clientName, after.clientName);
  push("Animatrice", txt(before.animatriceName), txt(after.animatriceName));
  push("Marque", txt(before.brandName), txt(after.brandName));
  push("Coût", txt(before.cost), txt(after.cost));
  push("Durée (h)", txt(before.durationHours), txt(after.durationHours));
  push("Clientes conseillées", txt(before.customersAdvised), txt(after.customersAdvised));
  push("Échantillons", txt(before.samples), txt(after.samples));
  push("Commentaire", txt(before.comment), txt(after.comment));
  push("Photo", txt(before.photoUrl), txt(after.photoUrl));

  const products = [...new Set([...Object.keys(before.lines), ...Object.keys(after.lines)])].sort((a, b) => a.localeCompare(b, "fr"));
  for (const p of products) {
    const b = before.lines[p], a = after.lines[p];
    push(`Vendu — ${p}`, b ? String(b.sold) : null, a ? String(a.sold) : null);
    push(`Rayon — ${p}`, txt(b?.stock), txt(a?.stock));
  }
  return out;
}
