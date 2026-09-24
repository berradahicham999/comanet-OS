/**
 * Garde-fous de la Phase 0 : ces tests échouent si une seconde définition d'une notion
 * métier réapparaît dans le code. Ils lisent les sources, sans exécuter l'application.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { selloutAmountSql, selloutSumSql } from "@/lib/sellout";

/** Chemins toujours en `/`, même sous Windows, pour matcher les littéraux `"src/lib/…"` des tests. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p.split(sep).join("/"));
  }
  return out;
}
/** Le corps de chaque source, et le même corps débarrassé de ses commentaires. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FILES = walk("src").map((path) => {
  const body = readFileSync(path, "utf8");
  return { path, body, code: stripComments(body) };
});
const hits = (re: RegExp, exclude: string[] = []) =>
  FILES.filter((f) => !exclude.some((x) => f.path.includes(x)) && re.test(f.body)).map((f) => f.path);
/** Comme `hits`, mais en ignorant les commentaires : une mention documentaire n'est pas un usage. */
const codeHits = (re: RegExp, exclude: string[] = []) =>
  FILES.filter((f) => !exclude.some((x) => f.path.includes(x)) && re.test(f.code)).map((f) => f.path);

describe("CA sell-out — une seule formule", () => {
  test("plus aucune somme brute de `animation_lines.amount` hors du module officiel", () => {
    // `import/run.ts` écrit `amount` (il ne le lit pas) ; `sellout.ts` est la définition.
    const found = hits(/sum\(\s*(al|l)\.amount\s*\)|sum\(amount\)\s+from\s+animation_lines/i, ["lib/sellout.ts", "lib/import/run.ts"]);
    assert.deepEqual(found, [], `Formule de sell-out concurrente dans : ${found.join(", ")}`);
  });
  test("plus aucune valorisation inventée à partir du prix COMANET", () => {
    const found = hits(/price_wholesale\s*\*\s*1\.6/);
    assert.deepEqual(found, [], `Prix public fabriqué dans : ${found.join(", ")}`);
  });
  test("le fragment officiel applique bien la priorité amount → prix ligne → prix produit", () => {
    const sqlText = JSON.stringify(selloutAmountSql("al", "p"));
    assert.match(sqlText, /amount/);
    assert.match(sqlText, /quantity_sold/);
    assert.match(sqlText, /price_retail/);
    assert.match(JSON.stringify(selloutSumSql()), /sum/);
  });
});

describe("Score animatrice — une seule source de vérité", () => {
  test("le second moteur `animatricePerformance` n'existe plus nulle part", () => {
    const found = codeHits(/animatricePerformance/);
    assert.deepEqual(found, [], `Second moteur de score encore présent dans : ${found.join(", ")}`);
  });
  test("le moteur vivant est bien `animatriceScores`", () => {
    assert.ok(hits(/export async function animatriceScores/).includes("src/lib/animations.ts"));
  });
});

describe("Score influence — un seul moteur", () => {
  test("le score relatif (CPM / engagement / ROAS) n'est calculé que par `relativeScore`", () => {
    const found = codeHits(/Math\.min\(\.\.\.cpms\)/, ["lib/influence.ts"]);
    assert.deepEqual(found, [], `Second calcul du score influence dans : ${found.join(", ")}`);
    const body = FILES.find((f) => f.path === "src/lib/influence.ts")!.code;
    assert.equal(body.match(/Math\.min\(\.\.\.cpms\)/g)?.length, 1);
  });
});

