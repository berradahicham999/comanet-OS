/**
 * Hooks de résolution du pont CLI de l'Agent marketing (voir `marketing-agent-tool.ts`).
 * Hors de Next.js, `next/navigation`, `next/headers` et `next/cache` n'existent pas : ils sont remplacés par
 * des stubs. Aucune session, aucun cache : les outils de lecture n'en ont pas besoin ; une lecture qui exige
 * une session échoue proprement (« indisponible hors de Next.js ») au lieu de planter au chargement.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const stub = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "agent-tool-next-stubs.cjs")).href;
const STUBBED = new Set(["next/navigation", "next/headers", "next/cache"]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED.has(specifier)) return { url: stub, shortCircuit: true, format: "commonjs" };
    return nextResolve(specifier, context);
  },
});
