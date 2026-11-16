/**
 * Contrôle Internet des positions (`src/lib/places/web-check-shared.ts`) : requête, ressemblance des noms, choix du
 * lieu Google (homonymes, mauvaise ville), verdict contre la fiche, décision automatique et alerte hors zone.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuery, searchable, placeNameScore, cityMatches, pickPlace, compareWithWeb, webPositionAction, isOutOfZone, placeTokens,
  type WebPlace, type PlaceSubject,
} from "@/lib/places/web-check-shared";
import { DEFAULT_WEB_PLACES as W } from "@/lib/settings";

// Lieux fictifs à Casablanca (Maârif) ; ~110 m par millième de degré de latitude.
const HERE = { lat: 33.585, lng: -7.635 };
const at = (dLatMilli: number) => ({ lat: HERE.lat + dLatMilli / 1000, lng: HERE.lng });
const place = (name: string, address: string, dLatMilli = 0): WebPlace => ({ placeId: name, name, address, ...at(dLatMilli) });

const doctor: PlaceSubject = { kind: "doctor", firstName: "Samira", lastName: "El Idrissi", specialty: "Dermatologie", city: "CASA" };
const pharmacy: PlaceSubject = { kind: "client", name: "PHARMACIE AL AMAL", city: "Casablanca" };

describe("requête et noms", () => {
  test("la requête porte le nom, la spécialité, la ville et le pays", () => {
    assert.equal(buildQuery(doctor), "Dr Samira El Idrissi, Dermatologie, CASA, Maroc");
    assert.equal(buildQuery({ kind: "client", name: "Pharmacie Atlas", address: "12 bd Zerktouni", city: "Casablanca" }), "Pharmacie Atlas, 12 bd Zerktouni, Casablanca, Maroc");
  });

  test("un nom sans mot distinctif n'est pas recherché", () => {
    assert.equal(searchable({ kind: "client", name: "PHARMACIE", city: "Rabat" }), false);
    assert.equal(searchable(pharmacy), true);
    assert.deepEqual(placeTokens("Parapharmacie Al Amal SARL"), ["amal"]);
  });

  test("médecin : nom de famille obligatoire, le prénom complète", () => {
    assert.equal(placeNameScore(doctor, "Dr Samira El Idrissi - Dermatologue"), 1);
    assert.equal(placeNameScore(doctor, "Cabinet Dr El Idrissi"), 0.85);
    assert.equal(placeNameScore(doctor, "Dr Samira Bennani"), 0);
    assert.ok(placeNameScore(doctor, "Dr Samira El Idrisi") >= W.minNameScore, "une faute de frappe est tolérée");
  });

  test("point de vente : mots distinctifs retrouvés", () => {
    assert.equal(placeNameScore(pharmacy, "Pharmacie Al Amal"), 1);
    assert.equal(placeNameScore(pharmacy, "Pharmacie Atlas"), 0);
  });

  test("ville : alias reconnus, ville différente refusée", () => {
    assert.equal(cityMatches("CASA", "45 Rue Ibnou Mounir, Casablanca 20250, Maroc"), true);
    assert.equal(cityMatches("FES", "Av. Hassan II, Fès 30000, Maroc"), true);
    assert.equal(cityMatches("Rabat", "Bd Mohammed V, Casablanca, Maroc"), false);
    assert.equal(cityMatches(null, "n'importe où"), true);
  });
});

describe("choix du lieu Google", () => {
  test("un seul lieu crédible = TROUVE", () => {
    const r = pickPlace(pharmacy, [place("Pharmacie Al Amal", "Maarif, Casablanca, Maroc"), place("Pharmacie Atlas", "Casablanca, Maroc", 5)], W);
    assert.equal(r.status, "TROUVE");
    assert.equal(r.place?.name, "Pharmacie Al Amal");
  });

  test("deux homonymes éloignés dans la même ville = AMBIGU", () => {
    const r = pickPlace(pharmacy, [place("Pharmacie Al Amal", "Maarif, Casablanca", 0), place("Pharmacie Al Amal", "Sidi Moumen, Casablanca", 60)], W);
    assert.equal(r.status, "AMBIGU");
    assert.equal(r.place, null);
  });

  test("deux fiches Google du même lieu (à quelques mètres) restent TROUVE", () => {
    const r = pickPlace(pharmacy, [place("Pharmacie Al Amal", "Casablanca", 0), place("Pharmacie Al Amal - Nuit", "Casablanca", 0.3)], W);
    assert.equal(r.status, "TROUVE");
  });

  test("bon nom mais autre ville, ou aucun résultat = INTROUVABLE", () => {
    assert.equal(pickPlace(pharmacy, [place("Pharmacie Al Amal", "Agadir, Maroc")], W).status, "INTROUVABLE");
    assert.equal(pickPlace(pharmacy, [], W).status, "INTROUVABLE");
  });
});

describe("verdict et décision automatique", () => {
  const web = { status: "TROUVE" as const, ...HERE };
  test("concorde sous le seuil, écart au-delà", () => {
    assert.deepEqual(compareWithWeb({ ...at(1), validated: true, source: "MANUELLE" }, web, W).verdict, "CONCORDE");
    const far = compareWithWeb({ ...at(5), validated: true, source: "PREMIERE_VISITE" }, web, W);
    assert.equal(far.verdict, "ECART");
    assert.ok(far.distanceM! > 500);
  });

  test("pas encore vérifiée, introuvable, sans position, position Google elle-même", () => {
    assert.equal(compareWithWeb(null, null, W).verdict, "NON_VERIFIE");
    assert.equal(compareWithWeb(null, { status: "INTROUVABLE", lat: null, lng: null }, W).verdict, "INTROUVABLE");
    assert.equal(compareWithWeb(null, web, W).verdict, "SANS_POSITION");
    assert.equal(compareWithWeb({ ...HERE, validated: false, source: "INTERNET" }, web, W).verdict, "SOURCE_INTERNET");
  });

  test("fiche sans position : la position Google est proposée (jamais validée seule)", () => {
    const a = webPositionAction(null, web, W);
    assert.equal(a?.kind, "PROPOSE");
  });

  test("position à valider qui concorde avec Google : validée ; qui s'en écarte : rien", () => {
    assert.equal(webPositionAction({ ...at(0.5), validated: false, source: "PREMIERE_VISITE" }, web, W)?.kind, "VALIDATE");
    assert.equal(webPositionAction({ ...at(0.5), validated: false, source: "HISTORIQUE" }, web, W)?.kind, "VALIDATE");
    assert.equal(webPositionAction({ ...at(5), validated: false, source: "PREMIERE_VISITE" }, web, W), null);
  });

  test("position Google : validée seulement par un démarrage sur place", () => {
    const pos = { ...HERE, validated: false, source: "INTERNET" as const };
    assert.equal(webPositionAction(pos, web, W), null, "Google seul ne valide rien");
    assert.equal(webPositionAction(pos, web, W, at(0.8))?.kind, "VALIDATE");
    assert.equal(webPositionAction(pos, web, W, at(4)), null);
  });

  test("une position validée n'est jamais touchée ; interrupteur coupé = rien", () => {
    assert.equal(webPositionAction({ ...at(5), validated: true, source: "MANUELLE" }, web, W), null);
    assert.equal(webPositionAction({ ...at(0.5), validated: false, source: "PREMIERE_VISITE" }, web, { ...W, autoValidate: false }), null);
  });
});

describe("alerte hors zone", () => {
  test("hors rayon d'une position validée, précision comprise", () => {
    assert.equal(isOutOfZone({ validated: true, distanceM: 900, accuracyM: 20, radiusM: 150 }), true);
    assert.equal(isOutOfZone({ validated: true, distanceM: 120, accuracyM: 20, radiusM: 150 }), false);
    assert.equal(isOutOfZone({ validated: true, distanceM: 600, accuracyM: 800, radiusM: 150 }), false, "une position imprécise ne prouve pas l'absence");
    assert.equal(isOutOfZone({ validated: false, distanceM: 5000, accuracyM: 10, radiusM: 150 }), false, "position non validée : pas d'alerte");
    assert.equal(isOutOfZone({ validated: true, distanceM: null, accuracyM: null, radiusM: 150 }), false);
  });
});
