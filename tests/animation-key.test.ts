/**
 * Normalisation de ville et clé de déduplication d'une animation.
 * Saisie manuelle et import doivent produire EXACTEMENT la même clé.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeCity, cityKey, animationKey, animatriceName } from "@/lib/animations-shared";

describe("normalizeCity", () => {
  test("majuscules, accents rétablis sur les villes connues", () => {
    assert.equal(normalizeCity("casa"), "CASABLANCA");
    assert.equal(normalizeCity("Casa Blanca"), "CASABLANCA");
    assert.equal(normalizeCity("CASABLANCA"), "CASABLANCA");
    assert.equal(normalizeCity("fes"), "FÈS");
    assert.equal(normalizeCity("Meknes"), "MEKNÈS");
  });
  test("insensible à la casse, aux accents saisis et aux espaces", () => {
    assert.equal(normalizeCity("  rabat  "), normalizeCity("RABAT"));
    assert.equal(normalizeCity("Tétouan"), normalizeCity("tetouan"));
    assert.equal(normalizeCity("Kénitra"), normalizeCity("kenitra"));
  });
  test("vide ou absent : null, pas une chaîne vide", () => {
    assert.equal(normalizeCity(""), null);
    assert.equal(normalizeCity(null), null);
    assert.equal(normalizeCity("   "), null);
  });
});

describe("cityKey — clé de rapprochement objectifs / réalisé", () => {
  test("mêmes villes écrites différemment → même clé", () => {
    assert.equal(cityKey("Casa"), cityKey("CASABLANCA"));
    assert.equal(cityKey("Fès"), cityKey("fes"));
  });
  test("villes différentes → clés différentes", () => {
    assert.notEqual(cityKey("Rabat"), cityKey("Casablanca"));
  });
});

describe("animationKey — déterminisme et discrimination", () => {
  const base = { date: "2026-09-07", city: "Casablanca", pos: "Pharmacie Al Andalous", animatrice: "MERIEM AYOUB" };

  test("deux saisies identiques produisent la même clé", () => {
    assert.equal(animationKey(base), animationKey({ ...base }));
  });
  test("la clé ne dépend ni de la casse, ni des accents, ni de la ponctuation", () => {
    assert.equal(
      animationKey(base),
      animationKey({ date: "2026-09-07", city: "CASA", pos: "pharmacie al-andalous", animatrice: "Meriem Ayoub" }),
    );
  });
  test("une date différente est une autre animation", () => {
    assert.notEqual(animationKey(base), animationKey({ ...base, date: "2026-09-08" }));
  });
  test("un point de vente différent est une autre animation", () => {
    assert.notEqual(animationKey(base), animationKey({ ...base, pos: "Parapharmacie Maarif" }));
  });
  test("une animatrice différente est une autre animation", () => {
    assert.notEqual(animationKey(base), animationKey({ ...base, animatrice: "Salma Bennani" }));
  });
  test("animatrice absente : clé stable, sans plantage", () => {
    assert.equal(animationKey({ ...base, animatrice: null }), animationKey({ ...base, animatrice: undefined }));
  });
  test("la clé porte bien les quatre composants, séparés", () => {
    assert.equal(animationKey(base).split("|").length, 4);
    assert.ok(animationKey(base).startsWith("2026-09-07|"));
  });
});

describe("animatriceName", () => {
  test("normalise l'affichage sans changer l'identité", () => {
    assert.equal(animatriceName("MERIEM AYOUB"), "Meriem Ayoub");
  });
});
