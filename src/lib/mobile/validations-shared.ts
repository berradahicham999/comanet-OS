/** File de validation du téléphone : ce que l'écran affiche et ce qu'il renvoie. */
export type ValidationKind = "CONTENU" | "ACTIVATION" | "PIECE";

export type ValidationItem = {
  kind: ValidationKind;
  id: string;
  title: string;
  context: string;
  detail: string | null;
  lines: string[];
  amountMad: number | null;
  href: string;
  refuseLabel: string;
};

export type ValidationDecision = { kind: ValidationKind; id: string; decision: "OK" | "KO"; comment?: string | null };

/** Distance à parcourir pour qu'un geste compte : assez longue pour qu'un défilement ne valide jamais rien. */
export const SWIPE_THRESHOLD_PX = 110;

/** Temps laissé pour annuler un geste, avant l'envoi : un swipe engage de l'argent ou une publication. */
export const UNDO_DELAY_MS = 5000;

/** Sens d'un geste relâché. Un mouvement surtout vertical est un défilement, jamais une décision. */
export function swipeDecision(dx: number, dy: number): "OK" | "KO" | null {
  if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < SWIPE_THRESHOLD_PX) return null;
  return dx > 0 ? "OK" : "KO";
}
