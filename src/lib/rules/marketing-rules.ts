import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum, fmtPct, fmtDateShort, iso, addDays, months } from "@/lib/format";
import { adsByDim, kpis, diagnose, brandAverages, type AdRow } from "@/lib/ads";
import { isUnderTension } from "@/lib/stock-math";
import { listCollaborations, collabKpis, scoreCollaborations } from "@/lib/influence";
import { budgetConsumptionByBrand, AD_SPEND_SOURCE_LABEL } from "@/lib/budget";
import type { Rule, Recommendation } from "./types";

/**
 * Budget engagé vs budget annuel.
 *
 * Le consommé vient de `src/lib/budget.ts` — la même fonction que /marketing, /marketing/budgets
 * et le cockpit. Avant l'unification, cette règle ignorait la dépense de régie et pouvait
 * annoncer 70 % là où l'écran Budgets affichait 130 %.
 */
export const budgetRule: Rule = {
  id: "budget-overrun",
  label: "Budget marketing sous tension",
  description: "Budget consommé (engagé + dépensé + régie) au-delà du seuil d'alerte, ou consommation en avance sur l'année.",
  async run({ settings, now: today }) {
    const year = today.getUTCFullYear();
    const [byBrand, brands] = await Promise.all([
      budgetConsumptionByBrand(year),
      db.execute(sql`select id, name from brands where active order by name`),
    ]);
    const out: Recommendation[] = [];
    const yearProgress = (today.getUTCMonth() + today.getUTCDate() / 30) / 12;
    for (const b of brands.rows as { id: string; name: string }[]) {
      const c = byBrand.get(b.id);
      if (!c || !c.hasBudget || c.consumedPct === null) continue;
      const pct = c.consumedPct;
      const plannedPct = ((c.consumed + c.planned) / c.annual) * 100;
      const ahead = pct / 100 > yearProgress + 0.15 && pct >= 50;
      if (pct < settings.budgetAlertPct && plannedPct <= 100 && !ahead) continue;
      const over = pct >= 100 || plannedPct > 100;
      out.push({
        key: `budget-overrun:${b.id}:${year}`,
        rule: "budget-overrun",
        category: "BUDGET",
        priority: pct >= 100 ? "CRITICAL" : over || pct >= settings.budgetAlertPct ? "HIGH" : "MEDIUM",
        title: b.name.toUpperCase(),
        subtitle: pct >= 100 ? "Budget annuel dépassé" : plannedPct > 100 ? "Le prévu ferait dépasser le budget annuel" : ahead ? "Consommation en avance sur l'année" : `Budget consommé à ${Math.round(pct)} %`,
        facts: [
          { label: "Budget annuel", value: fmtMAD(c.annual, { compact: true }) },
          { label: "Consommé", value: `${fmtMAD(c.consumed, { compact: true })} (${Math.round(pct)} %)` },
          { label: "Dont dépense publicitaire", value: `${fmtMAD(c.adSpend, { compact: true })} (${AD_SPEND_SOURCE_LABEL[c.adSource]})` },
          { label: "Dépensé", value: fmtMAD(c.spent, { compact: true }) },
          { label: "Encore prévu", value: `${fmtMAD(c.planned, { compact: true })} — total ${Math.round(plannedPct)} %` },
          { label: "Avancement année", value: fmtPct(yearProgress * 100) },
        ],
        why: over ? "Les engagements dépassent l'enveloppe validée : chaque nouvelle action nécessite un arbitrage." : "Au rythme actuel, l'enveloppe sera consommée avant la fin de l'année.",
        action: over ? "Arbitrer : réduire les actions prévues à faible ROI ou revoir le budget de la marque." : "Prioriser les actions restantes par ROI attendu et geler celles sans résultat mesurable.",
        task: { title: `Arbitrage budget ${b.name} ${year}`, dueInDays: 5, role: "MARKETING" },
        entity: { type: "brand", id: b.id, href: `/marketing/budgets?brand=${b.id}` },
        brandId: b.id,
      });
    }
    return out;
  },
};


