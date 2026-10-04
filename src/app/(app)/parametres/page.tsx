import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";
import { updateSettings, saveObjectives } from "./actions";
import { seedDemoAction, purgeDemoAction, seedContentDemoAction, purgeContentDemoAction, seedActivationDemoAction, purgeActivationDemoAction } from "./demo-actions";
import { fmtMAD, fmtNum } from "@/lib/format";
import { observedEventRatios } from "@/lib/forecast";
import type { SeasonEvent } from "@/lib/forecast-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres" };

function Field({ name, label, value, hint, step }: { name: string; label: string; value: number | string; hint?: string; step?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} defaultValue={value} step={step} className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function ParametresPage(props: { searchParams: Promise<{ tab?: string; year?: string }> }) {
  await requireAccess("administration");
  const sp = await props.searchParams;
  const tab = sp.tab ?? "regles";
  const { ref } = await getRefDate();
  const year = Number(sp.year) || ref.getUTCFullYear();
  const [s, brands, objRows, demoCount] = await Promise.all([
    getSettings(),
    listBrands(),
    db.execute(sql`select brand_id, month, amount::float8 as amount from objectives where year = ${year} and product_id is null and client_id is null`),
    db.execute(sql`select (select count(*) from animations where comment like '[DÉMO]%')::int + (select count(*) from regulatory_files where notes like '[DÉMO]%')::int + (select count(*) from tasks where description like '[DÉMO]%')::int + (select count(*) from content_items where brief like '[DÉMO]%')::int + (select count(*) from marketing_expenses where notes like '[DÉMO]%')::int + (select count(*) from activations where notes like '[DÉMO]%')::int + (select count(*) from inventory_items where notes like '[DÉMO]%')::int as n`),
  ]);
  const obj = new Map<string, number>();
  for (const r of objRows.rows as { brand_id: string | null; month: number | null; amount: number }[]) obj.set(`${r.brand_id ?? "all"}|${r.month ?? 0}`, r.amount);
  const activeBrands = brands.filter((b) => b.active);
  const demo = (demoCount.rows[0] as { n: number }).n;
  const observed = tab === "regles" ? await observedEventRatios(s.forecast, ref) : [];

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paramètres" subtitle="Seuils des règles, objectifs et données de démonstration. Les comptes et leurs droits se gèrent dans « Utilisateurs & droits ». Aucune règle métier n'est codée en dur : tout se règle ici.">
        <Tabs current={`/parametres?tab=${tab}`} tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres/activations", label: "Activations" }, { href: "/parametres/gestion", label: "Gestion commerciale" }, { href: "/parametres/analytics", label: "Analytics marketing" }, { href: "/parametres/ia", label: "Copilote IA" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>

      {tab === "regles" && (
        <form action={updateSettings} className="grid md:grid-cols-2 gap-4">
          <Card title="Stock & achats">
            <div className="grid grid-cols-3 gap-2">
              <Field name="cov_green" label="🟢 Confortable ≥ (mois)" value={s.coverage.green} />
              <Field name="cov_yellow" label="🟡 À surveiller ≥" value={s.coverage.yellow} />
              <Field name="cov_orange" label="🟠 Tendu ≥ (sinon 🔴)" value={s.coverage.orange} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field name="avgSalesMonths" label="Mois pour la vente moyenne" value={s.avgSalesMonths} hint="Fenêtre glissante de calcul de la rotation" />
              <Field name="stockCriticalRevenue" label="CA mensuel à risque « critique » (MAD)" value={s.stockCriticalRevenue} hint="En dessous, l'alerte est haute / moyenne" />
              <Field name="defaultMarginPct" label="Marge par défaut (%)" value={s.defaultMarginPct} hint="Si coût de revient inconnu" />
            </div>
          </Card>
          <Card title="Stock chez le client">
            <div className="grid grid-cols-2 gap-2">
              <Field name="cs_freshDays" label="🟢 Relevé récent si < (jours)" value={s.clientStock.freshDays} hint="Entre les deux seuils : 🟠 à vérifier" />
              <Field name="cs_staleDays" label="🔴 À refaire à partir de (jours)" value={s.clientStock.staleDays} hint="Déclenche « Relevé de stock à faire »" />
              <Field name="cs_coverageWindowDays" label="Fenêtre sell-in / sell-out (jours)" value={s.clientStock.coverageWindowDays} hint="Couverture estimée = stock relevé ÷ rythme de sell-in" />
              <Field name="cs_stockoutSelloutDays" label="Rupture : sell-out sur (jours)" value={s.clientStock.stockoutSelloutDays} hint="Stock à 0 + ventes en animation = réassort à proposer" />
            </div>
          </Card>
          <Card title="Clients">
            <div className="grid grid-cols-2 gap-2">
              <Field name="clientInactiveDays" label="Inactif après (jours)" value={s.clientInactiveDays} />
              <Field name="reorderGraceDays" label="Tolérance relance (jours)" value={s.reorderGraceDays} hint="Après la commande théorique" />
              <Field name="clientRiskDropPct" label="À risque si baisse > (%)" value={s.clientRiskDropPct} hint="3 mois vs 3 mois précédents" />
              <Field name="clientGrowthPct" label="En croissance si hausse > (%)" value={s.clientGrowthPct} />
              <Field name="clientHighPotentialPercentile" label="Fort potentiel : percentile CA" value={s.clientHighPotentialPercentile} hint="80 = top 20 % des clients" />
            </div>
          </Card>
          <Card title="CRM commercial (visites et objectifs clients)">
            <input type="hidden" name="crm_present" value="1" />
            <div className="text-[12px] text-muted mb-2">Fréquence proposée par type (visites / mois), appliquée seulement à la demande sur une sélection (Clients → Portefeuilles) :</div>
            <div className="grid grid-cols-2 gap-2">
              <Field name="crm_f_PHARMACIE" label="Pharmacie" value={s.crm.defaultFrequencyByType.PHARMACIE} />
              <Field name="crm_f_PARAPHARMACIE" label="Parapharmacie" value={s.crm.defaultFrequencyByType.PARAPHARMACIE} />
              <Field name="crm_f_GROSSISTE" label="Grossiste" value={s.crm.defaultFrequencyByType.GROSSISTE} />
              <Field name="crm_f_AUTRE" label="Autre" value={s.crm.defaultFrequencyByType.AUTRE} />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
              <span className="label">Comptent dans la progression :</span>
              <span>Visite ✓</span>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="crm_count_APPEL" defaultChecked={s.crm.countedKinds.includes("APPEL")} /> Appel</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" name="crm_count_MESSAGE" defaultChecked={s.crm.countedKinds.includes("MESSAGE")} /> Message</label>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field name="crm_lateVisitDayOfMonth" label="Alerte « non visité » à partir du (jour)" value={s.crm.lateVisitDayOfMonth} />
              <Field name="crm_paceGapPts" label="Portefeuille en retard si écart > (points)" value={s.crm.paceGapPts} hint="Progression vs part du mois écoulée" />
              <Field name="crm_objectiveLateRatio" label="Objectif en retard si réalisé < attendu × (ratio)" value={s.crm.objectiveLateRatio} step="0.05" hint="0,7 = 30 % de tolérance" />
              <Field name="crm_objectiveCheckFromDay" label="Objectif comparé à partir du (jour)" value={s.crm.objectiveCheckFromDay} hint="Avant : « pas encore comparable »" />
              <Field name="crm_orderWindowMinutes" label="Commande « en visite » jusqu'à (min après la fin)" value={s.crm.orderWindowMinutes} />
              <Field name="crm_tourSuggestions" label="Clients suggérés « à voir aujourd'hui »" value={s.crm.tourSuggestions} />
              <Field name="crm_assortmentMinPeers" label="Assortiment manquant : pairs minimum" value={s.crm.assortmentMinPeers} />
              <Field name="crm_assortmentMinSharePct" label="… part de pairs acheteurs (%)" value={Math.round(s.crm.assortmentMinShare * 100)} />
              <Field name="crm_assortmentTopN" label="… produits proposés" value={s.crm.assortmentTopN} />
              <Field name="crm_autoCloseHours" label="Clôture auto d'une visite après (h)" value={s.crm.autoCloseHours} />
            </div>
            <div className="text-[12px] text-muted mt-3 mb-1">Contrôle de présence des visites (même moteur que le médical) :</div>
            <div className="grid grid-cols-2 gap-2">
              <Field name="crm_radiusM" label="Rayon du point de vente (m)" value={s.crm.radiusM} />
              <Field name="crm_maxAccuracyM" label="Précision GPS max (m)" value={s.crm.maxAccuracyM} />
              <Field name="crm_maxStartStopM" label="Démarrer ↔ Terminer max (m)" value={s.crm.maxStartStopM} />
              <Field name="crm_minDurationMin" label="Durée min (min)" value={s.crm.minDurationMin} />
              <Field name="crm_maxDurationMin" label="Durée max (min)" value={s.crm.maxDurationMin} />
              <Field name="crm_maxSpeedKmh" label="Vitesse max entre visites (km/h)" value={s.crm.maxSpeedKmh} />
              <Field name="crm_lateSyncHours" label="Envoi différé au-delà de (h)" value={s.crm.lateSyncHours} />
              <Field name="crm_clockSkewMin" label="Décalage d'horloge toléré (min)" value={s.crm.clockSkewMin} />
              <Field name="crm_gpsTimeoutS" label="Attente de la position (s)" value={s.crm.gpsTimeoutS} />
            </div>
          </Card>
          <Card title="Réglementaire">
            <Field name="regulatoryAlertDays" label="Alertes (jours avant expiration)" value={s.regulatoryAlertDays.join(" / ")} hint="Séparés par / ou virgule" />
            <div className="mt-2"><Field name="regulatoryRenewalDays" label="Lancer le renouvellement à J- (tâche automatique)" value={s.regulatoryRenewalDays} /></div>
          </Card>
          <Card title="Commercial, terrain & marketing">
            <div className="grid grid-cols-2 gap-2">
              <Field name="brandDropPct" label="Marque en baisse si < (%) vs M-1" value={s.brandDropPct} />
              <Field name="sellOutDropPct" label="Sell-out terrain en baisse si < (%)" value={s.sellOutDropPct} />
              <Field name="budgetAlertPct" label="Alerte budget engagé à (%)" value={s.budgetAlertPct} />
            </div>
          </Card>
          <Card title="Agent marketing">
            <p className="text-[12px] text-muted mb-2">Lecture marketing d&apos;un produit. Les seuils de stock (couverture, tension, surstock) et de croissance (Analytics marketing → « se vend si croissance ≥ ») sont réutilisés tels quels.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field name="mi_starContributionPct" label="STAR / CASH COW si contribution ≥ (% du CA)" value={s.marketingIntel.starContributionPct} />
              <Field name="mi_minPeriodRevenueMad" label="Classable si CA période ≥ (MAD)" value={s.marketingIntel.minPeriodRevenueMad} hint="En dessous : données insuffisantes" />
              <Field name="mi_lowMarginPct" label="Marge faible si < (%)" value={s.marketingIntel.lowMarginPct} hint="Jamais de scale automatique" />
              <Field name="mi_maxDecisions" label="Recommandations rendues (max)" value={s.marketingIntel.maxDecisions} />
            </div>
          </Card>
          <Card title="Studio créatif (Intelligence contenu)">
            <p className="text-[12px] text-muted mb-2">Opportunités, concepts et packages de contenu. Les scores sont des aides à la décision ; un apprentissage exige un volume minimal ; le budget de test payant est borné par le disponible du levier.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field name="cr_fatigueWindowDays" label="Fenêtre de fatigue (jours)" value={s.creative.fatigueWindowDays} hint="Contenus et concepts récents comptés" />
              <Field name="cr_duplicateThreshold" label="Doublon si proximité ≥ (0 à 1)" value={s.creative.duplicateThreshold} step="0.05" />
              <Field name="cr_saturationMinCount" label="Territoire saturé à partir de (contenus)" value={s.creative.saturationMinCount} />
              <Field name="cr_maxOpportunities" label="Opportunités affichées (max)" value={s.creative.maxOpportunities} />
              <Field name="cr_maxConcepts" label="Concepts par génération" value={s.creative.maxConcepts} hint="3 à 5" />
              <Field name="cr_paidTestBudgetMad" label="Budget de test payant (MAD)" value={s.creative.paidTestBudgetMad} hint="Jamais au-delà du disponible" />
              <Field name="cr_minLearningCreatives" label="Apprentissage : volume minimal" value={s.creative.minLearningCreatives} hint="Créatives ou publications par motif" />
              <label className="block text-[13px]"><span className="label block mb-1">Modèle des concepts</span><select name="cr_conceptTier" className="select h-9" defaultValue={s.creative.conceptTier}><option value="advanced">avancé</option><option value="fast">rapide</option></select></label>
              <label className="block text-[13px]"><span className="label block mb-1">Modèle de construction</span><select name="cr_builderTier" className="select h-9" defaultValue={s.creative.builderTier}><option value="fast">rapide</option><option value="advanced">avancé</option></select></label>
            </div>
          </Card>
          <Card title="Plan marketing (Marketing OS)">
            <p className="text-[12px] text-muted mb-2">Allocation proposée du budget par canal : part réelle de l&apos;année précédente, ajustée par le verdict de chaque canal (Analytics marketing). Sans historique suffisant, « non mesurable ».</p>
            <div className="grid grid-cols-2 gap-2">
              <Field name="mp_minHistoryMad" label="Historique minimal N-1 (MAD)" value={s.marketingPlan.minHistoryMad} hint="En dessous : aucune proposition" />
              <Field name="mp_testingSharePct" label="Réserve de tests (% du budget)" value={s.marketingPlan.testingSharePct} />
              <Field name="mp_scaleAdjustPct" label="Canal SCALE : +(%)" value={s.marketingPlan.scaleAdjustPct} />
              <Field name="mp_optimizeAdjustPct" label="Canal OPTIMIZE : −(%)" value={s.marketingPlan.optimizeAdjustPct} />
              <Field name="mp_stopAdjustPct" label="Canal STOP : −(%)" value={s.marketingPlan.stopAdjustPct} />
              <Field name="mp_reviewDays" label="Revue d'une décision approuvée (jours)" value={s.marketingPlan.reviewDays} hint="Au-delà sans exécution : expirée" />
              <Field name="mp_maxDecisions" label="Décisions affichées (max)" value={s.marketingPlan.maxDecisions} />
            </div>
          </Card>
          <Card title="Prévision saisonnière" className="md:col-span-2">
            <div id="prevision" />
            <p className="text-[12px] text-muted mb-2">Prévision mensuelle <b>modélisée</b> (Stock & achats → Prévision & commandes) : base désaisonnalisée × indice des événements ci-dessous. Un coefficient de 0,85 = −15 % sur les jours couverts, 1,5 = +50 %. Mots-clés vides = toutes les références ; sinon seules celles dont le nom ou la catégorie contient un mot-clé. Le <b>ratio observé</b> (ventes journalières dedans ÷ dehors sur 36 mois) est une corrélation constatée dans l&apos;historique, affichée pour calibrer le coefficient, jamais appliquée d&apos;office.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <Field name="fc_baseMonths" label="Mois de base (complets)" value={s.forecast.baseMonths} hint="Moyenne désaisonnalisée" />
              <Field name="fc_horizonMonths" label="Horizon affiché (mois)" value={s.forecast.horizonMonths} />
            </div>
            <input type="hidden" name="fc_ev_count" value={s.forecast.events.length + 1} />
            <div className="space-y-3">
              {[...s.forecast.events, null].map((e: SeasonEvent | null, i) => {
                const o = e ? observed.find((x) => x.key === e.key) : null;
                return (
                  <div key={e?.key ?? "new"} className={`rounded-xl border border-line p-3 ${e ? "" : "border-dashed"}`}>
                    <input type="hidden" name={`fc_ev_${i}_key`} value={e?.key ?? ""} />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Field name={`fc_ev_${i}_label`} label={e ? "Événement" : "Nouvel événement (libellé)"} value={e?.label ?? ""} hint={e ? undefined : "Laisser vide pour ne rien ajouter"} />
                      <Field name={`fc_ev_${i}_multiplier`} label="Coefficient" value={e?.multiplier ?? 1} step="0.05" hint={o ? (o.ratio === null ? `observé : pas assez de jours (${o.products} réf.)` : `observé : ×${o.ratio.toFixed(2)} sur ${o.daysIn} j (${o.products} réf.)`) : undefined} />
                      <Field name={`fc_ev_${i}_keywords`} label="Mots-clés (virgules)" value={e?.keywords.join(", ") ?? ""} hint="Vide : toutes les références" />
                      <Field name={`fc_ev_${i}_recurring`} label="Chaque année du … au … (JJ/MM → JJ/MM)" value={e?.recurring ? `${String(e.recurring.startDay).padStart(2, "0")}/${String(e.recurring.startMonth).padStart(2, "0")} → ${String(e.recurring.endDay).padStart(2, "0")}/${String(e.recurring.endMonth).padStart(2, "0")}` : ""} hint="Peut chevaucher le nouvel an" />
                    </div>
                    <div className="grid sm:grid-cols-4 gap-2 mt-2">
                      <label className="block text-[13px] sm:col-span-3"><span className="label block mb-1">Fenêtres explicites (une par ligne : AAAA-MM-JJ → AAAA-MM-JJ, bornes incluses)</span>
                        <textarea name={`fc_ev_${i}_windows`} defaultValue={e?.windows.map((w) => `${w.start} → ${w.end}`).join("\n") ?? ""} rows={Math.max(2, e?.windows.length ?? 0)} className="input py-1.5 font-mono text-[12px]" />
                        <span className="text-[11px] text-faint block mt-0.5">Ramadan : une fenêtre par année, à compléter chaque année (il recule d&apos;environ 11 jours par an).</span>
                      </label>
                      {e && <label className="flex items-end gap-2 text-[12px] pb-6"><input type="checkbox" name={`fc_ev_${i}_delete`} value="1" /> Supprimer cet événement</label>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="md:col-span-2"><button className="btn-primary" type="submit">Enregistrer les seuils</button></div>
        </form>
      )}

      {tab === "objectifs" && (
        <Card title={`Objectifs de CA HT — ${year}`} action={<form action="/parametres" method="get" className="flex gap-1"><input type="hidden" name="tab" value="objectifs" /><input name="year" defaultValue={year} className="input h-8 w-20 text-[12px]" /><button className="btn-secondary btn-sm" type="submit">Année</button></form>}>
          <p className="text-[12.5px] text-muted mb-3">Objectif annuel par marque (importé de votre fichier ou saisi ici). Les mois vides utilisent annuel ÷ 12 ; renseignez un mois pour tenir compte de la saisonnalité. Total COMANET = somme des marques.</p>
          <form action={saveObjectives}>
            <input type="hidden" name="year" value={year} /><input type="hidden" name="brandIds" value={activeBrands.map((b) => b.id).join(",")} />
            <div className="overflow-x-auto">
              <table className="tbl text-[12px]">
                <thead><tr><th>Marque</th><th className="num">Annuel</th>{["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => <th key={i} className="num">{m}</th>)}</tr></thead>
                <tbody>
                  {activeBrands.map((b) => (
                    <tr key={b.id}>
                      <td className="font-medium whitespace-nowrap">{b.name}</td>
                      <td><input name={`annual_${b.id}`} defaultValue={obj.get(`${b.id}|0`) ?? ""} className="input h-8 w-28 text-right text-[12px]" /></td>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <td key={m}><input name={`m_${b.id}_${m}`} defaultValue={obj.get(`${b.id}|${m}`) ?? ""} placeholder={obj.get(`${b.id}|0`) ? fmtNum(obj.get(`${b.id}|0`)! / 12) : ""} className="input h-8 w-20 text-right text-[11px] px-1.5" /></td>)}
                    </tr>
                  ))}
                  <tr><td className="font-semibold">Total COMANET</td><td className="num font-semibold">{fmtMAD(obj.get("all|0") ?? 0, { compact: true })}</td><td colSpan={12} className="text-faint text-[11px]">calculé automatiquement</td></tr>
                </tbody>
              </table>
            </div>
            <button className="btn-primary mt-3" type="submit">Enregistrer les objectifs</button>
          </form>
        </Card>
      )}

      {tab === "demo" && (
        <Card title="Données de démonstration">
          <p className="text-[13px] text-ink-2 mb-3">Les modules Terrain, Réglementaire, Tâches, Planning éditorial et Campagnes n&apos;étaient pas couverts par votre fichier. Vous pouvez y injecter un jeu de données <b>fictif mais cohérent</b> (calé sur vos vraies marques, produits et clients) pour visualiser les écrans, puis le purger d&apos;un clic. Toutes les entrées de démo sont marquées « [DÉMO] ».</p>
          <div className="flex flex-wrap gap-2 items-center">
            <form action={seedDemoAction}><button className="btn-primary btn-sm" type="submit">Charger les données de démo</button></form>
            <form action={purgeDemoAction}><button className="btn-secondary btn-sm text-red" type="submit">Purger les données de démo</button></form>
            <Badge tone={demo ? "yellow" : "gray"}>{demo ? `${demo} entrées de démo présentes` : "Aucune donnée de démo"}</Badge>
          </div>
          <h3 className="font-medium text-[13.5px] mt-5 mb-1">Planning éditorial seul</h3>
          <p className="text-[13px] text-ink-2 mb-2">Une trentaine de contenus sur vos marques et produits réels : publiés, en création, à valider, en retard, avec briefs, historique et commentaires. Indépendant des ventes importées. Vous devenez validateur de toutes les marques pour tester la file.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <form action={seedContentDemoAction}><button className="btn-primary btn-sm" type="submit">Charger la démo du planning</button></form>
            <form action={purgeContentDemoAction}><button className="btn-secondary btn-sm text-red" type="submit">Purger la démo du planning</button></form>
          </div>
          <h3 className="font-medium text-[13.5px] mt-5 mb-1">Activations et matériel</h3>
          <p className="text-[13px] text-ink-2 mb-2">Quatorze activations sur vos marques et vos villes (Casablanca, Rabat, Marrakech, Agadir, Tanger, Fès, Tétouan) : terminées avec résultats, en cours, validées avec checklist, proposées, idées ; budgets par poste engagés et facturés, matériel sorti d&apos;un inventaire de démo, historique. Les ventes ne sont pas touchées : l&apos;impact ventes n&apos;apparaît que si des ventes existent sur les clients rattachés.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <form action={seedActivationDemoAction}><button className="btn-primary btn-sm" type="submit">Charger la démo des activations</button></form>
            <form action={purgeActivationDemoAction}><button className="btn-secondary btn-sm text-red" type="submit">Purger la démo des activations</button></form>
          </div>
        </Card>
      )}
    </>
  );
}
