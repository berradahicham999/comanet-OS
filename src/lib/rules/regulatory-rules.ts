import { sql } from "drizzle-orm";
import { db } from "@/db";
import { daysBetween, fmtDate, iso } from "@/lib/format";
import type { Rule, Recommendation } from "./types";
import { brandLabel } from "./stock-rules";

type Row = { id: string; dossier: string; expiry_date: string | null; status: string; missing_documents: string | null; product_name: string | null; product_id: string | null; brand_name: string | null; brand_id: string | null };

export const regulatoryExpiryRule: Rule = {
  id: "regulatory-expiry",
  label: "Autorisation proche de l'expiration",
  description: "Dossier réglementaire expiré ou expirant dans le délai de renouvellement configuré ; documents manquants.",
  async run({ settings, now: today }) {
    const r = await db.execute(sql`
      select rf.id, rf.dossier, rf.expiry_date::text as expiry_date, rf.status::text as status, rf.missing_documents,
             p.name as product_name, p.id as product_id, b.name as brand_name, b.id as brand_id
      from regulatory_files rf left join products p on p.id = rf.product_id left join brands b on b.id = rf.brand_id
      where rf.status <> 'VALIDE' or rf.expiry_date <= ${iso(today)}::date + ${settings.regulatoryRenewalDays}::int
      order by rf.expiry_date nulls last`);
    const out: Recommendation[] = [];
    for (const row of r.rows as Row[]) {
      const label = brandLabel(row.brand_name, row.product_name ?? row.dossier);
      const days = row.expiry_date ? daysBetween(today, new Date(row.expiry_date + "T12:00:00Z")) : null;
      const missing = row.missing_documents?.trim();
      if (days !== null && days <= settings.regulatoryRenewalDays) {
        const expired = days < 0;
        const priority = expired || days <= 30 ? "CRITICAL" : days <= 90 ? "HIGH" : "MEDIUM";
        out.push({
          key: `regulatory-expiry:${row.id}`,
          rule: "regulatory-expiry",
          category: "REGLEMENTAIRE",
          priority,
          title: label,
          subtitle: expired ? `Autorisation expirée depuis ${Math.abs(days)} j` : `Autorisation expire dans ${days} jours`,
          facts: [
            { label: "Dossier", value: row.dossier },
            { label: "Expiration", value: fmtDate(row.expiry_date) },
            { label: "Statut", value: row.status },
            ...(missing ? [{ label: "Documents manquants", value: missing }] : []),
          ],
          why: expired
            ? "Un produit sans autorisation valide ne peut plus être commercialisé légalement : risque de retrait et de blocage des ventes."
            : `Le délai d'instruction impose de lancer le renouvellement au plus tard ${settings.regulatoryRenewalDays} jours avant l'échéance.`,
          action: expired ? "Suspendre la mise en marché et déposer le renouvellement en urgence." : `Lancer le renouvellement${missing ? ` — commencer par réunir : ${missing}.` : "."}`,
          impact: "Continuité de commercialisation du produit.",
          task: { title: `Renouvellement ${row.dossier} — ${row.product_name ?? ""}`.trim(), dueInDays: expired ? 1 : Math.min(14, Math.max(2, days - 60)), role: "REGLEMENTAIRE", priority },
          entity: { type: "regulatory", id: row.id, href: `/reglementaire/${row.id}` },
          brandId: row.brand_id,
        });
      } else if (missing && row.status !== "VALIDE") {
        out.push({
          key: `regulatory-missing:${row.id}`,
          rule: "regulatory-expiry",
          category: "REGLEMENTAIRE",
          priority: "HIGH",
          title: label,
          subtitle: "Dossier incomplet",
          facts: [{ label: "Dossier", value: row.dossier }, { label: "Statut", value: row.status }, { label: "Documents manquants", value: missing }],
          why: "Le dossier ne peut pas avancer tant que les pièces manquent.",
          action: `Réunir et déposer : ${missing}.`,
          task: { title: `Compléter le dossier ${row.dossier} — ${row.product_name ?? ""}`.trim(), dueInDays: 7, role: "REGLEMENTAIRE" },
          entity: { type: "regulatory", id: row.id, href: `/reglementaire/${row.id}` },
          brandId: row.brand_id,
        });
      }
    }
    return out;
  },
};
