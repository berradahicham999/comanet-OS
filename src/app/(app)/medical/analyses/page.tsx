import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { PageHeader, Card, Tabs, Empty, Badge } from "@/components/ui";
import { suggestedTour, doctorSegments, visitImpactReport, type ImpactAgg } from "@/lib/medical/analyses";
import { cityTitle } from "@/lib/medical/prescriptions-shared";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analyses médicales" };

/**
 * Analyses médicales : tournée suggérée de la semaine, segments médecins, impact des visites
 * (corrélation observée). Une déléguée ne voit que ses médecins et ses visites.
 */
export default async function AnalysesPage(props: { searchParams: Promise<{ tab?: string; delegate?: string }> }) {
  const user = await requireAccess("medical");
  const own = await isOwnOnly();
  const sp = await props.searchParams;
  const tab = ["tournee", "segments", "impact"].includes(sp.tab ?? "") ? sp.tab! : "tournee";
  const delegates = own ? [] : (await db.execute<{ id: string; name: string }>(sql`
    select u.id, u.name from medical_delegates md join users u on u.id = md.user_id where md.active order by u.name`)).rows;
  const delegateId = own ? user.id : sp.delegate && delegates.some((d) => d.id === sp.delegate) ? sp.delegate : (tab === "tournee" ? delegates[0]?.id ?? null : null);
  const q = (t: string) => `/medical/analyses?${new URLSearchParams({ tab: t, ...(delegateId && !own ? { delegate: delegateId } : {}) })}`;

  const [tour, segments, impact] = await Promise.all([
    tab === "tournee" && delegateId ? suggestedTour(delegateId) : null,
    tab === "segments" ? doctorSegments(delegateId) : null,
    tab === "impact" ? visitImpactReport(delegateId) : null,
  ]);

  return (
    <>
      <PageHeader eyebrow="Médical" title="Analyses médicales" subtitle="Chaque analyse dit ses observations et sépare la donnée, l'analyse et la recommandation. Aucune n'est une boîte noire.">
        {!own && (
          <form className="flex items-end gap-2 text-[13px]">
            <input type="hidden" name="tab" value={tab} />
            <label><span className="label block mb-1">Déléguée</span>
              <select name="delegate" defaultValue={delegateId ?? ""} className="select h-9 min-w-[200px]">
                {tab !== "tournee" && <option value="">Toutes</option>}
                {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <button className="btn-primary h-9" type="submit">Afficher</button>
          </form>
        )}
      </PageHeader>
      <Tabs current={q(tab)} tabs={[{ href: q("tournee"), label: "Tournée suggérée" }, { href: q("segments"), label: "Segments médecins" }, { href: q("impact"), label: "Impact des visites" }]} />

      <div className="mt-4">
        {tab === "tournee" && (
          !delegateId ? <Empty title="Aucune déléguée" hint="Créez une fiche déléguée dans Médical → Délégués médicaux." /> : !tour?.length ? <Empty title="Aucun médecin dans les secteurs de cette déléguée" /> : (
            <Card pad={false} title={`Médecins à voir en priorité cette semaine (${tour.length})`}>
              <p className="px-4 pb-2 text-[12.5px] text-muted">Priorité = poids du potentiel × retard sur la fréquence de visite × opportunité produit (produits recommandés). Poids réglables dans Paramétrage médical.</p>
              <div className="overflow-x-auto">
                <table className="tbl text-[12.5px]">
                  <thead><tr><th>#</th><th>Médecin</th><th>Potentiel</th><th>Dernière visite</th><th>Priorité</th><th>Pourquoi</th></tr></thead>
                  <tbody>
                    {tour.map((t, i) => (
                      <tr key={t.doctorId}>
                        <td>{i + 1}</td>
                        <td><Link className="hover:underline" href={`/medical/medecins/${t.doctorId}`}>Dr {t.name}</Link><div className="text-[11px] text-muted">{[t.specialty, cityTitle(t.city)].filter(Boolean).join(" · ")}</div></td>
                        <td>{t.potential ? <Badge tone={t.potential === "A" ? "green" : t.potential === "B" ? "blue" : "gray"}>{t.potential}</Badge> : "—"}</td>
                        <td>{t.lastVisitAt ? fmtDate(t.lastVisitAt) : "jamais"}</td>
                        <td className="tabular-nums font-semibold">{t.score.toLocaleString("fr-FR")}</td>
                        <td className="text-muted">{t.reasons.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        )}

        {tab === "segments" && (
          !segments?.length ? <Empty title="Pas encore de segment" hint="Les segments s'appuient sur les ordonnances importées (Médical → Ordonnances) et les visites réalisées." /> : (
            <div className="grid lg:grid-cols-2 gap-3">
              {segments.map((g) => (
                <Card key={g.segment} title={`${g.label} (${g.count})`}>
                  <ul className="text-[13px] space-y-1">
                    {g.doctors.map((d) => (
                      <li key={d.id} className="flex justify-between gap-2">
                        <Link className="hover:underline truncate" href={`/medical/medecins/${d.id}`}>Dr {d.name}</Link>
                        <span className="text-muted shrink-0 tabular-nums">{d.lines} ord. ({d.recent} vs {d.previous}) · {d.visits} visite(s)</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )
        )}

        {tab === "impact" && impact && (
          impact.pairs === 0 ? <Empty title="Aucune visite avec produit présenté" hint="L'impact se mesure à partir des produits cochés dans les comptes rendus et des ordonnances importées." /> : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-yellow-soft border border-yellow/40 px-4 py-3 text-[13px] text-ink-2">
                <b>Corrélation observée, pas une preuve.</b> Ordonnances du médecin pour chaque produit présenté, {impact.windowDays} jours avant vs {impact.windowDays} jours après la visite. Une visite dont la fenêtre « après » n&apos;est pas écoulée est « pas encore comparable » et n&apos;entre pas dans les totaux.
              </div>
              <ImpactTable title="Par produit présenté" rows={impact.byProduct} />
              <div className="grid lg:grid-cols-2 gap-4">
                <ImpactTable title="Par marque" rows={impact.byBrand} />
                {!own && <ImpactTable title="Par déléguée" rows={impact.byDelegate} />}
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}

function ImpactTable({ title, rows }: { title: string; rows: ImpactAgg[] }) {
  return (
    <Card pad={false} title={title}>
      <div className="overflow-x-auto">
        <table className="tbl text-[12.5px]">
          <thead><tr><th>{title.replace("Par ", "").replace(/^./, (c) => c.toUpperCase())}</th><th>Présentations mesurées</th><th>Ordonnances avant</th><th>Ordonnances après</th><th>Écart</th><th>Pas encore comparables</th></tr></thead>
          <tbody>
            {rows.slice(0, 30).map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="tabular-nums">{r.measured}</td>
                <td className="tabular-nums">{r.measured ? r.before : "—"}</td>
                <td className="tabular-nums">{r.measured ? r.after : "—"}</td>
                <td className="tabular-nums">{r.measured ? (r.after - r.before > 0 ? `+${r.after - r.before}` : r.after - r.before) : "pas encore comparable"}</td>
                <td className="tabular-nums text-muted">{r.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
