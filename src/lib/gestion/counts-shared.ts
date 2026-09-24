/**
 * Inventaires — règles pures (partagé client / serveur, sans base) : statuts, compté d'une ligne
 * (somme des saisies), écart en quantité / valeur / %, fiabilité d'un inventaire, écart rapporté
 * aux sorties, écarts récurrents, et pistes d'explication d'un écart. Une piste sépare toujours la
 * DONNÉE (un fait mesuré dans la base) de l'HYPOTHÈSE (ce qu'elle pourrait expliquer) : rien n'est
 * présenté comme une cause certaine. L'écriture vit dans `counts.ts`.
 */
import { SCALE, formatScaled, parseDecimal, rescale, roundDiv } from "./money";

export const COUNT_STATUSES = ["BROUILLON", "EN_COURS", "VALIDE", "ANNULE"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export const COUNT_STATUS_META: Record<CountStatus, { label: string; tone: "gray" | "blue" | "green" | "red" }> = {
  BROUILLON: { label: "En préparation", tone: "gray" },
  EN_COURS: { label: "Comptage en cours", tone: "blue" },
  VALIDE: { label: "Validé", tone: "green" },
  ANNULE: { label: "Annulé", tone: "red" },
};

const q = (v: string | null | undefined) => parseDecimal(v ?? null, SCALE.qty);
const lotKey = (lot: string | null | undefined) => (lot ?? "").trim().toUpperCase();
/** Clé d'une ligne d'inventaire : article × lot (lot comparé sans casse ni espaces). */
export const countLineKey = (productId: string, lot: string | null | undefined) => `${productId}|${lotKey(lot)}`;

/** Compté par ligne = somme des saisies de tous les compteurs. Une ligne sans saisie n'est pas comptée (≠ 0). */
export function countedByLine(entries: { productId: string; lotNumber: string | null; quantity: string }[]): Map<string, string> {
  const m = new Map<string, bigint>();
  for (const e of entries) {
    const k = countLineKey(e.productId, e.lotNumber);
    m.set(k, (m.get(k) ?? 0n) + (q(e.quantity) ?? 0n));
  }
  return new Map([...m].map(([k, v]) => [k, formatScaled(v, SCALE.qty)]));
}

export type LineGap = { gapQty: string; gapValue: string | null; gapPct: number | null };

/** Écart = compté − théorique ; valeur au CMUP figé au démarrage ; % du théorique (— si théorique nul). */
export function lineGap(theoretical: string, counted: string, cmup: string | null): LineGap {
  const t = q(theoretical) ?? 0n, c = q(counted) ?? 0n;
  const g = c - t;
  const cm = parseDecimal(cmup, SCALE.cost);
  // qté (10³) × coût (10⁴) → montant (10²) : ÷ 10⁵.
  const value = cm === null ? null : formatScaled(roundDiv(g * cm, 10n ** 5n), SCALE.money);
  const pct = t === 0n ? null : Number(roundDiv(g * 10000n, t)) / 100;
  return { gapQty: formatScaled(g, SCALE.qty), gapValue: value, gapPct: pct };
}

export type CountStats = {
  lines: number; counted: number; uncounted: number; withGap: number;
  /** Part des lignes comptées sans écart (%). */
  accuracyLines: number | null;
  valueTheoretical: string; valueCounted: string;
  /** Somme des écarts en valeur (signée) et en valeur absolue. */
  gapValueNet: string; gapValueAbs: string;
  /** 1 − |écarts| ÷ valeur théorique (%), sur les lignes comptées valorisées. */
  accuracyValue: number | null;
  missingCost: number;
};

/** Chiffres d'un inventaire : sur les seules lignes comptées (une ligne non comptée n'est ni juste ni fausse). */
export function countStats(lines: { theoreticalQty: string; countedQty: string | null; cmup: string | null }[]): CountStats {
  let counted = 0, withGap = 0, missingCost = 0;
  let vt = 0n, vc = 0n, net = 0n, abs = 0n;
  for (const l of lines) {
    if (l.countedQty === null) continue;
    counted++;
    const t = q(l.theoreticalQty) ?? 0n, c = q(l.countedQty) ?? 0n;
    if (t !== c) withGap++;
    const cm = parseDecimal(l.cmup, SCALE.cost);
    if (cm === null) { if (t !== c) missingCost++; continue; }
    vt += roundDiv(t * cm, 10n ** 5n);
    vc += roundDiv(c * cm, 10n ** 5n);
    const g = roundDiv((c - t) * cm, 10n ** 5n);
    net += g;
    abs += g < 0n ? -g : g;
  }
  const f = (v: bigint) => formatScaled(v, SCALE.money);
  return {
    lines: lines.length, counted, uncounted: lines.length - counted, withGap,
    accuracyLines: counted ? Math.round(((counted - withGap) / counted) * 1000) / 10 : null,
    valueTheoretical: f(vt), valueCounted: f(vc), gapValueNet: f(net), gapValueAbs: f(abs),
    accuracyValue: vt > 0n ? Math.max(0, Number(roundDiv((vt - abs) * 1000n, vt)) / 10) : null,
    missingCost,
  };
}

/** Écart rapporté aux sorties de la période (%) : 2 manquants pour 400 sorties pèsent moins que 2 pour 10. */
export function gapOverOutflows(gapQty: string, outflowsQty: string): number | null {
  const g = q(gapQty) ?? 0n, o = q(outflowsQty) ?? 0n;
  if (o <= 0n) return null;
  return Number(roundDiv((g < 0n ? -g : g) * 10000n, o)) / 100;
}

/** Articles en écart dans au moins `min` inventaires validés distincts (écarts récurrents). */
export function recurringGaps(history: { productId: string; countId: string; gapQty: string }[], min: number): Map<string, number> {
  const m = new Map<string, Set<string>>();
  for (const h of history) {
    if ((q(h.gapQty) ?? 0n) === 0n) continue;
    const s = m.get(h.productId) ?? new Set<string>();
    s.add(h.countId);
    m.set(h.productId, s);
  }
  return new Map([...m].filter(([, s]) => s.size >= min).map(([k, s]) => [k, s.size]));
}

/* ------------------------------------------------------------------ */
/* Pistes d'explication d'un écart                                     */
/* ------------------------------------------------------------------ */

export type LeadCode = "BL_APRES_DEMARRAGE" | "BL_TARDIFS" | "RECEPTION_APRES_DEMARRAGE" | "COMMANDE_OUVERTE" | "RETOUR_SANS_STOCK" | "ECHANTILLONS" | "LOT_PERIME" | "MOUVEMENTS_PENDANT";
export type GapLead = { code: LeadCode; data: string; hypothesis: string };

/** Faits mesurés pour un article en écart (tous en quantités, texte décimal ; 0 = rien trouvé). */
export type GapFacts = {
  gapQty: string;
  /** BL datés au plus tard du jour du comptage mais validés après son démarrage (non inclus dans le théorique figé). */
  blAfterStart: { count: number; qty: string };
  /** BL de la période validés plus de N heures après leur date. */
  lateBls: { count: number; hours: number };
  /** Réceptions datées au plus tard du jour du comptage mais validées après son démarrage. */
  receptionsAfterStart: { count: number; qty: string };
  /** Reste à recevoir de commandes ouvertes (livraison possiblement arrivée, non réceptionnée). */
  openOrdersQty: string;
  /** Avoirs de la période sans retour en stock (motif « sans retour ») sur cet article. */
  creditsWithoutReturnQty: string;
  /** Échantillons remis aux délégués sur la période moins les sorties « échantillon » du journal. */
  samplesWithoutMovementQty: string;
  /** Lot périmé au jour du comptage (pour une ligne de lot). */
  expiredLot: { lot: string; expiry: string } | null;
  /** Mouvements du journal sur l'article depuis le démarrage du comptage. */
  movementsSinceStart: number;
};

const n = (v: string) => q(v) ?? 0n;
const fmt = (v: string) => formatScaled(rescale(n(v) < 0n ? -n(v) : n(v), SCALE.qty, SCALE.qty), SCALE.qty).replace(/\.?0+$/, "").replace(".", ",");

/**
 * Pistes pour un écart, dans l'ordre où les vérifier. Une piste n'est proposée que si sa donnée
 * existe ET va dans le sens de l'écart (un manquant ne s'explique pas par une réception oubliée).
 */
export function gapLeads(f: GapFacts): GapLead[] {
  const g = n(f.gapQty);
  if (g === 0n) return [];
  const missing = g < 0n;
  const out: GapLead[] = [];
  if (missing && f.blAfterStart.count > 0) out.push({
    code: "BL_APRES_DEMARRAGE",
    data: `${f.blAfterStart.count} BL daté(s) au plus tard du jour du comptage, validé(s) après son démarrage (${fmt(f.blAfterStart.qty)} u.).`,
    hypothesis: "La marchandise est sortie avant le comptage mais le BL n'était pas encore validé : le théorique figé la comptait encore. Le manquant peut n'être qu'apparent.",
  });
  if (missing && f.lateBls.count > 0) out.push({
    code: "BL_TARDIFS",
    data: `${f.lateBls.count} BL de la période validé(s) plus de ${f.lateBls.hours} h après leur date.`,
    hypothesis: "Des sorties physiques précèdent leur saisie : un BL encore en brouillon au moment du comptage expliquerait un manquant.",
  });
  if (!missing && f.receptionsAfterStart.count > 0) out.push({
    code: "RECEPTION_APRES_DEMARRAGE",
    data: `${f.receptionsAfterStart.count} réception(s) datée(s) au plus tard du jour du comptage, validée(s) après son démarrage (${fmt(f.receptionsAfterStart.qty)} u.).`,
    hypothesis: "La marchandise était en rayon mais absente du théorique figé : le surplus peut n'être qu'apparent.",
  });
  if (!missing && n(f.openOrdersQty) > 0n) out.push({
    code: "COMMANDE_OUVERTE",
    data: `${fmt(f.openOrdersQty)} u. encore attendue(s) sur des commandes fournisseurs ouvertes.`,
    hypothesis: "Une livraison est peut-être arrivée sans avoir été réceptionnée dans l'application.",
  });
  if (!missing && n(f.creditsWithoutReturnQty) > 0n) out.push({
    code: "RETOUR_SANS_STOCK",
    data: `${fmt(f.creditsWithoutReturnQty)} u. créditée(s) par avoir sans retour en stock sur la période.`,
    hypothesis: "Le client a peut-être rendu la marchandise alors que l'avoir a été fait « sans retour ».",
  });
  if (missing && n(f.samplesWithoutMovementQty) > 0n) out.push({
    code: "ECHANTILLONS",
    data: `${fmt(f.samplesWithoutMovementQty)} u. remise(s) aux délégués en échantillons sans sortie « échantillon » au journal.`,
    hypothesis: "Des échantillons ont quitté l'entrepôt sans mouvement de stock.",
  });
  if (missing && f.expiredLot) out.push({
    code: "LOT_PERIME",
    data: `Lot ${f.expiredLot.lot} périmé depuis le ${f.expiredLot.expiry.split("-").reverse().join("/")}.`,
    hypothesis: "Le lot a peut-être été détruit ou mis de côté sans déclaration « casse / périmé ».",
  });
  if (f.movementsSinceStart > 0) out.push({
    code: "MOUVEMENTS_PENDANT",
    data: `${f.movementsSinceStart} mouvement(s) de stock sur cet article depuis le démarrage du comptage.`,
    hypothesis: "Le stock a bougé pendant le comptage : vérifiez si la saisie a été faite avant ou après ces mouvements.",
  });
  return out;
}
