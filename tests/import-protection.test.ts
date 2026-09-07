/**
 * Collision saisie / import — la saisie humaine gagne toujours.
 *
 * `importAnimations()` a besoin de Postgres pour être testé de bout en bout (il n'y en a pas
 * sur les postes de développement) : ces tests couvrent la DÉCISION isolément — quelle
 * animation est protégée, quels champs peuvent être complétés — via la même logique de tri
 * que la fonction d'import, reproduite ici en pur.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** Reproduit la partition faite dans `importAnimations()` avant l'upsert par lot. */
function partition(
  pendingKeys: string[],
  existingByKey: Map<string, { id: string; source: string }>,
): { protectedKeys: string[]; upsertKeys: string[] } {
  const protectedKeys: string[] = [];
  const upsertKeys: string[] = [];
  for (const key of pendingKeys) {
    if (existingByKey.get(key)?.source === "saisie") protectedKeys.push(key);
    else upsertKeys.push(key);
  }
  return { protectedKeys, upsertKeys };
}

describe("partition saisie vs import", () => {
  test("une animation saisie est protégée, une importée est mise à jour normalement", () => {
    const existing = new Map([
      ["k1", { id: "a1", source: "saisie" }],
      ["k2", { id: "a2", source: "import" }],
    ]);
    const { protectedKeys, upsertKeys } = partition(["k1", "k2", "k3"], existing);
    assert.deepEqual(protectedKeys, ["k1"]);
    assert.deepEqual(upsertKeys, ["k2", "k3"], "k3 est une nouvelle animation, jamais protégée");
  });

  test("aucune animation existante : tout passe par l'upsert normal", () => {
    const { protectedKeys, upsertKeys } = partition(["k1", "k2"], new Map());
    assert.deepEqual(protectedKeys, []);
    assert.deepEqual(upsertKeys, ["k1", "k2"]);
  });

  test("toutes protégées : rien ne passe par l'upsert", () => {
    const existing = new Map([["k1", { id: "a1", source: "saisie" }], ["k2", { id: "a2", source: "saisie" }]]);
    const { protectedKeys, upsertKeys } = partition(["k1", "k2"], existing);
    assert.deepEqual(protectedKeys, ["k1", "k2"]);
    assert.deepEqual(upsertKeys, []);
  });
});

describe("complétion des champs absents — jamais un écrasement", () => {
  // Même expression que la migration : COALESCE(NULLIF(city, ''), <valeur du fichier>).
  function fillCity(current: string | null, fromFile: string | null): string | null {
    return current && current !== "" ? current : fromFile;
  }
  function fillAnimatrice(current: string | null, fromFile: string | null): string | null {
    return current ?? fromFile;
  }

  test("un champ déjà renseigné par l'animatrice n'est jamais remplacé", () => {
    assert.equal(fillCity("CASABLANCA", "FÈS"), "CASABLANCA");
    assert.equal(fillAnimatrice("u1", "u2"), "u1");
  });
  test("un champ vide est complété par la valeur du fichier", () => {
    assert.equal(fillCity(null, "FÈS"), "FÈS");
    assert.equal(fillCity("", "FÈS"), "FÈS");
    assert.equal(fillAnimatrice(null, "u2"), "u2");
  });
  test("un champ vide et le fichier muet aussi : reste vide, rien d'inventé", () => {
    assert.equal(fillCity(null, null), null);
  });
});
