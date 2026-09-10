/** `get_regulatory_alerts` — dossiers DMP à échéance, situation, écart en jours (définition : `regulatory.ts` → `situationOf()`). */
import { z } from "zod";
import { AT_RISK, SITUATIONS, daysUntil, situationOf, variantLabel, type Situation } from "@/lib/regulatory";
import type { AiTool, ToolResult } from "./types";
import { inBrandScope, limitOf, resolveBrand, scopeLabel, unavailable } from "./shared";

const schema = z.object({
  days_ahead: z.number().int().min(0).max(1000).default(180).describe("Horizon en jours : dossiers expirant d'ici N jours (défaut 180), plus ceux déjà expirés, bloqués ou non déposés."),
  brand: z.string().optional().describe("Marque."),
  situation: z.enum(["BLOQUE", "EXPIRE", "CRITIQUE", "NON_DEPOSE", "A_RENOUVELER", "SANS_DATE", "EN_INSTRUCTION", "VALIDE"]).optional().describe("Ne garder qu'une situation."),
  limit: z.number().int().min(1).max(50).optional().describe("Nombre de dossiers (défaut 20, triés par urgence)."),
});

export const getRegulatoryAlerts: AiTool<typeof schema> = {
  name: "get_regulatory_alerts",
  description:
    "Réglementaire (DMP Maroc) : dossiers par situation (bloqué, expiré, critique, à redéposer, non déposé, sans date, en instruction, valide), jours restants avant expiration, statut du certificat (ATD attestation de dépôt, CE certificat d'enregistrement), responsable. Un dossier = une variante (modèle de vente, échantillon, minidose, travel size) d'une référence.",
  module: "reglementaire",
  action: "view",
  schema,
  async run(input, ctx): Promise<ToolResult> {
    const { deps, access, settings } = ctx;
    const { brand, error } = await resolveBrand(ctx, input.brand);
    if (error) return error;
    let files = inBrandScope(await deps.regulatoryFiles(), access, (r) => r.brand_id);
    if (brand) files = files.filter((r) => r.brand_id === brand.id);
    if (!files.length) return unavailable("Aucun dossier réglementaire enregistré dans ce périmètre.", "Importer le classeur réglementaire (Imports → Réglementaire) ou créer les dossiers dans Réglementaire.", "Dossiers DMP");
    const all = files.map((r) => {
      const s = situationOf({ status: r.status, blocked: r.blocked, expiryDate: r.expiry_date }, ctx.now, settings.regulatoryRenewalDays);
      return { ...r, situation: s.situation, days: s.days ?? daysUntil(r.expiry_date, ctx.now) };
    });
    const counts: Record<string, number> = {};
    for (const f of all) counts[f.situation] = (counts[f.situation] ?? 0) + 1;
    const urgent = (f: typeof all[number]) => AT_RISK.includes(f.situation) || f.situation === "A_RENOUVELER" || (f.days !== null && f.days <= input.days_ahead);
    let rows = input.situation ? all.filter((f) => f.situation === input.situation) : all.filter(urgent);
    const order = (s: Situation) => ["BLOQUE", "EXPIRE", "CRITIQUE", "NON_DEPOSE", "A_RENOUVELER", "SANS_DATE", "EN_INSTRUCTION", "VALIDE"].indexOf(s);
    rows = rows.sort((a, b) => order(a.situation) - order(b.situation) || (a.days ?? 9999) - (b.days ?? 9999)).slice(0, limitOf(input.limit, 20));
    return {
      available: true,
      source: `Dossiers réglementaires — situations calculées au ${ctx.now.toISOString().slice(0, 10)} (redépôt à lancer ${settings.regulatoryRenewalDays} j avant expiration)`,
      scope: scopeLabel(access, [brand ? `marque ${brand.name}` : null, `horizon ${input.days_ahead} j`]),
      data: {
        total_files: all.length,
        by_situation: Object.fromEntries(Object.entries(counts).map(([k, v]) => [`${k} (${SITUATIONS[k as Situation]?.label ?? k})`, v])),
        at_risk: all.filter((f) => AT_RISK.includes(f.situation)).length,
        alert_days: settings.regulatoryAlertDays,
        rows: rows.map((f) => ({
          product: f.product_name, brand: f.brand_name, dossier: f.dossier, reference: f.reference, variant: f.variant_type ? variantLabel(f.variant_type) : null, size: f.size,
          situation: f.situation, situation_label: SITUATIONS[f.situation]?.label, days_to_expiry: f.days, expiry_date: f.expiry_date,
          status: f.status, certificate_status: f.certificate_status, blocked: f.blocked, responsible: f.responsible, href: `/reglementaire/${f.id}`,
        })),
      },
      rowCount: rows.length,
      links: [{ label: "Ouvrir Réglementaire", href: "/reglementaire" }],
    };
  },
};
