/** Brief du matin : lecture du bloc d'actions JSON, tolérance aux réponses mal formées. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseBrief } from "@/lib/ai/brief-shared";

describe("brief du matin — analyse de la réponse", () => {
  test("texte et trois actions, bornes appliquées", () => {
    const raw = `- CA sell-in du mois 120 000 MAD, +8 % vs M-1 (Sage).\n- 2 références en rupture (stock).\n- Actions du jour : voir ci-dessous.\n\n\`\`\`json\n{"actions":[{"title":"Commander Crème A","why":"couverture 0,5 mois","assignee_role":"achats","due_in_days":2,"priority":"CRITICAL","module":"stock","expected":"stock > 2 mois"},{"title":"Relancer Para Sud","why":"95 j sans commande","assignee_role":"commercial","due_in_days":400,"priority":"URGENT","module":"inconnu","expected":"commande"},{"title":"","why":"x"},{"title":"Quatrième","why":"x"}]}\n\`\`\``;
    const { text, actions } = parseBrief(raw);
    assert.ok(text.startsWith("- CA sell-in"));
    assert.ok(!text.includes("```"));
    assert.equal(actions.length, 2);
    assert.equal(actions[0].priority, "CRITICAL");
    assert.equal(actions[1].due_in_days, 90, "échéance plafonnée");
    assert.equal(actions[1].priority, "MEDIUM", "priorité inconnue → MEDIUM");
    assert.equal(actions[1].module, "taches", "module inconnu → taches");
  });
  test("sans bloc JSON ou JSON invalide : texte conservé, aucune action, aucune erreur", () => {
    assert.deepEqual(parseBrief("- Rien à signaler."), { text: "- Rien à signaler.", actions: [] });
    const r = parseBrief("- Ligne.\n```json\n{oops\n```");
    assert.equal(r.actions.length, 0);
    assert.equal(r.text, "- Ligne.");
  });
});
