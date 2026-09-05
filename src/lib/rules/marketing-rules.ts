import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum, fmtPct, fmtDateShort, iso, addDays } from "@/lib/format";
import { adsByDim, kpis, diagnose, brandAverages } from "@/lib/ads";
import { listCollaborations, collabKpis, scoreCollaborations } from "@/lib/influence";
import type { Rule, Recommendation } from "./types";

/** Budget engagé vs budget annuel. */
export const budgetRule: Rule = {
  id: "budget-overrun",
  label: "Budget marketing sous tension",
  description: "Budget engagé (engagé + dépensé) au-delà du seuil d'alerte, ou consommation en avance sur l'année.",
  async run({ settings, now: today }) {
    const year = today.getUTCFullYear();
    const r = await db.execute(sql`
      select b.id, b.name, bu.amount::float8 as budget,
        coalesce(sum(case when e.status in ('COMMITTED','SPENT') then e.amount end),0)::float8 as engaged,
        coalesce(sum(case when e.status = 'SPENT' then e.amount end),0)::float8 as spent,
        coalesce(sum(e.amount),0)::float8 as planned
      from brands b join budgets bu on bu.brand_id = b.id and bu.year = ${year}
      left join marketing_expenses e on e.brand_id = b.id and extract(year from e.date) = ${year}
      group by b.id, b.name, bu.amount`);
    const out: Recommendation[] = [];
    const yearProgress = (today.getUTCMonth() + today.getUTCDate() / 30) / 12;
    for (const row of r.rows as { id: string; name: string; budget: number; engaged: number; spent: number; planned: number }[]) {
      if (!row.budget) continue;
      const pct = (row.engaged / row.budget) * 100;
      const plannedPct = (row.planned / row.budget) * 100;
      const ahead = pct / 100 > yearProgress + 0.15 && pct >= 50;
      if (pct < settings.budgetAlertPct && plannedPct <= 100 && !ahead) continue;
      const over = pct >= 100 || plannedPct > 100;
      out.push({
        key: `budget-overrun:${row.id}:${year}`,
        rule: "budget-overrun",
        category: "BUDGET",
        priority: pct >= 100 ? "CRITICAL" : over || pct >= settings.budgetAlertPct ? "HIGH" : "MEDIUM",
        title: row.name.toUpperCase(),
        subtitle: pct >= 100 ? "Budget annuel dépassé" : plannedPct > 100 ? "Le prévu dépasse le budget annuel" : ahead ? "Consommation en avance sur l'année" : `Budget engagé à ${Math.round(pct)} %`,
        facts: [
          { label: "Budget annuel", value: fmtMAD(row.budget, { compact: true }) },
          { label: "Engagé", value: `${fmtMAD(row.engaged, { compact: true })} (${Math.round(pct)} %)` },
          { label: "Dépensé", value: fmtMAD(row.spent, { compact: true }) },
          { label: "Prévu total", value: `${fmtMAD(row.planned, { compact: true })} (${Math.round(plannedPct)} %)` },
          { label: "Avancement année", value: fmtPct(yearProgress * 100) },
        ],
        why: over ? "Les engagements dépassent l'enveloppe validée : chaque nouvelle action nécessite un arbitrage." : "Au rythme actuel, l'enveloppe sera consommée avant la fin de l'année.",
        action: over ? "Arbitrer : réduire les actions prévues à faible ROI ou revoir le budget de la marque." : "Prioriser les actions restantes par ROI attendu et geler celles sans résultat mesurable.",
        task: { title: `Arbitrage budget ${row.name} ${year}`, dueInDays: 5, role: "MARKETING" },
        entity: { type: "brand", id: row.id, href: `/marketing/budgets?brand=${row.id}` },
        brandId: row.id,
      });
    }
    return out;
  },
};


/**
 * Ads Intelligence.
 *
 * Source prioritaire : les données de régie importées (`ad_metrics`), qui donnent le détail
 * jour × campagne. À défaut, les dépenses digitales saisies à la main dans les campagnes.
 * Le verdict et le diagnostic viennent du moteur `lib/ads` : le même raisonnement que
 * l'écran Digital Ads, pour éviter deux vérités dans l'application.
 */
