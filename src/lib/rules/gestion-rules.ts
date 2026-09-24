import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, fmtMAD, fmtNum, iso, plural } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/**
 * Règles de la gestion commerciale : BL validés restés sans facture, pièces en attente de
 * déblocage, lots périmés ou proches de la péremption encore en stock, commandes fournisseurs en
 * retard, réceptions sans facture fournisseur. Seuils dans `settings.gestion`.
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

/** Commandes fournisseurs en retard : livraison attendue dépassée (+ délai de grâce) et pas entièrement reçue. */
export const lateOrdersRule: Rule = {
  id: "gestion-commandes-en-retard",
  label: "Commandes fournisseurs en retard",
  description: "Commandes validées dont la livraison attendue est dépassée de plus du délai réglé (settings.gestion.purchases.lateOrderGraceDays) et qui ne sont pas entièrement reçues.",
  async run({ settings, now }) {
    const grace = settings.gestion.purchases.lateOrderGraceDays;
    const limit = iso(new Date(now.getTime() - grace * 86400000));
    const rows = (await db.execute<{ id: string; number: string; supplier: string; expected: string; left_lines: number; net: string; brands: string | null }>(sql`
      select d.id, d.number, s.legal_name as supplier, d.expected_date::text as expected, d.net_ht_mad::text as net,
        (select count(*)::int from purchase_document_lines l where l.document_id = d.id and l.received_qty < l.quantity) as left_lines,
        (select string_agg(distinct b.name, ', ') from purchase_document_lines l join products p on p.id = l.product_id join brands b on b.id = p.brand_id
          where l.document_id = d.id and l.received_qty < l.quantity) as brands
      from purchase_documents d join suppliers s on s.id = d.supplier_id
      where d.type = 'COMMANDE' and d.status in ('VALIDE', 'PARTIELLE') and d.expected_date is not null and d.expected_date < ${limit}::date
      order by d.expected_date limit 20`)).rows;
    return rows.map((r): Recommendation => {
      const late = Math.round((now.getTime() - new Date(`${r.expected}T12:00:00Z`).getTime()) / 86400000);
      return {
        key: `gestion-commandes-en-retard:${r.id}`,
        rule: "gestion-commandes-en-retard",
        category: "GESTION",
        priority: late > 30 ? "HIGH" : "MEDIUM",
        title: `${r.number} — ${r.supplier}`,
        subtitle: `Livraison attendue le ${fmtDate(r.expected)} · ${late} jours de retard`,
        facts: [
          { label: "Lignes non reçues", value: fmtNum(r.left_lines) },
          { label: "Montant HT commandé", value: fmtMAD(r.net) },
          ...(r.brands ? [{ label: "Marques", value: r.brands }] : []),
        ],
        why: `La commande ${r.number} devait être livrée le ${fmtDate(r.expected)} ; ${r.left_lines} ligne(s) ne sont pas reçues. Ces quantités comptent encore comme « commandes en cours » dans la couverture de stock : si elles n'arrivent pas, la rupture n'est pas vue.`,
        action: `Relancer ${r.supplier} pour une nouvelle date ; si le reliquat ne viendra pas, solder la commande (il sort alors des commandes en cours et la commande conseillée se recalcule).`,
        task: { title: `Relancer ${r.supplier} — ${r.number}`, dueInDays: 2, role: "ADMIN" },
        entity: { type: "document", id: r.id, href: `/gestion/achats/${r.id}` },
        score: Number(r.net),
      };
    });
  },
};

