import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum, fmtDate, months } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/** « MARQUE — Produit », sans répéter la marque si la désignation commence déjà par elle. */
export function brandLabel(brand: string | null, name: string) {
  const b = (brand ?? "").toUpperCase();
  return !b || name.toUpperCase().startsWith(b) ? name : `${b} — ${name}`;
}

/** Produits sous couverture : préparer la commande fournisseur. */
export const stockCoverageRule: Rule = {
  id: "stock-coverage",
  label: "Couverture de stock insuffisante",
  description: "Produit dont la couverture (stock / ventes moyennes) est sous les seuils configurés ou inférieure au délai fournisseur.",
  async run({ stocks, settings }) {
    const out: Recommendation[] = [];
    for (const p of stocks) {
      if (p.avgMonthly <= 0 || !p.stockKnown) continue;
      const leadMonths = p.leadTimeDays / 30;
      const belowLead = p.coverageMonths !== null && p.coverageMonths <= leadMonths + 0.5;
      if (p.level !== "red" && p.level !== "orange" && !belowLead) continue;
      const stockout = p.stock <= 0;
      const monthlyRevenue = p.avgMonthly * (p.priceWholesale ?? 0);
      // Priorité = urgence × enjeu : un produit à 4 u./mois n'est pas critique même en rupture
      const urgent = stockout || p.level === "red";
      const priority = urgent && monthlyRevenue >= settings.stockCriticalRevenue ? "CRITICAL"
        : (urgent || monthlyRevenue >= settings.stockCriticalRevenue) ? "HIGH"
        : monthlyRevenue >= settings.stockCriticalRevenue / 5 ? "MEDIUM" : "LOW";
      const label = brandLabel(p.brandName, p.name);
      out.push({
        key: `stock-coverage:${p.productId}`,
        rule: "stock-coverage",
        category: "STOCK",
        priority,
        title: label,
        subtitle: stockout ? "Rupture de stock" : `Couverture ${months(p.coverageMonths ?? 0)}`,
        facts: [
          { label: "Stock", value: `${fmtNum(p.stock)} u.` + (p.onOrder ? ` (+${fmtNum(p.onOrder)} en cours)` : "") },
          { label: "Ventes moyennes", value: `${fmtNum(p.avgMonthly)}/mois` },
          { label: "Couverture", value: months(p.coverageMonths ?? 0) },
          { label: "Lead time fournisseur", value: `${Math.round(p.leadTimeDays / 30 * 10) / 10} mois` },
          ...(p.stockoutDate ? [{ label: "Rupture estimée", value: fmtDate(p.stockoutDate) }] : []),
        ],
        why: stockout
          ? `Stock à zéro alors que le produit vend ${fmtNum(p.avgMonthly)} u./mois : chaque jour de rupture = CA perdu (~${fmtMAD((p.avgMonthly / 30) * (p.priceWholesale ?? 0), { compact: true })}/jour).`
          : `La couverture (${months(p.coverageMonths ?? 0)}) ${belowLead ? "est inférieure au délai de réapprovisionnement" : "passe sous le seuil d'alerte"} : sans commande maintenant, la rupture arrive ${p.stockoutDate ? "vers le " + fmtDate(p.stockoutDate) : "avant la prochaine livraison"}.`,
        action: p.recommendedOrder > 0
          ? `Préparer une commande fournisseur de ${fmtNum(p.recommendedOrder)} unités${p.moq ? ` (MOQ ${fmtNum(p.moq)})` : ""} pour revenir à ${fmtNum(p.targetStock)} u. de stock cible.`
          : "Vérifier la commande fournisseur en cours et sa date de livraison.",
        impact: `Sécurise ~${fmtMAD(p.avgMonthly * (p.priceWholesale ?? 0) * (p.leadTimeDays / 30), { compact: true })} de CA sur le délai fournisseur.`,
        task: { title: `Commande fournisseur ${p.name} (${fmtNum(p.recommendedOrder)} u.)`, dueInDays: stockout ? 1 : 3, role: "ADMIN", priority },
        entity: { type: "product", id: p.productId, href: `/produits/${p.productId}` },
        brandId: p.brandId,
        score: monthlyRevenue,
      });
    }
    return out;
  },
};

