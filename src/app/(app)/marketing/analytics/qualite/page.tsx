import Link from "next/link";
import { requireAccess, canDo } from "@/lib/access";
import { qualityReport } from "@/lib/analytics-marketing/quality";
import { freshness } from "@/lib/analytics-marketing/queries";
import { SOURCE_KINDS } from "@/lib/analytics-marketing/shared";
import { PageHeader, Card, Badge, Kpi, Tabs, Empty, Section } from "@/components/ui";
import { ANALYTICS_TABS } from "@/components/analytics";
import { fmtAgo, fmtDateShort, fmtNum } from "@/lib/format";
import { recalculateAnalytics } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Qualité des données marketing" };

export default async function QualitePage() {
  await requireAccess("marketing");
  const [report, fresh, canEdit] = await Promise.all([qualityReport(), freshness(), canDo("marketing", "edit")]);
  const open = report.issues.filter((i) => i.count > 0);
  const red = open.filter((i) => i.severity === "red").length;
  const lastOk = fresh.map((f) => f.lastOk).filter(Boolean).sort().at(-1) ?? null;
  const errors = fresh.filter((f) => f.lastError && (!f.lastOk || (f.lastAttempt ?? "") > f.lastOk));

  return (
    <>
      <PageHeader eyebrow="Marketing · Analytics" title="Qualité des données"
        subtitle="Ce qui manque pour que les chiffres soient crédibles. Chaque manque a un responsable et un lien pour corriger ; la complétude s'affiche à côté de chaque indicateur."
        actions={canEdit && (
          <form action={recalculateAnalytics}><button type="submit" className="btn-ghost btn-sm">Recalculer maintenant</button></form>
        )} />
      <div className="mb-4"><Tabs tabs={ANALYTICS_TABS} current="/marketing/analytics/qualite" /></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Complétude des données" value={report.completeness === null ? "—" : `${Math.round(report.completeness * 100)} %`} tone={report.completeness === null ? undefined : report.completeness >= 0.8 ? "green" : report.completeness >= 0.5 ? "orange" : "red"} sub="moyenne des contrôles pondérables" />
        <Kpi label="Manques ouverts" value={String(open.length)} tone={red ? "red" : open.length ? "orange" : "green"} sub={red ? `${red} bloquant${red > 1 ? "s" : ""}` : "aucun bloquant"} />
        <Kpi label="Dernier recalcul" value={lastOk ? fmtAgo(lastOk) : "jamais"} tone={errors.length ? "red" : lastOk ? "green" : undefined} sub={errors.length ? `${errors.length} source${errors.length > 1 ? "s" : ""} en erreur` : "toutes sources"} />
        <Kpi label="Lignes de faits" value={fmtNum(fresh.reduce((s, f) => s + f.spendRows, 0))} sub={`${fmtNum(fresh.reduce((s, f) => s + f.resultRows, 0))} résultats mesurés`} />
      </div>

      <Section title="Manques à corriger" description="Classés par gravité : rouge bloque une analyse entière, orange dégrade une page, jaune est informatif.">
        {open.length === 0 ? (
          <Empty title="Rien à corriger" hint="Toutes les sources sont complètes sur les contrôles suivis." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((i) => (
              <Card key={i.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={i.severity} dot>{i.count === 1 && i.total === null ? "à traiter" : fmtNum(i.count)}</Badge>
                      <span className="font-medium text-ink">{i.label}</span>
                    </div>
                    <p className="text-sm text-ink-2 mt-1">{i.why}</p>
                    {i.samples.length > 0 && <p className="text-xs text-muted mt-1 truncate">ex. {i.samples.join(" · ")}</p>}
                  </div>
                  {i.completeness !== null && <div className="text-right shrink-0"><div className="text-lg font-semibold tabular-nums">{Math.round(i.completeness * 100)} %</div><div className="text-[11px] text-muted">conforme</div></div>}
                </div>
                <div className="flex items-center justify-between mt-3 text-xs">
                  <span className="text-muted">Responsable : <span className="text-ink-2 font-medium">{i.owner}</span></span>
                  <Link href={i.href} className="btn-ghost btn-sm">Corriger</Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <Section title="Couverture des sources" description="Périodes réellement présentes en base. Une analyse hors de ces bornes affiche « données insuffisantes ».">
          <Card pad={false}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Source</th><th className="px-2 py-2 text-right">Lignes</th><th className="px-2 py-2">Du</th><th className="px-4 py-2">Au</th></tr></thead>
              <tbody>
                {report.coverage.map((c) => (
                  <tr key={c.source} className="border-t border-line">
                    <td className="px-4 py-2"><Link href={c.href} className="hover:underline">{c.label}</Link></td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.rows ? fmtNum(c.rows) : <span className="text-muted">aucune</span>}</td>
                    <td className="px-2 py-2 tabular-nums">{c.firstDay ? fmtDateShort(c.firstDay) : "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{c.lastDay ? fmtDateShort(c.lastDay) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
        <Section title="Fraîcheur de la couche de faits" description="Recalculée après chaque import, synchronisation ou saisie, et chaque matin à 6h30.">
          <Card pad={false}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="px-4 py-2">Source</th><th className="px-2 py-2">Dernier succès</th><th className="px-2 py-2 text-right">Dépenses</th><th className="px-2 py-2 text-right">Résultats</th><th className="px-4 py-2">État</th></tr></thead>
              <tbody>
                {Object.entries(SOURCE_KINDS).filter(([k]) => k !== "ACTIVATION_LINE").map(([k, meta]) => {
                  const f = fresh.find((x) => x.sourceKind === k);
                  const inError = f?.lastError && (!f.lastOk || (f.lastAttempt ?? "") > f.lastOk);
                  return (
                    <tr key={k} className="border-t border-line">
                      <td className="px-4 py-2"><Link href={meta.href} className="hover:underline">{meta.label}</Link></td>
                      <td className="px-2 py-2 text-muted">{f?.lastOk ? fmtAgo(f.lastOk) : "jamais"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{f ? fmtNum(f.spendRows) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{f ? fmtNum(f.resultRows) : "—"}</td>
                      <td className="px-4 py-2">{inError ? <Badge tone="red" dot>erreur</Badge> : f?.lastOk ? <Badge tone="green" dot>ok</Badge> : <Badge tone="gray">—</Badge>}{inError && <div className="text-[11px] text-red-700 mt-1 max-w-[220px] truncate" title={f!.lastError!}>{f!.lastError}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted mt-2">Une activation validée est lue via son reflet dans les dépenses marketing (une seule source d&apos;argent).</p>
        </Section>
      </div>
    </>
  );
}
