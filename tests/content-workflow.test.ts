/**
 * Planning éditorial : transitions, retards, templates — logique pure de `src/lib/content/shared.ts`.
 * Les statuts utilisés ici sont des données de test : le code ne connaît aucun nom de statut.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkTransition, nextTransitions, lateness, applyTemplate, refKey, shiftIso, mergeImportedBrief, briefMarkdown, type StatusRef, type TransitionRef, type BriefState } from "@/lib/content/shared";

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

describe("Brief PDF importé", () => {
  const ctx = { platforms: ["INSTAGRAM", "TIKTOK"], formats: ["REEL", "POST"], objectives: ["NOTORIETE"], products: [{ id: "p1", name: "Gamarde Crème Hydratante" }, { id: "p2", name: "Gamarde Sérum Éclat" }] };
  const base: BriefState = { keyMessage: "Ancien message", hook: "Accroche saisie", caption: null, brief: "Notes", references: [{ url: "https://a.ma" }], platform: "INSTAGRAM", format: "POST", objective: null, deadline: "2026-10-10", productIds: ["p1"] };

  test("le PDF remplace ce qu'il dit, ne vide jamais ce qu'il ne dit pas", () => {
    const { patch, changed } = mergeImportedBrief(base, { summary: "Un reel produit.", keyMessage: "Hydrate 24 h", hook: null, caption: "  " }, ctx);
    assert.equal(patch.keyMessage, "Hydrate 24 h");
    assert.equal("hook" in patch, false);
    assert.equal("caption" in patch, false);
    assert.equal(patch.brief, "Un reel produit.");
    assert.deepEqual(changed, ["Message clé", "Notes de brief (résumé)"]);
  });
  test("les points manquants s'ajoutent au résumé", () => {
    const { patch } = mergeImportedBrief(base, { summary: "Résumé", missing: ["durée de la vidéo"] }, ctx);
    assert.match(patch.brief ?? "", /À préciser[\s\S]*- durée de la vidéo/);
  });
  test("clés hors référentiel ignorées, deadline posée seulement si absente", () => {
    const { patch } = mergeImportedBrief(base, { summary: null, platform: "SNAPCHAT", format: "REEL", objective: "NOTORIETE", deadline: "2026-10-08" }, ctx);
    assert.equal("platform" in patch, false);
    assert.equal(patch.format, "REEL");
    assert.equal(patch.objective, "NOTORIETE");
    assert.equal("deadline" in patch, false);
    const sans = mergeImportedBrief({ ...base, deadline: null }, { summary: null, deadline: "2026-10-08" }, ctx);
    assert.equal(sans.patch.deadline, "2026-10-08");
  });
  test("références et produits s'ajoutent sans doublon (noms sans accents ni casse)", () => {
    const { patch } = mergeImportedBrief(base, { summary: null, references: [{ url: "https://a.ma" }, { url: "https://b.ma", label: "Inspi" }, { url: "javascript:x" }], products: ["gamarde serum eclat", "Produit inconnu", "Gamarde Crème Hydratante"] }, ctx);
    assert.deepEqual(patch.references, [{ url: "https://a.ma" }, { url: "https://b.ma", label: "Inspi" }]);
    assert.deepEqual(patch.productIds, ["p1", "p2"]);
  });
  test("relire le même PDF ne change rien", () => {
    const first = mergeImportedBrief(base, { summary: "R", keyMessage: "M" }, ctx);
    const again = mergeImportedBrief({ ...base, ...first.patch }, { summary: "R", keyMessage: "M" }, ctx);
    assert.deepEqual(again.changed, []);
  });
  test("le brief à coller omet les champs vides et rappelle où déposer le livrable", () => {
    const md = briefMarkdown({ title: "Reel crème", brand: "Gamarde", platform: "Instagram", format: null, objective: null, date: "2026-10-12", publishTime: "18:00:00", deadline: null, fields: { keyMessage: "Hydrate", hook: "" }, references: [], products: [{ name: "Crème", claims: "Hydrate 24 h" }], briefPdf: "brief.pdf" });
    assert.match(md, /# Brief — Reel crème/);
    assert.match(md, /2026-10-12 à 18:00/);
    assert.match(md, /## Message clé\nHydrate/);
    assert.doesNotMatch(md, /Accroche/);
    assert.match(md, /Allégations autorisées\*\* : Hydrate 24 h/);
    assert.match(md, /Déposer le livrable/);
  });
});
