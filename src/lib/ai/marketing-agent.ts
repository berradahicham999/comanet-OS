/**
 * Surface « Agent marketing » du copilote : consigne de surface versionnée (`prompts/marketing-agent.md`)
 * et contexte de la marque sélectionnée. Aucune donnée de vente ou de stock n'entre dans le prompt : la
 * consigne dit seulement quelle marque est sélectionnée et quels outils appeler ; les chiffres sont lus par
 * les outils à chaque question (« données à jour au … »).
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";

export const MARKETING_AGENT_SURFACE = "marketing";
export const MARKETING_AGENT_MODULE = "marketing-agent";

const PROMPT_PATH = path.join(process.cwd(), "src/lib/ai/prompts/marketing-agent.md");
let cached: string | null = null;

export function loadMarketingAgentPrompt(): string {
  if (cached && process.env.NODE_ENV === "production") return cached;
  cached = fs.readFileSync(PROMPT_PATH, "utf8");
  return cached;
}

/** Consigne complète de la surface : persona + marque sélectionnée (si la personne en a choisi une). */
export function marketingAgentInstructions(brandName: string | null, periodKey: string | null): string {
  const brand = brandName
    ? `Marque sélectionnée dans l'écran : « ${brandName} ». Sauf mention contraire dans la question, chaque outil est appelé avec brand = « ${brandName} »${periodKey ? ` et period = ${periodKey}` : ""} ; la personne n'a pas à la recopier.`
    : "Aucune marque sélectionnée dans l'écran : demande la marque si la question n'en nomme pas une (une seule question, pas plus).";
  return `${loadMarketingAgentPrompt()}\n\n## Contexte de l'écran\n${brand}`;
}