describe("Verdict Ads — un seul moteur, aucun seuil en dur", () => {
  test("`diagnose` n'est défini qu'une fois", () => {
    const found = hits(/export function diagnose\(/);
    assert.deepEqual(found, ["src/lib/ads.ts"]);
  });
  test("plus de verdict calculé à la main dans les règles marketing", () => {
    const body = FILES.find((f) => f.path.endsWith("rules/marketing-rules.ts"))!.body;
    assert.doesNotMatch(body, /verdict\s*=\s*"(SCALE|STOP|OPTIMIZE|MAINTAIN)"/);
    assert.doesNotMatch(body, /roas\s*<\s*1\.2|roas\s*>=\s*3/);
  });
  test("les seuils du moteur sont tous nommés, aucun littéral de décision", () => {
    const body = FILES.find((f) => f.path.endsWith("lib/ads.ts"))!.body;
    const diag = body.slice(body.indexOf("export function diagnose("));
    for (const name of ["t.minSpend", "t.minDays", "t.cpmRisePct", "t.ctrDropPct", "t.convDropPct", "t.frequencyMax", "t.cpaVsBrandFactor", "t.cpaRisePct", "t.roasDropPct", "t.roasRisePct", "t.roasVsBrandFactor", "t.roasMin", "t.scaleStepPct", "t.scaleStepDays"]) {
      assert.ok(diag.includes(name), `Seuil ${name} absent de diagnose()`);
    }
  });
});

describe("Couverture stock et risque campagne — une seule définition", () => {
  test("plus de seuil de tension écrit en dur", () => {
    const found = hits(/coverageMonths\s*[<>]=?\s*1\.5|avgMonthly\s*[<>]\s*30\b/);
    assert.deepEqual(found, [], `Seuil de tension en dur dans : ${found.join(", ")}`);
  });
  test("la règle `stock-scale-caution` a bien été retirée du registre", () => {
    const body = FILES.find((f) => f.path.endsWith("rules/index.ts"))!.body;
    assert.doesNotMatch(body, /scaleCautionRule/);
  });
  test("`isUnderTension` est la seule porte d'entrée du risque", () => {
    assert.ok(hits(/export function isUnderTension/).includes("src/lib/stock-math.ts"));
    assert.ok(hits(/isUnderTension\(/).length >= 2);
  });
});

describe("Budget consommé — une seule définition", () => {
  test("plus de somme de statuts COMMITTED/SPENT hors du module officiel", () => {
    const found = hits(/status in \('COMMITTED','SPENT'\)/, ["lib/budget.ts"]);
    assert.deepEqual(found, [], `Calcul de budget concurrent dans : ${found.join(", ")}`);
  });
});

describe("Clé de commande — une seule définition", () => {
  test("plus de repli maison sur `sales.id` ou `sales.date`", () => {
    const found = hits(/coalesce\(s\.invoice_ref, s\.(id|date)::text\)/, ["lib/analytics.ts"]);
    assert.deepEqual(found, [], `Clé de commande concurrente dans : ${found.join(", ")}`);
  });
});

describe("mondayOf — une seule définition", () => {
  test("défini uniquement dans format.ts", () => {
    const found = hits(/function mondayOf\(/);
    assert.deepEqual(found, ["src/lib/format.ts"]);
  });
});

describe("Planning éditorial — une seule façon de changer un statut", () => {
  test("aucune mise à jour directe de content_items.status hors du workflow", () => {
    // `transition()` (workflow.ts) est la seule fonction autorisée à changer le statut d'un contenu :
    // elle vérifie le référentiel des transitions, les droits, écrit l'historique et notifie.
    const found = codeHits(/update\(contentItems\)\s*\.set\(\{[^}]*\bstatus\b|update\s+content_items\s+set[^;]*\bstatus\s*=/i, ["lib/content/workflow.ts", "lib/content/demo.ts"]);
    assert.deepEqual(found, [], `Statut de contenu modifié hors de transition() dans : ${found.join(", ")}`);
  });
  test("aucun nom de statut de contenu codé en dur dans les pages et règles", () => {
    // Les statuts vivent dans `content_statuses` ; le code raisonne sur leurs drapeaux (is_published, awaiting_validation…).
    const found = codeHits(/['"](BRIEF_PRET|EN_CREATION|A_VALIDER|CORRECTIONS|PROGRAMME)['"]/, ["db/seed-demo.ts", "lib/content/demo.ts", "db/schema.ts"]);
    assert.deepEqual(found, [], `Nom de statut de contenu en dur dans : ${found.join(", ")}`);
  });
});

describe("Activations — un seul workflow, un seul reflet budgétaire", () => {
  test("aucune mise à jour directe de activations.status hors du workflow", () => {
    const found = codeHits(/update\(activations\)\s*\.set\(\{[^}]*\bstatus\b|update\s+activations\s+set[^;]*\bstatus\s*=/i, ["lib/activations/workflow.ts", "lib/activations/demo.ts"]);
    assert.deepEqual(found, [], `Statut d'activation modifié hors de transitionActivation() dans : ${found.join(", ")}`);
  });
  test("aucun nom de statut d'activation codé en dur dans les pages et règles", () => {
    // TERMINEE / ANNULEE / VALIDEE existent aussi comme statuts de visite médicale : on ne teste que les clés propres aux activations.
    const found = codeHits(/['"](PROPOSEE|EN_PREPARATION|MESUREE|ARCHIVEE)['"]/, ["db/seed-demo.ts", "lib/activations/demo.ts", "db/schema.ts"]);
    assert.deepEqual(found, [], `Nom de statut d'activation en dur dans : ${found.join(", ")}`);
  });
  test("marketing_expenses n'est alimentée pour une activation que par budget.ts", () => {
    const found = codeHits(/insert into marketing_expenses[^;]*activation_ref|insert\(marketingExpenses\)[^;]*activationRef/i, ["lib/activations/budget.ts"]);
    assert.deepEqual(found, [], `Reflet budgétaire concurrent dans : ${found.join(", ")}`);
  });
  test("les totaux budgétaires ne sont calculés que par budgetTotals()", () => {
    const found = hits(/export function budgetTotals\(/);
    assert.deepEqual(found, ["src/lib/activations/shared.ts"]);
  });
});

describe("Tableaux SQL — toujours via pgArray()", () => {
  test("plus aucun `any(${tableau}::type[])` : drizzle développe le tableau en `($1, $2)`, qui n'est pas un tableau Postgres", () => {
    // Un tableau vide donnait `any(()::uuid[])` (erreur de syntaxe) : la page Ventes plantait dès qu'un secteur était coché.
    const found = codeHits(/=\s*any\(\$\{(?!pgArray\()[^}]*\}\s*::\s*\w+\[\]\)/, ["lib/sql-array.ts"]);
    assert.deepEqual(found, [], `Tableau passé sans pgArray() dans : ${found.join(", ")}`);
  });
});

describe("Stock chez le client — une seule écriture, une seule lecture du dernier relevé", () => {
  test("seul `src/lib/client-stock.ts` écrit dans `client_stock_readings`", () => {
    const found = codeHits(/insert\(clientStockReadings\)|insert\s+into\s+client_stock_readings|delete\(clientStockReadings\)|delete\s+from\s+client_stock_readings/i, ["lib/client-stock.ts"]);
    assert.deepEqual(found, [], `Écriture concurrente dans : ${found.join(", ")}`);
  });
  test("l'ancienneté et la couverture ne sont définies qu'une fois", () => {
    assert.deepEqual(hits(/export function agingOf\(/), ["src/lib/client-stock-shared.ts"]);
    assert.deepEqual(hits(/export function estimatedCoverageWeeks\(/), ["src/lib/client-stock-shared.ts"]);
  });
  test("aucun seuil d'ancienneté en dur hors des paramètres", () => {
    // Un appel `agingOf(…, { freshDays: 15, staleDays: 45 })` contournerait `settings.clientStock`.
    const found = codeHits(/agingOf\([^;]*?\{[^}]*(freshDays|staleDays)\s*:\s*\d/, ["lib/settings.ts"]);
    assert.deepEqual(found, [], `Seuil d'ancienneté écrit en dur dans : ${found.join(", ")}`);
  });
});

describe("Gestion commerciale — journal de stock, numérotation, audit, montants exacts", () => {
  test("seul `src/lib/gestion/ledger.ts` écrit dans `stock_movements`", () => {
    const found = codeHits(/insert\(stockMovements\)|insert\s+into\s+stock_movements/i, ["lib/gestion/ledger.ts"]);
    assert.deepEqual(found, [], `Écriture concurrente du journal dans : ${found.join(", ")}`);
  });
  test("personne ne modifie ni ne supprime un mouvement (le journal est en écriture seule)", () => {
    const found = codeHits(/update\(stockMovements\)|delete\(stockMovements\)|update\s+stock_movements|delete\s+from\s+stock_movements|truncate[^`]*stock_movements/i);
    assert.deepEqual(found, [], `Réécriture du journal dans : ${found.join(", ")}`);
  });
  test("seul `src/lib/gestion/numbering.ts` écrit les compteurs de numérotation", () => {
    const found = codeHits(/insert\(documentSequences\)|update\(documentSequences\)|(insert\s+into|update)\s+document_sequences/i, ["lib/gestion/numbering.ts"]);
    assert.deepEqual(found, [], `Compteur de numérotation écrit hors du module dans : ${found.join(", ")}`);
  });
  test("seul `src/lib/audit.ts` écrit le journal d'audit", () => {
    const found = codeHits(/insert\(auditLogs\)|insert\s+into\s+audit_logs/i, ["lib/audit.ts"]);
    assert.deepEqual(found, [], `Écriture directe du journal d'audit dans : ${found.join(", ")}`);
  });
  test("aucun montant de la gestion commerciale n'est calculé en virgule flottante", () => {
    // Les montants passent par `money.ts` (entiers à échelle fixe). `Number(...)` reste permis pour
    // l'affichage et le tri ; `parseFloat` et `toFixed` (arrondi binaire) sont proscrits.
    const found = codeHits(/parseFloat\(|\.toFixed\(/, ["lib/gestion/money.ts"]).filter((p) => p.includes("lib/gestion/"));
    assert.deepEqual(found, [], `Calcul flottant dans : ${found.join(", ")}`);
  });
  test("le CMUP et la numérotation n'ont qu'une définition", () => {
    assert.deepEqual(hits(/export function nextCmup\(/), ["src/lib/gestion/money.ts"]);
    assert.deepEqual(hits(/export function formatNumber\(/), ["src/lib/gestion/numbering-shared.ts"]);
    assert.deepEqual(hits(/export async function allocateNumber\(/), ["src/lib/gestion/numbering.ts"]);
    assert.deepEqual(hits(/export async function recordStockMovements\(/), ["src/lib/gestion/ledger.ts"]);
  });
});

describe("Gestion commerciale — pièces de vente", () => {
  test("seul `src/lib/gestion/documents.ts` crée, valide ou fait évoluer une pièce", () => {
    const found = codeHits(/(insert|update|delete)\(salesDocuments\)|(insert|update|delete)\(salesDocumentLines\)|(insert\s+into|update|delete\s+from)\s+sales_documents?\b|update\s+sales_document_lines/i, ["lib/gestion/documents.ts"]);
    assert.deepEqual(found, [], `Écriture de pièce hors du module dans : ${found.join(", ")}`);
  });
  test("seul `src/lib/gestion/projection.ts` écrit les ventes émises par COMANET OS", () => {
    assert.deepEqual(codeHits(/source:\s*"COMANET_OS"/), ["src/lib/gestion/documents-shared.ts"]);
    const found = codeHits(/insert\(sales\)|insert\s+into\s+sales\b/i, ["lib/import/", "lib/gestion/projection.ts"]).filter((p) => p.includes("lib/gestion/"));
    assert.deepEqual(found, [], `Projection concurrente dans : ${found.join(", ")}`);
  });
  test("montants d'une pièce, montant en lettres et PDF n'ont qu'une définition", () => {
    assert.deepEqual(hits(/export function computeDocument\(/), ["src/lib/gestion/calc.ts"]);
    assert.deepEqual(hits(/export function amountInWords\(/), ["src/lib/gestion/calc.ts"]);
    assert.deepEqual(hits(/export function commercialIssues\(/), ["src/lib/gestion/documents-shared.ts"]);
    assert.deepEqual(hits(/export async function validateDocument\(/), ["src/lib/gestion/documents.ts"]);
    assert.deepEqual(hits(/export async function storedPdf\(/), ["src/lib/gestion/pdf.tsx"]);
  });
});

describe("Gestion commerciale — achats", () => {
  test("seul `src/lib/gestion/purchases.ts` crée, valide ou fait évoluer une pièce d'achat", () => {
    const found = codeHits(/(insert|update|delete)\((purchaseDocuments|purchaseDocumentLines|landedCosts)\)|(insert\s+into|update|delete\s+from)\s+(purchase_documents?|purchase_document_lines|landed_costs)\b/i, ["lib/gestion/purchases.ts"]);
    assert.deepEqual(found, [], `Écriture de pièce d'achat hors du module dans : ${found.join(", ")}`);
  });
  test("montants d'achat, frais d'approche et coût de revient n'ont qu'une définition", () => {
    assert.deepEqual(hits(/export function computePurchase\(/), ["src/lib/gestion/purchases-shared.ts"]);
    assert.deepEqual(hits(/export function allocateLandedCosts\(/), ["src/lib/gestion/purchases-shared.ts"]);
    assert.deepEqual(hits(/export function unitCostMad\(/), ["src/lib/gestion/purchases-shared.ts"]);
    assert.deepEqual(hits(/export async function validatePurchase\(/), ["src/lib/gestion/purchases.ts"]);
  });
});

describe("Gestion commerciale — inventaires", () => {
  test("seul `src/lib/gestion/counts.ts` écrit les inventaires", () => {
    const found = codeHits(/(insert|update|delete)\((stockCounts|stockCountLines|stockCountEntries)\)|(insert\s+into|update|delete\s+from)\s+(stock_counts|stock_count_lines|stock_count_entries)\b/i, ["lib/gestion/counts.ts"]);
    assert.deepEqual(found, [], `Écriture d'inventaire hors du module dans : ${found.join(", ")}`);
  });
  test("écart, fiabilité et pistes n'ont qu'une définition", () => {
    assert.deepEqual(hits(/export function lineGap\(/), ["src/lib/gestion/counts-shared.ts"]);
    assert.deepEqual(hits(/export function countStats\(/), ["src/lib/gestion/counts-shared.ts"]);
    assert.deepEqual(hits(/export function gapLeads\(/), ["src/lib/gestion/counts-shared.ts"]);
    assert.deepEqual(hits(/export async function validateCount\(/), ["src/lib/gestion/counts.ts"]);
  });
});

describe("Gestion commerciale — règlements et bascule", () => {
  test("seul `src/lib/gestion/payments.ts` écrit règlements, imputations et relances", () => {
    const found = codeHits(/(insert|update|delete)\((payments|paymentAllocations|paymentReminders)\)|(insert\s+into|update|delete\s+from)\s+(payments|payment_allocations|payment_reminders)\b/i, ["lib/gestion/payments.ts"]);
    assert.deepEqual(found, [], `Écriture de règlement hors du module dans : ${found.join(", ")}`);
  });
  test("solde, balance âgée, relance et bascule n'ont qu'une définition", () => {
    assert.deepEqual(hits(/export function invoiceBalance\(/), ["src/lib/gestion/receivables-shared.ts"]);
    assert.deepEqual(hits(/export function agingBucket\(/), ["src/lib/gestion/receivables-shared.ts"]);
    assert.deepEqual(hits(/export function reminderLevel\(/), ["src/lib/gestion/receivables-shared.ts"]);
    assert.deepEqual(hits(/export function emitsReal\(/), ["src/lib/gestion/documents-shared.ts"]);
    assert.deepEqual(hits(/export function importBlockedByCutover\(/), ["src/lib/gestion/documents-shared.ts"]);
    assert.deepEqual(hits(/export async function setCutoverMode\(/), ["src/lib/gestion/cutover.ts"]);
  });
  test("le mode de bascule ne se lit que par `emitsReal()` (plus de `mode !== \"ACTIF\"` en dur dans les pièces)", () => {
    const found = codeHits(/cutover\.mode\s*!==\s*"ACTIF"/).filter((p) => p.includes("lib/gestion/"));
    assert.deepEqual(found, [], `Test du mode en dur dans : ${found.join(", ")}`);
  });
});