/**
 * Ads Intelligence.
 *
 * Source prioritaire : les données de régie (`ad_metrics`), qui donnent le détail jour ×
 * campagne. À défaut, les dépenses digitales saisies à la main dans les campagnes, converties
 * au même format et passées au MÊME moteur.
 *
 * Le verdict vient uniquement de `diagnose()` (`lib/ads`), avec les seuils de `settings.ads` :
 * un second moteur, avec ses propres seuils écrits en dur, vivait ici et pouvait rendre un
 * verdict différent de celui de l'écran Digital Ads pour la même campagne.
 */
export const adsRule: Rule = {
  id: "ads-performance",
  label: "Performance Ads",
  description: "SCALE / OPTIMIZE / STOP par campagne publicitaire : 30 derniers jours comparés aux 30 précédents et à la moyenne de la marque.",
  async run({ now: today, stocks, settings }) {
    const end = iso(addDays(today, 1));
    const start = iso(addDays(today, -29));
    const prevStart = iso(addDays(today, -59));
    const [regieCur, regiePrev] = await Promise.all([
      adsByDim("campaign", { start, end }),
      adsByDim("campaign", { start: prevStart, end: start }),
    ]);

    // Repli : aucune donnée de régie sur la fenêtre — on lit les dépenses saisies, converties
    // au même format pour passer par le même moteur de verdict.
    const [cur, prev] = regieCur.length
      ? [regieCur, regiePrev]
      : await Promise.all([
          manualCampaignRows({ start, end }),
          manualCampaignRows({ start: prevStart, end: start }),
        ]);
    if (!cur.length) return [];

    const curK = cur.map(kpis);
    const prevK = new Map(prev.map((r) => [r.key, kpis(r)]));
    // référence par marque, pour situer chaque campagne dans son propre contexte
    const byBrand = new Map<string, typeof curK>();
    for (const r of curK) {
      const k = r.brandId ?? "none";
      byBrand.set(k, [...(byBrand.get(k) ?? []), r]);
    }

    const out: Recommendation[] = [];
    for (const r of curK) {
      const avg = brandAverages(byBrand.get(r.brandId ?? "none") ?? curK);
      const d = diagnose(r, prevK.get(r.key) ?? null, avg, settings.ads);
      if (d.verdict === "MAINTAIN" || d.verdict === "WATCH") continue;
      // Garde-fou stock : même définition du « produit en tension » que la règle campagne/stock.
      const tight = r.brandId ? stocks.filter((p) => p.brandId === r.brandId && isUnderTension(p, settings)) : [];
      const actions = [...d.actions];
      if (d.verdict === "SCALE" && tight.length) {
        actions.unshift(`Sécuriser d'abord le stock de ${tight.slice(0, 3).map((p) => p.name).join(", ")} (couverture sous ${settings.stockTightCoverageMonths} mois) avant d'augmenter le budget.`);
      }
      out.push({
        key: `ads-${d.verdict.toLowerCase()}:${r.key}`,
        rule: "ads-performance",
        category: "MARKETING",
        priority: d.verdict === "STOP" ? "CRITICAL" : d.verdict === "OPTIMIZE" ? "HIGH" : "MEDIUM",
        title: `${(r.brandName ?? "Sans marque").toUpperCase()} — ${r.campaignName}`,
        subtitle: `${d.verdict} · ${r.platform} · ${d.headline}`,
        facts: d.signals.map((sig) => ({ label: sig.label, value: sig.delta === null ? sig.value : `${sig.value} (${sig.delta > 0 ? "+" : ""}${Math.round(sig.delta)} %)` })),
        why: d.diagnostic,
        action: actions.join(" "),
        impact: d.verdict === "STOP" ? `${fmtMAD(r.spend, { compact: true })} de dépense réallouable sur 30 j`
          : d.verdict === "SCALE" ? `Marge de progression sur une campagne à ${r.roas?.toFixed(2) ?? "?"}× de ROAS`
            : "Retour au coût par achat de référence",
        task: { title: `${d.verdict} — ${r.campaignName}`, dueInDays: d.verdict === "STOP" ? 1 : 3, role: "MARKETING" },
        entity: r.campaignId
          ? { type: "campaign", id: r.campaignId, href: `/marketing/campagnes/${r.campaignId}` }
          : { type: "campaign", id: r.key, href: `/marketing/ads${r.brandId ? `?brand=${r.brandId}` : ""}` },
        brandId: r.brandId,
        score: r.spend,
      });
    }
    return out;
  },
};

