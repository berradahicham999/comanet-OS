import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { animationTotals, animationsByDim, animationDaily, animationObjectives, objectiveForRange, bestOf, type DimRow } from "@/lib/animations";
import { adoptionByWeek, adoptionByAnimatrice } from "@/lib/terrain/usual-products";
import { PageHeader, Card, Tabs, Delta, Progress, Empty, BrandDot } from "@/components/ui";
import { SimpleLine } from "@/components/charts";
import { fmtMAD, fmtNum, fmtDateShort, delta, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Animations" };

const DIMS = [
  { key: "animatrice", label: "Animatrices" },
  { key: "city", label: "Villes" },
  { key: "pos", label: "Points de vente" },
  { key: "brand", label: "Marques" },
  { key: "product", label: "Produits" },
] as const;

export default async function TerrainPage(props: {
  searchParams: Promise<{ period?: PeriodParam; start?: string; end?: string; dim?: string; animatrice?: string; city?: string }>;
}) {
  const user = await requireAccess("terrain");
  const isAnimatrice = await isOwnOnly();
  const sp = await props.searchParams;
  // Les animations sont saisies au jour le jour : la période se cale sur aujourd'hui, pas sur la
  // dernière vente Sage importée (getRefDate), sinon tout ce qui a été saisi depuis disparaît.
  const ref = today();
  const period = resolvePeriod(sp.period, ref, { start: sp.start, end: sp.end });
  const dim = (DIMS.find((d) => d.key === sp.dim)?.key ?? "animatrice") as (typeof DIMS)[number]["key"];
  const mine = isAnimatrice ? user.id : sp.animatrice || undefined;
  const filter = { animatriceId: mine, city: sp.city || undefined };
  const year = Number(period.start.slice(0, 4));

  const [totals, prevTotals, rows, daily, objectives, cityRows, best, hasData, weeklyAdoption, teamAdoption] = await Promise.all([
    animationTotals(period, filter),
    animationTotals(period.prev, filter),
    animationsByDim(dim, period, period.prev, filter),
    animationDaily(period, filter),
    animationObjectives(year),
    animationsByDim("city", period, period.prev, filter),
    bestOf(period),
    db.execute(sql`select count(*)::int as n from animations where status = 'DONE'`),
    // Bascule WhatsApp → application : coût nul si l'écran n'est pas admin/trade.
    isAnimatrice ? Promise.resolve([]) : adoptionByWeek({ weeks: 6 }),
    isAnimatrice ? Promise.resolve([]) : adoptionByAnimatrice(28),
  ]);

  const total = (hasData.rows[0] as { n: number }).n;
  const coveredCities = cityRows.map((c) => c.name).filter((c) => c && c !== "—");
  const objectiveUnits = objectiveForRange(objectives, period, { cities: coveredCities.length ? coveredCities : undefined });
  const completion = objectiveUnits > 0 ? (totals.units / objectiveUnits) * 100 : null;
  const basket = totals.units ? totals.revenue / totals.units : 0;
  const revPerDay = totals.days ? totals.revenue / totals.days : 0;
  const prevRevPerDay = prevTotals.days ? prevTotals.revenue / prevTotals.days : 0;

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { period: sp.period, start: sp.start, end: sp.end, dim: sp.dim, animatrice: sp.animatrice, city: sp.city, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/terrain${s ? `?${s}` : ""}`;
  };

  const b = best as Record<string, { name?: string; date?: string; units?: number; revenue?: number; days?: number; city?: string } | null>;
  const podium = [
    { label: "Meilleur produit", value: b.product?.name, sub: b.product ? `${fmtNum(b.product.units)} u. · ${fmtMAD(b.product.revenue, { compact: true })}` : null },
    { label: "Meilleure animatrice", value: b.animatrice?.name, sub: b.animatrice ? `${fmtMAD(b.animatrice.revenue, { compact: true })} · ${fmtNum(b.animatrice.days)} j` : null },
    { label: "Meilleur point de vente", value: b.pos?.name, sub: b.pos ? `${fmtMAD(b.pos.revenue, { compact: true })} · ${b.pos.city ?? ""}` : null },
    { label: "Meilleure ville", value: b.city?.name, sub: b.city ? fmtMAD(b.city.revenue, { compact: true }) : null },
    { label: "Meilleure marque", value: b.brand?.name, sub: b.brand ? `${fmtNum(b.brand.units)} u. · ${fmtMAD(b.brand.revenue, { compact: true })}` : null },
    { label: "Meilleure journée", value: b.day?.date ? fmtDateShort(b.day.date) : undefined, sub: b.day ? fmtMAD(b.day.revenue, { compact: true }) : null },
  ];

  if (total === 0) {
    return (
      <>
        <PageHeader eyebrow="Terrain" title="Animations — sell-out" subtitle="Ventes réalisées en point de vente, par jour, ville, animatrice et produit." />
        <Empty
          title="Aucune animation chargée"
          hint={<>Chargez votre feuille « Données Journalières » depuis <Link href="/imports?type=ANIMATIONS" className="text-accent font-medium">Imports → Animations POS</Link>. Une ligne par jour × point de vente × animatrice, une colonne par produit — le fichier est repris tel quel.</>}
          action={<Link href="/imports?type=ANIMATIONS" className="btn-primary btn-sm">Importer le fichier</Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Terrain"
        title="Animations — sell-out"
        subtitle={`${period.label} · CA TTC encaissé en rayon. Comparaison : ${period.prev.label}.`}
        actions={<>
          <Link href="/imports?type=ANIMATIONS" className="btn-secondary btn-sm">Importer le jour</Link>
          <Link href="/terrain/saisie" className="btn-secondary btn-sm">+ Saisir</Link>
          <Link href={`/terrain/rapports${mine ? `?animatrice=${mine}` : ""}`} className="btn-secondary btn-sm">Rapports</Link>
          {!isAnimatrice && <Link href="/terrain/animatrices" className="btn-primary btn-sm">Plan d&apos;action animatrices</Link>}
        </>}
      >
        <form action="/terrain" method="get" className="flex flex-wrap gap-2 mb-3 text-[13px]">
          {sp.dim && <input type="hidden" name="dim" value={sp.dim} />}
          <select name="period" defaultValue={sp.period ?? "month"} className="select h-9 w-auto">
            {PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input type="date" name="start" defaultValue={sp.start ?? ""} className="input h-9 w-auto" title="Début (période personnalisée)" />
          <input type="date" name="end" defaultValue={sp.end ?? ""} className="input h-9 w-auto" title="Fin (période personnalisée)" />
          <select name="city" defaultValue={sp.city ?? ""} className="select h-9 w-auto">
            <option value="">Toutes les villes</option>
            {cityRows.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <button className="btn-secondary h-9" type="submit">Appliquer</button>
          {(sp.city || sp.animatrice) && <Link href={qs({ city: undefined, animatrice: undefined })} className="btn-ghost btn-sm h-9">Réinitialiser</Link>}
        </form>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
          <Card>
            <div className="label">CA sell-out TTC</div>
            <div className="kpi mt-1.5">{fmtMAD(totals.revenue, { compact: true })}</div>
            <div className="mt-1.5 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(totals.revenue, prevTotals.revenue)} /> vs {period.prev.label}</div>
          </Card>
          <Card>
            <div className="label">Unités vendues</div>
            <div className="kpi mt-1.5">{fmtNum(totals.units)}</div>
            <div className="mt-1.5 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(totals.units, prevTotals.units)} /></div>
          </Card>
          <Card>
            <div className="label">Objectif de la période</div>
            <div className={`kpi mt-1.5 ${completion === null ? "text-faint" : completion >= 100 ? "text-green" : completion >= 70 ? "text-orange" : "text-red"}`}>
              {completion === null ? "—" : `${Math.round(completion)} %`}
            </div>
            <div className="mt-1.5 text-[12px] text-muted">{objectiveUnits > 0 ? `${fmtNum(totals.units)} / ${fmtNum(objectiveUnits)} u.` : "objectifs non chargés"}</div>
            {objectiveUnits > 0 && <Progress value={Math.min(100, completion ?? 0)} tone={(completion ?? 0) >= 100 ? "green" : (completion ?? 0) >= 70 ? "yellow" : "red"} className="mt-1.5" />}
          </Card>
          <Card>
            <div className="label">Jours d&apos;animation</div>
            <div className="kpi mt-1.5">{fmtNum(totals.days)}</div>
            <div className="mt-1.5 text-[12px] text-muted">{totals.animations} animations · {totals.pos} POS</div>
          </Card>
          <Card>
            <div className="label">CA moyen / jour</div>
            <div className="kpi mt-1.5">{fmtMAD(revPerDay, { compact: true })}</div>
            <div className="mt-1.5 text-[12px] text-muted flex items-center gap-1"><Delta value={delta(revPerDay, prevRevPerDay)} /> · {fmtNum(totals.days ? totals.units / totals.days : 0, 1)} u./j</div>
          </Card>
          <Card>
            <div className="label">Panier moyen</div>
            <div className="kpi mt-1.5">{fmtMAD(basket)}</div>
            <div className="mt-1.5 text-[12px] text-muted">par unité vendue</div>
          </Card>
        </div>
      </PageHeader>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div>
          <Card title="CA par jour" className="mb-4">
            {daily.length > 1 ? <SimpleLine data={daily} xKey="date" yKey="revenue" height={180} /> : <div className="text-sm text-muted py-6 text-center">Pas assez de jours sur la période pour tracer une courbe.</div>}
          </Card>

          <Tabs current={qs({ dim })} tabs={DIMS.map((d) => ({ href: qs({ dim: d.key }), label: d.label }))} />
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead><tr>
                <th>{DIMS.find((d) => d.key === dim)!.label.replace(/s$/, "")}</th>
                {(dim === "pos" || dim === "animatrice" || dim === "product") && <th>{dim === "product" ? "Marque" : "Ville"}</th>}
                <th className="num">CA TTC</th><th className="num">Part</th><th className="num">Unités</th>
                {dim !== "brand" && dim !== "product" && <th className="num">Jours</th>}
                {dim !== "brand" && dim !== "product" && <th className="num">CA / jour</th>}
                <th className="num">Panier</th><th className="num">vs {period.prev.label}</th>
              </tr></thead>
              <tbody>
                {rows.map((r: DimRow) => (
                  <tr key={r.id}>
                    <td className="max-w-[260px]">
                      {dim === "animatrice" && r.id !== "none" ? <Link href={`/terrain/animatrices?focus=${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                        : dim === "city" ? <Link href={qs({ city: r.name })} className="font-medium hover:underline">{r.name}</Link>
                          : dim === "pos" ? <Link href={`/clients/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                            : dim === "product" ? <Link href={`/produits/${r.id}`} className="font-medium hover:underline truncate block">{r.name}</Link>
                              : <span className="font-medium flex items-center gap-1.5">{r.color && <BrandDot color={r.color} />}{r.name}</span>}
                    </td>
                    {(dim === "pos" || dim === "animatrice" || dim === "product") && <td className="text-muted whitespace-nowrap">{r.extra || "—"}</td>}
                    <td className="num font-medium">{fmtMAD(r.revenue, { compact: true })}</td>
                    <td className="num text-muted">{totals.revenue ? `${Math.round((r.revenue / totals.revenue) * 100)} %` : "—"}</td>
                    <td className="num">{fmtNum(r.units)}</td>
                    {dim !== "brand" && dim !== "product" && <td className="num text-muted">{fmtNum(r.days)}</td>}
                    {dim !== "brand" && dim !== "product" && <td className="num">{r.days ? fmtMAD(r.revenue / r.days, { compact: true }) : "—"}</td>}
                    <td className="num text-muted">{r.units ? fmtMAD(r.revenue / r.units) : "—"}</td>
                    <td className="num"><Delta value={delta(r.revenue, r.prevRevenue)} size="xs" /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted py-8">Aucune animation sur cette période.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {!isAnimatrice && (weeklyAdoption.length > 0 || teamAdoption.length > 0) && (
            <Card title="Adoption saisie mobile" action={<Link href="/parametres/evenements" className="text-[11px] text-accent hover:underline">Journal</Link>}>
              <div className="text-[11px] text-muted mb-2">Saisie directe (app) vs import du fichier — par semaine</div>
              <div className="flex items-end gap-1.5 h-14 mb-3">
                {weeklyAdoption.map((w) => {
                  const total = w.saisie + w.import_;
                  const pct = total > 0 ? (w.saisie / total) * 100 : null;
                  const tone = pct === null ? "bg-sunk" : pct >= 70 ? "bg-green" : pct >= 30 ? "bg-orange" : "bg-red";
                  return (
                    <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1" title={`${fmtDateShort(w.weekStart)} · ${w.saisie} saisie(s) / ${w.import_} import(s)`}>
                      <div className="w-full flex-1 flex items-end rounded-sm overflow-hidden bg-sunk">
                        <div className={`w-full ${tone}`} style={{ height: `${pct ?? 4}%` }} />
                      </div>
                      <div className="text-[9px] text-faint">{fmtDateShort(w.weekStart).slice(0, 5)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[11px] text-muted mb-1.5">Par animatrice — 4 dernières semaines</div>
              <div className="space-y-2">
                {[...teamAdoption].sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1)).map((a) => (
                  <div key={a.animatriceId}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium truncate">{a.name}</span>
                      <span className="text-muted tabular-nums shrink-0">{a.pct === null ? "aucune activité" : `${Math.round(a.pct)} %`}</span>
                    </div>
                    {a.pct !== null && (
                      <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-sunk flex">
                        <div className="h-full bg-green" style={{ width: `${a.pct}%` }} />
                        <div className="h-full bg-faint/40" style={{ width: `${100 - a.pct}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Palmarès de la période">
            <div className="space-y-2.5">
              {podium.map((p) => (
                <div key={p.label} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-muted uppercase tracking-wider">{p.label}</div>
                    <div className="text-[13px] font-medium truncate">{p.value ?? "—"}</div>
                  </div>
                  <div className="text-[11.5px] text-muted whitespace-nowrap pt-3.5">{p.sub ?? ""}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Objectif par ville" action={<Link href="/imports?type=ANIM_OBJECTIVES" className="text-[11px] text-accent hover:underline">Charger</Link>}>
            {objectives.length === 0 ? (
              <div className="text-[13px] text-muted">Aucun objectif chargé pour {year}. Importez le tableau « objectifs 2026 » (ville × marque, en unités par an).</div>
            ) : (
              <div className="space-y-2.5">
                {cityRows.filter((c) => c.name !== "—").map((c) => {
                  const obj = objectiveForRange(objectives, period, { cities: [c.name] });
                  const pct = obj > 0 ? (c.units / obj) * 100 : null;
                  return (
                    <Link key={c.id} href={qs({ city: c.name })} className="block group">
                      <div className="flex items-center gap-2 text-[13px]">
                        <span className="font-medium group-hover:underline">{c.name}</span>
                        <span className="ml-auto tabular-nums text-muted">{fmtNum(c.units)}{obj > 0 ? ` / ${fmtNum(obj)}` : ""} u.</span>
                      </div>
                      {pct !== null && <Progress value={Math.min(100, pct)} tone={pct >= 100 ? "green" : pct >= 70 ? "yellow" : "red"} className="mt-1" />}
                      {pct !== null && <div className={`text-[11px] mt-0.5 ${pct >= 100 ? "text-green" : pct >= 70 ? "text-orange" : "text-red"}`}>{Math.round(pct)} % de l&apos;objectif</div>}
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Lecture">
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              Le CA affiché est le <b>sell-out TTC</b> : quantités vendues en animation × prix public.
              L&apos;objectif de la période est l&apos;objectif annuel de chaque ville ramené au nombre de jours
              ({period.days} j), limité aux villes animées. Chaque ligne du fichier quotidien est identifiée par
              jour + point de vente + animatrice : réimporter le même fichier met à jour sans doublonner.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
