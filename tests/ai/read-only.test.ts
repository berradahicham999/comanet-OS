/**
 * Garde-fou : le copilote ne modifie jamais la donnée métier. Depuis `src/lib/ai/`, les seules écritures
 * autorisées visent les tables `ai_*` et une insertion dans `tasks` (statut PROPOSED). Le test lit les
 * sources, sans exécuter l'application.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** Chemins toujours en `/`, même sous Windows, pour matcher les littéraux `"src/lib/…"` des tests. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p.split(sep).join("/"));
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FILES = walk("src/lib/ai").map((path) => ({ path, code: strip(readFileSync(path, "utf8")) }));

const ALLOWED_TABLES = ["aiConversations", "aiMessages", "aiToolCalls", "aiCache", "aiActionPlans", "aiReports", "tasks"];

describe("copilote IA — lecture seule sur la donnée métier", () => {
  test("aucune écriture SQL brute (insert / update / delete / truncate) depuis src/lib/ai", () => {
    const found = FILES.filter((f) => /sql`[^`]*\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i.test(f.code)).map((f) => f.path);
    assert.deepEqual(found, [], `Écriture SQL brute dans : ${found.join(", ")}`);
  });
  test("les écritures Drizzle ne visent que les tables ai_* et tasks", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      for (const m of f.code.matchAll(/db\s*\.\s*(insert|update|delete)\s*\(\s*(\w+)/g)) {
        if (!ALLOWED_TABLES.includes(m[2])) bad.push(`${f.path} → ${m[1]}(${m[2]})`);
      }
    }
    assert.deepEqual(bad, [], `Écriture interdite : ${bad.join(", ")}`);
  });
  test("une tâche créée par le copilote naît toujours au statut PROPOSED avec la source AI", () => {
    const deps = FILES.find((f) => f.path.endsWith("tools/deps.ts"))!;
    const insert = deps.code.match(/db\.insert\(tasks\)[\s\S]*?returning/)![0];
    assert.match(insert, /status:\s*"PROPOSED"/);
    assert.match(insert, /source:\s*"AI"/);
  });
  test("les outils n'importent pas la base : dans tools/, seuls deps.ts et context.ts y accèdent", () => {
    const offenders = FILES.filter((f) => f.path.includes("/tools/") && !/\/(deps|context)\.ts$/.test(f.path) && /from\s+"@\/db"/.test(f.code)).map((f) => f.path);
    assert.deepEqual(offenders, [], `Accès direct à la base dans : ${offenders.join(", ")}`);
  });
});