/**
 * Dépenses publicitaires saisies à la main, présentées comme des lignes de régie.
 *
 * Impressions, clics et portée sont à 0 : ils ne sont pas saisis. `diagnose()` en tire des
 * indicateurs `null` et se prononce alors sur le seul couple CPA / ROAS, sans inventer de CTR.
 */
async function manualCampaignRows(range: { start: string; end: string }): Promise<AdRow[]> {
  const r = await db.execute(sql`
    select c.id::text as id, c.name, c.channel::text as channel, b.id::text as brand_id, b.name as brand_name, b.color as brand_color,
      coalesce(sum(e.amount), 0)::float8 as spend,
      coalesce(sum(e.conversions), 0)::float8 as conversions,
      coalesce(sum(e.attributed_revenue), 0)::float8 as revenue,
      count(distinct e.date)::int as days
    from campaigns c
    join brands b on b.id = c.brand_id
    join marketing_expenses e on e.campaign_id = c.id
      and e.status <> 'PLANNED'
      and e.category in ('META','TIKTOK','GOOGLE','DIGITAL')
      and e.date >= ${range.start}::date and e.date < ${range.end}::date
    where c.channel in ('META','TIKTOK','GOOGLE')
    group by c.id, c.name, c.channel, b.id, b.name, b.color
    having coalesce(sum(e.amount), 0) > 0`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    key: String(x.id),
    platform: String(x.channel),
    campaignName: String(x.name),
    campaignId: String(x.id),
    brandId: x.brand_id ? String(x.brand_id) : null,
    brandName: x.brand_name ? String(x.brand_name) : null,
    brandColor: x.brand_color ? String(x.brand_color) : null,
    spend: Number(x.spend),
    impressions: 0, reach: 0, clicks: 0, linkClicks: 0, landingPageViews: 0,
    leads: 0, purchases: Number(x.conversions), messagingStarted: 0,
    revenue: Number(x.revenue),
    days: Number(x.days),
    objective: null,
  }));
}

/**
 * Influence : collaborations publiées sans statistiques, et profils dont le coût par personne
 * touchée sort nettement de la moyenne. On ne juge jamais une influenceuse sur le CA
 * quand aucun code promo ne permet de l'attribuer.
 */
