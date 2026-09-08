import Link from "next/link";
import { requireActivationAccess, activationScope, canDoActivation, canValidateActivation } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { listActivations, knownCities } from "@/lib/activations/queries";
import { LATENESS_LABELS, safeTone, toneClass } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Empty, Kpi, Tabs } from "@/components/ui";
import { ActivationTypeIcon } from "@/components/activation-type-icon";
import { ActivationBoard, type BoardView } from "@/components/activation-board";
import { moveActivation, changeActivationStatus } from "./actions";
import { fmtMAD, fmtDateShort, iso, today, startOfMonth, addMonths, fmtMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activations" };

type SP = { vue?: string; brand?: string; type?: string; status?: string; city?: string; responsible?: string; q?: string; periode?: string; m?: string };

export default async function ActivationsPage(props: { searchParams: Promise<SP> }) {
  await requireActivationAccess();
  const sp = await props.searchParams;
  const [refs, settings, scope, brands, users, cities, canCreate, canEdit, isValidator] = await Promise.all([
    activationRefs(), getSettings(), activationScope(), listBrands(), listUsers(), knownCities(), canDoActivation("create"), canDoActivation("edit"), canValidateActivation(null),
  ]);
  const todayIso = iso(today());
  const vue: "liste" | BoardView = sp.vue === "kanban" || sp.vue === "calendrier" || sp.vue === "marques" ? sp.vue : "liste";
  // Période : « mois » (par défaut, mois courant ou `m=YYYY-MM`), « avenir », « tout ». Calendrier et vue par marque sont toujours au mois.
  const periode = vue === "calendrier" || vue === "marques" ? "mois" : sp.periode === "avenir" || sp.periode === "tout" ? sp.periode : "mois";
  const monthAnchor = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? new Date(sp.m + "-01T12:00:00Z") : startOfMonth(today());
  const range = periode === "mois" ? { start: iso(monthAnchor), end: iso(addMonths(monthAnchor, 1)) } : periode === "avenir" ? { start: todayIso, end: null } : { start: null, end: null };
  const includeClosed = !!sp.status && refs.statuses.some((s) => s.key === sp.status && (s.isArchived || s.isCancelled));

  const rows = await listActivations({ ...range, brand: sp.brand, type: sp.type, status: sp.status, city: sp.city, responsible: sp.responsible, q: sp.q, includeClosed }, scope, refs, settings.activations, todayIso);
  const st = new Map(refs.statuses.map((s) => [s.key, s]));
  const tp = new Map(refs.types.map((t) => [t.key, t]));
  const totals = rows.reduce((a, r) => ({ planned: a.planned + r.planned, committed: a.committed + r.committed + r.materials, spent: a.spent + r.fullCost }), { planned: 0, committed: 0, spent: 0 });
  const late = rows.filter((r) => r.late.length).length;
  const awaiting = rows.filter((r) => st.get(r.status)?.awaitingValidation).length;
  const visibleBrands = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)));

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/marketing/activations?${s}` : "/marketing/activations";
  };
  const prevM = iso(addMonths(monthAnchor, -1)).slice(0, 7), nextM = iso(addMonths(monthAnchor, 1)).slice(0, 7);
  const tabHref = (v: string) => qs({ vue: v === "liste" ? undefined : v, m: sp.m, periode: v === "calendrier" || v === "marques" ? undefined : sp.periode });
  const monthHrefBase = `${qs({ m: undefined })}${qs({ m: undefined }).includes("?") ? "&" : "?"}m=`;

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Activations" subtitle="Événements, PLV, sampling, salons, opérations pharmacie : ce qui est prévu, ce que ça coûte, ce qui est en retard, ce qui a marché."
        actions={<>
          <Link href="/marketing/activations/bord" className="btn-ghost btn-sm">Tableau de bord</Link>
          {awaiting > 0 && isValidator && <Link href="/marketing/activations/validation" className="btn-secondary btn-sm">À valider · {awaiting}</Link>}
          {canCreate && <Link href="/marketing/activations/nouvelle?rapide=1" className="btn-secondary btn-sm sm:hidden">Créer depuis la pharmacie</Link>}
          {canCreate && <Link href="/marketing/activations/nouvelle" className="btn-primary btn-sm">Nouvelle activation</Link>}
        </>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={periode === "mois" ? `Activations · ${fmtMonth(monthAnchor)}` : "Activations"} value={String(rows.length)} sub={`${rows.filter((r) => st.get(r.status)?.isValidated).length} validées`} />
        <Kpi label="Budget prévu" value={fmtMAD(totals.planned, { compact: true })} sub={`${fmtMAD(totals.committed, { compact: true })} engagé`} />
        <Kpi label="Coût complet" value={fmtMAD(totals.spent, { compact: true })} sub="dépensé + matériel" />
        <Kpi label="En retard" value={String(late)} tone={late ? "red" : "green"} sub={awaiting ? `${awaiting} à valider` : "statut, checklist, résultats, budget"} />
      </div>

      <form className="card card-pad mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 text-[13px]" method="get">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Nom, lieu, ville…" className="input h-9 col-span-2 lg:col-span-1" />
        <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9"><option value="">Toutes marques</option>{visibleBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="select h-9"><option value="">Tous types</option>{refs.types.filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="select h-9"><option value="">Statuts ouverts</option>{refs.statuses.filter((s) => s.active).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        <select name="city" defaultValue={sp.city ?? ""} className="select h-9"><option value="">Toutes villes</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select name="responsible" defaultValue={sp.responsible ?? ""} className="select h-9"><option value="">Tous responsables</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <div className="flex gap-1">
          <select name="periode" defaultValue={periode} className="select h-9"><option value="mois">Mois</option><option value="avenir">À venir</option><option value="tout">Tout</option></select>
          <button className="btn-primary btn-sm h-9" type="submit">OK</button>
        </div>
        {periode === "mois" && <input type="hidden" name="m" value={iso(monthAnchor).slice(0, 7)} />}
      </form>

      <div className="mb-3"><Tabs current={tabHref(vue)} tabs={[{ href: tabHref("liste"), label: "Liste", count: rows.length }, { href: tabHref("kanban"), label: "Kanban" }, { href: tabHref("calendrier"), label: "Calendrier" }, { href: tabHref("marques"), label: "Par marque" }]} /></div>

      {vue !== "liste" && (
        <ActivationBoard key={`${vue}-${iso(monthAnchor)}-${rows.length}`} view={vue} cards={rows} refs={refs} brands={visibleBrands.map((b) => ({ id: b.id, name: b.name, color: b.color }))}
          monthStart={iso(monthAnchor)} monthEnd={iso(addMonths(monthAnchor, 1))} todayIso={todayIso} canEdit={canEdit} monthHrefBase={monthHrefBase}
          actions={{ move: moveActivation, status: changeActivationStatus }} />
      )}

      {vue === "liste" && periode === "mois" && (
        <div className="flex items-center gap-2 mb-3 text-[13px]">
          <Link href={qs({ m: prevM })} className="btn-ghost btn-sm">‹</Link>
          <span className="font-medium capitalize">{fmtMonth(monthAnchor)}</span>
          <Link href={qs({ m: nextM })} className="btn-ghost btn-sm">›</Link>
          <Link href={qs({ m: undefined })} className="text-muted hover:underline ml-1">Aujourd&apos;hui</Link>
        </div>
      )}

      {vue !== "liste" ? null : rows.length === 0 ? (
        <Empty title="Aucune activation sur cette période" hint={<>Proposez une activation depuis « Nouvelle activation » (un modèle la pré-remplit en moins d&apos;une minute), ou élargissez la période avec « Tout ».</>}
          action={canCreate ? <Link href="/marketing/activations/nouvelle" className="btn-primary btn-sm">Nouvelle activation</Link> : undefined} />
      ) : (
        <>
          {/* Mobile : cartes */}
          <div className="sm:hidden space-y-2">
            {rows.map((r) => {
              const s = st.get(r.status); const t = tp.get(r.type);
              return (
                <Link key={r.id} href={`/marketing/activations/${r.id}`} className="card card-pad block">
                  <div className="flex items-center gap-2"><ActivationTypeIcon icon={t?.icon} size={14} className="text-muted shrink-0" /><span className="font-medium truncate">{r.name}</span><span className={`badge ml-auto shrink-0 ${toneClass(s?.tone)}`}>{s?.label ?? r.status}</span></div>
                  <div className="text-[12px] text-muted mt-1 flex flex-wrap gap-x-2">{r.brand && <span className="inline-flex items-center gap-1"><BrandDot color={r.color ?? "#999"} />{r.brand}{r.brandCount > 1 ? ` +${r.brandCount - 1}` : ""}</span>}<span>{fmtDateShort(r.date)}{r.endDate && r.endDate !== r.date ? ` → ${fmtDateShort(r.endDate)}` : ""}</span>{r.city && <span>{r.city}</span>}</div>
                  <div className="text-[12px] mt-1 flex flex-wrap gap-1">{r.planned > 0 && <span>{fmtMAD(r.fullCost, { compact: true })} / {fmtMAD(r.planned, { compact: true })}</span>}{r.late.map((l) => <Badge key={l} tone="red">{LATENESS_LABELS[l]}</Badge>)}</div>
                </Link>
              );
            })}
          </div>
          {/* Bureau : table */}
          <Card pad={false} className="hidden sm:block">
            <div className="table-wrap">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-muted"><th className="px-3 py-2">Activation</th><th className="px-3 py-2">Marque</th><th className="px-3 py-2">Dates</th><th className="px-3 py-2">Ville</th><th className="px-3 py-2">Pilote</th><th className="px-3 py-2 text-right">Prévu</th><th className="px-3 py-2 text-right">Engagé</th><th className="px-3 py-2 text-right">Coût complet</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Alertes</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const s = st.get(r.status); const t = tp.get(r.type);
                    return (
                      <tr key={r.id} className="border-t border-line hover:bg-surface-2/60">
                        <td className="px-3 py-2"><Link href={`/marketing/activations/${r.id}`} className="font-medium hover:underline inline-flex items-center gap-2"><ActivationTypeIcon icon={t?.icon} size={14} className="text-muted" />{r.name}</Link><div className="text-[11.5px] text-muted">{t?.label ?? r.type}{r.checklistTotal ? ` · checklist ${r.checklistDone}/${r.checklistTotal}` : ""}</div></td>
                        <td className="px-3 py-2">{r.brand ? <span className="inline-flex items-center gap-1.5"><BrandDot color={r.color ?? "#999"} />{r.brand}{r.brandCount > 1 ? <span className="text-muted">+{r.brandCount - 1}</span> : null}</span> : "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtDateShort(r.date)}{r.endDate && r.endDate !== r.date ? ` → ${fmtDateShort(r.endDate)}` : ""}</td>
                        <td className="px-3 py-2">{r.city ?? "—"}{r.client ? <div className="text-[11.5px] text-muted truncate max-w-[160px]">{r.client}{r.clientCount > 1 ? ` +${r.clientCount - 1}` : ""}</div> : null}</td>
                        <td className="px-3 py-2">{r.responsible ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.planned ? fmtMAD(r.planned, { suffix: false }) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.committed + r.materials ? fmtMAD(r.committed + r.materials, { suffix: false }) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.fullCost ? fmtMAD(r.fullCost, { suffix: false }) : "—"}</td>
                        <td className="px-3 py-2"><Badge tone={safeTone(s?.tone)}>{s?.label ?? r.status}</Badge></td>
                        <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{r.late.map((l) => <Badge key={l} tone="red">{LATENESS_LABELS[l]}</Badge>)}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
