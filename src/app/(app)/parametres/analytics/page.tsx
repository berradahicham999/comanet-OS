import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getSettings, animationDayCostOf, animationMinMultipleOf } from "@/lib/settings";
import { listChannels, listMetricDefinitions } from "@/lib/analytics-marketing/queries";
import { CHANNEL_FAMILIES, MAPPING_KINDS, RESULT_KEYS } from "@/lib/analytics-marketing/shared";
import { BUDGET_CATEGORY_LABELS } from "@/lib/budget-categories";
import { PageHeader, Card, Badge, Tabs, Section } from "@/components/ui";
import { saveAnalyticsSettings, saveChannel, saveMapping, saveMetric } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres — Analytics marketing" };

function Field({ name, label, value, hint, step }: { name: string; label: string; value: number | string | null; hint?: string; step?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} defaultValue={value ?? ""} step={step ?? "any"} className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function AnalyticsSettingsPage(props: { searchParams: Promise<{ tab?: string }> }) {
  await requireAccess("administration");
  const tab = (await props.searchParams).tab ?? "seuils";
  const [settings, channels, metrics, mappings, sources] = await Promise.all([
    getSettings(), listChannels(), listMetricDefinitions(),
    db.execute<{ source_kind: string; source_key: string; channel_key: string }>(sql`select * from channel_mappings order by source_kind, source_key`),
    db.execute<{ kind: string; key: string; label: string }>(sql`
      select 'CONTENT_PLATFORM' as kind, key, label from content_platforms
      union all select 'ACTIVATION_TYPE', key, label from activation_types
      union all select 'AD_PLATFORM', p, p from (values ('META'), ('TIKTOK'), ('GOOGLE'), ('AUTRE')) as x(p)`),
  ]);
  const a = settings.analytics;
  const dayCost = animationDayCostOf(a);
  const mapOf = (kind: string, key: string) => mappings.rows.find((m) => m.source_kind === kind && m.source_key === key)?.channel_key ?? "";
  const sourceRows: { kind: string; key: string; label: string }[] = [
    ...Object.entries(BUDGET_CATEGORY_LABELS).map(([key, label]) => ({ kind: "BUDGET_CATEGORY", key, label })),
    ...sources.rows.map((r) => ({ kind: r.kind, key: r.key, label: r.label })),
    { kind: "COLLABORATION", key: "*", label: "Toutes les collaborations" }, { kind: "ANIMATION", key: "*", label: "Toutes les animations" }, { kind: "SAMPLE", key: "*", label: "Tous les échantillons médicaux" },
  ];
  const channelSelect = (name: string, value: string) => (
    <select name={name} defaultValue={value} className="input h-9">
      <option value="">—</option>
      {channels.map((c) => <option key={c.key} value={c.key}>{c.label}{c.active ? "" : " (inactif)"}</option>)}
    </select>
  );
  const resultSelect = (name: string, value: string | null) => (
    <select name={name} defaultValue={value ?? ""} className="input h-9">
      <option value="">aucun</option>
      {RESULT_KEYS.map((k) => <option key={k} value={k}>{metrics.find((m) => m.key === k)?.label ?? k}</option>)}
    </select>
  );

  return (
    <>
      <PageHeader eyebrow="Administration" title="Analytics marketing" subtitle="Fenêtres d'attribution, coût animatrice, poids du score, seuils de verdict, canaux, correspondances et dictionnaire de métriques. Rien n'est en dur : chaque page affiche le réglage appliqué.">
        <Tabs current={`/parametres/analytics?tab=${tab}`} tabs={[{ href: "/parametres/analytics?tab=seuils", label: "Seuils & fenêtres" }, { href: "/parametres/analytics?tab=canaux", label: "Canaux", count: channels.length }, { href: "/parametres/analytics?tab=correspondances", label: "Correspondances", count: sourceRows.length }, { href: "/parametres/analytics?tab=metriques", label: "Dictionnaire", count: metrics.length }, { href: "/parametres", label: "← Paramètres" }]} />
      </PageHeader>

      {tab === "seuils" && (
        <form action={saveAnalyticsSettings} className="grid md:grid-cols-2 gap-4">
          <Card title="Attribution et répartition">
            <div className="grid grid-cols-2 gap-2">
              <Field name="windowBeforeDays" label="Fenêtre avant (jours)" value={a.windowBeforeDays} hint="Ventes comparées avant une action" />
              <Field name="windowAfterDays" label="Fenêtre après (jours)" value={a.windowAfterDays} hint="Ventes observées après une action" />
              <label className="block text-[13px]"><span className="label block mb-1">Répartition multi-produits</span>
                <select name="productSplit" defaultValue={a.productSplit} className="input h-9"><option value="PRORATA_SALES">Au prorata du sell-in récent</option><option value="EQUAL">À parts égales</option></select></label>
              <Field name="productSplitLookbackDays" label="Jours de sell-in pour le prorata" value={a.productSplitLookbackDays} />
            </div>
          </Card>
          <Card title="Coût d'une animatrice">
            <div className="grid grid-cols-2 gap-2">
              <Field name="animationMonthlyCost" label="Coût mensuel chargé (MAD)" value={a.animationMonthlyCost} hint="Salaire + charges" />
              <Field name="animationDaysPerMonth" label="Jours d'animation par mois" value={a.animationDaysPerMonth} />
              <Field name="animationDayCost" label="Tarif journalier saisi (MAD)" value={a.animationDayCost} hint="Facultatif : prime sur le calcul mensuel ÷ jours" />
              <Field name="animationTargetSelloutPerDay" label="Sell-out TTC attendu par jour (MAD)" value={a.animationTargetSelloutPerDay} hint="Prime sur le multiple ci-dessous" />
              <Field name="animationMinSelloutMultiple" label="Multiple attendu (× le coût)" value={a.animationMinSelloutMultiple} hint="Si pas d'objectif journalier" />
              <Field name="animationStopSelloutMultiple" label="Plancher STOP (× le coût)" value={a.animationStopSelloutMultiple} />
            </div>
            <p className="text-[12px] text-muted mt-2">Appliqué : {dayCost ? `${dayCost} MAD/jour, rentable à partir de ${animationMinMultipleOf(a).toFixed(1)}× soit ${Math.round(dayCost * animationMinMultipleOf(a))} MAD TTC/jour` : "aucun coût : le canal Animation reste non mesurable"}. Rétroactif sur tout l&apos;historique terrain.</p>
          </Card>
          <Card title="Score de santé (poids) et équilibre">
            <div className="grid grid-cols-3 gap-2">
              <Field name="hw_objective" label="Objectif" value={a.healthWeights.objective} />
              <Field name="hw_roi" label="Retour" value={a.healthWeights.roi} />
              <Field name="hw_intensity" label="Intensité" value={a.healthWeights.intensity} />
              <Field name="hw_stock" label="Stock" value={a.healthWeights.stockCoverage} />
              <Field name="hw_data" label="Données" value={a.healthWeights.dataQuality} />
              <Field name="investmentBalancePts" label="Tolérance sur/sous-investi (pt)" value={a.investmentBalancePts} />
            </div>
          </Card>
          <Card title="Produits : quatre cas et stock">
            <div className="grid grid-cols-2 gap-2">
              <Field name="pc_minSpend" label="Poussé si dépense ≥ (MAD)" value={a.productCases.pushedMinSpend} />
              <Field name="pc_minExposures" label="ou si actions ≥" value={a.productCases.pushedMinExposures} />
              <Field name="pc_growth" label="Se vend si croissance ≥ (%)" value={a.productCases.sellingGrowthPct} hint="ou au-dessus de la médiane de la marque" />
              <Field name="pc_overstockMonths" label="Surstock si couverture > (mois)" value={a.productCases.overstockMonths} />
              <Field name="pc_overstockUnits" label="et stock ≥ (unités)" value={a.productCases.overstockMinUnits} hint="Partagé avec la règle stock" />
            </div>
          </Card>
          <Card title="Verdict par canal (hors régie)">
            <div className="grid grid-cols-2 gap-2">
              <Field name="cd_minSpend" label="Dépense minimale pour trancher (MAD)" value={a.channelDiagnosis.minSpend} />
              <Field name="cd_rise" label="OPTIMIZE si coût/résultat +N %" value={a.channelDiagnosis.costRisePct} />
              <Field name="cd_drop" label="SCALE si coût/résultat −N %" value={a.channelDiagnosis.costDropPct} />
              <Field name="cd_factor" label="STOP si > N × la moyenne du canal" value={a.channelDiagnosis.costVsPortfolioFactor} />
              <Field name="cd_weeks" label="Alerte après N semaines de hausse" value={a.channelDiagnosis.degradingWeeks} />
            </div>
            <p className="text-[12px] text-muted mt-2">Les régies (Meta, TikTok, Google) gardent les seuils de Paramètres → Publicité.</p>
          </Card>
          <Card title="Réallocation et alertes">
            <div className="grid grid-cols-2 gap-2">
              <Field name="re_min" label="Déplacement minimal (MAD)" value={a.reallocation.minShiftMad} />
              <Field name="re_max" label="Part maximale déplacée par mois (%)" value={a.reallocation.maxShiftPct} hint="Doublée pour un canal STOP" />
              <Field name="al_drift" label="Dérive budget : engagé > plan de N %" value={a.alerts.budgetDriftPct} />
              <Field name="al_drop" label="Marque sans dépense : objectif sous 100 − N %" value={a.alerts.brandNoSpendObjectiveDropPct} />
            </div>
          </Card>
          <div className="md:col-span-2"><button className="btn-primary" type="submit">Enregistrer</button></div>
        </form>
      )}

      {tab === "canaux" && (
        <Section title="Canaux" description="Le résultat propre sert au coût par résultat ; le repli est utilisé quand le principal est à zéro (ex. Meta : achats → conversations).">
          <div className="space-y-2">
            {channels.map((c) => (
              <form key={c.key} action={saveChannel} className="card card-pad grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
                <input type="hidden" name="key" value={c.key} />
                <div className="text-[12px] text-muted md:col-span-1"><span className="font-mono">{c.key}</span></div>
                <Field name="label" label="Libellé" value={c.label} />
                <label className="block text-[13px]"><span className="label block mb-1">Famille</span><select name="family" defaultValue={c.family} className="input h-9">{Object.entries(CHANNEL_FAMILIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="block text-[13px]"><span className="label block mb-1">Résultat propre</span>{resultSelect("resultMetric", c.resultMetric)}</label>
                <label className="block text-[13px]"><span className="label block mb-1">Repli</span>{resultSelect("fallbackResultMetric", c.fallbackResultMetric)}</label>
                <Field name="color" label="Couleur" value={c.color} />
                <Field name="sort" label="Ordre" value={c.sort} />
                <div className="flex items-center gap-3"><label className="text-[13px] flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={c.active} /> actif</label><button className="btn-ghost btn-sm" type="submit">OK</button></div>
              </form>
            ))}
            <form action={saveChannel} className="card card-pad grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
              <Field name="key" label="Nouvelle clé" value="" hint="MAJUSCULES_ET_UNDERSCORES" />
              <Field name="label" label="Libellé" value="" />
              <label className="block text-[13px]"><span className="label block mb-1">Famille</span><select name="family" className="input h-9">{Object.entries(CHANNEL_FAMILIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="block text-[13px]"><span className="label block mb-1">Résultat propre</span>{resultSelect("resultMetric", null)}</label>
              <label className="block text-[13px]"><span className="label block mb-1">Repli</span>{resultSelect("fallbackResultMetric", null)}</label>
              <Field name="color" label="Couleur" value="#64748b" />
              <Field name="sort" label="Ordre" value={50} />
              <div className="flex items-center gap-3"><input type="hidden" name="active" value="on" /><button className="btn-primary btn-sm" type="submit">Ajouter</button></div>
            </form>
          </div>
        </Section>
      )}

      {tab === "correspondances" && (
        <Section title="Correspondances source → canal" description="Comment chaque catégorie budgétaire, régie, plateforme éditoriale ou type d'activation se range dans un canal. Un changement relance le recalcul de la source.">
          <Card pad={false}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Source</th><th className="px-2 py-2">Clé</th><th className="px-2 py-2">Canal</th><th className="px-4 py-2"></th></tr></thead>
              <tbody>
                {sourceRows.map((r) => (
                  <tr key={`${r.kind}:${r.key}`} className="border-t border-line">
                    <td className="px-4 py-1.5 text-xs text-muted">{MAPPING_KINDS[r.kind as keyof typeof MAPPING_KINDS] ?? r.kind}</td>
                    <td className="px-2 py-1.5">{r.label}{r.label !== r.key && <span className="text-[11px] text-muted font-mono ml-1">{r.key}</span>}</td>
                    <td className="px-2 py-1.5" colSpan={2}>
                      <form action={saveMapping} className="flex gap-2 items-center">
                        <input type="hidden" name="sourceKind" value={r.kind} /><input type="hidden" name="sourceKey" value={r.key} />
                        {channelSelect("channelKey", mapOf(r.kind, r.key))}
                        <button className="btn-ghost btn-sm" type="submit">OK</button>
                        {!mapOf(r.kind, r.key) && <Badge tone="orange">non rangé → Autres</Badge>}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
      )}

      {tab === "metriques" && (
        <Section title="Dictionnaire de métriques" description="Libellés, sens et seuils modifiables. La formule est calculée dans le code (une seule définition) et affichée ici à titre documentaire.">
          <div className="space-y-2">
            {metrics.map((m) => (
              <form key={m.key} action={saveMetric} className="card card-pad grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
                <input type="hidden" name="key" value={m.key} />
                <div className="text-[12px] md:col-span-1"><span className="font-mono">{m.key}</span><div className="text-muted">{m.family} · {m.unit}{m.attribution !== "NONE" && ` · ${m.attribution === "MEASURED" ? "mesuré" : "corrélation"}`}</div></div>
                <Field name="label" label="Libellé" value={m.label} />
                <label className="block text-[13px] md:col-span-2"><span className="label block mb-1">Description</span><input name="description" defaultValue={m.description ?? ""} className="input h-9" /><span className="text-[11px] text-faint block mt-0.5">Formule : {m.formula}</span></label>
                <label className="block text-[13px]"><span className="label block mb-1">Sens</span><select name="direction" defaultValue={m.direction} className="input h-9"><option value="HIGHER_BETTER">Plus haut = mieux</option><option value="LOWER_BETTER">Plus bas = mieux</option><option value="NEUTRAL">Neutre</option></select></label>
                <div className="grid grid-cols-2 gap-1"><Field name="warnThreshold" label="Seuil alerte" value={m.warnThreshold} /><Field name="alertThreshold" label="Seuil critique" value={m.alertThreshold} /></div>
                <div className="flex items-center gap-3"><label className="text-[13px] flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={m.active} /> actif</label><button className="btn-ghost btn-sm" type="submit">OK</button></div>
              </form>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
