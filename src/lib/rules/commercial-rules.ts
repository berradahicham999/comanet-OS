import { sql } from "drizzle-orm";
import { db } from "@/db";
import { compareMonth, periodRange, shiftRange } from "@/lib/analytics";
import { delta, fmtDate, fmtMAD, fmtNum, fmtPct } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/** Clients dont la commande théorique est dépassée, ou en forte baisse, ou inactifs à forte valeur. */
export const clientRules: Rule = {
  id: "client-intel",
  label: "Plan d'action client",
  description: "Relances à effectuer (commande théorique dépassée), clients à risque et clients inactifs à forte valeur.",
  async run({ clients }) {
    const out: Recommendation[] = [];
    const revs = clients.map((c) => c.revenue12).filter((v) => v > 0).sort((a, b) => a - b);
    const median = revs.length ? revs[Math.floor(revs.length / 2)] : 0;

    for (const c of clients) {
      const rec = c.recommendation;
      if (rec.kind === "NONE" || rec.kind === "DEVELOPPEMENT") continue;
      if (rec.kind === "RELANCE" && !c.overdue) continue; // "anticiper" reste dans la fiche client, pas dans l'Action Center
      if (rec.kind === "REACTIVATION" && c.revenue12 < median * 0.5) continue; // inactifs de faible valeur : hors radar quotidien
      if (rec.kind === "ANALYSE" && c.revenue12 < median * 0.5) continue;
      const priority = rec.kind === "RELANCE" ? (c.highPotential ? "HIGH" : "MEDIUM") : rec.kind === "ANALYSE" ? "HIGH" : "MEDIUM";
      out.push({
        key: `client-${rec.kind.toLowerCase()}:${c.id}`,
        rule: "client-intel",
        category: rec.kind === "ANIMATION" ? "TERRAIN" : "COMMERCIAL",
        priority,
        title: c.name,
        subtitle: `${rec.title}${c.city ? " · " + c.city : ""}`,
        facts: [
          { label: "Dernière commande", value: fmtDate(c.lastOrder) },
          { label: "Commande précédente", value: fmtDate(c.prevOrder) },
          { label: "Rythme habituel", value: c.avgIntervalDays ? `tous les ${Math.round(c.avgIntervalDays)} j` : "n/c" },
          ...(c.nextTheoretical ? [{ label: "Commande théorique", value: fmtDate(c.nextTheoretical) }] : []),
          { label: "CA 12 mois", value: fmtMAD(c.revenue12, { compact: true }) },
          { label: "Évolution 3 mois", value: c.growthPct === null ? "n/c" : fmtPct(c.growthPct, 0, true) },
          ...(c.fieldStock !== null ? [{ label: "Stock rayon constaté", value: `${fmtNum(c.fieldStock)} u.` }] : []),
        ],
        why: rec.detail,
        action: rec.kind === "RELANCE" ? "Le commercial contacte le client cette semaine avec une proposition de réassort basée sur ses produits habituels."
          : rec.kind === "REACTIVATION" ? "Visite du commercial avec offre de réactivation ; vérifier s'il reste du stock dormant à écouler."
          : rec.kind === "ANIMATION" ? "Programmer une animation et une activation locale ; ne pas relancer commercialement tant que le stock rayon ne tourne pas."
          : "Visite du commercial pour comprendre la baisse (stock, concurrence, visibilité) et proposer un plan (animation, PLV, offre).",
        impact: c.avgBasket ? `Panier moyen ${fmtMAD(c.avgBasket, { compact: true })}` : undefined,
        task: { title: `${rec.title} — ${c.name}`, dueInDays: rec.kind === "RELANCE" ? 3 : 7, role: "TRADE", priority },
        entity: { type: "client", id: c.id, href: `/clients/${c.id}` },
        score: c.revenue12,
      });
    }
    // On limite pour rester actionnable : max 12 clients, par enjeu
    return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 12);
  },
};

