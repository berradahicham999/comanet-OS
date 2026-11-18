/**
 * Simplification du module Marketing (décision d'Hicham, 18/11/2026) : cinq entrées de menu, pages masquées
 * renvoyées côté serveur vers la page la plus proche, et aucun lien de l'application vers une page masquée.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { NAV } from "@/components/nav-config";
import { MARKETING_REDIRECTS, HIDDEN_MARKETING_PATHS, HIDDEN_MARKETING_EXACT, isHiddenMarketingHref } from "@/lib/marketing-redirects";

describe("menu Marketing", () => {
  test("cinq entrées : Pilotage, Opérations, Contenu, Digital Ads, Plan & budget", () => {
    const g = NAV.find((x) => x.title === "Marketing");
    assert.ok(g);
    assert.deepEqual(g.items.map((i) => [i.label, i.href]), [
      ["Pilotage", "/marketing"], ["Opérations", "/marketing/activations"], ["Contenu", "/marketing/planning"],
      ["Digital Ads", "/marketing/ads"], ["Plan & budget", "/marketing/plan"],
    ]);
    for (const i of g.items) assert.ok(!isHiddenMarketingHref(i.href), i.href);
  });
  test("Opérations regroupe campagnes, influence et matériel ; Plan & budget regroupe budgets et résultats", () => {
    const g = NAV.find((x) => x.title === "Marketing")!;
    assert.deepEqual(g.items.find((i) => i.label === "Opérations")?.match, ["/marketing/campagnes", "/marketing/influence", "/marketing/materiel"]);
    assert.deepEqual(g.items.find((i) => i.label === "Plan & budget")?.match, ["/marketing/budgets", "/marketing/analytics"]);
  });
});

describe("pages masquées", () => {
  test("reconnaît les adresses masquées, garde la fiche d'une action et les résultats", () => {
    for (const h of ["/marketing/studio", "/marketing/studio/concept/abc?onglet=brief", "/marketing/bibliotheque/nouveau", "/marketing/priorites", "/marketing/priorites?brand=x",
      "/marketing/priorites/generer?brand=x", "/marketing/priorites/generer/k", "/marketing/agent?brand=x", "/marketing/analytics", "/marketing/analytics?period=last30",
      "/marketing/analytics/canaux?brand=x", "/marketing/analytics/360", "/marketing/analytics/qualite"]) assert.ok(isHiddenMarketingHref(h), h);
    for (const h of ["/marketing", "/marketing/priorites/0f2c9a1e-1111-4222-8333-944445555666", "/marketing/analytics/plan?brand=x", "/marketing/analytics/revue/abc",
      "/marketing/activations", "/marketing/planning", "/marketing/ads", "/marketing/plan", "/marketing/budgets", "/marketing/studios-x"]) assert.ok(!isHiddenMarketingHref(h), h);
  });
  test("chaque page masquée a une redirection, et aucune redirection ne mène à une page masquée", () => {
    const sources = MARKETING_REDIRECTS.map((r) => r.source);
    for (const p of [...HIDDEN_MARKETING_PATHS, ...HIDDEN_MARKETING_EXACT]) assert.ok(sources.includes(p), `redirection manquante : ${p}`);
    for (const p of HIDDEN_MARKETING_PATHS.filter((x) => x !== "/marketing/agent" && !x.startsWith("/marketing/analytics/"))) assert.ok(sources.includes(`${p}/:path*`), `sous-pages non couvertes : ${p}`);
    for (const r of MARKETING_REDIRECTS) {
      assert.equal(r.permanent, false, "réversible : jamais de 308");
      assert.ok(!isHiddenMarketingHref(r.destination.replace(":brand", "x")), `${r.source} → ${r.destination}`);
    }
    // La revue de marque passe avant la redirection générique de « marques ».
    const i = MARKETING_REDIRECTS.findIndex((r) => r.source === "/marketing/analytics/marques" && r.has);
    const j = MARKETING_REDIRECTS.findIndex((r) => r.source === "/marketing/analytics/marques" && !r.has);
    assert.ok(i >= 0 && i < j);
  });
  test("next.config.ts sert ces redirections", () => {
    assert.match(readFileSync("next.config.ts", "utf8"), /redirects\(\)\s*\{\s*return MARKETING_REDIRECTS;/);
  });
});

/* ------------------------------ Aucun lien mort ------------------------------ */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
}
const norm = (p: string) => p.split(sep).join("/");

/** Pages masquées elles-mêmes : leur code reste, elles ne sont plus servies. */
const HIDDEN_DIRS = ["src/app/(app)/marketing/studio/", "src/app/(app)/marketing/bibliotheque/", "src/app/(app)/marketing/priorites/generer/", "src/app/(app)/marketing/agent/",
  "src/app/(app)/marketing/analytics/360/", "src/app/(app)/marketing/analytics/canaux/", "src/app/(app)/marketing/analytics/marques/", "src/app/(app)/marketing/analytics/produits/",
  "src/app/(app)/marketing/analytics/qualite/"];
const HIDDEN_FILES = ["src/app/(app)/marketing/priorites/page.tsx", "src/app/(app)/marketing/analytics/page.tsx"];
/** Composants et outils qui ne servent qu'aux pages masquées ou au copilote désactivé (raison à côté). */
const ONLY_FOR_HIDDEN: Record<string, string> = {
  "src/components/creative-studio.tsx": "Studio créatif",
  "src/components/action-proposal.tsx": "liens du générateur (la fiche d'action n'utilise que ProposalSheet, sans lien)",
  "src/components/analytics-ask.tsx": "synthèse analytics",
  "src/components/analytics.tsx": "onglets des pages analytics masquées",
  "src/components/ai/marketing-agent-chat.tsx": "page Agent",
  "src/lib/ai/tools/creative.ts": "outil retiré du registre",
  "src/lib/marketing-redirects.ts": "la liste elle-même",
};

describe("aucun lien vers une page masquée", () => {
  test("ni page, ni règle de l'Action Center, ni outil du copilote, ni file de validation", () => {
    const offenders: string[] = [];
    for (const file of walk("src").map(norm)) {
      if (HIDDEN_DIRS.some((d) => file.startsWith(d)) || HIDDEN_FILES.includes(file) || ONLY_FOR_HIDDEN[file]) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, n) => {
        if (!/href|links:|Link |redirect\(/.test(line)) return;
        // `match: [...]` du menu : préfixes qui allument un item, pas des liens.
        line = line.replace(/match: \[[^\]]*\]/g, "");
        for (const m of line.matchAll(/\/marketing\/[A-Za-z0-9/_-]*/g)) {
          // Un segment dynamique (`/marketing/priorites/${id}`) désigne une fiche, pas la liste.
          const dynamic = line.slice(m.index! + m[0].length, m.index! + m[0].length + 2) === "${";
          const path = dynamic ? `${m[0]}x` : m[0];
          if (isHiddenMarketingHref(path)) offenders.push(`${file}:${n + 1} → ${m[0]}`);
        }
      });
    }
    assert.deepEqual(offenders, []);
  });
});