export const influenceRule: Rule = {
  id: "influence-tracking",
  label: "Suivi des collaborations influence",
  description: "Publications sans statistiques, collaborations confirmées non publiées, et profils à faible efficience sur 90 jours.",
  async run({ now: today }) {
    const start = iso(addDays(today, -90));
    const end = iso(addDays(today, 1));
    const rows = await listCollaborations({ start, end });
    if (!rows.length) return [];
    const scored = scoreCollaborations(rows.map(collabKpis));
    const out: Recommendation[] = [];

    // 1. Publications sans statistiques
    const noStats = scored.filter((r) => ["PUBLIE", "ANALYSE", "TERMINE"].includes(r.status) && r.reach === null);
    if (noStats.length) {
      out.push({
        key: `influence-no-stats:${noStats.length}`,
        rule: "influence-tracking",
        category: "MARKETING",
        priority: "MEDIUM",
        title: `${noStats.length} publication(s) influence sans statistiques`,
        subtitle: "90 derniers jours",
        facts: [
          { label: "Collaborations", value: String(noStats.length) },
          { label: "Budget concerné", value: fmtMAD(noStats.reduce((a, r) => a + r.cost, 0), { compact: true }) },
          { label: "Profils", value: [...new Set(noStats.map((r) => r.influencer))].slice(0, 4).join(", ") },
        ],
        why: "Sans reach ni engagement saisis, ces collaborations ne peuvent pas être comparées : le budget est dépensé sans mesure de retour.",
        action: "Demander les captures d'insights (reach, likes, commentaires, clics) 48 h après chaque publication et les saisir dans l'Influence Center.",
        impact: `${fmtMAD(noStats.reduce((a, r) => a + r.cost, 0), { compact: true })} de dépense rendus évaluables`,
        task: { title: "Récupérer les statistiques des collaborations influence", dueInDays: 5, role: "MARKETING" },
        entity: { type: "campaign", id: "influence", href: "/marketing/influence" },
        score: noStats.reduce((a, r) => a + r.cost, 0),
      });
    }

    // 2. Collaborations confirmées dont la date est passée sans publication
    const late = scored.filter((r) => ["CONFIRMEE", "CONTENU_RECU"].includes(r.status) && r.date < iso(today));
    if (late.length) {
      out.push({
        key: `influence-late:${late.length}`,
        rule: "influence-tracking",
        category: "EXECUTION",
        priority: "HIGH",
        title: `${late.length} collaboration(s) confirmée(s) non publiée(s)`,
        subtitle: "date de publication dépassée",
        facts: [
          { label: "Profils", value: late.slice(0, 4).map((r) => `${r.influencer} (${fmtDateShort(r.date)})`).join(", ") },
          { label: "Budget engagé", value: fmtMAD(late.reduce((a, r) => a + r.cost, 0), { compact: true }) },
        ],
        why: "Le cachet est engagé mais la publication n'est pas enregistrée : soit elle a eu lieu sans être saisie, soit l'influenceuse ne l'a pas faite.",
        action: "Relancer chaque profil concerné, puis mettre le statut à jour dans l'Influence Center.",
        task: { title: "Relancer les collaborations influence en attente", dueInDays: 2, role: "MARKETING" },
        entity: { type: "campaign", id: "influence-late", href: "/marketing/influence" },
        score: late.reduce((a, r) => a + r.cost, 0),
      });
    }

    // 3. Part non mesurable
    const measured = scored.filter((r) => r.measured).length;
    const share = scored.length ? (measured / scored.length) * 100 : 0;
    if (scored.length >= 4 && share < 40) {
      const cost = scored.reduce((a, r) => a + r.cost, 0);
      out.push({
        key: "influence-not-attributable",
        rule: "influence-tracking",
        category: "MARKETING",
        priority: "MEDIUM",
        title: `${Math.round(100 - share)} % du budget influence n'est pas attribuable`,
        subtitle: "90 derniers jours",
        facts: [
          { label: "Collaborations", value: String(scored.length) },
          { label: "Mesurables", value: `${measured} (${Math.round(share)} %)` },
          { label: "Budget total", value: fmtMAD(cost, { compact: true }) },
        ],
        why: "Sans code promo ni lien tracké unique par influenceuse, aucun chiffre d'affaires ne peut être rattaché à ces collaborations : le retour reste une hypothèse.",
        action: "Attribuer un code promo nominatif à chaque collaboration à venir et saisir le CA généré par ce code à la fin de l'opération.",
        impact: `${fmtMAD(cost, { compact: true })} de budget rendus mesurables sur le prochain cycle`,
        task: { title: "Mettre en place un code promo par influenceuse", dueInDays: 10, role: "MARKETING" },
        entity: { type: "campaign", id: "influence-attr", href: "/marketing/influence" },
        score: cost,
      });
    }
    return out;
  },
};

/**
 * RISQUE « CAMPAGNE ACTIVE + PRODUIT EN TENSION » — définition officielle et unique.
 *
 * Deux règles couvraient exactement le même risque et produisaient deux cartes pour un seul
 * problème : `campaign-stock` (entrée campagne, seuil `coverage.orange`, tous canaux) et
 * `stock-scale-caution` (entrée produit, seuil 1,5 mois et 30 u./mois en dur, canaux digitaux).
 * Elles sont fusionnées ici, avec une définition unique.
 *
 * ── Campagne active ─────────────────────────────────────────────────────────
 *  `status = 'ACTIVE'` ET (pas de date de début, ou déjà passée) ET (pas de date de fin, ou
 *  pas encore atteinte). Tous canaux : une campagne trade ou événementielle crée de la
 *  demande au même titre qu'une campagne META.
 *
 * ── Périmètre produit ───────────────────────────────────────────────────────
 *  Les produits rattachés à la campagne (`campaign_products`). Si la campagne n'en rattache
 *  aucun, tous les produits actifs de sa marque — même convention que `campaignStock()`.
 *  Un produit inactif ou absent du référentiel de stock n'est pas évalué (il n'est pas vendu).
 *
 * ── Produit en tension ──────────────────────────────────────────────────────
 *  `isUnderTension()` : couverture connue, strictement inférieure à
 *  `settings.stockTightCoverageMonths`, sur un produit dont la rotation dépasse
 *  `settings.stockTightMinMonthlyUnits`. Les deux seuils sont dans les réglages.
 *
 * ── Restitution ─────────────────────────────────────────────────────────────
 *  Une recommandation PAR CAMPAGNE, listant les produits en tension. Un produit poussé par
 *  plusieurs campagnes apparaît dans chacune : c'est chaque campagne qu'il faut arbitrer.
 *  Priorité CRITICAL si un produit est sous un demi-mois de couverture, HIGH sinon.
 */
