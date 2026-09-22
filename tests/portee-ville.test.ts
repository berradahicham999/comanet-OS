/**
 * Portée par ville et « toutes les marques » : une animatrice voit tous les clients de sa ville
 * (variantes d'accent comprises, clients futurs compris) et toutes les marques.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expandAssignments, normalizeCities } from "@/lib/permissions-shared";
import { readConfig } from "@/lib/permissions-form";

const catalog = {
  brandIds: ["b1", "b2", "b3"],
  clients: [
    { id: "c1", city: "FÈS" },
    { id: "c2", city: "FES" },
    { id: "c3", city: "Fes " },
    { id: "c4", city: "RABAT" },
    { id: "c5", city: null },
    { id: "c6", city: "TETOUAN" },
  ],
};

describe("portée par ville", () => {
  test("une ville couvre toutes ses variantes d'écriture", () => {
    const r = expandAssignments({ brandIds: [], clientIds: [], allBrands: false, cities: ["Fès"] }, catalog);
    assert.deepEqual(r.clientIds.sort(), ["c1", "c2", "c3"]);
  });

  test("les clients cochés un à un s'ajoutent aux villes, sans doublon", () => {
    const r = expandAssignments({ brandIds: [], clientIds: ["c4", "c1"], allBrands: false, cities: ["FES"] }, catalog);
    assert.deepEqual(r.clientIds.sort(), ["c1", "c2", "c3", "c4"]);
  });

  test("un client ajouté plus tard dans la ville entre automatiquement", () => {
    const later = { ...catalog, clients: [...catalog.clients, { id: "c7", city: "Tétouan" }] };
    const r = expandAssignments({ brandIds: [], clientIds: [], allBrands: false, cities: ["TÉTOUAN"] }, later);
    assert.deepEqual(r.clientIds.sort(), ["c6", "c7"]);
  });

  test("toutes les marques remplace la liste, y compris les marques futures", () => {
    assert.deepEqual(expandAssignments({ brandIds: ["b1"], clientIds: [], allBrands: true, cities: [] }, catalog).brandIds, ["b1", "b2", "b3"]);
    assert.deepEqual(expandAssignments({ brandIds: ["b1"], clientIds: [], allBrands: false, cities: [] }, catalog).brandIds, ["b1"]);
  });

  test("sans ville ni client, rien n'est ouvert", () => {
    assert.deepEqual(expandAssignments({ brandIds: [], clientIds: [], allBrands: false, cities: [] }, catalog).clientIds, []);
  });

  test("les villes sont dédoublonnées sous leur forme canonique", () => {
    assert.deepEqual(normalizeCities(["fes", "FÈS", " Fès ", "", null, "casa"]), ["FÈS", "CASABLANCA"]);
  });

  test("le formulaire transmet villes et « toutes les marques »", () => {
    const fd = new FormData();
    fd.set("scope", "OWN");
    fd.set("all_brands", "on");
    fd.append("city_scope", "FÈS");
    fd.append("city_scope", "RABAT");
    fd.set("client_c9", "1");
    const c = readConfig(fd);
    assert.equal(c.allBrands, true);
    assert.deepEqual(c.cities, ["FÈS", "RABAT"]);
    assert.deepEqual(c.clientIds, ["c9"]);
  });
});