/** Surstock : ne pas pousser en marketing / activer si marge élevée (§16 intelligence croisée). */
export const overstockRule: Rule = {
  id: "stock-overstock",
  label: "Surstock",
  description: "Produit avec plus de 6 mois de couverture : ne pas alimenter le marketing sans plan d'écoulement, ou lancer une activation si la marge le justifie.",
  async run({ stocks, settings }) {
    const out: Recommendation[] = [];
    for (const p of stocks) {
      if (p.coverageMonths === null || p.coverageMonths <= 6 || p.stock < 50) continue;
      const highMargin = (p.marginPct ?? settings.defaultMarginPct) >= 40;
      const lowSellOut = p.fieldSellOut30d === 0 || p.trendPct === null || p.trendPct < 0;
      const activation = highMargin && lowSellOut;
      out.push({
        key: `stock-overstock:${p.productId}`,
        rule: "stock-overstock",
        category: "STOCK",
        priority: p.coverageMonths > 10 ? "HIGH" : "MEDIUM",
        title: brandLabel(p.brandName, p.name),
        subtitle: `Surstock : ${months(p.coverageMonths)} de couverture`,
        facts: [
          { label: "Stock", value: `${fmtNum(p.stock)} u.` },
          { label: "Ventes moyennes", value: `${fmtNum(p.avgMonthly)}/mois` },
          { label: "Valeur immobilisée", value: fmtMAD(p.stockValue, { compact: true }) },
          { label: "Marge", value: p.marginPct !== null ? `${Math.round(p.marginPct)} %` : "n/c" },
          { label: "Tendance", value: p.trendPct === null ? "n/c" : `${p.trendPct > 0 ? "+" : ""}${Math.round(p.trendPct)} %` },
        ],
        why: `${fmtMAD(p.stockValue, { compact: true })} immobilisés pour ${months(p.coverageMonths)} de ventes${lowSellOut ? ", avec une rotation qui ne progresse pas" : ""}.`,
        action: activation
          ? "Marge élevée + stock élevé + rotation faible → lancer un plan d'activation marketing (contenu, animation ciblée, offre trade) plutôt que de laisser dormir le stock."
          : "Ne pas augmenter les investissements marketing sur ce produit ; proposer une offre trade ciblée aux clients à forte rotation et suspendre les achats.",
        impact: activation ? "Transforme du stock dormant en CA à marge élevée." : "Évite d'immobiliser davantage de trésorerie.",
        task: { title: activation ? `Plan d'activation ${p.name}` : `Plan d'écoulement stock ${p.name}`, dueInDays: 10, role: activation ? "MARKETING" : "TRADE" },
        entity: { type: "product", id: p.productId, href: `/produits/${p.productId}` },
        brandId: p.brandId,
        score: p.stockValue,
      });
    }
    return out;
  },
};

/** Ads actives sur une marque dont un produit clé est tendu : ne pas scaler avant sécurisation du stock. */
export const scaleCautionRule: Rule = {
  id: "stock-scale-caution",
  label: "Ne pas scaler les Ads avant le stock",
  description: "Une campagne digitale est active sur une marque dont un produit majeur a moins de 1,5 mois de couverture.",
  async run({ stocks }) {
    const r = await db.execute(sql`select brand_id, name from campaigns where status = 'ACTIVE' and channel in ('META','TIKTOK','GOOGLE')`);
    const active = new Map<string, string[]>();
    for (const row of r.rows as { brand_id: string; name: string }[]) active.set(row.brand_id, [...(active.get(row.brand_id) ?? []), row.name]);
    const out: Recommendation[] = [];
    for (const p of stocks) {
      if (!p.stockKnown || !p.brandId || !active.has(p.brandId) || p.coverageMonths === null || p.coverageMonths >= 1.5 || p.avgMonthly < 30) continue;
      out.push({
        key: `stock-scale-caution:${p.productId}`,
        rule: "stock-scale-caution",
        category: "MARKETING",
        priority: "HIGH",
        title: brandLabel(p.brandName, p.name),
        subtitle: "Campagne active sur un produit à stock tendu",
        facts: [
          { label: "Couverture", value: months(p.coverageMonths) },
          { label: "Campagnes actives", value: active.get(p.brandId)!.join(", ") },
          { label: "Sell-out terrain 30 j", value: `${fmtNum(p.fieldSellOut30d)} u.` },
        ],
        why: "Scaler l'acquisition sur un produit qui va manquer crée de la demande non servie, du CPA gaspillé et de la frustration client.",
        action: "Prévoir l'achat ET geler toute augmentation de budget Ads sur ce produit jusqu'à confirmation de la date de livraison ; rediriger le budget vers un produit à couverture confortable.",
        task: { title: `Geler le scaling Ads ${p.name} jusqu'à réception stock`, dueInDays: 1, role: "MARKETING" },
        entity: { type: "product", id: p.productId, href: `/produits/${p.productId}` },
        brandId: p.brandId,
      });
    }
    return out;
  },
};