/** Réceptions validées sans facture fournisseur enregistrée au-delà du délai réglé. */
export const uninvoicedReceptionsRule: Rule = {
  id: "gestion-receptions-non-facturees",
  label: "Réceptions sans facture fournisseur",
  description: "Réceptions validées dont la facture du fournisseur n'est pas enregistrée après le délai réglé (settings.gestion.purchases.uninvoicedReceptionDays).",
  async run({ settings, now }) {
    const days = settings.gestion.purchases.uninvoicedReceptionDays;
    const limit = iso(new Date(now.getTime() - days * 86400000));
    const rows = (await db.execute<{ supplier_id: string; supplier: string; n: number; oldest: string; numbers: string; net: string }>(sql`
      select d.supplier_id, s.legal_name as supplier, count(*)::int as n, min(d.date)::text as oldest, string_agg(d.number, ', ' order by d.date) as numbers, sum(d.net_ht_mad)::text as net
      from purchase_documents d join suppliers s on s.id = d.supplier_id
      where d.type = 'RECEPTION' and d.status in ('VALIDE', 'FACTUREE_PARTIEL') and d.date <= ${limit}::date
      group by d.supplier_id, s.legal_name order by min(d.date) limit 20`)).rows;
    return rows.map((r): Recommendation => ({
      key: `gestion-receptions-non-facturees:${r.supplier_id}`,
      rule: "gestion-receptions-non-facturees",
      category: "GESTION",
      priority: "MEDIUM",
      title: `${r.supplier} — ${r.n} réception(s) sans facture`,
      subtitle: `Depuis le ${fmtDate(r.oldest)}`,
      facts: [{ label: "Réceptions", value: r.numbers }, { label: "Montant HT reçu", value: fmtMAD(r.net) }],
      why: `Des marchandises de ${r.supplier} sont entrées en stock depuis plus de ${days} jours sans que leur facture soit enregistrée : la dette fournisseur et la TVA déductible ne sont pas suivies, et un écart de prix passerait inaperçu.`,
      action: "Enregistrer la facture reçue (Achats → Facturer des réceptions) et joindre son PDF ; la réclamer au fournisseur si elle n'est pas arrivée.",
      task: { title: `Enregistrer la facture de ${r.supplier}`, dueInDays: 5, role: "ADMIN" },
      entity: { type: "document", id: r.supplier_id, href: `/gestion/achats/facturer?supplier=${r.supplier_id}` },
      score: Number(r.net),
    }));
  },
};

/** Comptage ouvert depuis trop longtemps : le théorique figé vieillit, les écarts perdent leur sens. */
export const staleCountRule: Rule = {
  id: "gestion-inventaire-ouvert",
  label: "Inventaire ouvert depuis trop longtemps",
  description: "Comptage démarré depuis plus de N jours sans validation ni annulation (settings.gestion.inventory.staleCountDays).",
  async run({ settings, now }) {
    const days = settings.gestion.inventory.staleCountDays;
    const rows = (await db.execute<{ id: string; title: string; started: string; entries: number }>(sql`
      select c.id, c.title, c.started_at::date::text as started, (select count(*)::int from stock_count_entries e where e.count_id = c.id) as entries
      from stock_counts c where c.status = 'EN_COURS' and c.started_at < ${new Date(now.getTime() - days * 86400000).toISOString()}::timestamptz`)).rows;
    return rows.map((r): Recommendation => ({
      key: `gestion-inventaire-ouvert:${r.id}`, rule: "gestion-inventaire-ouvert", category: "GESTION", priority: "HIGH",
      title: `${r.title} — comptage ouvert depuis le ${fmtDate(r.started)}`,
      facts: [{ label: "Saisies", value: fmtNum(r.entries) }],
      why: `Le stock théorique a été figé le ${fmtDate(r.started)} ; depuis, BL et réceptions continuent de le faire bouger. Plus le comptage reste ouvert, plus ses écarts mélangent vrais manquants et flux normaux.`,
      action: "Terminer le comptage et valider l'inventaire (motif sur chaque écart), ou l'annuler et en relancer un sur un périmètre plus court.",
      task: { title: `Clore l'inventaire « ${r.title} »`, dueInDays: 2, role: "ADMIN", priority: "HIGH" },
      entity: { type: "document", id: r.id, href: `/gestion/inventaires/${r.id}` },
    }));
  },
};

