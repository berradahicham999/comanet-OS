/**
 * Cycle d'un rapport (`reportMove()`) : valider, archiver, annuler la validation, désarchiver. Aucune base.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reportMove, normalizeReportStatus } from "@/lib/ai/report-decisions-shared";

const admin = { canValidate: true, canEdit: true, wasValidated: false, openDecisions: false };
const viewer = { canValidate: false, canEdit: false, wasValidated: false, openDecisions: false };

describe("reportMove", () => {
  test("un rapport d'agent en minuscules se valide comme un brouillon", () => {
    assert.deepEqual(reportMove(normalizeReportStatus("draft"), "VALIDATE", admin), { ok: true, to: "VALIDATED" });
  });
  test("sans droit, refus explicite (plus d'erreur qui casse la page)", () => {
    const r = reportMove("DRAFT", "VALIDATE", viewer);
    assert.equal(r.ok, false);
    assert.equal(reportMove("DRAFT", "ARCHIVE", viewer).ok, false);
  });
  test("décisions encore à trancher : pas de validation d'un bloc", () => {
    assert.equal(reportMove("DRAFT", "VALIDATE", { ...admin, openDecisions: true }).ok, false);
  });
  test("annuler la validation remet en brouillon (droit Valider)", () => {
    assert.deepEqual(reportMove("VALIDATED", "REOPEN", admin), { ok: true, to: "DRAFT" });
    assert.equal(reportMove("VALIDATED", "REOPEN", { ...viewer, canEdit: true }).ok, false);
  });
  test("désarchiver rend le statut d'avant", () => {
    assert.deepEqual(reportMove("ARCHIVED", "REOPEN", { ...admin, wasValidated: true }), { ok: true, to: "VALIDATED" });
    assert.deepEqual(reportMove("ARCHIVED", "REOPEN", admin), { ok: true, to: "DRAFT" });
  });
  test("un rapport archivé ne se valide pas directement", () => {
    assert.equal(reportMove("ARCHIVED", "VALIDATE", admin).ok, false);
  });
  test("archiver un validé est possible, archiver deux fois non", () => {
    assert.deepEqual(reportMove("VALIDATED", "ARCHIVE", admin), { ok: true, to: "ARCHIVED" });
    assert.equal(reportMove("ARCHIVED", "ARCHIVE", admin).ok, false);
  });
});

import { groupFollowUpsByDelegate } from "@/lib/medical/follow-up-shared";

describe("groupFollowUpsByDelegate (Action Center médical)", () => {
  const doc = (id: string, delegateId: string, highPotential: boolean, days: number | null, neverVisited = false) =>
    ({ id, name: `Dr ${id}`, delegateId, delegateName: delegateId.toUpperCase(), highPotential, neverVisited, daysSinceLastVisit: days });
  test("une carte par déléguée, fort potentiel d'abord puis plus long retard", () => {
    const g = groupFollowUpsByDelegate([doc("a", "x", false, 200), doc("b", "x", true, 40), doc("c", "x", false, 90, true), doc("d", "y", false, 30)]);
    assert.equal(g.length, 2);
    assert.equal(g[0].delegateId, "x");
    assert.deepEqual([g[0].total, g[0].highPotential, g[0].neverVisited], [3, 1, 1]);
    assert.deepEqual(g[0].first.map((d) => d.id), ["b", "a", "c"]);
  });
  test("rien à relancer, aucune carte", () => {
    assert.deepEqual(groupFollowUpsByDelegate([]), []);
  });
});
