/**
 * Outils CRM commercial du copilote : portefeuille et progression des visites du mois (par commerciale,
 * par ville), et fiche d'un client (chronologie des interactions, brief de visite). Lecture seule ; aucune
 * position GPS ni heure de visite ne sort vers le modèle. Définitions officielles : `src/lib/crm/`.
 */
import { z } from "zod";
import type { AiTool, ToolResult } from "./types";
import { round, unavailable } from "./shared";
import { canSeeUser, hasTeamView } from "@/lib/crm/access-shared";
import { headlineObjective, monthLabel } from "@/lib/crm/portfolio-shared";

const monthRe = /^\d{4}-\d{2}$/;
const thisMonth = (d: Date) => d.toISOString().slice(0, 7);

const portfolioSchema = z.object({
  commercial: z.string().optional().describe("Nom de la commerciale ; absent = la personne connectée, ou toute l'équipe visible pour un manager."),
  month: z.string().regex(monthRe).optional().describe("Mois AAAA-MM (défaut : mois en cours)."),
  city: z.string().optional().describe("Ville des clients (vue équipe)."),
});

export const getClientPortfolio: AiTool<typeof portfolioSchema> = {
  name: "get_client_portfolio",
  description:
    "CRM commercial : portefeuille d'une commerciale (clients confiés, fréquence de visite mensuelle) et progression des visites du mois — visites comptées plafonnées à la fréquence de chaque client, part du mois écoulée, rythme (en retard / dans le rythme), clients pas encore visités, objectifs clients (CA HT sell-in) en retard, clients à voir en priorité avec leurs raisons ; ou la synthèse par commerciale et par ville pour un manager. Aucune position GPS.",
  module: "clients",
  action: "view",
  schema: portfolioSchema,
  async run(input, ctx): Promise<ToolResult> {
    const crm = ctx.deps.crm;
    if (!crm) return unavailable("Lectures CRM non branchées.", "—");
    const month = input.month ?? thisMonth(ctx.now);
    const viewer = await crm.viewer(ctx.access.userId, ctx.access.userName, ctx.access.perms);
    const source = "CRM commercial — visites (client_visits), fréquences et commerciaux attitrés des fiches clients, objectifs clients, sell-in HT";
    let target: { id: string; name: string } | null = null;
    if (input.commercial) {
      target = await crm.findCommercial(input.commercial);
      if (!target) return unavailable(`Commerciale « ${input.commercial} » introuvable (aucun portefeuille ni visite).`, "Vérifier le nom, ou affecter des clients (Clients → Portefeuilles).", source);
      if (!canSeeUser(viewer, target.id)) return unavailable("Le suivi de cette commerciale est réservé à la direction, à son manager et au droit « Valider » sur Clients.", "Demander l'accès à la direction.", source);
    } else if (!hasTeamView(viewer)) target = { id: viewer.userId, name: viewer.name };

    if (target) {
      const p = await crm.portfolio(target.id, month);
      if (!p.clients.length) return unavailable(`Aucun client confié à ${target.name}.`, "Affecter des clients et une fréquence de visite (Clients → Portefeuilles).", source);
      const late = p.clients.filter((c) => (c.frequency ?? 0) > 0 && c.doneThisMonth === 0);
      const objectivesLate = p.clients.map((c) => ({ c, h: headlineObjective(c.objective) })).filter((x) => x.h?.verdict === "EN_RETARD");
      const suggestions = month === thisMonth(ctx.now) ? await crm.suggestions(p) : [];
      return {
        available: true, source, scope: target.name,
        period: { start: `${month}-01`, end: `${month}-28`, label: monthLabel(month) },
        data: {
          month: monthLabel(month), month_elapsed_pct: round(p.elapsedPct),
          visits: { expected: p.progress.expected, counted: p.progress.counted, done_raw: p.progress.done, progress_pct: p.progress.pct === null ? null : round(p.progress.pct), pace: p.pace.label, behind: p.pace.behind },
          clients: { total: p.clients.length, followed: p.progress.followed, not_visited_this_month: p.progress.notVisited, without_frequency: p.progress.undefinedFrequency },
          by_city: p.byCity.map((c) => ({ city: c.city, clients: c.clients, expected: c.progress.expected, counted: c.progress.counted, progress_pct: c.progress.pct === null ? null : round(c.progress.pct) })),
          not_visited: late.slice(0, 15).map((c) => ({ client: c.name, city: c.city, frequency: c.frequency, last_visit: c.lastVisit })),
          objectives_late: objectivesLate.slice(0, 10).map(({ c, h }) => ({ client: c.name, target_ht_mad: round(h!.target), realized_ht_mad: round(h!.realized), pct: h!.pct === null ? null : round(h!.pct) })),
          to_see_first: suggestions,
        },
        rowCount: p.clients.length,
        links: [{ label: "Ouvrir le suivi", href: `/clients/visites?user=${target.id}&month=${month}` }],
        notes: ["Visites plafonnées à la fréquence de chaque client ; un client sans fréquence n'entre pas dans la progression.", "Une hausse de ventes après des visites est une corrélation observée ; seule une commande saisie pendant la visite est un lien mesuré."],
      };
    }

    const team = await crm.team(viewer, month, input.city ?? null);
    if (!team.rows.length) return unavailable("Aucun portefeuille commercial visible ce mois.", "Affecter des clients aux commerciales (Clients → Portefeuilles).", source);
    return {
      available: true, source, scope: input.city ? `équipe visible · ville ${input.city}` : "équipe visible",
      period: { start: `${month}-01`, end: `${month}-28`, label: monthLabel(month) },
      data: {
        month: monthLabel(month), month_elapsed_pct: round(team.elapsedPct),
        team: { expected: team.totals.expected, counted: team.totals.counted, progress_pct: team.totals.pct === null ? null : round(team.totals.pct), not_visited: team.totals.notVisited, without_frequency: team.totals.undefinedFrequency, unassigned_clients: team.unassigned },
        by_commercial: team.rows.map((r) => ({
          name: r.name, clients: r.clients, expected: r.progress.expected, counted: r.progress.counted, progress_pct: r.progress.pct === null ? null : round(r.progress.pct), pace: r.pace.label,
          not_visited: r.progress.notVisited, visits_done: r.visitsDone, outside_portfolio: r.visitsOutside, not_done: r.notDone, calls_messages: r.contacts, orders_in_visits: r.ordersInVisits,
          objectives: { defined: r.objectivesDefined, reached: r.objectivesReached, late: r.objectivesLate },
        })),
        by_city: team.byCity.map((c) => ({ city: c.city, clients: c.clients, expected: c.progress.expected, counted: c.progress.counted, progress_pct: c.progress.pct === null ? null : round(c.progress.pct) })),
      },
      rowCount: team.rows.length,
      links: [{ label: "Ouvrir le suivi des visites", href: `/clients/visites?month=${month}` }],
      notes: ["Visites plafonnées à la fréquence de chaque client.", "« Commandes en visite » : commandes saisies par la commerciale chez le client pendant la visite (déduit)."],
    };
  },
};

