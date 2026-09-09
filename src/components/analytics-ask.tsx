import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { Card, Badge } from "@/components/ui";
import { MeasuredValue, fmtCostPerResult } from "@/components/analytics";
import { parseQuestion, INTENT_LABELS } from "@/lib/analytics-marketing/ask";
import { aggregate, aggregateBy } from "@/lib/analytics-marketing/queries";
import { compute } from "@/lib/analytics-marketing/metrics";
import { channelVerdicts, reallocationsFrom } from "@/lib/analytics-marketing/decision";
import { reallocationSentence } from "@/lib/analytics-marketing/reallocation";
import { verdictMeta } from "@/lib/ads";
import type { PageContext } from "@/lib/analytics-marketing/context";
import { resolvePeriod } from "@/lib/periods";
import { fmtMAD, fmtPct } from "@/lib/format";

/**
 * Bloc « question » : une phrase en français → réponse structurée Donnée / Analyse / Hypothèse /
 * Recommandation, calculée depuis le dictionnaire de métriques. Sans modèle de langage : ce
 * qui n'est pas compris est dit, rien n'est deviné.
 */
export async function AskBlock({ ctx, q }: { ctx: PageContext; q: string | null }) {
  const examples = ["Quel canal marche le mieux pour Gamarde ce trimestre ?", "Combien avons-nous dépensé en animation à Marrakech sur 90 jours ?", "Quels produits pousser pour Alphascience ?", "Où en est le budget Auracos cette année ?"];
  const products = (await db.execute<{ id: string; name: string }>(sql`select id::text as id, name from products where active`)).rows;
  const vocab = { brands: ctx.brands.map((b) => ({ id: b.id, name: b.name })), channels: ctx.channels.map((c) => ({ key: c.key, label: c.label })), cities: ctx.cities, products };
  const parsed = q ? parseQuestion(q, vocab) : null;

  let body: React.ReactNode = null;
  if (parsed) {
    const period = resolvePeriod(parsed.period, ctx.ref);
    const brandIds = parsed.brandId ? [parsed.brandId] : ctx.brands.map((b) => b.id);
    const filter = { range: { start: period.start, end: period.end }, prev: period.prev, n1: period.n1, brandIds, channelKeys: parsed.channelKey ? [parsed.channelKey] : null, city: parsed.city, productIds: parsed.productId ? [parsed.productId] : null };
    const settings = ctx.settings;
    const mctx = { settings: settings.analytics, health: { stockCoverageOk: null, dataQuality: ctx.completeness } };
    const scopeLabel = [parsed.brandId ? ctx.brands.find((b) => b.id === parsed.brandId)?.name : "toutes marques", parsed.channelKey ? ctx.channels.find((c) => c.key === parsed.channelKey)?.label : null, parsed.city ?? null, period.label].filter(Boolean).join(" · ");
    const a = await aggregate(filter);
    const spend = compute("SPEND_SPENT", a, mctx), sellIn = compute("SELL_IN", a, mctx), roi = compute("ROI_MEASURED", a, mctx), roiC = compute("ROI_CORRELATED", a, mctx), budget = compute("BUDGET_CONSUMED_PCT", a, mctx), obj = compute("OBJECTIVE_ATTAINMENT", a, mctx), growth = compute("SALES_GROWTH_PREV", a, mctx);
    const dataLines: React.ReactNode[] = [
      <li key="s">Dépense marketing : <MeasuredValue m={spend} unit="MAD" size="sm" /></li>,
      <li key="v">Sell-in : <MeasuredValue m={sellIn} unit="MAD" size="sm" /> {growth.ok && <span className="text-muted">({fmtPct(growth.value, 0, true)} vs période précédente)</span>}</li>,
    ];
    let analysis: React.ReactNode = null, hypothesis: React.ReactNode = null, reco: React.ReactNode = null;

    if (parsed.intent === "BEST_CHANNEL" || parsed.intent === "WORST_CHANNEL" || parsed.intent === "OVERVIEW") {
      const verdicts = (await channelVerdicts({ range: filter.range, prev: period.prev, brandIds, ref: ctx.ref, settings })).filter((v) => !parsed.city || true);
      const ranked = verdicts.filter((v) => v.verdict.costPerResult).sort((x, y) => (x.verdict.costPerResult!.value / (x.verdict.costPerResult!.portfolio ?? x.verdict.costPerResult!.value)) - (y.verdict.costPerResult!.value / (y.verdict.costPerResult!.portfolio ?? y.verdict.costPerResult!.value)));
      const pick = parsed.intent === "WORST_CHANNEL" ? ranked[ranked.length - 1] : ranked[0];
      if (parsed.city) hypothesis = <span>La ville n&apos;est connue que sur les animations et activations : les régies et l&apos;influence ne sont pas localisées, le classement par canal ci-dessous porte sur le périmètre marque, pas sur {parsed.city}.</span>;
      if (!pick) analysis = <span>Aucun canal avec dépense et résultat mesurés sur ce périmètre : impossible de classer.</span>;
      else {
        const others = ranked.filter((v) => v !== pick).slice(0, 3);
        dataLines.push(<li key="c">{ranked.length} canal(aux) mesurés : {ranked.map((v) => `${v.channel.label} (${fmtCostPerResult(v.verdict.costPerResult!.value, v.verdict.costPerResult!.key)})`).join(", ")}</li>);
        analysis = <span><strong>{pick.channel.label}</strong> pour {ctx.brands.find((b) => b.id === pick.brandId)?.name} : {pick.verdict.headline.toLowerCase()} — {pick.verdict.why}{others.length > 0 && <> Comparé à {others.map((v) => v.channel.label).join(", ")}.</>}</span>;
        hypothesis = hypothesis ?? <span>Le coût par résultat compare des résultats différents selon les canaux (conversation, portée, sell-out) : le classement est relatif à la moyenne de chaque canal, pas une preuve de causalité sur les ventes.</span>;
        reco = <ul className="list-disc pl-5">{pick.verdict.actions.map((x) => <li key={x}>{x}</li>)}</ul>;
      }
      const realloc = reallocationsFrom(verdicts, settings, { brand: (id) => ctx.brands.find((b) => b.id === id)?.name ?? "?", channel: (k) => ctx.channels.find((c) => c.key === k)?.label ?? k });
      if (realloc.length) reco = <>{reco}<p className="mt-1">{reallocationSentence(realloc[0], { brand: (id) => ctx.brands.find((b) => b.id === id)?.name ?? "?", channel: (k) => ctx.channels.find((c) => c.key === k)?.label ?? k, result: (k) => ctx.metrics.get(k)?.label ?? k })}</p></>;
    } else if (parsed.intent === "SPEND") {
      const byChannel = await aggregateBy("channel", filter);
      dataLines.push(<li key="ch">Par canal : {byChannel.map((r) => `${ctx.channels.find((c) => c.key === r.key)?.label ?? r.key} ${fmtMAD(r.aggregate.spend.spent, { compact: true })}`).join(", ") || "aucune"}</li>);
      analysis = a.spend.unmeasuredRows > 0 ? <span>{a.spend.unmeasuredRows} ligne(s) de dépense sans montant (coût non renseigné) : le total est un minimum.</span> : <span>Toutes les dépenses du périmètre ont un montant mesuré.</span>;
      hypothesis = <span>Une dépense de régie compte à la journée close ; une activation compte dès validation (engagé) ; une animation au tarif journalier de Paramètres.</span>;
      reco = <span>Comparer à l&apos;enveloppe : <MeasuredValue m={budget} unit="PCT" size="sm" /></span>;
    } else if (parsed.intent === "ROI") {
      dataLines.push(<li key="r">ROI mesuré : <MeasuredValue m={roi} unit="MULTIPLE" attribution="MEASURED" size="sm" /></li>, <li key="rc">Retour observé : <MeasuredValue m={roiC} unit="MULTIPLE" attribution="CORRELATION" size="sm" /></li>);
      analysis = roi.ok ? <span>Le ROI mesuré ne porte que sur les dépenses qui ont un CA réellement remonté (régie, code promo, saisie) : {Math.round((roi.completeness ?? 0) * 100)} % des dépenses.</span> : <span>Aucune dépense ne porte de CA mesuré sur ce périmètre : le ROI n&apos;est pas calculable, seul le retour observé (corrélation) l&apos;est.</span>;
      hypothesis = <span>Le retour observé compare le sell-in à la période précédente ; il capte aussi la saisonnalité et les commandes exceptionnelles.</span>;
      reco = <span>Pour rendre le ROI mesurable : codes promo nominatifs sur l&apos;influence, CA saisi sur les activations, pixel d&apos;achat sur les régies.</span>;
    } else if (parsed.intent === "PRODUCTS") {
      const rows = (await aggregateBy("product", filter)).filter((r) => r.key).sort((x, y) => y.aggregate.sales.sellIn - x.aggregate.sales.sellIn).slice(0, 5);
      dataLines.push(<li key="p">Top sell-in : {rows.map((r) => `${products.find((p) => p.id === r.key)?.name ?? "?"} ${fmtMAD(r.aggregate.sales.sellIn, { compact: true })}`).join(", ") || "aucune vente"}</li>);
      analysis = <span>Les quatre cas (poussé / se vend) et le croisement avec le stock sont sur la page Par produit.</span>;
      hypothesis = <span>« Se vend » = croissance ≥ {settings.analytics.productCases.sellingGrowthPct} % ou au-dessus de la médiane de la marque : un pic exceptionnel le mois précédent fait passer un bon produit en « ne se vend pas ».</span>;
      reco = <Link href={`/marketing/analytics/produits?period=${parsed.period}${parsed.brandId ? `&brand=${parsed.brandId}` : ""}`} className="underline">Ouvrir la vue par produit filtrée</Link>;
    } else if (parsed.intent === "BUDGET") {
      dataLines.push(<li key="b">Enveloppe consommée : <MeasuredValue m={budget} unit="PCT" size="sm" /></li>);
      analysis = budget.ok ? <span>{fmtPct(budget.value)} de l&apos;enveloppe annuelle consommée (engagé + régie), selon la définition officielle du budget consommé.</span> : <span>Pas d&apos;enveloppe annuelle définie sur ce périmètre.</span>;
      hypothesis = <span>Le prévu (PLANNED) n&apos;est pas compté dans le consommé : c&apos;est un projet, pas un engagement.</span>;
      reco = <Link href="/marketing/budgets" className="underline">Voir les budgets</Link>;
    } else {
      dataLines.push(<li key="o">Objectif : <MeasuredValue m={obj} unit="PCT" size="sm" /></li>);
      analysis = obj.ok ? <span>{fmtPct(obj.value)} de l&apos;objectif proratisé sur la période.</span> : <span>Pas d&apos;objectif sur ce périmètre.</span>;
      hypothesis = <span>Le sell-in dépend aussi des commandes grossistes et de la saisonnalité, pas seulement du marketing.</span>;
      reco = <Link href={`/marketing/analytics/marques?period=${parsed.period}${parsed.brandId ? `&brand=${parsed.brandId}` : ""}`} className="underline">Voir la vue par marque</Link>;
    }

    body = (
      <div className="mt-3 text-sm space-y-2">
        <div className="text-xs text-muted">J&apos;ai compris : <Badge tone="blue">{INTENT_LABELS[parsed.intent]}</Badge> {parsed.understood.map((u) => <Badge key={u} tone="gray" className="ml-1">{u}</Badge>)} <span className="ml-1">· périmètre : {scopeLabel}</span>{parsed.unknown.length > 0 && <span className="ml-1 text-orange-700">· non compris : {parsed.unknown.join(", ")}</span>}</div>
        <div><span className="font-semibold">Donnée</span><ul className="list-disc pl-5">{dataLines}</ul></div>
        <div><span className="font-semibold">Analyse</span><div>{analysis}</div></div>
        <div><span className="font-semibold">Hypothèse</span><div className="text-ink-2">{hypothesis}</div></div>
        <div><span className="font-semibold">Recommandation</span><div>{reco}</div></div>
      </div>
    );
  }

  return (
    <Card title="Poser une question">
      <form method="get" className="flex gap-2">
        {ctx.periodKey !== "month" && <input type="hidden" name="period" value={ctx.periodKey} />}
        <input name="q" defaultValue={q ?? ""} placeholder={examples[0]} className="input h-9 flex-1" />
        <button className="btn-primary btn-sm" type="submit">Répondre</button>
      </form>
      <div className="text-[11px] text-muted mt-1">Sans modèle de langage : marque, canal, ville, produit et période sont reconnus par mots-clés. Exemples : {examples.slice(1).map((e) => <Link key={e} href={`/marketing/analytics?q=${encodeURIComponent(e)}`} className="underline mr-2">{e}</Link>)}</div>
      {body}
    </Card>
  );
}
