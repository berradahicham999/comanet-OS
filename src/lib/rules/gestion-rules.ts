import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, fmtMAD, fmtNum, iso, plural } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/**
 * Règles de la gestion commerciale : BL validés restés sans facture, pièces en attente de
 * déblocage, lots périmés ou proches de la péremption encore en stock. Seuils dans
 * `settings.gestion` (uninvoicedAlertDays, expiryAlertDays).
 */

/** BL validés non facturés depuis plus de N jours, regroupés par client. */
export const uninvoicedBLRule: Rule = {
  id: "gestion-bl-non-factures",
  label: "BL non facturés",
  description: "Bons de livraison validés (ou livrés) dont une partie reste à facturer au-delà du délai réglé (settings.gestion.uninvoicedAlertDays).",
  async run({ settings, now }) {
    const days = settings.gestion.uninvoicedAlertDays;
    const limit = iso(new Date(now.getTime() - days * 86400000));
    const rows = (await db.execute<{ client_id: string; client: string; n: number; oldest: string; ttc: string; numbers: string; simulation: boolean }>(sql`
      select d.client_id, c.name as client, count(*)::int as n, min(d.date)::text as oldest, sum(d.ttc)::text as ttc,
        string_agg(d.number, ', ' order by d.date) as numbers, bool_and(d.is_simulation) as simulation
      from sales_documents d join clients c on c.id = d.client_id
      where d.type = 'BL' and d.status in ('VALIDE', 'LIVRE', 'FACTURE_PARTIEL') and d.date <= ${limit}::date
      group by d.client_id, c.name order by min(d.date) limit 20`)).rows;
    return rows.map((r): Recommendation => ({
      key: `gestion-bl-non-factures:${r.client_id}`,
      rule: "gestion-bl-non-factures",
      category: "GESTION",
      priority: Number(r.ttc) >= 20000 ? "HIGH" : "MEDIUM",
      title: `${r.client} — ${r.n} ${plural(r.n, "BL")} à facturer`,
      subtitle: r.simulation ? "Pièces de simulation (période parallèle)" : "Bons de livraison validés",
      facts: [
        { label: "BL", value: r.numbers },
        { label: "Plus ancien", value: fmtDate(r.oldest) },
        { label: "Montant TTC des BL", value: fmtMAD(r.ttc) },
      ],
      why: `${fmtNum(r.n)} ${plural(r.n, "bon")} de livraison de ${r.client} ${r.n > 1 ? "attendent" : "attend"} une facture depuis plus de ${days} jours : la marchandise est sortie, la créance n'est pas encore émise.`,
      action: "Regrouper ces BL sur une facture (Gestion commerciale → Facturer des BL), ou annuler ceux qui n'ont pas été livrés.",
      task: { title: `Facturer les BL de ${r.client}`, dueInDays: 2, role: "ADMIN" },
      entity: { type: "client", id: r.client_id, href: `/gestion/pieces/facturer?client=${r.client_id}` },
      score: Number(r.ttc),
    }));
  },
};

/** Pièces bloquées (remise, encours, client bloqué, vente à perte) dont le déblocage a été demandé. */
export const approvalPendingRule: Rule = {
  id: "gestion-deblocage",
  label: "Déblocage commercial demandé",
  description: "Brouillons de pièce soumis pour levée de blocage, en attente d'une personne habilitée (interrupteur « Lever un blocage commercial »).",
  async run() {
    const rows = (await db.execute<{ id: string; type: string; client: string; ttc: string; at: string; by: string | null }>(sql`
      select d.id, d.type, c.name as client, d.ttc::text as ttc, d.approval_requested_at::text as at, u.name as by
      from sales_documents d join clients c on c.id = d.client_id left join users u on u.id = d.approval_requested_by_id
      where d.status = 'BROUILLON' and d.approval_requested_at is not null order by d.approval_requested_at limit 20`)).rows;
    return rows.map((r): Recommendation => ({
      key: `gestion-deblocage:${r.id}`,
      rule: "gestion-deblocage",
      category: "GESTION",
      priority: "HIGH",
      title: `${r.type === "BL" ? "BL" : "Facture"} à débloquer — ${r.client}`,
      subtitle: `Demandé par ${r.by ?? "—"} le ${fmtDate(r.at)}`,
      facts: [{ label: "Montant TTC", value: fmtMAD(r.ttc) }],
      why: "La pièce dépasse une règle commerciale (remise autorisée, encours, client bloqué ou prix sous le coût de revient) et ne peut pas être validée sans levée.",
      action: "Ouvrir la pièce, vérifier les dépassements listés, puis lever les blocages et valider — ou renvoyer au commercial pour correction.",
      task: { title: `Débloquer la pièce de ${r.client}`, dueInDays: 1, role: "ADMIN", priority: "HIGH" },
      entity: { type: "document", id: r.id, href: `/gestion/pieces/${r.id}` },
      score: Number(r.ttc),
    }));
  },
};