/** Marque en baisse vs M-1 (à date). */
export const brandDropRule: Rule = {
  id: "brand-drop",
  label: "Marque en baisse",
  description: "CA marque du mois (à date) en baisse de plus de X % vs le mois précédent à date, hors petites bases.",
  async run({ settings, today, stocks }) {
    const brands = await db.execute(sql`select id, name from brands where active`);
    const out: Recommendation[] = [];
    if (today.getUTCDate() < 5) return out; // trop tôt dans le mois pour conclure
    for (const b of brands.rows as { id: string; name: string }[]) {
      const cmp = await compareMonth({ brandId: b.id }, today);
      const d = delta(cmp.current.amount, cmp.m1.amount);
      if (d === null || cmp.m1.amount < 10000 || d > -settings.brandDropPct) continue;
      const bStocks = stocks.filter((p) => p.brandId === b.id);
      const stockouts = bStocks.filter((p) => p.stockKnown && p.stock <= 0 && p.avgMonthly > 0);
      const range = periodRange("month", today), r1 = shiftRange(range, -1);
      const hyp = stockouts.length
        ? `Hypothèse principale : ${stockouts.length} produit(s) en rupture (${stockouts.map((p) => p.name).slice(0, 3).join(", ")}).`
        : "Aucune rupture détectée : la baisse vient probablement de la demande (sell-out) ou du rythme de commande des clients.";
      out.push({
        key: `brand-drop:${b.id}:${range.start.slice(0, 7)}`,
        rule: "brand-drop",
        category: "COMMERCIAL",
        priority: d < -30 ? "CRITICAL" : "HIGH",
        title: b.name.toUpperCase(),
        subtitle: `CA ${fmtPct(d, 0, true)} vs M-1 à date`,
        facts: [
          { label: `Du ${fmtDate(range.start)} au ${fmtDate(today)}`, value: fmtMAD(cmp.current.amount, { compact: true }) },
          { label: `M-1 (${fmtDate(r1.start)} → ${fmtDate(r1.end)})`, value: fmtMAD(cmp.m1.amount, { compact: true }) },
          { label: "N-1 à date", value: fmtMAD(cmp.n1.amount, { compact: true }) },
          { label: "Clients actifs", value: `${cmp.current.clients} (M-1 : ${cmp.m1.clients})` },
        ],
        why: `Le CA de la marque recule de ${fmtPct(Math.abs(d))} par rapport à la même période du mois précédent. ${hyp}`,
        action: stockouts.length ? "Sécuriser le réapprovisionnement, puis relancer les clients qui n'ont pas pu commander." : "Analyser les ventes par client et par produit ; programmer des animations sur les points de vente en baisse.",
        task: { title: `Analyser la baisse ${b.name} (${fmtPct(d, 0, true)} vs M-1)`, dueInDays: 3, role: "TRADE", priority: "HIGH" },
        entity: { type: "brand", id: b.id, href: `/marques/${b.id}` },
        brandId: b.id,
        score: cmp.m1.amount - cmp.current.amount,
      });
    }
    return out;
  },
};

/** Clients / produits créés automatiquement par import et non qualifiés. */
export const dataQualityRule: Rule = {
  id: "data-quality",
  label: "Qualité des données",
  description: "Entités créées automatiquement par un import Sage et à qualifier (type, ville, marque…).",
  async run() {
    const r = await db.execute(sql`
      select (select count(*) from clients where needs_review)::int as clients,
             (select count(*) from products where needs_review or brand_id is null)::int as products`);
    const row = r.rows[0] as { clients: number; products: number };
    const out: Recommendation[] = [];
    if (row.clients > 0) out.push({
      key: "data-quality:clients", rule: "data-quality", category: "DATA", priority: "LOW",
      title: `${fmtNum(row.clients)} clients à qualifier`, subtitle: "Créés automatiquement par import",
      facts: [{ label: "Clients", value: String(row.clients) }],
      why: "Sans type, ville ou commercial, ces clients sortent des analyses par canal et par ville.",
      action: "Compléter type / ville / commercial depuis la liste clients (filtre « à qualifier »).",
      task: { title: `Qualifier ${row.clients} clients importés`, dueInDays: 14, role: "TRADE" },
      entity: { type: "client", id: "", href: "/clients?review=1" },
    });
    if (row.products > 0) out.push({
      key: "data-quality:products", rule: "data-quality", category: "DATA", priority: "LOW",
      title: `${fmtNum(row.products)} produits à rattacher`, subtitle: "Sans marque ou créés par import",
      facts: [{ label: "Produits", value: String(row.products) }],
      why: "Un produit sans marque n'alimente ni le budget, ni le cockpit marque, ni le réglementaire.",
      action: "Rattacher chaque produit à sa marque et renseigner prix / lead time.",
      task: { title: `Rattacher ${row.products} produits à leur marque`, dueInDays: 7, role: "ADMIN" },
      entity: { type: "product", id: "", href: "/produits?review=1" },
    });
    return out;
  },
};