export const adsRule: Rule = {
  id: "ads-performance",
  label: "Performance Ads",
  description: "SCALE / OPTIMIZE / STOP par campagne publicitaire : 30 derniers jours comparés aux 30 précédents et à la moyenne de la marque.",
  async run({ now: today, stocks }) {
    const end = iso(addDays(today, 1));
    const start = iso(addDays(today, -29));
    const prevStart = iso(addDays(today, -59));
    const [cur, prev] = await Promise.all([
      adsByDim("campaign", { start, end }),
      adsByDim("campaign", { start: prevStart, end: start }),
    ]);
    const out: Recommendation[] = [];
    if (cur.length) {
      const curK = cur.map(kpis);
      const prevK = new Map(prev.map((r) => [r.key, kpis(r)]));
      // référence par marque, pour situer chaque campagne dans son propre contexte
      const byBrand = new Map<string, typeof curK>();
      for (const r of curK) {
        const k = r.brandId ?? "none";
        byBrand.set(k, [...(byBrand.get(k) ?? []), r]);
      }
      for (const r of curK) {
        const avg = brandAverages(byBrand.get(r.brandId ?? "none") ?? curK);
        const d = diagnose(r, prevK.get(r.key) ?? null, avg);
        if (d.verdict === "MAINTAIN" || d.verdict === "WATCH") continue;
        const tight = r.brandId ? stocks.filter((p) => p.brandId === r.brandId && p.coverageMonths !== null && p.coverageMonths < 1.5 && p.avgMonthly > 30) : [];
        const actions = [...d.actions];
        if (d.verdict === "SCALE" && tight.length) {
          actions.unshift(`Sécuriser d'abord le stock de ${tight.slice(0, 3).map((p) => p.name).join(", ")} (couverture sous 1,5 mois) avant d'augmenter le budget.`);
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
    }

    // Repli : aucune donnée de régie importée — on retombe sur les dépenses saisies.
    const d30 = iso(addDays(today, -30)), d120 = iso(addDays(today, -120));
    const r = await db.execute(sql`
      select c.id, c.name, c.channel::text as channel, b.id as brand_id, b.name as brand_name,
        coalesce(sum(case when e.date >= ${d30}::date then e.amount end),0)::float8 as spend30,
        coalesce(sum(case when e.date >= ${d30}::date then e.conversions end),0)::float8 as conv30,
        coalesce(sum(case when e.date >= ${d30}::date then e.attributed_revenue end),0)::float8 as rev30,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.amount end),0)::float8 as spend90,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.conversions end),0)::float8 as conv90,
        coalesce(sum(case when e.date >= ${d120}::date and e.date < ${d30}::date then e.attributed_revenue end),0)::float8 as rev90
      from campaigns c join brands b on b.id = c.brand_id
      left join marketing_expenses e on e.campaign_id = c.id and e.category in ('META','TIKTOK','GOOGLE') and e.date <= ${iso(today)}::date
      where c.status = 'ACTIVE' and c.channel in ('META','TIKTOK','GOOGLE')
      group by c.id, c.name, c.channel, b.id, b.name`);
    for (const row of r.rows as Record<string, number | string>[]) {
      const spend30 = Number(row.spend30), conv30 = Number(row.conv30), rev30 = Number(row.rev30);
      const spend90 = Number(row.spend90), conv90 = Number(row.conv90), rev90 = Number(row.rev90);
      if (spend30 <= 0) continue;
      const cpa = conv30 ? spend30 / conv30 : null, cpaRef = conv90 ? spend90 / conv90 : null;
      const roas = spend30 ? rev30 / spend30 : 0, roasRef = spend90 ? rev90 / spend90 : null;
      const cpaDelta = cpa && cpaRef ? ((cpa - cpaRef) / cpaRef) * 100 : null;
      let verdict: "SCALE" | "MAINTAIN" | "OPTIMIZE" | "STOP";
      if (rev30 === 0 && conv30 === 0) verdict = "OPTIMIZE";
      else if (roas < 1.2) verdict = "STOP";
      else if ((cpaDelta !== null && cpaDelta > 20) || (roasRef !== null && roas < roasRef * 0.75)) verdict = "OPTIMIZE";
      else if (roas >= 3 && (cpaDelta === null || cpaDelta <= 0)) verdict = "SCALE";
      else verdict = "MAINTAIN";
      if (verdict === "MAINTAIN") continue;
      const tight = stocks.filter((p) => p.brandId === row.brand_id && p.coverageMonths !== null && p.coverageMonths < 1.5 && p.avgMonthly > 30);
      const why = rev30 === 0 && conv30 === 0 ? `${fmtMAD(spend30, { compact: true })} dépensés sur 30 jours sans conversion ni CA saisi : impossible de juger la rentabilité.`
        : verdict === "STOP" ? `ROAS ${roas.toFixed(1)} : chaque dirham investi rapporte moins qu'il ne coûte une fois la marge déduite.`
          : verdict === "OPTIMIZE" ? `CPA ${cpaDelta !== null ? fmtPct(cpaDelta, 0, true) + " vs 90 jours précédents" : "dégradé"}${roasRef !== null ? `, ROAS ${roas.toFixed(1)} vs ${roasRef.toFixed(1)}` : ""}.`
            : `ROAS ${roas.toFixed(1)}${cpaDelta !== null ? `, CPA ${fmtPct(cpaDelta, 0, true)}` : ""} : la campagne est rentable et stable.`;
      const action = rev30 === 0 && conv30 === 0 ? "Importer l'export de la régie (Imports → Publicités) pour obtenir un diagnostic détaillé, ou saisir les conversions et le CA attribué."
        : verdict === "STOP" ? "Couper la campagne, conserver les audiences, réallouer le budget vers une campagne rentable."
          : verdict === "OPTIMIZE" ? "Analyser la landing page et le tunnel, tester 3 nouvelles variations créatives, resserrer le ciblage."
            : tight.length ? `Augmenter le budget par paliers de 20 % — MAIS d'abord sécuriser le stock de ${tight.map((p) => p.name).join(", ")} (couverture < 1,5 mois).` : "Augmenter le budget par paliers de 20 % en surveillant le CPA à chaque palier.";
      out.push({
        key: `ads-${verdict.toLowerCase()}:${row.id}`,
        rule: "ads-performance",
        category: "MARKETING",
        priority: verdict === "STOP" ? "HIGH" : verdict === "OPTIMIZE" ? "HIGH" : "MEDIUM",
        title: `${String(row.brand_name).toUpperCase()} — ${row.name}`,
        subtitle: `${verdict} · ${row.channel}`,
        facts: [
          { label: "Dépense 30 j", value: fmtMAD(spend30, { compact: true }) },
          { label: "CA attribué 30 j", value: fmtMAD(rev30, { compact: true }) },
          { label: "ROAS", value: roas.toFixed(2) + (roasRef !== null ? ` (réf. ${roasRef.toFixed(2)})` : "") },
          { label: "CPA", value: cpa ? fmtMAD(cpa) + (cpaDelta !== null ? ` (${fmtPct(cpaDelta, 0, true)})` : "") : "n/c" },
          { label: "Conversions", value: fmtNum(conv30) },
        ],
        why, action,
        impact: verdict === "SCALE" ? `+${fmtMAD(rev30 * 0.2, { compact: true })} de CA attribué par palier de +20 %` : verdict === "STOP" ? `${fmtMAD(spend30, { compact: true })}/mois réalloués` : "Retour au CPA de référence",
        task: { title: `${verdict} — ${row.name}`, dueInDays: verdict === "STOP" ? 1 : 3, role: "MARKETING" },
        entity: { type: "campaign", id: String(row.id), href: `/marketing/campagnes/${row.id}` },
        brandId: String(row.brand_id),
        score: spend30,
      });
    }
    return out;
  },
};

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
 * Croisement marketing × stock : une campagne active qui pousse des produits dont la
 * couverture est trop faible. Augmenter la pression publicitaire créerait une rupture.
 */
export const campaignStockRule: Rule = {
  id: "campaign-stock",
  label: "Campagne active sur produit en tension",
  description: "Campagne en cours poussant un produit dont la couverture de stock est inférieure au seuil.",
  async run({ now: today, stocks, settings }) {
    const r = await db.execute(sql`
      select c.id, c.name, b.id as brand_id, b.name as brand_name, cp.product_id
      from campaigns c
      join brands b on b.id = c.brand_id
      join campaign_products cp on cp.campaign_id = c.id
      where c.status = 'ACTIVE'
        and (c.start_date is null or c.start_date <= ${iso(today)}::date)
        and (c.end_date is null or c.end_date >= ${iso(today)}::date)`);
    const byCampaign = new Map<string, { name: string; brandId: string; brandName: string; products: string[] }>();
    for (const row of r.rows as { id: string; name: string; brand_id: string; brand_name: string; product_id: string }[]) {
      const e = byCampaign.get(row.id) ?? { name: row.name, brandId: row.brand_id, brandName: row.brand_name, products: [] };
      e.products.push(row.product_id);
      byCampaign.set(row.id, e);
    }
    const out: Recommendation[] = [];
    const threshold = settings.coverage?.orange ?? 1;
    for (const [id, c] of byCampaign) {
      const tight = stocks.filter((p) => c.products.includes(p.productId) && p.coverageMonths !== null && p.coverageMonths < threshold);
      if (!tight.length) continue;
      out.push({
        key: `campaign-stock:${id}`,
        rule: "campaign-stock",
        category: "MARKETING",
        priority: tight.some((p) => (p.coverageMonths ?? 9) < 0.5) ? "CRITICAL" : "HIGH",
        title: `${c.brandName.toUpperCase()} — ${c.name}`,
        subtitle: `${tight.length} produit(s) poussé(s) sous ${threshold} mois de couverture`,
        facts: tight.slice(0, 5).map((p) => ({ label: p.name, value: `${p.coverageMonths?.toFixed(1)} mois · ${fmtNum(p.stock)} en stock` })),
        why: "La campagne pousse la demande sur des références qui risquent la rupture avant la fin de la période : la publicité serait payée pour un produit indisponible.",
        action: "Passer la commande de réassort maintenant, ou retirer ces références du périmètre de la campagne et pousser une alternative disponible.",
        impact: "Évite une rupture pendant la campagne et le budget publicitaire perdu",
        task: { title: `Réassort avant campagne ${c.name}`, dueInDays: 2, role: "ADMIN" },
        entity: { type: "campaign", id, href: `/marketing/campagnes/${id}` },
        brandId: c.brandId,
      });
    }
    return out;
  },
};
