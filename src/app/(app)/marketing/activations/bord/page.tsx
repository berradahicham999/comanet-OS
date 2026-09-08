import Link from "next/link";
import { requireActivationAccess, activationScope } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { listActivations } from "@/lib/activations/queries";
import { compareActivations } from "@/lib/activations/roi";
import { LATENESS_LABELS, safeTone, toneClass } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Kpi, Progress, Empty } from "@/components/ui";
import { ActivationTypeIcon } from "@/components/activation-type-icon";
import { fmtMAD, fmtDateShort, fmtMonth, iso, today, startOfMonth, addMonths } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tableau de bord Activations" };

/**
 * Le module en une minute : ce qui est prévu ce mois, ce que ça coûte par marque, ce qui est
 * en retard, ce qui a marché (comparatif de l'année), la répartition par type.
 */
export default async function ActivationsBoardPage(props: { searchParams: Promise<{ m?: string }> }) {
  await requireActivationAccess();
  const sp = await props.searchParams;
  const [refs, settings, scope, brands] = await Promise.all([activationRefs(), getSettings(), activationScope(), listBrands()]);
  const todayIso = iso(today());
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? new Date(sp.m + "-01T12:00:00Z") : startOfMonth(today());
  const year = month.getUTCFullYear();
  const [ofMonth, open, top] = await Promise.all([
    listActivations({ start: iso(month), end: iso(addMonths(month, 1)) }, scope, refs, settings.activations, todayIso),
    listActivations({}, scope, refs, settings.activations, todayIso),
    compareActivations("type", { start: `${year}-01-01`, end: `${year + 1}-01-01` }, scope, settings.activations, todayIso),
  ]);
  const st = new Map(refs.statuses.map((s) => [s.key, s]));
  const late = open.filter((a) => a.late.length);
  const awaiting = open.filter((a) => st.get(a.status)?.awaitingValidation);
  const running = open.filter((a) => st.get(a.status)?.isRunning);
  const monthPlanned = ofMonth.reduce((s, a) => s + a.planned, 0);
  const monthEngaged = ofMonth.reduce((s, a) => s + a.committed + a.materials, 0);
  const monthCost = ofMonth.reduce((s, a) => s + a.fullCost, 0);

  // Budget par marque sur l'année : prévu / engagé / coût complet, sur toutes les activations validées.
  const yearRows = await listActivations({ start: `${year}-01-01`, end: `${year + 1}-01-01`, includeClosed: true }, scope, refs, settings.activations, todayIso);
  const byBrand = new Map<string, { brandId: string | null; brand: string; color: string | null; n: number; planned: number; engaged: number; cost: number }>();
  for (const a of yearRows) {
    if (st.get(a.status)?.isCancelled) continue;
    const k = a.brandId ?? "—";
    const e = byBrand.get(k) ?? { brandId: a.brandId, brand: a.brand ?? "Sans marque", color: a.color, n: 0, planned: 0, engaged: 0, cost: 0 };
    e.n++; e.planned += a.planned; e.engaged += a.committed + a.materials; e.cost += a.fullCost; byBrand.set(k, e);
  }
  const brandRows = [...byBrand.values()].sort((x, y) => y.planned - x.planned);
  const silent = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)) && !ofMonth.some((a) => a.brandId === b.id));
  const byType = new Map<string, { n: number; cost: number }>();
  for (const a of yearRows) { if (st.get(a.status)?.isCancelled) continue; const e = byType.get(a.type) ?? { n: 0, cost: 0 }; e.n++; e.cost += a.fullCost; byType.set(a.type, e); }
  const typeRows = [...byType.entries()].map(([key, v]) => ({ key, label: refs.types.find((t) => t.key === key)?.label ?? key, icon: refs.types.find((t) => t.key === key)?.icon ?? null, ...v })).sort((x, y) => y.n - x.n);
  const maxType = Math.max(1, ...typeRows.map((t) => t.n));
  const prevM = iso(addMonths(month, -1)).slice(0, 7), nextM = iso(addMonths(month, 1)).slice(0, 7);

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/activations" className="hover:underline">Activations</Link>} title="Tableau de bord" subtitle="Ce qui est prévu, ce que ça coûte, ce qui est en retard, ce qui a marché."
        actions={<><Link href={`/marketing/activations/bord?m=${prevM}`} className="btn-ghost btn-sm">‹</Link><span className="text-[13px] font-medium capitalize">{fmtMonth(month)}</span><Link href={`/marketing/activations/bord?m=${nextM}`} className="btn-ghost btn-sm">›</Link><Link href="/marketing/activations/comparatif" className="btn-secondary btn-sm">Comparatif</Link></>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={`Activations · ${fmtMonth(month)}`} value={String(ofMonth.length)} sub={`${running.length} en cours · ${awaiting.length} à valider`} href={`/marketing/activations?m=${iso(month).slice(0, 7)}`} />
        <Kpi label="Prévu ce mois" value={fmtMAD(monthPlanned, { compact: true })} sub={`${fmtMAD(monthEngaged, { compact: true })} engagé`} />
        <Kpi label="Coût complet ce mois" value={fmtMAD(monthCost, { compact: true })} sub="dépensé + matériel" />
        <Kpi label="En retard" value={String(late.length)} tone={late.length ? "red" : "green"} sub="toutes activations ouvertes" href="/actions?cat=MARKETING" />
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card title={`Budget par marque · ${year}`}>
          {brandRows.length === 0 ? <p className="text-[13px] text-muted">Aucune activation cette année.</p> : (
            <div className="space-y-2">
              {brandRows.map((b) => (
                <div key={b.brand} className="text-[12.5px]">
                  <div className="flex items-center gap-2"><BrandDot color={b.color ?? "#999"} /><Link href={`/marketing/activations?brand=${b.brandId ?? ""}&periode=tout`} className="font-medium hover:underline">{b.brand}</Link><span className="text-muted">{b.n} activation{b.n > 1 ? "s" : ""}</span><span className="ml-auto tabular-nums">{fmtMAD(b.engaged, { compact: true })} / {fmtMAD(b.planned, { compact: true })}</span></div>
                  <Progress value={b.planned > 0 ? (b.engaged / b.planned) * 100 : 0} tone={b.planned > 0 && b.engaged > b.planned ? "red" : "accent"} className="mt-1" />
                  <div className="text-[11px] text-muted mt-0.5">Coût complet {fmtMAD(b.cost, { compact: true })}</div>
                </div>
              ))}
            </div>
          )}
          {silent.length > 0 && <p className="mt-3 text-[12px] text-muted">Sans activation ce mois-ci : {silent.map((b) => b.name).join(", ")}.</p>}
        </Card>

        <Card title={`En retard (${late.length})`}>
          {late.length === 0 ? <p className="text-[13px] text-muted">Rien en retard : statuts à jour, checklists faites, résultats saisis, budgets tenus.</p> : (
            <ul className="space-y-1.5 text-[12.5px]">
              {late.slice(0, 12).map((a) => (
                <li key={a.id} className="flex items-center gap-2 flex-wrap">
                  <Link href={`/marketing/activations/${a.id}`} className="font-medium hover:underline truncate">{a.name}</Link>
                  <span className="text-muted">{fmtDateShort(a.date)}</span>
                  {a.late.map((l) => <Badge key={l} tone="red">{LATENESS_LABELS[l]}</Badge>)}
                  <span className={`badge ml-auto ${toneClass(st.get(a.status)?.tone)}`}>{st.get(a.status)?.label ?? a.status}</span>
                </li>
              ))}
              {late.length > 12 && <li className="text-muted">… et {late.length - 12} autres, voir l&apos;<Link href="/actions?cat=MARKETING" className="text-accent">Action Center</Link>.</li>}
            </ul>
          )}
        </Card>

        <Card title={`Ce qui a marché · ${year}`} action={<Link href="/marketing/activations/comparatif" className="text-[12px] text-accent hover:underline">Comparatif complet</Link>}>
          {top.length === 0 ? <Empty title="Pas encore d'activation terminée" hint="Le retour se mesure sur les activations terminées avec des points de vente rattachés." /> : (
            <ul className="space-y-1.5 text-[12.5px]">
              {top.slice(0, 6).map((r) => (
                <li key={r.key} className="flex items-center gap-2"><span className="font-medium">{r.label}</span><span className="text-muted">{r.count} · {fmtMAD(r.fullCost, { compact: true })}</span><span className="ml-auto tabular-nums">{r.roi != null ? <Badge tone={safeTone(r.roi >= settings.activations.roiRepeatMin ? "green" : r.roi > 0 ? "orange" : "red")}>× {r.roi.toFixed(2)}</Badge> : <span className="text-muted">pas encore comparable</span>}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Répartition par type · ${year}`}>
          {typeRows.length === 0 ? <p className="text-[13px] text-muted">—</p> : (
            <ul className="space-y-1.5 text-[12.5px]">
              {typeRows.map((t) => (
                <li key={t.key}>
                  <div className="flex items-center gap-2"><ActivationTypeIcon icon={t.icon} size={13} className="text-muted" /><Link href={`/marketing/activations?type=${t.key}&periode=tout`} className="hover:underline">{t.label}</Link><span className="ml-auto tabular-nums">{t.n} · {fmtMAD(t.cost, { compact: true })}</span></div>
                  <Progress value={(t.n / maxType) * 100} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Activations de ${fmtMonth(month)}`} className="mt-4" pad={false}>
        {ofMonth.length === 0 ? <p className="p-4 text-[13px] text-muted">Aucune activation ce mois-ci.</p> : (
          <div className="table-wrap"><table className="w-full text-[13px]">
            <thead><tr className="text-left text-muted"><th className="px-3 py-2">Activation</th><th className="px-3 py-2">Marque</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Ville</th><th className="px-3 py-2 text-right">Prévu</th><th className="px-3 py-2 text-right">Coût complet</th><th className="px-3 py-2">Statut</th></tr></thead>
            <tbody>{ofMonth.map((a) => (
              <tr key={a.id} className="border-t border-line"><td className="px-3 py-1.5"><Link href={`/marketing/activations/${a.id}`} className="font-medium hover:underline">{a.name}</Link></td><td className="px-3 py-1.5">{a.brand ? <span className="inline-flex items-center gap-1.5"><BrandDot color={a.color ?? "#999"} />{a.brand}</span> : "—"}</td><td className="px-3 py-1.5 whitespace-nowrap">{fmtDateShort(a.date)}{a.endDate && a.endDate !== a.date ? ` → ${fmtDateShort(a.endDate)}` : ""}</td><td className="px-3 py-1.5">{a.city ?? "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{a.planned ? fmtMAD(a.planned, { suffix: false }) : "—"}</td><td className="px-3 py-1.5 text-right tabular-nums">{a.fullCost ? fmtMAD(a.fullCost, { suffix: false }) : "—"}</td><td className="px-3 py-1.5"><Badge tone={safeTone(st.get(a.status)?.tone)}>{st.get(a.status)?.label ?? a.status}</Badge></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
