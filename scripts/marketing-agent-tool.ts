/**
 * Pont CLI de l'Agent marketing : exécute un outil du copilote sur les données réelles de COMANET OS et
 * imprime le résultat JSON. Sert au sous-agent Claude Code `comanet-marketing` (et à tout script) pour lire
 * ventes, stock, objectifs, marge et activité marketing sans passer par l'interface, avec exactement la même
 * couche (`src/lib/ai/tools/` → `src/lib/marketing-intel/` → fonctions officielles) que le copilote.
 *
 *   npm run agent:tool -- get_brand_overview '{"brand":"Gamarde","period":"30d"}'
 *   npm run agent:tool -- get_marketing_recommendations '{"brand":"Gamarde"}'
 *   npm run agent:tool -- --list
 *
 * Lecture seule : les outils d'écriture (propose_task, propose_report) sont refusés. Nécessite DATABASE_URL
 * (.env.local). Tourne sous la condition `react-server` (modules `server-only`) avec `agent-tool-hooks.mjs`, qui
 * remplace `next/navigation`, `next/headers` et `next/cache` par des stubs hors de Next.js.
 * Le script agit avec tous les droits de lecture : il est destiné à la direction, sur son poste.
 */
import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const [name, rawInput] = process.argv.slice(2);
  const { TOOLS, executeTool, toolDefinitions } = await import("../src/lib/ai/tools");
  if (!name || name === "--list" || name === "-l") {
    for (const d of toolDefinitions(TOOLS.filter((t) => !t.writes))) console.log(`${d.name}\n  ${d.description}\n  paramètres : ${Object.keys(d.input_schema.properties).join(", ") || "(aucun)"}\n`);
    return 0;
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) { console.error(`Outil inconnu : ${name}. Liste : npm run agent:tool -- --list`); return 2; }
  if (tool.writes) { console.error(`Refusé : ${name} écrit dans la base. Le pont CLI est en lecture seule.`); return 2; }
  let input: unknown = {};
  if (rawInput) { try { input = JSON.parse(rawInput); } catch { console.error("Paramètres invalides : attendu un objet JSON, ex. '{\"brand\":\"Gamarde\"}'."); return 2; } }

  const [{ realDeps }, { getRefDate }, { getSettings }, { today }, { noPermissions }] = await Promise.all([
    import("../src/lib/ai/tools/deps"), import("../src/lib/ref-date"), import("../src/lib/settings"), import("../src/lib/format"), import("../src/lib/permissions-shared"),
  ]);
  const perms = noPermissions();
  for (const m of Object.keys(perms) as (keyof typeof perms)[]) perms[m].view = true;
  const [{ ref, lastSale, staleDays }, settings] = await Promise.all([getRefDate(), getSettings()]);
  const ctx = {
    access: { userId: "cli", userName: "Pont CLI", perms, scope: "ALL" as const, brandIds: null, clientIds: null, ownOnly: false, seeInternalCosts: true },
    refDate: ref, now: today(), settings,
    deps: { ...realDeps, logToolCall: async () => undefined },
  };
  const result = await executeTool(name, input, ctx);
  console.log(JSON.stringify({ tool: name, input, data_freshness: { sales_last_import: lastSale ? lastSale.toISOString().slice(0, 10) : null, stale_days: staleDays, run_at: new Date().toISOString() }, result }, null, 2));
  return result.available ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(3); });
