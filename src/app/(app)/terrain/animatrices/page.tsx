import Link from "next/link";
import { requireAccess, canDo } from "@/lib/access";
import { getRefDate } from "@/lib/ref-date";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { animatriceScores, animationMonthly, type ActionPlanItem } from "@/lib/animations";
import { PageHeader, Card, Badge, Delta, Progress, Empty } from "@/components/ui";
import { fmtMAD, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan d'action animatrices" };

const SEV: Record<ActionPlanItem["severity"], { tone: "red" | "orange" | "blue" | "green"; label: string }> = {
  critique: { tone: "red", label: "Critique" },
  important: { tone: "orange", label: "Important" },
  opportunité: { tone: "blue", label: "Opportunité" },
  bravo: { tone: "green", label: "À valoriser" },
};

export default async function AnimatricesPage(props: { searchParams: Promise<{ period?: PeriodParam; start?: string; end?: string; focus?: string }> }) {
  await requireAccess("terrain");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  const period = resolvePeriod(sp.period, ref, { start: sp.start, end: sp.end });
  const year = Number(period.start.slice(0, 4));
  const scores = await animatriceScores(period, period.prev, year);
  const active = scores.filter((s) => s.days > 0 || s.animations > 0);
  const focus = sp.focus ? scores.find((s) => s.id === sp.focus) ?? null : null;
  const trend = focus ? await animationMonthly(period.end, 13, { animatriceId: focus.id }) : [];

  const teamRevPerDay = active.length ? active.reduce((s, a) => s + a.revenuePerDay, 0) / active.length : 0;
  const teamUnits = active.reduce((s, a) => s + a.units, 0);
  const teamObjective = active.reduce((s, a) => s + a.objectiveUnits, 0);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { period: sp.period, start: sp.start, end: sp.end, focus: sp.focus, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/terrain/animatrices${s ? `?${s}` : ""}`;
  };

  if (!(await canDo("terrain", "validate"))) return null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/terrain" className="hover:underline">Animations</Link>}
        title="Plan d'action animatrices"
        subtitle={`${period.label} · score = CA/jour 40 % · panier moyen 20 % · atteinte de l'objectif 25 % · progression 15 %. L'objectif de chacune est celui de sa ville, au prorata de ses jours d'animation.`}
        actions={<form action="/terrain/animatrices" method="get" className="flex gap-2">
          <select name="period" defaultValue={sp.period ?? "month"} className="select h-9 w-auto">{PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          <button className="btn-secondary btn-sm h-9" type="submit">Appliquer</button>
        </form>}
      >
        {active.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card><div className="label">Équipe</div><div className="kpi mt-1.5">{active.length}</div><div className="text-[12px] text-muted mt-1">animatrices actives</div></Card>
            <Card><div className="label">CA moyen / jour</div><div className="kpi mt-1.5">{fmtMAD(teamRevPerDay, { compact: true })}</div><div className="text-[12px] text-muted mt-1">référence de comparaison</div></Card>
            <Card><div className="label">Atteinte collective</div><div className={`kpi mt-1.5 ${teamObjective && teamUnits / teamObjective >= 1 ? "text-green" : "text-orange"}`}>{teamObjective ? `${Math.round((teamUnits / teamObjective) * 100)} %` : "—"}</div><div className="text-[12px] text-muted mt-1">{fmtNum(teamUnits)} / {fmtNum(teamObjective)} u.</div></Card>
            <Card><div className="label">Actions à traiter</div><div className="kpi mt-1.5 text-orange">{scores.reduce((s, a) => s + a.plan.filter((p) => p.severity === "critique" || p.severity === "important").length, 0)}</div><div className="text-[12px] text-muted mt-1">points critiques ou importants</div></Card>
          </div>
        )}
      </PageHeader>

      {active.length === 0 ? (
        <Empty title="Aucune animation sur la période" hint={<>Changez de période, ou chargez le fichier quotidien depuis <Link href="/imports?type=ANIMATIONS" className="text-accent font-medium">Imports → Animations POS</Link>.</>} />
      ) : (
        <div className="space-y-4">
          {focus && (
            <Card title={`Tendance — ${focus.name}`} action={<Link href={qs({ focus: undefined })} className="text-[12px] text-muted hover:underline">Fermer</Link>}>
              <div className="grid sm:grid-cols-3 gap-3 text-[13px]">
                <div><div className="label">CA 13 mois</div><div className="mt-1 space-y-0.5">{trend.slice(-6).map((m) => (
                  <div key={m.month} className="flex items-center gap-2"><span className="text-muted w-16">{m.month}</span><Progress value={Math.min(100, (m.revenue / Math.max(1, ...trend.map((t) => t.revenue))) * 100)} className="flex-1" /><span className="tabular-nums w-20 text-right">{fmtMAD(m.revenue, { compact: true })}</span></div>
                ))}</div></div>
                <div>
                  <div className="label">Marques travaillées</div>
                  <div className="mt-1 text-[13px]">{focus.brandsCovered} marque(s) · top : <b>{focus.topBrand ?? "—"}</b></div>
                  {focus.missingBrands.length > 0 && <div className="text-[12px] text-orange mt-1">Jamais vendues : {focus.missingBrands.join(", ")}</div>}
                </div>
                <div>
                  <div className="label">Repères</div>
                  <div className="mt-1 text-[13px]">Top produit : <b>{focus.topProduct ?? "—"}</b></div>
                  <div className="text-[13px]">Top POS : <b>{focus.topPos ?? "—"}</b></div>
                  <div className="text-[13px]">{focus.pos} point(s) de vente animés</div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid xl:grid-cols-2 gap-4">
            {active.map((a) => (
              <Card key={a.id}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`h-10 w-10 shrink-0 rounded-full font-semibold flex items-center justify-center ${a.rank === 1 ? "bg-green-soft text-green" : a.score >= 50 ? "bg-accent-soft text-accent-2" : "bg-orange-soft text-orange"}`}>{a.rank}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex items-center gap-2">{a.name}{a.city && <span className="text-[12px] font-normal text-muted">{a.city}</span>}</div>
                    <div className="text-[12px] text-muted">{fmtNum(a.days)} jours · {a.animations} animations · {a.pos} POS</div>
                  </div>
                  <div className="text-right">
                    <div className="kpi">{a.score}</div>
                    <div className="text-[10px] text-muted uppercase tracking-wider">score</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-[13px]">
                  <div><div className="label">CA TTC</div><div className="font-medium mt-0.5">{fmtMAD(a.revenue, { compact: true })}</div></div>
                  <div><div className="label">CA / jour</div><div className="font-medium mt-0.5">{fmtMAD(a.revenuePerDay, { compact: true })}</div><Delta value={a.progression} size="xs" /></div>
                  <div><div className="label">Panier</div><div className="font-medium mt-0.5">{fmtMAD(a.basket)}</div></div>
                  <div><div className="label">Unités</div><div className="font-medium mt-0.5">{fmtNum(a.units)}</div><div className="text-[11px] text-muted">{fmtNum(a.unitsPerDay, 1)}/j</div></div>
                </div>

                {a.objectiveUnits > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-muted">Objectif de la période (prorata {a.city ?? "ville"})</span>
                      <span className={`font-medium ${(a.completion ?? 0) >= 100 ? "text-green" : (a.completion ?? 0) >= 70 ? "text-orange" : "text-red"}`}>{fmtNum(a.units)} / {fmtNum(a.objectiveUnits)} u. · {Math.round(a.completion ?? 0)} %</span>
                    </div>
                    <Progress value={Math.min(100, a.completion ?? 0)} tone={(a.completion ?? 0) >= 100 ? "green" : (a.completion ?? 0) >= 70 ? "yellow" : "red"} />
                  </div>
                )}

                <div className="space-y-2">
                  {a.plan.length === 0 && <div className="text-[13px] text-muted">Rien à signaler sur la période.</div>}
                  {a.plan.map((p, i) => (
                    <div key={i} className="rounded-xl border border-line px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={SEV[p.severity].tone}>{SEV[p.severity].label}</Badge>
                        <span className="text-[13px] font-medium">{p.title}</span>
                      </div>
                      <div className="text-[12px] text-muted mt-1">{p.detail}</div>
                      <div className="text-[12.5px] mt-1">→ <b>{p.action}</b></div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-3">
                  <Link href={`/terrain/rapports?animatrice=${a.id}${sp.period ? `&period=${sp.period}` : ""}`} className="btn-secondary btn-sm">Ses rapports</Link>
                  <Link href={qs({ focus: a.id })} className="btn-ghost btn-sm">Tendance & marques</Link>
                  <Link href={`/taches/nouvelle?title=${encodeURIComponent(`Point performance — ${a.name}`)}`} className="btn-ghost btn-sm">Créer une tâche</Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