/** Aucun inventaire validé depuis trop longtemps alors que le journal porte du stock. */
export const noRecentCountRule: Rule = {
  id: "gestion-sans-inventaire",
  label: "Pas d'inventaire récent",
  description: "Du stock est suivi au journal mais aucun inventaire n'a été validé depuis plus de N jours (settings.gestion.inventory.maxDaysWithoutCount).",
  async run({ settings, now }) {
    const days = settings.gestion.inventory.maxDaysWithoutCount;
    const r = (await db.execute<{ last: string | null; first: string | null; open: number }>(sql`
      select (select max(count_date)::text from stock_counts where status = 'VALIDE') as last,
        (select min(date)::text from stock_movements) as first,
        (select count(*)::int from stock_counts where status in ('BROUILLON', 'EN_COURS')) as open`)).rows[0];
    if (!r?.first || r.open > 0) return [];
    const ref = r.last ?? r.first;
    const age = Math.round((now.getTime() - new Date(`${ref}T12:00:00Z`).getTime()) / 86400000);
    if (age <= days) return [];
    return [{
      key: `gestion-sans-inventaire:${iso(now).slice(0, 7)}`, rule: "gestion-sans-inventaire", category: "GESTION", priority: "MEDIUM",
      title: r.last ? `Dernier inventaire validé il y a ${age} jours` : `Aucun inventaire depuis le début du journal (${age} jours)`,
      facts: [{ label: r.last ? "Dernier inventaire" : "Premier mouvement", value: fmtDate(ref) }],
      why: "Le stock du journal n'a pas été confronté au rayon depuis longtemps : casse, périmés détruits et erreurs de saisie s'accumulent sans être vus.",
      action: "Préparer un inventaire, au moins tournant sur les marques qui tournent le plus (Gestion commerciale → Inventaires).",
      task: { title: "Préparer un inventaire", dueInDays: 14, role: "ADMIN" },
      entity: { type: "document", id: "inventaires", href: "/gestion/inventaires" },
    }];
  },
};

/** Articles en écart dans plusieurs inventaires validés. */
export const recurringGapsRule: Rule = {
  id: "gestion-ecarts-recurrents",
  label: "Écarts d'inventaire récurrents",
  description: "Article en écart dans au moins N inventaires validés (settings.gestion.inventory.recurringCount).",
  async run({ settings }) {
    const min = settings.gestion.inventory.recurringCount;
    const rows = (await db.execute<{ product_id: string; name: string; brand_id: string | null; n: number; net: string; value: string | null }>(sql`
      select l.product_id, p.name, p.brand_id, count(distinct l.count_id)::int as n, sum(l.gap_qty)::text as net, sum(l.gap_value)::text as value
      from stock_count_lines l join stock_counts c on c.id = l.count_id join products p on p.id = l.product_id
      where c.status = 'VALIDE' and l.gap_qty is not null and l.gap_qty <> 0
      group by l.product_id, p.name, p.brand_id having count(distinct l.count_id) >= ${min} order by count(distinct l.count_id) desc limit 15`)).rows;
    return rows.map((r): Recommendation => ({
      key: `gestion-ecarts-recurrents:${r.product_id}`, rule: "gestion-ecarts-recurrents", category: "GESTION", priority: Number(r.net) < 0 ? "HIGH" : "MEDIUM",
      title: `${r.name} — en écart dans ${r.n} inventaires`,
      facts: [{ label: "Écart cumulé", value: `${fmtNum(Number(r.net))} u.` }, ...(r.value ? [{ label: "Valeur cumulée", value: fmtMAD(r.value) }] : [])],
      why: `Le même article ressort en écart à chaque inventaire : ce n'est plus une erreur de comptage isolée mais un flux qui n'est pas saisi (échantillons, casse, BL tardifs) ou une fragilité de stockage.`,
      action: "Ouvrir les pistes d'explication du dernier inventaire, suivre cet article en inventaire tournant mensuel et revoir qui le sort du stock.",
      task: { title: `Comprendre les écarts sur ${r.name}`, dueInDays: 7, role: "ADMIN" },
      entity: { type: "product", id: r.product_id, href: `/produits/${r.product_id}` },
      brandId: r.brand_id,
      score: Math.abs(Number(r.value ?? 0)),
    }));
  },
};

