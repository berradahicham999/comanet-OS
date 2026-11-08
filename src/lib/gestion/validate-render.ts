import "server-only";
import { hasFlag, requirePermission } from "@/lib/access";
import { moduleOfType, type DocType } from "@/lib/gestion/documents-shared";
import { validateDocument } from "@/lib/gestion/documents";

/**
 * Validation + PDF figé. Le PDF est rendu hors transaction : s'il échoue, il sera rendu à la première ouverture.
 * Confirmer une commande client ne sort pas de stock : le droit « Créer » suffit (le commercial confirme
 * ce qu'il a saisi) ; BL, facture et avoir demandent « Valider ».
 */
export async function validateAndRender(id: string, type: DocType, override: boolean) {
  const user = await requirePermission(moduleOfType(type), type === "COMMANDE" ? "create" : "validate");
  if (override && !(await hasFlag("overrideCommercial"))) throw new Error("Accès refusé : le droit « Lever un blocage commercial » n'est pas activé sur votre compte.");
  const r = await validateDocument(id, { id: user.id, name: user.name }, { override });
  try {
    // Chargé à la demande : le moteur de PDF est lourd, et la file de validation du téléphone n'en a besoin qu'ici.
    const { storedPdf } = await import("@/lib/gestion/pdf");
    await storedPdf(id, user.id);
  } catch (e) {
    console.error("PDF de pièce", id, e);
  }
  return r;
}
