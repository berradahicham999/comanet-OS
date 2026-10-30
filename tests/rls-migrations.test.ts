/**
 * Sécurité Supabase : toute table publique doit avoir la RLS (sinon l'API PostgREST, clé anon publique, peut la
 * lire, la modifier et la vider — alerte « rls_disabled_in_public »). L'application se connecte en direct et
 * contourne la RLS : l'activer sans politique ne change rien pour elle.
 *
 * Une table est couverte si une migration l'active explicitement (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`)
 * ou si un balayage générique (boucle sur `NOT c.relrowsecurity`, migrations 0033 et 0054) est appliqué au même
 * moment ou après sa création. Une nouvelle table doit donc porter son `ENABLE ROW LEVEL SECURITY` dans sa migration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..", "drizzle");
const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
const migrations = journal.entries
  .sort((a, b) => a.idx - b.idx)
  .map((e) => ({ idx: e.idx, tag: e.tag, sql: readFileSync(join(dir, `${e.tag}.sql`), "utf8") }));

const name = (raw: string) => raw.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();

const created = new Map<string, { idx: number; tag: string }>();
const enabled = new Set<string>();
let lastSweep = -1;
for (const m of migrations) {
  for (const x of m.sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+((?:"?public"?\.)?"?[\w]+"?)/gi)) {
    const t = name(x[1]);
    if (!created.has(t)) created.set(t, { idx: m.idx, tag: m.tag });
  }
  for (const x of m.sql.matchAll(/ALTER TABLE(?: IF EXISTS)?\s+(?:ONLY\s+)?((?:"?public"?\.)?"?[\w]+"?)\s+ENABLE ROW LEVEL SECURITY/gi)) {
    enabled.add(name(x[1]));
  }
  if (/NOT\s+c\.relrowsecurity/i.test(m.sql) && /ENABLE ROW LEVEL SECURITY/i.test(m.sql)) lastSweep = m.idx;
}

test("toutes les migrations du journal sont lues", () => {
  assert.ok(migrations.length > 50);
  assert.ok(created.size > 100);
});

test("toute table créée par une migration a la RLS", () => {
  const missing = [...created].filter(([t, c]) => !enabled.has(t) && c.idx > lastSweep).map(([t, c]) => `${t} (${c.tag})`);
  assert.deepEqual(missing, [], `Ajouter « ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY; » dans la migration : ${missing.join(", ")}`);
});

test("les tables signalées par Supabase le 25/10/2026 sont couvertes", () => {
  for (const t of ["marketing_plans", "marketing_actions", "marketing_decisions", "action_templates", "creative_concepts", "marketing_output_natures"]) {
    const c = created.get(t);
    assert.ok(c, `${t} introuvable dans les migrations`);
    assert.ok(enabled.has(t) || c.idx <= lastSweep, `${t} sans RLS`);
  }
});
