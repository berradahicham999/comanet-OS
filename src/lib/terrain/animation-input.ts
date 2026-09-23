/**
 * SAISIE D'UNE ANIMATION — décision pure, sans base de données.
 *
 * Tout ce qui décide (validation, normalisation, valorisation, clé de déduplication) vit ici
 * et se teste sans Postgres. La server action ne garde que les allers-retours en base et
 * l'orchestration. C'est le découpage de `medical/visits.ts`, appliqué au terrain.
 *
 * Le comportement reproduit ici est EXACTEMENT celui de `saveAnimation` au 7 septembre 2026 :
 * ces fonctions ont été extraites avant d'être refactorées, et `tests/animation-input.test.ts`
 * fige ce comportement pour que la mise en transaction ne le déplace pas.
 */
import { animationKey, normalizeCity } from "@/lib/animations-shared";
import { lineSellout, toFiniteNumber } from "@/lib/sellout";

export type AnimationStatus = "PLANNED" | "DONE" | "CANCELLED";

/** Codes rendus à l'écran — voir `ANIMATION_ERRORS` dans `animations-shared.ts`. */
export type AnimationErrorCode = "client" | "date" | "periode" | "jours" | "nombre" | "quantite" | "stock";

/** Ce que le formulaire envoie, en chaînes brutes. */
export type RawAnimationInput = {
  clientId: string;
  /** Date de fin : le jour du relevé des ventes. */
  date: string;
  /** Date de début (« Du »). Vide ou absente → même jour que la fin. */
  startDate?: string;
  /** Jours réellement animés sur la période. Vide ou absent → tous les jours de la période. */
  days?: string;
  status: string;
  animatriceId: string | null;
  brandId: string | null;
  cost: string;
  durationHours: string;
  customersAdvised: string;
  samples: string;
  comment: string;
  photoUrl: string;
  lines: { productId: string; qty: string; stock: string }[];
};

export type AnimationLineInput = {
  productId: string;
  quantitySold: number;
  stockObserved: number | null;
};

export type ParsedAnimation = {
  clientId: string;
  /** Dernier jour (relevé des ventes). */
  date: string;
  /** Premier jour, toujours renseigné à la saisie (= `date` pour une animation d'un jour). */
  startDate: string;
  /** Jours animés, entre 1 et la longueur de la période. */
  days: number;
  status: AnimationStatus;
  animatriceId: string | null;
  brandId: string | null;
  cost: number;
  durationHours: number | null;
  customersAdvised: number;
  samples: number;
  comment: string | null;
  photoUrl: string | null;
  lines: AnimationLineInput[];
};

export type ParseResult = { ok: true; value: ParsedAnimation } | { ok: false; error: AnimationErrorCode };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Période la plus longue acceptée pour une seule saisie. Au-delà, c'est une erreur de date. */
export const MAX_ANIMATION_SPAN_DAYS = 31;