/** Clients à relancer (factures réelles échues ; niveau et délai entre relances dans settings.gestion.receivables). */
export const overdueInvoicesRule: Rule = {
  id: "gestion-factures-echues",
  label: "Factures échues à relancer",
  description: "Client avec des factures échues non soldées, dont la relance est due (niveau atteint, délai depuis la dernière relance écoulé).",
  async run() {
    const { reminderCandidates } = await import("@/lib/gestion/payments");
    const rows = (await reminderCandidates({ simulation: false })).filter((c) => c.due).slice(0, 20);
    return rows.map((c): Recommendation => ({
      key: `gestion-factures-echues:${c.clientId}:${c.level}`, rule: "gestion-factures-echues", category: "GESTION",
      priority: c.level >= 3 ? "CRITICAL" : c.level === 2 ? "HIGH" : "MEDIUM",
      title: `${c.client} — ${fmtMAD(c.overdue)} échus`,
      subtitle: `Relance de niveau ${c.level} · ${c.oldestDays} j de retard au plus`,
      facts: [{ label: "Factures", value: c.invoices.map((i) => i.number).join(", ") }, { label: "Dernière relance", value: c.lastReminder ? `niveau ${c.lastReminder.level}, ${fmtDate(c.lastReminder.sentAt)}` : "aucune" }],
      why: `${c.invoices.length} facture(s) de ${c.client} ont dépassé leur échéance ; la plus ancienne de ${c.oldestDays} jours. Sans relance, le retard s'installe et l'encours de risque grossit.`,
      action: "Envoyer la relance préparée (Gestion commerciale → Relances : WhatsApp ou e-mail en un clic), puis noter la date de règlement promise.",
      task: { title: `Relancer ${c.client} (niveau ${c.level})`, dueInDays: 1, role: "TRADE", priority: c.level >= 3 ? "HIGH" : undefined },
      entity: { type: "client", id: c.clientId, href: "/gestion/relances" },
      score: Number(c.overdue),
    }));
  },
};

/** Chèques et effets à remettre à la banque, et impayés du mois à traiter. */
export const portfolioRule: Rule = {
  id: "gestion-portefeuille",
  label: "Portefeuille : remises en banque et impayés",
  description: "Effets et chèques en portefeuille dont l'échéance approche (settings.gestion.receivables.depositLeadDays) ; règlements déclarés impayés ces 30 derniers jours.",
  async run({ settings, now }) {
    const { toDeposit } = await import("@/lib/gestion/payments");
    const dep = await toDeposit(settings.gestion.receivables.depositLeadDays);
    const bounced = (await db.execute<{ id: string; number: string; client: string; client_id: string; amount: string; bounced_at: string; reason: string | null }>(sql`
      select p.id, p.number, c.name as client, p.client_id, p.amount::text, p.bounced_at::text, p.status_reason as reason from payments p join clients c on c.id = p.client_id
      where p.status = 'IMPAYE' and not p.is_simulation and p.bounced_at >= ${iso(new Date(now.getTime() - 30 * 86400000))}::date order by p.bounced_at desc limit 10`)).rows;
    const recs: Recommendation[] = [];
    if (dep.length) {
      const total = dep.reduce((a, p) => a + Number(p.amount), 0);
      recs.push({
        key: `gestion-portefeuille:depot:${iso(now)}`, rule: "gestion-portefeuille", category: "GESTION", priority: "MEDIUM",
        title: `${dep.length} chèque(s) / effet(s) à remettre en banque`, facts: [{ label: "Montant", value: fmtMAD(total) }, { label: "Plus proche échéance", value: dep[0].due_date ? fmtDate(dep[0].due_date) : "—" }],
        why: "Un effet non remis à temps n'est pas présenté à l'échéance : l'argent arrive en retard et un éventuel impayé est découvert trop tard.",
        action: "Préparer la remise en banque (Règlements → À remettre en banque), puis confirmer l'encaissement à réception du relevé.",
        task: { title: "Remise en banque des effets", dueInDays: 1, role: "ADMIN" },
        entity: { type: "document", id: "banque", href: "/gestion/reglements?tab=banque" }, score: total,
      });
    }
    for (const b of bounced) recs.push({
      key: `gestion-portefeuille:impaye:${b.id}`, rule: "gestion-portefeuille", category: "GESTION", priority: "HIGH",
      title: `Impayé ${b.number} — ${b.client}`, subtitle: `Rejeté le ${fmtDate(b.bounced_at)}${b.reason ? ` · ${b.reason}` : ""}`,
      facts: [{ label: "Montant", value: fmtMAD(b.amount) }],
      why: "Le règlement est revenu impayé : les factures qu'il soldait sont rouvertes et l'encours du client remonte d'autant.",
      action: "Appeler le client pour un règlement de remplacement ; envisager de le bloquer (fiche client) tant qu'il n'est pas régularisé.",
      task: { title: `Régulariser l'impayé ${b.number} — ${b.client}`, dueInDays: 2, role: "ADMIN", priority: "HIGH" },
      entity: { type: "client", id: b.client_id, href: `/gestion/reglements/${b.id}` }, score: Number(b.amount),
    });
    return recs;
  },
};

