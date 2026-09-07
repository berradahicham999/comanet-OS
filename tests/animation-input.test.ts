/**
 * Fige le comportement de la saisie d'animation AVANT sa mise en transaction.
 * Ces tests décrivent ce que `saveAnimation` faisait au 7 septembre 2026 : si le refactoring
 * déplace une décision, ils échouent.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAnimationInput, animationDedupeKey, valueAnimationLines, type RawAnimationInput } from "@/lib/terrain/animation-input";
import { animationKey } from "@/lib/animations-shared";

const base = (over: Partial<RawAnimationInput> = {}): RawAnimationInput => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  date: "2026-09-07",
  status: "DONE",
  animatriceId: "22222222-2222-2222-2222-222222222222",
  brandId: null,
  cost: "", durationHours: "", customersAdvised: "", samples: "",
  comment: "", photoUrl: "",
  lines: [{ productId: "p1", qty: "8", stock: "3" }],
  ...over,
});
const ok = (r: ReturnType<typeof parseAnimationInput>) => {
  assert.equal(r.ok, true, `attendu valide, reçu erreur ${r.ok ? "" : r.error}`);
  return r.ok ? r.value : (undefined as never);
};

describe("saisie complète", () => {
  test("les champs sont normalisés et les lignes conservées", () => {
    const v = ok(parseAnimationInput(base({ cost: "1500,50", durationHours: "7.5", customersAdvised: "42", samples: "10", comment: "  affluence  ", photoUrl: " https://x " })));
    assert.equal(v.cost, 1500.5);
    assert.equal(v.durationHours, 7.5);
    assert.equal(v.customersAdvised, 42);
    assert.equal(v.samples, 10);
    assert.equal(v.comment, "affluence");
    assert.equal(v.photoUrl, "https://x");
    assert.deepEqual(v.lines, [{ productId: "p1", quantitySold: 8, stockObserved: 3 }]);
  });
  test("les champs d'en-tête vides valent 0 ou null, pas une erreur", () => {
    const v = ok(parseAnimationInput(base()));
    assert.equal(v.cost, 0);
    assert.equal(v.customersAdvised, 0);
    assert.equal(v.samples, 0);
    assert.equal(v.durationHours, null);
    assert.equal(v.comment, null);
  });
  test("un statut inconnu retombe sur DONE", () => {
    assert.equal(ok(parseAnimationInput(base({ status: "N'IMPORTE QUOI" }))).status, "DONE");
    assert.equal(ok(parseAnimationInput(base({ status: "PLANNED" }))).status, "PLANNED");
    assert.equal(ok(parseAnimationInput(base({ status: "CANCELLED" }))).status, "CANCELLED");
  });
});

describe("refus explicites — jamais de zéro silencieux", () => {
  test("point de vente manquant", () => {
    const r = parseAnimationInput(base({ clientId: "  " }));
    assert.deepEqual(r, { ok: false, error: "client" });
  });
  test("date absente, mal formée ou impossible", () => {
    for (const d of ["", "07/09/2026", "2026-13-45", "hier"]) {
      assert.deepEqual(parseAnimationInput(base({ date: d })), { ok: false, error: "date" }, `date « ${d} »`);
    }
  });
  test("coût illisible ou négatif", () => {
    assert.deepEqual(parseAnimationInput(base({ cost: "abc" })), { ok: false, error: "nombre" });
    assert.deepEqual(parseAnimationInput(base({ cost: "-10" })), { ok: false, error: "nombre" });
  });
  test("clientes conseillées décimales : arrondies, comme avant le refactoring", () => {
    // Comportement d'origine conservé : seules les QUANTITÉS de ligne exigent un entier.
    assert.equal(ok(parseAnimationInput(base({ customersAdvised: "4.5" }))).customersAdvised, 5);
    assert.equal(ok(parseAnimationInput(base({ samples: "2.4" }))).samples, 2);
  });
  test("quantité négative ou décimale", () => {
    assert.deepEqual(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "-2", stock: "" }] })), { ok: false, error: "quantite" });
    assert.deepEqual(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "1.5", stock: "" }] })), { ok: false, error: "quantite" });
    assert.deepEqual(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "huit", stock: "" }] })), { ok: false, error: "quantite" });
  });
  test("stock rayon négatif", () => {
    assert.deepEqual(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "1", stock: "-3" }] })), { ok: false, error: "stock" });
  });
});

describe("lignes produit", () => {
  test("une ligne sans produit est ignorée", () => {
    assert.equal(ok(parseAnimationInput(base({ lines: [{ productId: "", qty: "5", stock: "2" }] }))).lines.length, 0);
  });
  test("une ligne sans vente ni stock est ignorée", () => {
    assert.equal(ok(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "", stock: "" }, { productId: "p2", qty: "0", stock: "" }] }))).lines.length, 0);
  });
  test("une ligne à 0 vendu mais avec un stock constaté est CONSERVÉE", () => {
    const v = ok(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "0", stock: "12" }] })));
    assert.deepEqual(v.lines, [{ productId: "p1", quantitySold: 0, stockObserved: 12 }]);
  });
  test("plusieurs lignes sur le même produit sont conservées telles quelles", () => {
    const v = ok(parseAnimationInput(base({ lines: [{ productId: "p1", qty: "3", stock: "" }, { productId: "p1", qty: "5", stock: "" }] })));
    assert.equal(v.lines.length, 2);
  });
});

describe("clé de déduplication — identique à celle de l'import", () => {
  test("la clé de saisie et celle de l'import coïncident pour la même journée", () => {
    const saisie = animationDedupeKey({ date: "2026-09-07", clientCity: "Casa", clientName: "LA GLOIRE", animatriceName: "Meriem Ayoub" });
    const importe = animationKey({ date: "2026-09-07", city: "CASABLANCA", pos: "LA GLOIRE", animatrice: "MERIEM AYOUB" });
    assert.equal(saisie, importe);
  });
  test("ville absente : clé stable, sans plantage", () => {
    assert.equal(
      animationDedupeKey({ date: "2026-09-07", clientCity: null, clientName: "X", animatriceName: null }),
      animationDedupeKey({ date: "2026-09-07", clientCity: "", clientName: "X", animatriceName: null }),
    );
  });
  test("une autre date, un autre POS ou une autre animatrice donnent une autre clé", () => {
    const k = { date: "2026-09-07", clientCity: "FÈS", clientName: "LA GLOIRE", animatriceName: "Meryem" };
    assert.notEqual(animationDedupeKey(k), animationDedupeKey({ ...k, date: "2026-09-08" }));
    assert.notEqual(animationDedupeKey(k), animationDedupeKey({ ...k, clientName: "BSN PARA" }));
    assert.notEqual(animationDedupeKey(k), animationDedupeKey({ ...k, animatriceName: "Hanane" }));
  });
});

describe("valorisation des lignes", () => {
  const lines = [
    { productId: "p1", quantitySold: 8, stockObserved: 3 },
    { productId: "p2", quantitySold: 2, stockObserved: null },
  ];
  test("prix connu : montant = quantité × prix public", () => {
    const { valued, missingPrice } = valueAnimationLines(lines, new Map([["p1", 199], ["p2", 150]]));
    assert.equal(valued[0].amount, 1592);
    assert.equal(valued[0].unitPrice, 199);
    assert.equal(valued[1].amount, 300);
    assert.equal(missingPrice, false);
  });
  test("prix inconnu : montant null — jamais 0 — et le signalement remonte", () => {
    const { valued, missingPrice } = valueAnimationLines(lines, new Map([["p1", 199]]));
    assert.equal(valued[1].amount, null);
    assert.notEqual(valued[1].amount, 0);
    assert.equal(valued[1].measurable, false);
    assert.equal(missingPrice, true);
  });
  test("une ligne à 0 vendu sans prix ne déclenche pas d'alerte de prix", () => {
    const { missingPrice } = valueAnimationLines([{ productId: "p3", quantitySold: 0, stockObserved: 5 }], new Map());
    assert.equal(missingPrice, false);
  });
});
