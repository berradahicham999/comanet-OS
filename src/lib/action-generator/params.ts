/**
 * Paramètres d'URL du générateur (assistant, fiche d'option, ajout au plan) — partagés client / serveur.
 * Une proposition se reconstruit à l'identique à partir de ces paramètres : rien n'est stocké avant « Ajouter au plan ».
 */
import { AXIS_KEYS, OBJECTIVE_KEYS, TARGET_KEYS } from "./catalog";
import type { AxisKey, GeneratorInput, ObjectiveKey, TargetKey } from "./types";

export type GeneratorParams = { brand?: string; objectif?: string; levier?: string; budget?: string; mois?: string; cible?: string; produit?: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** `null` tant que la marque n'est pas choisie. */
export function parseGeneratorParams(sp: GeneratorParams, defaults: { month: string }): GeneratorInput | null {
  if (!sp.brand || !UUID.test(sp.brand)) return null;
  const objective = (OBJECTIVE_KEYS as string[]).includes(sp.objectif ?? "") ? (sp.objectif as ObjectiveKey) : "SELL_OUT";
  const axis = (AXIS_KEYS as string[]).includes(sp.levier ?? "") ? (sp.levier as AxisKey) : null;
  const target = (TARGET_KEYS as string[]).includes(sp.cible ?? "") ? (sp.cible as TargetKey) : "FEMMES_25_45";
  const raw = String(sp.budget ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  const n = raw === "" ? NaN : Number(raw);
  const budget = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  const month = /^\d{4}-\d{2}$/.test(sp.mois ?? "") ? `${sp.mois}-01` : /^\d{4}-\d{2}-01$/.test(sp.mois ?? "") ? sp.mois! : defaults.month;
  const productId = sp.produit && UUID.test(sp.produit) ? sp.produit : null;
  return { brandId: sp.brand, objective, axis, budget, month, target, productId };
}

export function generatorQuery(i: GeneratorInput): string {
  const p = new URLSearchParams({ brand: i.brandId, objectif: i.objective, mois: i.month.slice(0, 7), cible: i.target });
  if (i.axis) p.set("levier", i.axis);
  if (i.budget !== null) p.set("budget", String(i.budget));
  if (i.productId) p.set("produit", i.productId);
  return p.toString();
}