/** Bascule : la date approche sans période parallèle, ou elle est passée sans activation. */
export const cutoverReminderRule: Rule = {
  id: "gestion-bascule",
  label: "Bascule depuis Sage",
  description: "Date de bascule dans moins de 45 jours sans période parallèle, ou dépassée sans que COMANET OS émette.",
  async run({ settings, now }) {
    const c = settings.gestion.cutover;
    if (!c.date || c.mode === "ACTIF") return [];
    const days = Math.round((new Date(`${c.date}T12:00:00Z`).getTime() - now.getTime()) / 86400000);
    if (days > 45 || (days > 0 && c.mode === "PARALLELE")) return [];
    const late = days <= 0;
    return [{
      key: `gestion-bascule:${c.date}:${c.mode}:${late ? "late" : "soon"}`, rule: "gestion-bascule", category: "GESTION", priority: late ? "HIGH" : "MEDIUM",
      title: late ? `Bascule prévue le ${fmtDate(c.date)} : pas encore activée` : `Bascule dans ${days} jours : période parallèle à lancer`,
      facts: [{ label: "Mode actuel", value: c.mode === "OFF" ? "Sage fait foi" : "Période parallèle" }, { label: "Sites", value: c.sites.join(", ") }],
      why: late ? "La date de bascule est passée mais Sage émet toujours les pièces : les ventes COMANET OS restent des simulations." : "Un mois de saisie en parallèle permet de comparer COMANET OS à Sage (rapport de contrôle) avant d'arrêter Sage.",
      action: late ? "Ouvrir Gestion commerciale → Bascule, lever les contrôles bloquants et activer — ou repousser la date dans Paramètres." : "Passer en période parallèle (Gestion commerciale → Bascule), importer le stock initial et saisir les pièces du mois en double.",
      task: { title: late ? "Activer la bascule" : "Lancer la période parallèle", dueInDays: late ? 2 : 7, role: "ADMIN" },
      entity: { type: "document", id: "bascule", href: "/gestion/bascule" },
    }];
  },
};

export const gestionRules: Rule[] = [overdueInvoicesRule, portfolioRule, cutoverReminderRule, uninvoicedBLRule, approvalPendingRule, expiringLotsRule, lateOrdersRule, uninvoicedReceptionsRule, staleCountRule, noRecentCountRule, recurringGapsRule];
