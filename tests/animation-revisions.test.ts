/**
 * Historique des rapports d'animation : la comparaison avant / après doit dire exactement
 * ce qui a changé, lisiblement, et rien d'autre.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffAnimation, snapshotSummary, type AnimationSnapshot } from "@/lib/terrain/revisions";

const snap = (over: Partial<AnimationSnapshot> = {}): AnimationSnapshot => ({
  startDate: "2026-09-18", date: "2026-09-20", days: 3, status: "DONE",
  clientName: "LA GLOIRE", animatriceName: "Meriem", brandName: "Gamarde",
  cost: 0, durationHours: null, customersAdvised: 12, samples: 5, comment: null, photoUrl: null,
  lines: { "Gamarde crème": { sold: 8, stock: 3 } },
  ...over,
});

describe("diffAnimation", () => {
  test("rien ne change : aucune ligne d'historique", () => {
    assert.deepEqual(diffAnimation(snap(), snap()), []);
  });
  test("une quantité corrigée", () => {
    const d = diffAnimation(snap(), snap({ lines: { "Gamarde crème": { sold: 6, stock: 3 } } }));
    assert.deepEqual(d, [{ label: "Vendu — Gamarde crème", before: "8", after: "6" }]);
  });
  test("produit ajouté et retiré", () => {
    const d = diffAnimation(snap(), snap({ lines: { "Gamarde sérum": { sold: 2, stock: null } } }));
    assert.deepEqual(d, [
      { label: "Vendu — Gamarde crème", before: "8", after: null },
      { label: "Rayon — Gamarde crème", before: "3", after: null },
      { label: "Vendu — Gamarde sérum", before: null, after: "2" },
    ]);
  });
  test("période, statut et commentaire", () => {
    const d = diffAnimation(snap(), snap({ days: 2, status: "CANCELLED", comment: "fermé dimanche" }));
    assert.deepEqual(d.map((c) => c.label), ["Période", "Statut", "Commentaire"]);
    assert.equal(d[1].after, "Annulée");
    assert.equal(d[2].before, null);
  });
});

test("snapshotSummary : point de vente, période, animatrice", () => {
  const s = snapshotSummary(snap());
  assert.ok(s.startsWith("LA GLOIRE — "));
  assert.ok(s.endsWith(" · 3 j — Meriem"));
});
