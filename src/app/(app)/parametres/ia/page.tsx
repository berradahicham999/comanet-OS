import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { isAiConfigured, modelFor } from "@/lib/ai/client";
import { monthlyCostUsd } from "@/lib/ai/limits";
import { priceFor } from "@/lib/ai/cost";
import { toolStats, usageByDay, usageBySurface, usageByUser, type UsageRow } from "@/lib/ai/usage";
import { PageHeader, Card, Badge, Section, Tabs } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { saveAiSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres — Copilote IA" };

const usd = (v: number) => `${v.toFixed(v < 1 ? 3 : 2)} $`;

function UsageTable({ rows, first }: { rows: UsageRow[]; first: string }) {
  if (!rows.length) return <div className="text-[13px] text-muted">Aucun appel sur la période.</div>;
  const total = rows.reduce((s, r) => ({ requests: s.requests + r.requests, tokensIn: s.tokensIn + r.tokensIn, tokensOut: s.tokensOut + r.tokensOut, cacheRead: s.cacheRead + r.cacheRead, costUsd: s.costUsd + r.costUsd }), { requests: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0 });
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{first}</th><th className="num">Réponses</th><th className="num">Tokens entrée</th><th className="num">dont cache</th><th className="num">Tokens sortie</th><th className="num">Coût estimé</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key}><td>{r.label}</td><td className="num">{fmtNum(r.requests)}</td><td className="num">{fmtNum(r.tokensIn)}</td><td className="num text-muted">{fmtNum(r.cacheRead)}</td><td className="num">{fmtNum(r.tokensOut)}</td><td className="num font-medium">{usd(r.costUsd)}</td></tr>)}
          <tr className="font-medium"><td>Total</td><td className="num">{fmtNum(total.requests)}</td><td className="num">{fmtNum(total.tokensIn)}</td><td className="num text-muted">{fmtNum(total.cacheRead)}</td><td className="num">{fmtNum(total.tokensOut)}</td><td className="num">{usd(total.costUsd)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function Field({ name, label, value, hint }: { name: string; label: string; value: number; hint?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} defaultValue={value} type="number" step="any" className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function AiSettingsPage(props: { searchParams: Promise<{ tab?: string }> }) {
  await requireAccess("administration");
  const tab = (await props.searchParams).tab ?? "couts";
  const [settings, monthly, byDay, byUser, bySurface, tools] = await Promise.all([getSettings(), monthlyCostUsd().catch(() => 0), usageByDay(30), usageByUser(30), usageBySurface(30), toolStats(30)]);
  const ai = settings.ai;
  const configured = isAiConfigured();
  const fast = modelFor("fast"), advanced = modelFor("advanced");
  const pctCap = ai.monthlyCostAlertUsd > 0 ? Math.round((monthly / ai.monthlyCostAlertUsd) * 100) : null;

  return (
    <>
      <PageHeader eyebrow={<Link href="/parametres" className="hover:underline">Paramètres</Link>} title="Copilote IA" subtitle="Coûts, modèles, limites. La clé et les modèles se règlent en variables d'environnement sur Vercel ; les limites ici.">
        <Tabs current={`/parametres/ia?tab=${tab}`} tabs={[{ href: "/parametres/ia?tab=couts", label: "Coûts" }, { href: "/parametres/ia?tab=modeles", label: "Modèles & état" }, { href: "/parametres/ia?tab=limites", label: "Limites" }, { href: "/parametres/ia?tab=outils", label: "Outils" }]} />
      </PageHeader>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Card><div className="label">État</div><div className="mt-2">{configured ? <Badge tone="green" dot>Configuré</Badge> : <Badge tone="orange" dot>Non configuré</Badge>}</div><div className="text-[12px] text-muted mt-1">{configured ? "ANTHROPIC_API_KEY présente sur le serveur." : "Renseigner ANTHROPIC_API_KEY sur Vercel puis redéployer."}</div></Card>
        <Card><div className="label">Coût du mois (estimé)</div><div className="kpi mt-2">{usd(monthly)}</div><div className="text-[12px] text-muted mt-1">{pctCap === null ? "aucun plafond" : `${pctCap} % du plafond de ${ai.monthlyCostAlertUsd} $`}{pctCap !== null && pctCap >= 100 && <span className="text-orange font-medium"> · surfaces automatiques suspendues</span>}</div></Card>
        <Card><div className="label">Modèles</div><div className="mt-2 text-[13px]"><span className="text-muted">rapide</span> <span className="font-medium">{fast}</span><br /><span className="text-muted">avancé</span> <span className="font-medium">{advanced}</span></div></Card>
      </div>

      {tab === "couts" && (
        <div className="space-y-4">
          <Section title="Par surface — 30 jours"><Card pad={false}><div className="p-4"><UsageTable rows={bySurface} first="Surface" /></div></Card></Section>
          <Section title="Par personne — 30 jours"><Card pad={false}><div className="p-4"><UsageTable rows={byUser} first="Personne" /></div></Card></Section>
          <Section title="Par jour — 30 jours"><Card pad={false}><div className="p-4"><UsageTable rows={byDay} first="Jour" /></div></Card></Section>
          <div className="text-[12px] text-faint">Coût estimé d&apos;après la grille de prix versionnée dans le code (`src/lib/ai/cost.ts`) ; un modèle inconnu est facturé au tarif le plus élevé de la grille. La facture Anthropic fait foi.</div>
        </div>
      )}

      {tab === "modeles" && (
        <Section title="Modèles et variables d'environnement" description="Ces réglages vivent sur Vercel (Settings → Environment Variables), jamais en base.">
          <Card>
            <table className="tbl">
              <thead><tr><th>Variable</th><th>Valeur active</th><th>Rôle</th><th className="num">Entrée $/M</th><th className="num">Sortie $/M</th></tr></thead>
              <tbody>
                <tr><td><code>ANTHROPIC_API_KEY</code></td><td>{configured ? "présente" : <span className="text-orange">absente</span>}</td><td>Clé d&apos;accès à l&apos;API Anthropic</td><td className="num">—</td><td className="num">—</td></tr>
                <tr><td><code>AI_MODEL_FAST</code></td><td>{fast}</td><td>Explications de cartes, brief du matin</td><td className="num">{priceFor(fast).input}</td><td className="num">{priceFor(fast).output}</td></tr>
                <tr><td><code>AI_MODEL_ADVANCED</code></td><td>{advanced}</td><td>Questions libres, plans d&apos;exécution, rapports</td><td className="num">{priceFor(advanced).input}</td><td className="num">{priceFor(advanced).output}</td></tr>
              </tbody>
            </table>
            <div className="text-[12px] text-muted mt-3">Le system prompt est versionné dans <code>src/lib/ai/prompts/copilot.md</code> et mis en cache côté API ; le contexte du jour (date, personne, page) est ajouté après le bloc mis en cache.</div>
          </Card>
        </Section>
      )}

      {tab === "limites" && (
        <Section title="Limites d'usage" description="Appliquées côté serveur à chaque question. Les questions manuelles d'un administrateur ne sont jamais bloquées par le plafond mensuel ; seules les surfaces automatiques (brief, explications) le sont.">
          <Card>
            <form action={saveAiSettings} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field name="requestsPerHour" label="Questions par personne et par heure" value={ai.requestsPerHour} />
              <Field name="dailyTokenBudget" label="Budget quotidien (tokens, toutes surfaces)" value={ai.dailyTokenBudget} hint="Entrée + sortie. Se réinitialise à minuit (Casablanca)." />
              <Field name="monthlyCostAlertUsd" label="Plafond mensuel d'alerte (USD)" value={ai.monthlyCostAlertUsd} hint="0 = aucun plafond." />
              <Field name="maxToolCalls" label="Appels d'outils par question (max)" value={ai.maxToolCalls} hint="1 à 12." />
              <Field name="timeoutSeconds" label="Délai maximal d'une réponse (s)" value={ai.timeoutSeconds} hint="15 à 120." />
              <Field name="explainCacheMinutes" label="Cache d'une explication de carte (min)" value={ai.explainCacheMinutes} />
              <div className="sm:col-span-2 lg:col-span-3"><button type="submit" className="btn-primary btn-sm">Enregistrer</button></div>
            </form>
          </Card>
        </Section>
      )}

      {tab === "outils" && (
        <Section title="Appels d'outils — 30 jours" description="Chaque lecture de donnée par le copilote est journalisée (personne, outil, paramètres, durée, lignes).">
          <Card pad={false}>
            <div className="p-4 overflow-x-auto">
              {tools.length === 0 ? <div className="text-[13px] text-muted">Aucun appel sur la période.</div> : (
                <table className="tbl">
                  <thead><tr><th>Outil</th><th className="num">Appels</th><th className="num">Erreurs / refus</th><th className="num">Durée moyenne</th><th className="num">Lignes renvoyées</th></tr></thead>
                  <tbody>{tools.map((t) => <tr key={t.tool}><td><code>{t.tool}</code></td><td className="num">{fmtNum(t.calls)}</td><td className="num">{t.errors ? <span className="text-orange">{fmtNum(t.errors)}</span> : 0}</td><td className="num">{fmtNum(t.avgMs)} ms</td><td className="num">{fmtNum(t.rows)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </Card>
        </Section>
      )}
    </>
  );
}