const clientSchema = z.object({
  client: z.string().min(2).describe("Nom (ou code) du client."),
  limit: z.number().int().min(5).max(80).optional().describe("Nombre d'interactions de la chronologie (défaut 30)."),
});

export const getClientVisits: AiTool<typeof clientSchema> = {
  name: "get_client_visits",
  description:
    "Fiche commerciale d'un client avant ou après une visite : chronologie des interactions (visites avec compte rendu, appels, commandes et pièces, ventes, règlements, relevés de stock, animations, tâches), rythme de commande, produits habituels, objectif du mois, encours et échu (si droits), assortiment manquant (corrélation observée chez des clients comparables). Aucune position GPS.",
  module: "clients",
  action: "view",
  schema: clientSchema,
  async run(input, ctx): Promise<ToolResult> {
    const crm = ctx.deps.crm;
    if (!crm) return unavailable("Lectures CRM non branchées.", "—");
    const ref = await ctx.deps.findClient(input.client);
    if (!ref) return unavailable(`Aucun client trouvé pour « ${input.client} ».`, "Vérifier l'orthographe ou chercher dans Clients.", "Clients");
    if (ctx.access.clientIds && !ctx.access.clientIds.includes(ref.id)) return unavailable("Ce client est hors de votre portée.", "Demander l'accès à la direction.", "Clients");
    const [brief, timeline] = await Promise.all([crm.brief(ref.id), crm.timeline(ref.id, input.limit ?? 30)]);
    if (!brief) return unavailable("Fiche introuvable.", "—");
    const money = ctx.access.perms.reglements?.view || ctx.access.perms.facturation?.view;
    return {
      available: true,
      source: "CRM commercial — visites et contacts ; pièces et règlements COMANET OS ; ventes importées (sell-in HT) ; relevés de stock ; animations ; tâches",
      scope: ref.name,
      data: {
        client: { name: brief.client.name, city: brief.client.city, type: brief.client.type },
        rhythm: { last_order: brief.rhythm.lastOrder, avg_interval_days: brief.rhythm.avgIntervalDays === null ? null : round(brief.rhythm.avgIntervalDays), days_until_next_order: brief.rhythm.daysUntilNext, revenue_12m_ht_mad: round(brief.rhythm.revenue12), segment: brief.rhythm.segment },
        last_visit: brief.lastVisit,
        objective_this_month: brief.objective ? { target_ht_mad: round(brief.objective.target), realized_ht_mad: round(brief.objective.realized), pct: brief.objective.pct === null ? null : round(brief.objective.pct), verdict: brief.objective.verdict } : "aucun objectif défini",
        receivables: money && brief.receivables ? { outstanding_ttc_mad: Number(brief.receivables.outstanding), overdue_ttc_mad: Number(brief.receivables.overdue), oldest_days_late: brief.receivables.oldestDaysLate, last_payment: brief.receivables.lastPayment } : "non accessible",
        usual_products: brief.usualProducts,
        missing_assortment: { basis: brief.missing.basis, peers: brief.missing.peers, products: brief.missing.items.map((m) => ({ product: m.name, brand: m.brand, peers_buying: m.buyers, share_pct: round(m.share * 100) })) },
        last_stock_reading: brief.lastReading,
        timeline: timeline.map((t) => ({ date: t.date, kind: t.kind, title: t.title, detail: t.detail, who: t.who })),
        sales_known_until: brief.salesUpTo,
      },
      rowCount: timeline.length,
      links: [{ label: "Ouvrir le suivi commercial du client", href: `/clients/${ref.id}?tab=crm` }],
      notes: ["L'assortiment manquant est une corrélation observée chez des clients comparables, pas une prévision de vente."],
    };
  },
};
