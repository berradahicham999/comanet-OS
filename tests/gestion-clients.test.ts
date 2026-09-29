/**
 * Gestion commerciale — fiche client : prêt à facturer, doublons (src/lib/gestion/clients-shared.ts).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { billingIdentity, billingReadiness, duplicateCandidates, entityFromAbsorbed, isValidIce, mergeBlockers, normalizeIce, phoneKey, type ExistingClient } from "@/lib/gestion/clients-shared";

describe("identifiants", () => {
  test("ICE : 15 chiffres, séparateurs tolérés", () => {
    assert.equal(normalizeIce("001 234 567 000 089"), "001234567000089");
    assert.ok(isValidIce("001234567000089"));
    assert.ok(isValidIce("001.234.567.000.089"));
    assert.ok(!isValidIce("00123456700008"));
    assert.equal(normalizeIce(""), null);
  });
  test("téléphone ramené à ses 9 derniers chiffres", () => {
    assert.equal(phoneKey("+212 522 12 34 56"), phoneKey("0522 123456"));
    assert.equal(phoneKey("123"), null);
  });
});

describe("prêt à facturer", () => {
  const ok = { legalName: "PHARMACIE EXEMPLE SARL", ice: "001234567000089", billingAddress: "12 AV EXEMPLE", city: "MARRAKECH", accountCode: "056", paymentDays: 60, paymentModeKey: "CHEQUE" };
  test("fiche complète", () => {
    assert.deepEqual(billingReadiness(ok), { ready: true, missing: [], recommended: [] });
  });
  test("mentions obligatoires manquantes", () => {
    const r = billingReadiness({ ...ok, legalName: " ", ice: null, billingAddress: null });
    assert.equal(r.ready, false);
    assert.deepEqual(r.missing, ["Raison sociale", "ICE", "Adresse de facturation"]);
  });
  test("ICE mal formé", () => {
    assert.deepEqual(billingReadiness({ ...ok, ice: "12345" }).missing, ["ICE (15 chiffres)"]);
  });
  test("recommandations sans blocage", () => {
    const r = billingReadiness({ ...ok, accountCode: null, paymentDays: null, paymentModeKey: null });
    assert.equal(r.ready, true);
    assert.deepEqual(r.recommended, ["Code client Sage", "Délai de paiement", "Mode de paiement"]);
  });
});

describe("doublons à la création", () => {
  const existing: ExistingClient[] = [
    { id: "1", name: "PHARMA SUD", legalName: "EXEMPLE PHARMA SARL", ice: "001234567000089", phone: "0524 11 22 33", city: "MARRAKECH", active: true, aliases: ["PARAPHARMA SUD", "PHARMA SUD SARL AU"] },
    { id: "2", name: "PHARMACIE DU CENTRE", legalName: null, ice: null, phone: null, city: "CASABLANCA", active: true },
    { id: "3", name: "PHARMACIE CENTRE VILLE", legalName: null, ice: null, phone: null, city: "RABAT", active: false },
  ];
  test("même ICE : doublon certain, en tête", () => {
    const r = duplicateCandidates({ name: "Nouvelle officine", ice: "001 234 567 000 089" }, existing);
    assert.equal(r[0].id, "1");
    assert.ok(r[0].reasons.includes("Même ICE"));
  });
  test("même nom via un libellé brut connu", () => {
    const r = duplicateCandidates({ name: "Parapharma Sud" }, existing);
    assert.deepEqual(r.map((x) => x.id), ["1"]);
    assert.ok(r[0].reasons.includes("Même nom"));
  });
  test("raison sociale identique", () => {
    assert.equal(duplicateCandidates({ name: "Autre nom", legalName: "Exemple Pharma SARL" }, existing)[0]?.id, "1");
  });
  test("nom proche seulement dans la même ville", () => {
    assert.deepEqual(duplicateCandidates({ name: "Pharmacie du Centre", city: "Casablanca" }, existing).map((x) => x.id), ["2"]);
    assert.deepEqual(duplicateCandidates({ name: "Pharmacie Centre", city: "Casablanca" }, existing).map((x) => x.id), ["2"]);
    assert.deepEqual(duplicateCandidates({ name: "Pharmacie Centre", city: "Tanger" }, existing), []);
  });
  test("même téléphone", () => {
    assert.ok(duplicateCandidates({ name: "X", phone: "+212 524 11 22 33" }, existing)[0].reasons.includes("Même téléphone"));
  });
  test("la fiche elle-même est exclue à la modification", () => {
    assert.deepEqual(duplicateCandidates({ name: "PHARMA SUD", ice: "001234567000089" }, existing, "1"), []);
  });
});

describe("un point de vente, plusieurs raisons sociales", () => {
  const blank = { accountCode: null, ifNumber: null, rc: null, patente: null, billingAddress: null, postalCode: null, city: null };
  const fiche = { ...blank, name: "PARA LA GLOIRE", code: "C0110", legalName: "PARA LA GLOIRE", accountCode: "056", ice: "000520167000024", billingAddress: "1 RUE EXEMPLE", city: "FES" };
  test("sans raison sociale choisie, la pièce facture l'identité de la fiche", () => {
    const id = billingIdentity(fiche, null);
    assert.equal(id.legalName, "PARA LA GLOIRE");
    assert.equal(id.accountCode, "056");
    assert.equal(id.ice, "000520167000024");
  });
  test("une raison sociale supplémentaire n'emprunte ni l'ICE ni le code Sage de la fiche, seulement sa ville", () => {
    const id = billingIdentity(fiche, { ...blank, legalName: "LA GLOIRE SARL", ice: null });
    assert.equal(id.legalName, "LA GLOIRE SARL");
    assert.equal(id.name, "PARA LA GLOIRE");
    assert.equal(id.ice, null);
    assert.equal(id.accountCode, null);
    assert.equal(id.city, "FES");
  });
  test("fiche sans raison sociale : le nom du point de vente est imprimé, puis le code distributeur à défaut de code Sage", () => {
    const id = billingIdentity({ ...fiche, legalName: null, accountCode: null }, null);
    assert.equal(id.legalName, "PARA LA GLOIRE");
    assert.equal(id.accountCode, "C0110");
  });
  test("fusion : l'identité de la fiche absorbée devient une raison sociale, sauf si c'est la même société", () => {
    const absorbed = { ...blank, name: "LA GLOIRE", legalName: "LA GLOIRE", ice: null };
    assert.equal(entityFromAbsorbed(fiche, [], absorbed)?.legalName, "LA GLOIRE");
    assert.equal(entityFromAbsorbed(fiche, [], { ...absorbed, legalName: "Para la Gloire" }), null, "même raison sociale, aucune ICE contradictoire");
    assert.equal(entityFromAbsorbed(fiche, [], { ...absorbed, legalName: "AUTRE NOM", ice: "000 520 167 000 024" }), null, "même ICE");
    assert.notEqual(entityFromAbsorbed(fiche, [], { ...absorbed, legalName: "PARA LA GLOIRE", ice: "001234567000089" }), null, "même nom mais ICE différent : deux sociétés");
    assert.equal(entityFromAbsorbed(fiche, [{ ...blank, legalName: "LA GLOIRE", ice: null }], absorbed), null, "déjà présente");
    assert.equal(entityFromAbsorbed(fiche, [], { ...absorbed, legalName: null })?.legalName, "LA GLOIRE", "sans raison sociale : son nom");
  });
  test("fusion refusée tant que la fiche absorbée porte des pièces validées ou des règlements", () => {
    assert.deepEqual(mergeBlockers({ sameClient: false, absorbedValidatedDocs: 0, absorbedPayments: 0, keptValidatedDocs: 3 }), []);
    assert.match(mergeBlockers({ sameClient: false, absorbedValidatedDocs: 2, absorbedPayments: 0, keptValidatedDocs: 0 })[0], /autre sens/);
    assert.match(mergeBlockers({ sameClient: false, absorbedValidatedDocs: 0, absorbedPayments: 1, keptValidatedDocs: 4 })[0], /impossible/);
    assert.equal(mergeBlockers({ sameClient: true, absorbedValidatedDocs: 0, absorbedPayments: 0, keptValidatedDocs: 0 }).length, 1);
  });
});
