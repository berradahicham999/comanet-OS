/**
 * Planning éditorial : transitions, retards, templates — logique pure de `src/lib/content/shared.ts`.
 * Les statuts utilisés ici sont des données de test : le code ne connaît aucun nom de statut.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkTransition, nextTransitions, lateness, applyTemplate, refKey, shiftIso, type StatusRef, type TransitionRef } from "@/lib/content/shared";

const S = (key: string, sort: number, flags: Partial<StatusRef> = {}): StatusRef => ({ key, label: key, tone: "gray", sort, active: true, isPublished: false, isArchived: false, awaitingValidation: false, inProduction: false, ...flags });
const statuses: StatusRef[] = [
  S("IDEE", 1), S("EN_CREATION", 2, { inProduction: true }), S("A_VALIDER", 3, { awaitingValidation: true }),
  S("CORRECTIONS", 4, { inProduction: true }), S("VALIDE", 5), S("PUBLIE", 6, { isPublished: true }), S("ARCHIVE", 7, { isArchived: true }),
];
const T = (fromKey: string, toKey: string, requiresValidator = false, requiresComment = false): TransitionRef => ({ fromKey, toKey, requiresValidator, requiresComment, label: null });
const transitions = [T("IDEE", "EN_CREATION"), T("EN_CREATION", "A_VALIDER"), T("A_VALIDER", "VALIDE", true), T("A_VALIDER", "CORRECTIONS", true, true), T("VALIDE", "PUBLIE"), T("PUBLIE", "ARCHIVE")];

describe("Transitions de statut", () => {
  test("une transition absente du référentiel est refusée", () => {
    assert.equal(checkTransition(transitions, "IDEE", "PUBLIE", { isValidator: true }).ok, false);
  });
  test("valider exige un validateur", () => {
    assert.equal(checkTransition(transitions, "A_VALIDER", "VALIDE", { isValidator: false }).ok, false);
    assert.equal(checkTransition(transitions, "A_VALIDER", "VALIDE", { isValidator: true }).ok, true);
  });
  test("demander des corrections exige un commentaire", () => {
    assert.equal(checkTransition(transitions, "A_VALIDER", "CORRECTIONS", { isValidator: true, comment: "  " }).ok, false);
    assert.equal(checkTransition(transitions, "A_VALIDER", "CORRECTIONS", { isValidator: true, comment: "Logo trop petit" }).ok, true);
  });
  test("archiver est une transition comme une autre : le contenu reste, le statut change", () => {
    assert.equal(checkTransition(transitions, "PUBLIE", "ARCHIVE", { isValidator: false }).ok, true);
  });
  test("les transitions proposées indiquent celles réservées au validateur", () => {
    const next = nextTransitions({ statuses, transitions }, "A_VALIDER", false);
    assert.deepEqual(next.map((t) => [t.toKey, t.allowed]), [["CORRECTIONS", false], ["VALIDE", false]]);
    assert.ok(nextTransitions({ statuses, transitions }, "A_VALIDER", true).every((t) => t.allowed));
  });
});

describe("Retards", () => {
  const today = "2026-09-07";
  test("date de publication passée sans statut publié", () => {
    assert.equal(lateness({ date: "2026-09-01", deadline: null, status: "VALIDE", hasDeliverable: true }, statuses, today), "PUBLICATION");
  });
  test("deadline dépassée sans livrable", () => {
    assert.equal(lateness({ date: "2026-09-20", deadline: "2026-09-05", status: "EN_CREATION", hasDeliverable: false }, statuses, today), "LIVRABLE");
    assert.equal(lateness({ date: "2026-09-20", deadline: "2026-09-05", status: "EN_CREATION", hasDeliverable: true }, statuses, today), null);
  });
  test("un contenu publié ou archivé n'est jamais en retard", () => {
    assert.equal(lateness({ date: "2026-08-01", deadline: "2026-07-01", status: "PUBLIE", hasDeliverable: false }, statuses, today), null);
    assert.equal(lateness({ date: "2026-08-01", deadline: "2026-07-01", status: "ARCHIVE", hasDeliverable: false }, statuses, today), null);
  });
});

describe("Templates et clés", () => {
  test("un template ne remplace jamais ce qui est déjà saisi", () => {
    const out = applyTemplate({ hook: "Mon accroche", cta: "" }, { hook: "Accroche template", cta: "CTA template" });
    assert.equal(out.hook, "Mon accroche");
    assert.equal(out.cta, "CTA template");
  });
  test("clé technique dérivée d'un libellé accentué", () => {
    assert.equal(refKey("Visuel pharmacie"), "VISUEL_PHARMACIE");
    assert.equal(refKey("Éducation produit"), "EDUCATION_PRODUIT");
    assert.equal(refKey("Drive-to-store"), "DRIVE_TO_STORE");
  });
  test("décalage de date ISO", () => {
    assert.equal(shiftIso("2026-01-30", 3), "2026-02-02");
    assert.equal(shiftIso("2026-03-01", -1), "2026-02-28");
  });
});