export const campaignStockRule: Rule = {
  id: "campaign-stock",
  label: "Campagne active sur produit en tension",
  description: "Campagne en cours poussant un produit dont la couverture de stock est sous le seuil de tension : ne pas augmenter la pression publicitaire avant réassort.",
  async run({ now: today, stocks, settings }) {
    const r = await db.execute(sql`
      select c.id::text as id, c.name, c.channel::text as channel,
             b.id::text as brand_id, b.name as brand_name,
             coalesce(array_remove(array_agg(cp.product_id::text), null), '{}'::text[]) as product_ids
      from campaigns c
      join brands b on b.id = c.brand_id
      left join campaign_products cp on cp.campaign_id = c.id
      where c.status = 'ACTIVE'
        and (c.start_date is null or c.start_date <= ${iso(today)}::date)
        and (c.end_date is null or c.end_date >= ${iso(today)}::date)
      group by c.id, c.name, c.channel, b.id, b.name`);

    const out: Recommendation[] = [];
    for (const row of r.rows as { id: string; name: string; channel: string; brand_id: string; brand_name: string; product_ids: string[] }[]) {
      const ids = (row.product_ids ?? []).filter(Boolean);
      const scope = ids.length
        ? stocks.filter((p) => ids.includes(p.productId))
        : stocks.filter((p) => p.brandId === row.brand_id);
      const tight = scope.filter((p) => isUnderTension(p, settings));
      if (!tight.length) continue;
      const worst = Math.min(...tight.map((p) => p.coverageMonths ?? Number.POSITIVE_INFINITY));
      out.push({
        key: `campaign-stock:${row.id}`,
        rule: "campaign-stock",
        category: "MARKETING",
        priority: worst < 0.5 ? "CRITICAL" : "HIGH",
        title: `${row.brand_name.toUpperCase()} — ${row.name}`,
        subtitle: `${tight.length} produit(s) ${ids.length ? "poussé(s)" : "de la marque"} sous ${settings.stockTightCoverageMonths} mois de couverture`,
        facts: [
          ...tight.slice(0, 5).map((p) => ({ label: p.name, value: `${months(p.coverageMonths ?? 0)} · ${fmtNum(p.stock)} en stock${p.onOrder ? ` (+${fmtNum(p.onOrder)} en cours)` : ""}` })),
          { label: "Canal de la campagne", value: row.channel },
          { label: "Sell-out terrain 30 j", value: `${fmtNum(tight.reduce((a, p) => a + p.fieldSellOut30d, 0))} u.` },
        ],
        why: "La campagne pousse la demande sur des références qui risquent la rupture avant la fin de la période : le budget publicitaire serait payé pour un produit indisponible, et la demande créée resterait non servie.",
        action: "Passer la commande de réassort maintenant, geler toute augmentation de budget sur ces références jusqu'à confirmation de la date de livraison, ou retirer ces produits du périmètre de la campagne au profit d'une alternative disponible.",
        impact: "Évite une rupture pendant la campagne et le budget publicitaire perdu",
        task: { title: `Réassort avant campagne ${row.name}`, dueInDays: 2, role: "ADMIN" },
        entity: { type: "campaign", id: row.id, href: `/marketing/campagnes/${row.id}` },
        brandId: row.brand_id,
      });
    }
    return out;
  },
};
