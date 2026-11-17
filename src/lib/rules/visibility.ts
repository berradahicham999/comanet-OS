/**
 * Ce que le pilotage de direction ne montre pas (Cockpit, brief du matin, rapports du copilote).
 *
 * Seule définition du réglage « Réglementaire hors du Cockpit » (`settings.cockpit.hideRegulatory`, Paramètres,
 * activé par défaut). Le module /reglementaire, l'Action Center et les tâches réglementaires ne sont pas concernés :
 * la règle continue de tourner, elle n'est simplement plus remontée à la direction. Logique pure.
 */
import type { ComanetSettings } from "@/lib/settings";

/** Identifiant de `regulatoryExpiryRule` (`src/lib/rules/regulatory-rules.ts`) ; un test vérifie qu'ils restent égaux. */
export const REGULATORY_RULE_ID = "regulatory-expiry";

/** Outil du copilote qui lit les dossiers réglementaires. */
export const REGULATORY_TOOL = "get_regulatory_alerts";

type CockpitSetting = Pick<ComanetSettings, "cockpit">;

/** Règles à ne pas remonter dans le pilotage de direction. */
export function hiddenRuleIds(settings: CockpitSetting): string[] {
  return settings.cockpit.hideRegulatory ? [REGULATORY_RULE_ID] : [];
}

/** Outils du copilote retirés du brief du matin et des rapports. */
export function hiddenTools(settings: CockpitSetting): string[] {
  return settings.cockpit.hideRegulatory ? [REGULATORY_TOOL] : [];
}

/** Recommandations remontées à la direction : toutes, moins celles des règles masquées. */
export function directionRecommendations<R extends { rule: string }>(recs: R[], settings: CockpitSetting): R[] {
  const hidden = hiddenRuleIds(settings);
  return hidden.length ? recs.filter((r) => !hidden.includes(r.rule)) : recs;
}
