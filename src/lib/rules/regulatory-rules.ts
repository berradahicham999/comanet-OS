import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, iso } from "@/lib/format";
import { AT_RISK, CERTIFICATE_STATUS, SITUATIONS, formatDays, situationOf, variantLabel } from "@/lib/regulatory";
import type { Rule, Recommendation } from "./types";
import { brandLabel } from "./stock-rules";

type Row = {
  id: string; dossier: string; reference: string | null; variant_type: string; size: string | null;
  expiry_date: string | null; filing_date: string | null; status: string; certificate_status: string;
  blocked: boolean; blocked_reason: string | null; missing_documents: string | null;
  product_name: string | null; product_id: string | null; brand_name: string | null; brand_id: string | null;
  sold_12m: number;
};

/**
 * Échéances DMP : expiration de l'ATD, dossiers sans date, non déposés, blocages.
 * Le CA des 12 derniers mois de la référence sert à prioriser : un dossier expiré
 * sur un produit qui se vend est plus urgent qu'un dossier dormant.
 */
export const regulatoryExpiryRule: Rule = {
  id: "regulatory-expiry",
  label: "Dossier réglementaire à traiter",
  description: "Autorisation expirée ou dans le délai de redépôt, dossier sans date de validité, référence non déposée ou bloquée.",
  async run({ settings, now: today }) {
    const r = await db.execute(sql`
      select rf.id, rf.dossier, rf.reference, rf.variant_type, rf.size, rf.expiry_date::text as expiry_date,
             rf.filing_date::text as filing_date, rf.status::text as status, rf.certificate_status,
             rf.blocked, rf.blocked_reason, rf.missing_documents,
             p.name as product_name, p.id as product_id, b.name as brand_name, b.id as brand_id,
             coalesce((select sum(sa.amount) from sales sa where sa.product_id = rf.product_id and sa.date >= ${iso(today)}::date - interval '12 months'), 0)::float8 as sold_12m
      from regulatory_files rf
      left join products p on p.id = rf.product_id
      left join brands b on b.id = rf.brand_id
      order by rf.expiry_date nulls last`);
    const out: Recommendation[] = [];

    for (const row of r.rows as Row[]) {
      const name = row.reference ?? row.product_name ?? row.dossier;
      const variant = `${variantLabel(row.variant_type)}${row.size ? ` · ${row.size}` : ""}`;
      const label = brandLabel(row.brand_name, name);
      const { situation, days } = situationOf({ status: row.status, blocked: row.blocked, expiryDate: row.expiry_date }, today, settings.regulatoryRenewalDays);
      const sells = row.sold_12m > 0;
      const missing = row.missing_documents?.trim();
      const baseFacts = [
        { label: "Variante", value: variant },
        ...(row.expiry_date ? [{ label: "Fin de validité", value: fmtDate(row.expiry_date) }] : []),
        ...(sells ? [{ label: "CA 12 mois de la référence", value: `${Math.round(row.sold_12m).toLocaleString("fr-FR")} MAD` }] : []),
        ...(missing ? [{ label: "Documents manquants", value: missing }] : []),
      ];
      const entity = { type: "regulatory", id: row.id, href: `/reglementaire/${row.id}` } as const;

      if (situation === "EXPIRE" || situation === "CRITIQUE" || situation === "A_RENOUVELER") {
        const expired = situation === "EXPIRE";
        const priority = expired ? "CRITICAL" : situation === "CRITIQUE" ? "CRITICAL" : sells ? "HIGH" : "MEDIUM";
        out.push({
          key: `regulatory-expiry:${row.id}`,
          rule: "regulatory-expiry",
          category: "REGLEMENTAIRE",
          priority,
          title: label,
          subtitle: expired ? `Enregistrement expiré depuis ${Math.abs(days!)} jours` : `Fin de validité ${formatDays(days)}`,
          facts: baseFacts,
          why: expired
            ? `L'ATD n'est plus valide : la commercialisation de cette variante n'est plus couverte${sells ? ", alors qu'elle a généré du chiffre d'affaires sur 12 mois" : ""}.`
            : `Le délai d'instruction impose de relancer le dépôt au plus tard ${settings.regulatoryRenewalDays} jours avant l'échéance ; passé ce délai, le produit risque une rupture de couverture.`,
          action: expired
            ? "Déposer le renouvellement en urgence et vérifier avec le commercial ce qui reste en circulation."
            : `Lancer le redépôt${missing ? ` — commencer par réunir : ${missing}` : " : réunir le dossier et l'envoyer à la DMP"}.`,
          impact: "Continuité de commercialisation de la référence.",
          task: { title: `Redépôt DMP — ${name} (${variant})`, dueInDays: expired ? 1 : Math.min(14, Math.max(2, (days ?? 30) - 45)), role: "REGLEMENTAIRE", priority },
          entity, brandId: row.brand_id,
        });
        continue;
      }

      if (situation === "SANS_DATE") {
        out.push({
          key: `regulatory-nodate:${row.id}`,
          rule: "regulatory-expiry", category: "REGLEMENTAIRE", priority: sells ? "HIGH" : "MEDIUM",
          title: label, subtitle: "Enregistré, mais sans date de validité connue",
          facts: baseFacts,
          why: "Sans date de fin de validité, aucune alerte de redépôt ne peut être déclenchée : le dossier peut expirer sans que personne ne le voie.",
          action: "Retrouver l'ATD (ou demander une copie à la DMP) et saisir la date de dépôt et la fin de validité.",
          impact: "Rend le dossier pilotable.",
          task: { title: `Retrouver la validité de l'ATD — ${name} (${variant})`, dueInDays: 10, role: "REGLEMENTAIRE" },
          entity, brandId: row.brand_id,
        });
        continue;
      }

      if (situation === "NON_DEPOSE") {
        out.push({
          key: `regulatory-todeposit:${row.id}`,
          rule: "regulatory-expiry", category: "REGLEMENTAIRE", priority: sells ? "CRITICAL" : "MEDIUM",
          title: label, subtitle: sells ? "Référence vendue sans enregistrement" : "Référence non déposée",
          facts: baseFacts,
          why: sells
            ? "Cette référence a été facturée sur les 12 derniers mois alors qu'aucun enregistrement DMP n'existe."
            : "Tant que le dépôt n'est pas fait, la référence ne peut pas être commercialisée.",
          action: missing ? `Constituer le dossier — manque : ${missing}.` : "Constituer le dossier et déposer à la DMP.",
          impact: "Ouvre la commercialisation de la référence.",
          task: { title: `Déposer le dossier DMP — ${name} (${variant})`, dueInDays: sells ? 3 : 21, role: "REGLEMENTAIRE" },
          entity, brandId: row.brand_id,
        });
        continue;
      }

      if (situation === "BLOQUE" && sells) {
        out.push({
          key: `regulatory-blocked:${row.id}`,
          rule: "regulatory-expiry", category: "REGLEMENTAIRE", priority: "CRITICAL",
          title: label, subtitle: "Dossier bloqué sur une référence vendue",
          facts: [...baseFacts, ...(row.blocked_reason ? [{ label: "Motif", value: row.blocked_reason }] : [])],
          why: "Le dossier ne peut pas aboutir en l'état et la référence est pourtant facturée.",
          action: "Arrêter la mise en marché ou obtenir du laboratoire une formule conforme.",
          impact: "Élimine un risque de sanction.",
          task: { title: `Arbitrer le blocage réglementaire — ${name}`, dueInDays: 5, role: "REGLEMENTAIRE", priority: "CRITICAL" },
          entity, brandId: row.brand_id,
        });
        continue;
      }

      // Étape CE en attente sur un dossier par ailleurs valide
      if (!AT_RISK.includes(situation) && (row.certificate_status === "A_DEMANDER" || row.certificate_status === "DOCS_LABO")) {
        const docsLabo = row.certificate_status === "DOCS_LABO";
        out.push({
          key: `regulatory-certificate:${row.id}`,
          rule: "regulatory-expiry", category: "REGLEMENTAIRE", priority: docsLabo ? "MEDIUM" : "LOW",
          title: label,
          subtitle: (CERTIFICATE_STATUS[row.certificate_status] ?? CERTIFICATE_STATUS.A_DEMANDER).label,
          facts: [...baseFacts, { label: "Situation du dépôt", value: SITUATIONS[situation].label }],
          why: "Tant que le certificat d'enregistrement n'est pas obtenu, le dossier reste au stade de l'attestation de dépôt.",
          action: docsLabo ? "Relancer le laboratoire pour les pièces manquantes, puis déposer la demande de CE." : "Constituer et déposer la demande de certificat d'enregistrement.",
          impact: "Sécurise l'enregistrement définitif.",
          task: { title: `Demande de CE — ${name} (${variant})`, dueInDays: docsLabo ? 10 : 20, role: "REGLEMENTAIRE" },
          entity, brandId: row.brand_id,
        });
      }
    }
    return out;
  },
};
