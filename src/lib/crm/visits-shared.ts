/**
 * CRM commercial — visites : libellés et règles pures (sans base, importables côté client).
 * Le contrôle de présence n'est pas redéfini ici : c'est `verifyVisit()` (`src/lib/medical/gps-shared.ts`),
 * appelé avec la position du point de vente et les seuils de `settings.crm`.
 */
import type { CrmSettings } from "@/lib/settings";

export type ClientVisitStatus = "PLANIFIEE" | "EN_COURS" | "EFFECTUEE" | "NON_EFFECTUEE" | "ANNULEE";
export type ClientVisitKind = "VISITE" | "APPEL" | "MESSAGE";

export const VISIT_STATUS_LABELS: Record<ClientVisitStatus, string> = {
  PLANIFIEE: "Planifiée",
  EN_COURS: "En cours",
  EFFECTUEE: "Effectuée",
  NON_EFFECTUEE: "Non effectuée",
  ANNULEE: "Annulée",
};

export const VISIT_KIND_LABELS: Record<ClientVisitKind, string> = {
  VISITE: "Visite",
  APPEL: "Appel",
  MESSAGE: "Message (WhatsApp, e-mail)",
};

export const NOT_DONE_REASONS = ["Point de vente fermé", "Responsable absent", "Pas reçu (trop d'attente)", "Refus de recevoir"];

/** Résultats proposés au compte rendu (texte libre accepté en plus). */
export const VISIT_RESULTS = ["Commande prise", "Commande à venir", "Présentation produits", "Relevé de stock / merchandising", "Réclamation traitée", "Encaissement", "Pas d'intérêt"];

/** Une visite compte-t-elle dans la progression du mois ? Effectuée, et d'un type compté (par défaut : la visite physique). */
export function countsInProgress(v: { status: string; kind: string }, countedKinds: CrmSettings["countedKinds"]): boolean {
  return v.status === "EFFECTUEE" && (countedKinds as string[]).includes(v.kind);
}

/** Seuils de contrôle de présence d'une visite commerciale (forme attendue par `verifyVisit()`). */
export function crmCheckSettings(s: CrmSettings) {
  return {
    radiusM: s.radiusM, maxAccuracyM: s.maxAccuracyM, maxStartStopM: s.maxStartStopM, minDurationMin: s.minDurationMin,
    maxDurationMin: s.maxDurationMin, lateSyncHours: s.lateSyncHours, clockSkewMin: s.clockSkewMin, maxSpeedKmh: s.maxSpeedKmh,
  };
}

/** Lien de prise de commande pré-remplie sur le client (module Commandes, saisie mobile existante). */
export function orderHref(clientId: string): string {
  return `/gestion/pieces/nouveau?type=COMMANDE&client=${clientId}`;
}

/** Lien du relevé de stock en rayon (onglet existant de la fiche client). */
export function stockReadingHref(clientId: string): string {
  return `/clients/${clientId}?tab=stock&releve=1`;
}
