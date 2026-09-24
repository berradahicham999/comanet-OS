/** `search_entities` — recherche universelle filtrée par modules visibles (même requête que /recherche). */
import { z } from "zod";
import type { ModuleKey } from "@/lib/access-shared";
import { can } from "@/lib/permissions-shared";
import type { SearchResult } from "@/lib/search";
import type { AiTool, ToolResult } from "./types";
import { limitOf, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  query: z.string().min(2).describe("Mot-clé : nom de marque, produit, référence, client, ville, animatrice, campagne, dossier."),
  limit: z.number().int().min(1).max(20).optional().describe("Résultats par famille (défaut 8)."),
});

const SECTIONS: { key: keyof SearchResult; module: ModuleKey | ModuleKey[]; label: string }[] = [
  { key: "brands", module: "produits", label: "marques" },
  { key: "products", module: "produits", label: "produits" },
  { key: "clients", module: "clients", label: "clients" },
  { key: "users", module: ["terrain", "administration", "taches"], label: "personnes" },
  { key: "campaigns", module: "marketing", label: "campagnes" },
  { key: "contents", module: "marketing", label: "contenus" },
  { key: "regulatory", module: "reglementaire", label: "dossiers réglementaires" },
  { key: "tasks", module: "taches", label: "tâches" },
  { key: "deliveries", module: "livraisons", label: "bons de livraison" },
  { key: "invoices", module: "facturation", label: "factures et avoirs" },
];

export const searchEntities: AiTool<typeof schema> = {
  name: "search_entities",
  description: "Retrouve le nom exact et l'identifiant d'une marque, d'un produit, d'un client, d'une personne (animatrice, délégué), d'une campagne, d'un contenu, d'un dossier réglementaire, d'une tâche ou d'une pièce de vente (numéro de BL, facture, avoir) à partir d'un mot-clé. À utiliser avant un autre outil quand l'orthographe est incertaine.",
  module: "any",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const res = await ctx.deps.search(input.query);
    const limit = limitOf(input.limit, 8);
    const perms = ctx.access.perms;
    const visible = SECTIONS.filter((s) => (Array.isArray(s.module) ? s.module : [s.module]).some((m) => can(perms, m, "view")));
    const data: Record<string, { label: string; sub: string | null; href: string }[]> = {};
    let count = 0;
    for (const s of visible) {
      let hits = res[s.key] ?? [];
      if (s.key === "brands" && ctx.access.brandIds) hits = hits.filter((h) => ctx.access.brandIds!.includes(h.id));
      if (s.key === "clients" && ctx.access.clientIds) hits = hits.filter((h) => ctx.access.clientIds!.includes(h.id));
      if ((s.key === "deliveries" || s.key === "invoices") && ctx.access.clientIds) hits = hits.filter((h) => !!h.clientId && ctx.access.clientIds!.includes(h.clientId));
      if (!hits.length) continue;
      data[s.label] = hits.slice(0, limit).map((h) => ({ label: h.label, sub: h.sub, href: h.href }));
      count += Math.min(hits.length, limit);
    }
    if (!count) return unavailable(`Aucun résultat pour « ${input.query} » dans les modules visibles.`, "Essayer un autre mot-clé (nom partiel, code article, ville).", "Recherche");
    return { available: true, source: "Référentiels COMANET OS", scope: scopeLabel(ctx.access), data, rowCount: count, links: [{ label: "Voir la recherche", href: `/recherche?q=${encodeURIComponent(input.query)}` }] };
  },
};