const isIsoDate = (d: string) => ISO_DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/** Nombre de jours calendaires de `start` à `end` inclus (1 pour le même jour). */
export function periodSpan(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Nombre d'en-tête : vide → `null` (absent), illisible ou négatif → `undefined` (refusé).
 * Une valeur illisible n'est JAMAIS convertie en 0.
 */
function headerNumber(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  const n = toFiniteNumber(v);
  if (n === null || n < 0) return undefined;
  return n;
}

/**
 * Entier ≥ 0, ou `undefined` si la saisie est illisible ou hors bornes.
 * Réservé aux quantités des LIGNES produit : une demi-unité vendue n'existe pas.
 */
function lineCount(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v === "") return null;
  const n = toFiniteNumber(v);
  if (n === null || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Valide et normalise une saisie. Aucune valeur inventée : ce qui est illisible est refusé
 * avec un code d'erreur explicite, jamais remplacé par un zéro silencieux.
 */
export function parseAnimationInput(raw: RawAnimationInput): ParseResult {
  const clientId = raw.clientId.trim();
  if (!clientId) return { ok: false, error: "client" };

  const date = raw.date.trim();
  if (!isIsoDate(date)) return { ok: false, error: "date" };

  // Période « Du … au … » : les ventes sont relevées le dernier jour, la date de fin reste `date`.
  const startDate = raw.startDate?.trim() || date;
  if (!isIsoDate(startDate)) return { ok: false, error: "date" };
  const span = periodSpan(startDate, date);
  if (span < 1 || span > MAX_ANIMATION_SPAN_DAYS) return { ok: false, error: "periode" };
  // Jours animés : un jour de repos au milieu de la période se retire ici, jamais en devinant.
  let days = span;
  const rawDays = raw.days?.trim() ?? "";
  if (rawDays !== "") {
    const n = toFiniteNumber(rawDays);
    if (n === null || !Number.isInteger(n) || n < 1 || n > span) return { ok: false, error: "jours" };
    days = n;
  }

  const status: AnimationStatus = (["PLANNED", "DONE", "CANCELLED"] as const).includes(raw.status as AnimationStatus)
    ? (raw.status as AnimationStatus)
    : "DONE";

  const cost = headerNumber(raw.cost);
  const durationHours = headerNumber(raw.durationHours);
  // Clientes conseillées et échantillons acceptent une décimale à la saisie et sont arrondis
  // à l'écriture — comportement d'origine, conservé tel quel par le refactoring.
  const customersAdvised = headerNumber(raw.customersAdvised);
  const samples = headerNumber(raw.samples);
  if (cost === undefined || durationHours === undefined || customersAdvised === undefined || samples === undefined) {
    return { ok: false, error: "nombre" };
  }

  const lines: AnimationLineInput[] = [];
  for (const l of raw.lines) {
    const productId = l.productId.trim();
    if (!productId) continue;

    // Quantité : entier ≥ 0. Une quantité négative n'est pas une vente.
    let quantitySold = 0;
    if (l.qty.trim() !== "") {
      const v = lineCount(l.qty);
      if (v === undefined) return { ok: false, error: "quantite" };
      quantitySold = v ?? 0;
    }
    let stockObserved: number | null = null;
    if (l.stock.trim() !== "") {
      const v = lineCount(l.stock);
      if (v === undefined) return { ok: false, error: "stock" };
      stockObserved = v;
    }
    // Une ligne sans vente ET sans stock constaté n'apporte rien : elle est ignorée,
    // comme à l'import qui ne retient que les colonnes portant une quantité.
    if (quantitySold === 0 && stockObserved === null) continue;
    lines.push({ productId, quantitySold, stockObserved });
  }

  return {
    ok: true,
    value: {
      clientId, date, startDate, days, status,
      animatriceId: raw.animatriceId?.trim() || null,
      brandId: raw.brandId?.trim() || null,
      cost: cost ?? 0,
      durationHours,
      customersAdvised: Math.round(customersAdvised ?? 0),
      samples: Math.round(samples ?? 0),
      comment: raw.comment.trim() || null,
      photoUrl: raw.photoUrl.trim() || null,
      lines,
    },
  };
}

/**
 * Clé de déduplication d'une animation — LA MÊME que celle de l'import.
 *
 * Sémantique figée en Phase 0 : `date | ville | point de vente | animatrice`, chaque partie
 * normalisée par `animationKey()`. Le point de vente est le nom canonique du client et
 * l'animatrice son nom d'utilisateur : c'est ce que l'import a sous la main dans son fichier.
 */
export function animationDedupeKey(p: {
  date: string;
  clientCity: string | null;
  clientName: string;
  animatriceName: string | null;
}): string {
  return animationKey({
    date: p.date,
    city: normalizeCity(p.clientCity),
    pos: p.clientName,
    animatrice: p.animatriceName,
  });
}

export type ValuedLine = AnimationLineInput & {
  unitPrice: number | null;
  amount: number | null;
  /** `false` quand des unités ont été vendues sans qu'aucun prix fiable ne soit connu. */
  measurable: boolean;
};

/**
 * Valorisation officielle des lignes (voir `src/lib/sellout.ts`).
 * Sans prix public connu, le montant reste `null` — jamais 0 — et l'écran le signale.
 */
export function valueAnimationLines(
  lines: AnimationLineInput[],
  priceByProduct: Map<string, unknown>,
): { valued: ValuedLine[]; missingPrice: boolean } {
  const valued = lines.map((l) => {
    const s = lineSellout({ quantitySold: l.quantitySold, productPriceRetail: priceByProduct.get(l.productId) ?? null });
    return { ...l, unitPrice: s.unitPrice, amount: s.amount, measurable: !(l.quantitySold > 0 && s.amount === null) };
  });
  return { valued, missingPrice: valued.some((v) => !v.measurable) };
}
