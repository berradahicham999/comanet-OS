/**
 * File « À décider » (téléphone + Cockpit) : tri, lecture d'une décision reçue, contrat `sources.decisions[]` des rapports
 * d'agents, bascule du rapport en VALIDATED, réglage « Réglementaire hors du Cockpit ». Logique pure, aucune base.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { KIND_META, oneLine, readDecision, sortValidations, splitAgentId, VALIDATION_KINDS, type ValidationItem } from "@/lib/validations/shared";
import {
  decisionStates, isIsoDate, isSettled, normalizeReportStatus, parseAgentDecisions, parseOutcomes, pendingDecisions, reportTypeLabel, resolveOwner, withOutcome,
  type AgentOutcome,
} from "@/lib/ai/report-decisions-shared";
import { directionRecommendations, hiddenRuleIds, hiddenTools, REGULATORY_RULE_ID, REGULATORY_TOOL } from "@/lib/rules/visibility";
import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings";

const REPORT = "0b5f6c1e-2d3a-4b7c-8e9f-0a1b2c3d4e5f";
const BRAND = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const item = (p: Partial<ValidationItem>): ValidationItem => ({
  kind: "ACTIVATION", id: REPORT, title: "x", context: "", why: null, detail: null, lines: [], amountMad: null, dueDate: null, href: "/", refuseLabel: "Refuser", needsReason: true, ...p,
});

const line = (p: Record<string, unknown> = {}) => ({
  id: "d1", title: "Relancer Gamarde en pharmacie", why: "Sell-in en baisse de 18 % sur 3 mois", amount_mad: 12000, due_date: "2026-11-30",
  owner_role: "MARKETING", brand_id: BRAND, expected_kpi: "CA sell-in +10 % en décembre", review_date: "2026-12-31", ...p,
});

describe("tri de la file", () => {
  test("échéance la plus proche d'abord, sans échéance à la fin", () => {
    const out = sortValidations([item({ title: "sans", dueDate: null }), item({ title: "loin", dueDate: "2026-12-20" }), item({ title: "proche", dueDate: "2026-11-15" })]);
    assert.deepEqual(out.map((i) => i.title), ["proche", "loin", "sans"]);
  });
  test("à échéance égale, le montant le plus élevé d'abord ; un montant absent passe après", () => {
    const out = sortValidations([
      item({ title: "petit", dueDate: "2026-11-20", amountMad: 500 }), item({ title: "absent", dueDate: "2026-11-20", amountMad: null }),
      item({ title: "gros", dueDate: "2026-11-20", amountMad: 40000 }), item({ title: "zéro", dueDate: "2026-11-20", amountMad: 0 }),
    ]);
    assert.deepEqual(out.map((i) => i.title), ["gros", "petit", "zéro", "absent"]);
  });
  test("l'échéance prime sur le montant", () => {
    const out = sortValidations([item({ title: "gros tardif", dueDate: "2026-12-01", amountMad: 90000 }), item({ title: "petit urgent", dueDate: "2026-11-16", amountMad: 100 })]);
    assert.equal(out[0].title, "petit urgent");
  });
  test("à égalité complète, ordre stable par nature puis titre ; la liste reçue n'est pas modifiée", () => {
    const input = [item({ kind: "CONTENU", title: "b" }), item({ kind: "PIECE", title: "z" }), item({ kind: "CONTENU", title: "a" })];
    const out = sortValidations(input);
    assert.deepEqual(out.map((i) => `${i.kind}:${i.title}`), ["PIECE:z", "CONTENU:a", "CONTENU:b"]);
    assert.equal(input[0].title, "b");
  });
  test("chaque nature a un libellé", () => {
    for (const k of VALIDATION_KINDS) assert.ok(KIND_META[k].label);
  });
});

describe("décision reçue d'un écran", () => {
  test("un identifiant de contenu, d'activation, de pièce ou de rapport est un UUID", () => {
    assert.deepEqual(readDecision({ kind: "CONTENU", id: REPORT, decision: "OK" }), { kind: "CONTENU", id: REPORT, decision: "OK", comment: null });
    assert.equal(readDecision({ kind: "PIECE", id: "42", decision: "OK" }), null);
    assert.equal(readDecision({ kind: "RAPPORT", id: `${REPORT}:d1`, decision: "KO" }), null);
  });
  test("une décision d'agent s'écrit <rapport>:<décision>", () => {
    assert.deepEqual(splitAgentId(`${REPORT}:d-1:bis`), { reportId: REPORT, decisionId: "d-1:bis" });
    assert.equal(splitAgentId(REPORT), null);
    assert.equal(splitAgentId(`pas-un-uuid:d1`), null);
    assert.equal(readDecision({ kind: "DECISION_AGENT", id: REPORT, decision: "OK" }), null);
    assert.ok(readDecision({ kind: "DECISION_AGENT", id: `${REPORT}:d1`, decision: "KO", comment: "  trop cher  " })?.comment === "trop cher");
  });
  test("une décision marketing porte la clé du moteur, quelle qu'en soit la forme", () => {
    assert.ok(readDecision({ kind: "DECISION", id: "ads-performance:campaign:123", decision: "OK" }));
    assert.equal(readDecision({ kind: "DECISION", id: "   ", decision: "OK" }), null);
  });
  test("nature inconnue, décision inconnue ou corps illisible : rejeté", () => {
    assert.equal(readDecision({ kind: "AUTRE", id: REPORT, decision: "OK" }), null);
    assert.equal(readDecision({ kind: "CONTENU", id: REPORT, decision: "PEUT-ETRE" }), null);
    assert.equal(readDecision(null), null);
    assert.equal(readDecision("OK"), null);
  });
  test("le pourquoi tient sur une ligne", () => {
    assert.equal(oneLine("\n  Première raison.\nDeuxième."), "Première raison.");
    assert.equal(oneLine("   "), null);
    assert.equal(oneLine("a".repeat(300), 50)?.length, 50);
  });
});

describe("contrat sources.decisions[]", () => {
  test("une ligne conforme est lue telle quelle", () => {
    const p = parseAgentDecisions({ decisions: [line()] });
    assert.equal(p.declared, true);
    assert.equal(p.ignored, 0);
    assert.deepEqual(p.decisions[0], {
      id: "d1", title: "Relancer Gamarde en pharmacie", why: "Sell-in en baisse de 18 % sur 3 mois", amountMad: 12000, dueDate: "2026-11-30",
      ownerRole: "MARKETING", brandId: BRAND, expectedKpi: "CA sell-in +10 % en décembre", reviewDate: "2026-12-31",
    });
  });
  test("montant et marque absents ou null : acceptés, jamais estimés", () => {
    const p = parseAgentDecisions({ decisions: [line({ amount_mad: null, brand_id: null }), line({ id: "d2", amount_mad: undefined, brand_id: undefined })] });
    assert.equal(p.decisions.length, 2);
    assert.deepEqual(p.decisions.map((d) => [d.amountMad, d.brandId]), [[null, null], [null, null]]);
  });
  test("un rapport sans tableau n'est pas « déclaré » : il se lit comme un rapport à lire", () => {
    for (const sources of [null, undefined, [], "texte", { tables: ["sales"] }, { decisions: "aucune" }, { decisions: { id: "d1" } }, [{ tool: "get_sales_summary", ok: true }]]) {
      assert.deepEqual(parseAgentDecisions(sources), { declared: false, decisions: [], ignored: 0 });
    }
  });
  test("une ligne mal formée est ignorée et comptée, les autres restent", () => {
    const bad = [
      null, "texte", 12, [], {},
      line({ id: "" }), line({ id: "x1", title: "  " }), line({ id: "x2", why: null }), line({ id: "x3", owner_role: 3 }), line({ id: "x4", expected_kpi: "" }),
      line({ id: "x5", due_date: "30/11/2026" }), line({ id: "x6", due_date: "2026-02-31" }), line({ id: "x7", review_date: null }),
      line({ id: "x8", amount_mad: "12 000" }), line({ id: "x9", amount_mad: -5 }), line({ id: "x10", amount_mad: Number.NaN }),
      line({ id: "x11", brand_id: "gamarde" }),
    ];
    const p = parseAgentDecisions({ decisions: [line(), ...bad, line({ id: "d2" })] });
    assert.deepEqual(p.decisions.map((d) => d.id), ["d1", "d2"]);
    assert.equal(p.ignored, bad.length);
  });
  test("un identifiant répété dans le même rapport n'est lu qu'une fois", () => {
    const p = parseAgentDecisions({ decisions: [line(), line({ title: "Doublon" })] });
    assert.equal(p.decisions.length, 1);
    assert.equal(p.decisions[0].title, "Relancer Gamarde en pharmacie");
    assert.equal(p.ignored, 1);
  });
  test("un identifiant numérique est accepté", () => {
    assert.equal(parseAgentDecisions({ decisions: [line({ id: 7 })] }).decisions[0].id, "7");
  });
  test("dates du calendrier seulement", () => {
    assert.equal(isIsoDate("2026-11-30"), true);
    assert.equal(isIsoDate("2026-11-31"), false);
    assert.equal(isIsoDate("2026-1-3"), false);
    assert.equal(isIsoDate(20261130), false);
  });
  test("des outcomes illisibles valent « non tranchée »", () => {
    const sources = { decisions: [line(), line({ id: "d2" })], outcomes: { d1: { status: "PEUT-ETRE" }, d2: "oui", d3: null } };
    assert.deepEqual(parseOutcomes(sources), {});
    assert.equal(pendingDecisions(sources).length, 2);
    assert.deepEqual(parseOutcomes({ outcomes: [] }), {});
  });
});

describe("bascule du rapport en VALIDATED", () => {
  const outcome = (status: AgentOutcome["status"], taskId: string | null = null): AgentOutcome => ({ status, at: "2026-11-14T09:00:00.000Z", byId: "u1", byName: "Hicham", reason: status === "REJECTED" ? "Hors budget" : null, taskId });

  test("le statut écrit par les agents (« draft ») est compris comme DRAFT", () => {
    assert.equal(normalizeReportStatus("draft"), "DRAFT");
    assert.equal(normalizeReportStatus("Validated"), "VALIDATED");
    assert.equal(normalizeReportStatus("ARCHIVED"), "ARCHIVED");
    assert.equal(normalizeReportStatus(null), "DRAFT");
  });
  test("tant qu'une décision reste à trancher, le rapport reste en brouillon", () => {
    const sources = { tables: ["sales"], decisions: [line(), line({ id: "d2" })] };
    const next = withOutcome(sources, "DRAFT", "d1", outcome("APPROVED", "t1"));
    assert.ok(next);
    assert.equal(next.status, "DRAFT");
    assert.equal(isSettled(next.sources), false);
    assert.deepEqual(pendingDecisions(next.sources).map((d) => d.id), ["d2"]);
  });
  test("la dernière décision tranchée — validée ou refusée — fait passer le rapport VALIDATED", () => {
    const sources = { decisions: [line(), line({ id: "d2" })] };
    const first = withOutcome(sources, "DRAFT", "d1", outcome("APPROVED", "t1"))!;
    const second = withOutcome(first.sources, first.status, "d2", outcome("REJECTED"))!;
    assert.equal(second.status, "VALIDATED");
    assert.equal(isSettled(second.sources), true);
    const states = decisionStates(second.sources).decisions;
    assert.deepEqual(states.map((d) => d.outcome?.status), ["APPROVED", "REJECTED"]);
    assert.equal(states[0].outcome?.taskId, "t1");
    assert.equal(states[1].outcome?.reason, "Hors budget");
  });
  test("ce que l'agent a écrit n'est jamais modifié", () => {
    const sources = { tables: ["sales"], decisions: [line()] };
    const frozen = JSON.stringify(sources);
    const next = withOutcome(sources, "DRAFT", "d1", outcome("APPROVED"))!;
    assert.equal(JSON.stringify(sources), frozen);
    assert.deepEqual(next.sources.decisions, sources.decisions);
    assert.deepEqual(next.sources.tables, ["sales"]);
  });
  test("une décision déjà tranchée (sur le téléphone pendant que le bureau est ouvert) ne se tranche pas deux fois", () => {
    const first = withOutcome({ decisions: [line(), line({ id: "d2" })] }, "DRAFT", "d1", outcome("APPROVED"))!;
    assert.equal(withOutcome(first.sources, first.status, "d1", outcome("REJECTED")), null);
  });
  test("décision inconnue, ligne mal formée ou rapport sans tableau : rien à trancher", () => {
    assert.equal(withOutcome({ decisions: [line()] }, "DRAFT", "inconnue", outcome("APPROVED")), null);
    assert.equal(withOutcome({ decisions: [line({ due_date: "bientôt" })] }, "DRAFT", "d1", outcome("APPROVED")), null);
    assert.equal(withOutcome(null, "DRAFT", "d1", outcome("APPROVED")), null);
  });
  test("une ligne illisible n'empêche pas la bascule : seules les décisions lisibles comptent", () => {
    const next = withOutcome({ decisions: [line(), { id: "cassée" }] }, "DRAFT", "d1", outcome("APPROVED"))!;
    assert.equal(next.status, "VALIDATED");
  });
  test("un rapport sans décision lisible n'est jamais « tranché » de lui-même", () => {
    assert.equal(isSettled({ decisions: [] }), false);
    assert.equal(isSettled({ tables: [] }), false);
  });
  test("un rapport archivé ne redevient pas validé", () => {
    assert.equal(withOutcome({ decisions: [line()] }, "ARCHIVED", "d1", outcome("APPROVED"))!.status, "ARCHIVED");
  });
});

describe("responsable et libellés", () => {
  const users = [
    { id: "u1", email: "direction@exemple.ma", role: "ADMIN" as const },
    { id: "u2", email: "marketing@exemple.ma", role: "MARKETING" as const },
    { id: "u3", email: "terrain@exemple.ma", role: "TRADE" as const },
  ];
  test("owner_role : un rôle, en clé ou en clair", () => {
    assert.equal(resolveOwner("MARKETING", users)?.id, "u2");
    assert.equal(resolveOwner("Responsable marketing", users)?.id, "u2");
    assert.equal(resolveOwner("Direction", users)?.id, "u1");
    assert.equal(resolveOwner("commercial", users)?.id, "u3");
  });
  test("owner_role : l'adresse d'un compte", () => {
    assert.equal(resolveOwner("Terrain@exemple.ma", users)?.id, "u3");
    assert.equal(resolveOwner("inconnu@exemple.ma", users), null);
  });
  test("sans correspondance, personne n'est désigné d'office", () => {
    assert.equal(resolveOwner("Agence externe", users), null);
    assert.equal(resolveOwner("réglementaire", users), null);
  });
  test("le type d'un agent externe reste lisible", () => {
    assert.equal(reportTypeLabel("WEEKLY"), "COMANET WEEKLY");
    assert.equal(reportTypeLabel("comanet_cmo_monthly"), "Comanet cmo monthly");
    assert.equal(reportTypeLabel(""), "Rapport");
  });
});

describe("réglementaire hors du Cockpit", () => {
  const recs = [{ rule: REGULATORY_RULE_ID, key: "a" }, { rule: "stock-coverage", key: "b" }];
  test("activé par défaut, et conservé par un réglage enregistré avant son ajout", () => {
    assert.equal(DEFAULT_SETTINGS.cockpit.hideRegulatory, true);
    assert.equal(mergeSettings({ budgetAlertPct: 75 }).cockpit.hideRegulatory, true);
    assert.equal(mergeSettings({ cockpit: { hideRegulatory: false } }).cockpit.hideRegulatory, false);
  });
  test("activé : la règle et l'outil sortent du Cockpit, du brief et des rapports", () => {
    const on = { cockpit: { hideRegulatory: true } };
    assert.deepEqual(hiddenRuleIds(on), [REGULATORY_RULE_ID]);
    assert.deepEqual(hiddenTools(on), [REGULATORY_TOOL]);
    assert.deepEqual(directionRecommendations(recs, on).map((r) => r.key), ["b"]);
  });
  test("désactivé : rien n'est masqué", () => {
    const off = { cockpit: { hideRegulatory: false } };
    assert.deepEqual(hiddenRuleIds(off), []);
    assert.deepEqual(hiddenTools(off), []);
    assert.equal(directionRecommendations(recs, off).length, 2);
  });
  test("l'identifiant masqué est bien celui de la règle et de l'outil", () => {
    assert.match(readFileSync("src/lib/rules/regulatory-rules.ts", "utf8"), new RegExp(`id:\\s*"${REGULATORY_RULE_ID}"`));
    assert.match(readFileSync("src/lib/ai/tools/regulatory.ts", "utf8"), new RegExp(`name:\\s*"${REGULATORY_TOOL}"`));
  });
});

describe("une seule file, partagée par le téléphone et le Cockpit", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p.split(sep).join("/"));
    }
    return out;
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const FILES = walk("src").map((path) => ({ path, code: strip(readFileSync(path, "utf8")) }));

  test("la file ne vit plus dans src/lib/mobile", () => {
    assert.equal(existsSync("src/lib/mobile/validations.ts"), false);
    assert.equal(existsSync("src/lib/mobile/validations-shared.ts"), false);
    const found = FILES.filter((f) => /lib\/mobile\/validations|from\s+"\.\/validations(-shared)?"/.test(f.code) && f.path.startsWith("src/lib/mobile/")).map((f) => f.path);
    assert.deepEqual(found, []);
  });
  test("le téléphone et le Cockpit passent par les mêmes fonctions", () => {
    const route = FILES.find((f) => f.path === "src/app/api/m/validations/route.ts")!.code;
    const action = FILES.find((f) => f.path === "src/app/(app)/a-decider/actions.ts")!.code;
    for (const code of [route, action]) {
      assert.match(code, /from "@\/lib\/validations\/queue"/);
      assert.match(code, /decideValidation\(access, d\)/);
      assert.match(code, /readDecision\(/);
      assert.match(code, /access\.preview/);
    }
    assert.match(route, /listValidations\(access\)/);
    for (const page of ["src/app/(app)/page.tsx", "src/app/(app)/a-decider/page.tsx"]) assert.match(FILES.find((f) => f.path === page)!.code, /listValidations\(access\)/);
  });
  test("`decideValidation()` et `listValidations()` ne sont définies qu'une fois", () => {
    const found = FILES.filter((f) => /export async function (decideValidation|listValidations)\b/.test(f.code)).map((f) => f.path);
    assert.deepEqual(found, ["src/lib/validations/queue.ts"]);
  });
  test("la file n'écrit rien elle-même : elle délègue aux écritures officielles", () => {
    const queue = FILES.find((f) => f.path === "src/lib/validations/queue.ts")!.code;
    assert.equal(/\b(insert|update|delete)\(/.test(queue), false);
    assert.equal(/sql`[^`]*\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i.test(queue), false);
    for (const fn of ["transition(", "transitionActivation(", "validateAndRender(", "approveDecision(", "rejectDecision(", "decideReportDecision(", "setReportStatus("]) assert.ok(queue.includes(fn), `${fn} absent de la file`);
  });
  test("seul `report-decisions.ts` consigne le sort d'une décision d'agent", () => {
    const found = FILES.filter((f) => /withOutcome\(/.test(f.code) && !f.path.endsWith("report-decisions-shared.ts")).map((f) => f.path);
    assert.deepEqual(found, ["src/lib/ai/report-decisions.ts"]);
  });
});
