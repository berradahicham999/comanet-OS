/**
 * Garde-fous de la Phase 0 : ces tests échouent si une seconde définition d'une notion
 * métier réapparaît dans le code. Ils lisent les sources, sans exécuter l'application.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { selloutAmountSql, selloutSumSql } from "@/lib/sellout";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
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
