import { fmtDate, fmtNum, plural } from "@/lib/format";
import { CHANNEL_LABELS, staleClients, stockoutsAtActiveClients } from "@/lib/client-stock";
import type { Rule, Recommendation } from "./types";

/**
 * Règles « stock chez le client ». Les seuils viennent de `settings.clientStock` ; la lecture
 * du stock (dernier relevé par produit) de `src/lib/client-stock.ts`. Format de l'Action
 * Center : POURQUOI (diagnostic) puis QUOI FAIRE (action), avec une tâche assignable.
 */

/** Produit relevé à 0 chez un client qui en vend : réassort à proposer. */
export const clientStockoutRule: Rule = {
  id: "client-stockout",
  label: "Rupture chez un client actif",
  description: "Dernier relevé de stock à 0 sur un produit que le point de vente a vendu en animation sur la fenêtre configurée.",
  async run({ settings, now }) {
    const s = settings.clientStock;
    const rows = await stockoutsAtActiveClients(now, s);
    return rows.slice(0, 15).map((r): Recommendation => {
      const priority = r.selloutUnits >= 10 ? "HIGH" : "MEDIUM";
      const who = r.commercialName ? `au commercial en charge (${r.commercialName})` : "au commercial en charge — aucun portefeuille n'est configuré pour ce client dans Utilisateurs & droits";
      return {
        key: `client-stockout:${r.clientId}:${r.productId}`,
        rule: "client-stockout",
        category: "COMMERCIAL",
        priority,
        title: `${r.clientName} — ${r.productName}`,
        subtitle: [r.brandName, r.city, "Rupture en point de vente"].filter(Boolean).join(" · "),
        facts: [
          { label: "Dernier relevé", value: `0 u. le ${fmtDate(r.readAt)}` },
          { label: "Relevé par", value: `${r.userName ?? "—"} · ${CHANNEL_LABELS[r.channel]}` },
          { label: `Sell-out animation ${s.stockoutSelloutDays} j`, value: `${fmtNum(r.selloutUnits)} u.` },
          { label: "Commercial", value: r.commercialName ?? "non affecté" },
        ],
        why: `Le dernier relevé de stock chez ${r.clientName} donne 0 unité de ${r.productName}, alors que ${fmtNum(r.selloutUnits)} ${plural(r.selloutUnits, "unité")} y ${r.selloutUnits > 1 ? "ont" : "a"} été ${r.selloutUnits > 1 ? "vendues" : "vendue"} en animation sur les ${s.stockoutSelloutDays} derniers jours : le produit tourne mais n'est plus disponible en rayon.`,
        action: `Proposer un réassort ${who}, puis refaire un relevé à la prochaine visite pour confirmer la remise en rayon.`,
        impact: `${fmtNum(r.selloutUnits)} u. de sell-out sur ${s.stockoutSelloutDays} j à ne pas perdre`,
        task: { title: `Proposer réassort ${r.productName} — ${r.clientName}`, dueInDays: 3, role: "TRADE", priority },
        suggestedAssigneeId: r.commercialId,
        entity: { type: "client", id: r.clientId, href: `/clients/${r.clientId}?tab=stock` },
        brandId: r.brandId,
        score: r.selloutUnits,
      };
    });
  },
};

/** Point de vente relevé une fois puis plus jamais : relevé à refaire. */
export const clientStockStaleRule: Rule = {
  id: "client-stock-stale",
  label: "Relevé de stock à refaire",
  description: "Client dont le dernier relevé de stock dépasse le seuil « à refaire » (settings.clientStock.staleDays).",
  async run({ settings, now }) {
    const s = settings.clientStock;
    const rows = await staleClients(now, s);
    return rows.slice(0, 15).map((r): Recommendation => {
      const viaAnimation = !!r.plannedAnimationDate && !!r.animatriceId;
      const action = viaAnimation
        ? `Une animation est prévue le ${fmtDate(r.plannedAnimationDate)} : ${r.animatriceName} relève le stock produit par produit dans la saisie terrain ce jour-là (champ « rayon »).`
        : r.commercialName
          ? `${r.commercialName} refait le relevé à sa prochaine tournée depuis la fiche client, onglet « Stock en point de vente » (bouton « Relever le stock »).`
          : "Aucune animation prévue et aucun commercial en portefeuille pour ce client : affecter le client à un commercial dans Utilisateurs & droits, puis planifier le relevé.";
      return {
        key: `client-stock-stale:${r.clientId}`,
        rule: "client-stock-stale",
        category: "TERRAIN",
        priority: "LOW",
        title: r.clientName,
        subtitle: [r.city, "Relevé de stock à faire"].filter(Boolean).join(" · "),
        facts: [
          { label: "Dernier relevé", value: fmtDate(r.lastReadAt) },
          { label: "Produits relevés", value: `${r.productsRead}` },
          { label: "Prochaine animation", value: r.plannedAnimationDate ? `${fmtDate(r.plannedAnimationDate)}${r.animatriceName ? ` · ${r.animatriceName}` : ""}` : "aucune prévue" },
          { label: "Commercial", value: r.commercialName ?? "non affecté" },
        ],
        why: `Le stock chez ${r.clientName} n'a plus été relevé depuis le ${fmtDate(r.lastReadAt)}, soit plus de ${s.staleDays} jours : la lecture du stock en point de vente n'est plus fiable.`,
        action,
        task: { title: `Relevé de stock à faire — ${r.clientName}`, dueInDays: viaAnimation ? 14 : 7, role: viaAnimation ? "ANIMATRICE" : "TRADE", priority: "LOW" },
        suggestedAssigneeId: viaAnimation ? r.animatriceId : r.commercialId,
        entity: { type: "client", id: r.clientId, href: `/clients/${r.clientId}?tab=stock` },
        score: r.productsRead,
      };
    });
  },
};

export const clientStockRules: Rule[] = [clientStockoutRule, clientStockStaleRule];