/** Lots encore en stock interne, périmés ou proches de la péremption. */
export const expiringLotsRule: Rule = {
  id: "gestion-lots-peremption",
  label: "Lots périmés ou proches de la péremption",
  description: "Lots en stock dans un dépôt interne dont la date de péremption est passée ou tombe dans la fenêtre réglée (settings.gestion.expiryAlertDays).",
  async run({ settings, now }) {
    const days = settings.gestion.expiryAlertDays;
    const today = iso(now);
    const horizon = iso(new Date(now.getTime() + days * 86400000));
    const rows = (await db.execute<{ product_id: string; product: string; brand_id: string | null; lot: string; expiry: string; qty: string; warehouse: string }>(sql`
      select p.id as product_id, p.name as product, p.brand_id, l.lot_number as lot, l.expiry_date::text as expiry, sum(m.quantity)::text as qty, w.label as warehouse
      from stock_movements m join stock_lots l on l.id = m.lot_id join products p on p.id = m.product_id join warehouses w on w.key = m.warehouse_key
      where w.kind = 'INTERNE' and l.expiry_date is not null and l.expiry_date <= ${horizon}::date
      group by p.id, p.name, p.brand_id, l.id, l.lot_number, l.expiry_date, w.label having sum(m.quantity) > 0
      order by l.expiry_date limit 25`)).rows;
    return rows.map((r): Recommendation => {
      const expired = r.expiry < today;
      return {
        key: `gestion-lots-peremption:${r.product_id}:${r.lot}`,
        rule: "gestion-lots-peremption",
        category: "GESTION",
        priority: expired ? "HIGH" : "MEDIUM",
        title: `${r.product} — lot ${r.lot}`,
        subtitle: `${r.warehouse} · ${expired ? "périmé" : "péremption proche"}`,
        facts: [{ label: "Péremption", value: fmtDate(r.expiry) }, { label: "Quantité en stock", value: fmtNum(Number(r.qty)) }],
        why: expired
          ? `Le lot ${r.lot} est périmé depuis le ${fmtDate(r.expiry)} et compte encore ${fmtNum(Number(r.qty))} unité(s) en stock : il ne sera plus servi sur un BL.`
          : `Le lot ${r.lot} périme le ${fmtDate(r.expiry)} (moins de ${days} jours) avec ${fmtNum(Number(r.qty))} unité(s) en stock.`,
        action: expired
          ? "Sortir le lot vers le dépôt « non vendable » ou le détruire (mouvement de stock), et voir avec le laboratoire un éventuel avoir."
          : "Pousser ce lot en priorité (les BL le servent déjà en premier) : animation, remise ciblée ou proposition aux grossistes.",
        task: { title: `${expired ? "Traiter le lot périmé" : "Écouler le lot"} ${r.lot} — ${r.product}`, dueInDays: expired ? 3 : 14, role: "TRADE" },
        entity: { type: "product", id: r.product_id, href: `/produits/${r.product_id}` },
        brandId: r.brand_id,
        score: Number(r.qty),
      };
    });
  },
};

export const gestionRules: Rule[] = [uninvoicedBLRule, approvalPendingRule, expiringLotsRule];
