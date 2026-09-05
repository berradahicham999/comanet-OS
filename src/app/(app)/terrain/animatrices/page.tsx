import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { animatricePerformance } from "@/lib/terrain";
import { PageHeader, Card, Delta, Progress } from "@/components/ui";
import { fmtMAD, fmtNum, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Animatrices" };

export default async function AnimatricesPage(props: { searchParams: Promise<{ days?: string }> }) {
  const user = await requireAccess("terrain");
  if (user.role === "ANIMATRICE") return null;
  const sp = await props.searchParams;
  const days = Number(sp.days ?? 90) || 90;
  const perf = await animatricePerformance(today(), days);
  return (
    <>
      <PageHeader eyebrow="Terrain" title="Performance des animatrices" subtitle={`Fenêtre : ${days} jours. Score composite = CA 40 % · productivité (u./animation) 25 % · progression 30 j 15 % · qualité du reporting 20 %.`}
        actions={<form action="/terrain/animatrices" method="get" className="flex gap-2"><select name="days" defaultValue={String(days)} className="select h-9 w-auto"><option value="30">30 jours</option><option value="90">90 jours</option><option value="180">6 mois</option><option value="365">12 mois</option></select><button className="btn-secondary btn-sm h-9" type="submit">OK</button></form>} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {perf.map((p, i) => (
          <Card key={p.id} href={`/terrain?animatrice=${p.id}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full bg-accent-soft text-accent-2 font-semibold flex items-center justify-center">{i + 1}</div>
              <div className="min-w-0"><div className="font-semibold">{p.name}</div><div className="text-[12px] text-muted">{p.animations} animations · {p.days} jours</div></div>
              <div className="ml-auto text-right"><div className="kpi">{p.score}</div><div className="text-[10px] text-muted uppercase tracking-wider">score</div></div>
            </div>
            <Progress value={p.score} className="mb-3" tone={p.score >= 70 ? "green" : p.score >= 40 ? "accent" : "orange"} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-muted">CA sell-out (PPH)</dt><dd className="text-right font-medium">{fmtMAD(p.revenue, { compact: true })}</dd>
              <dt className="text-muted">Unités vendues</dt><dd className="text-right font-medium">{fmtNum(p.units)}</dd>
              <dt className="text-muted">Par animation</dt><dd className="text-right font-medium">{fmtNum(p.unitsPerAnimation, 1)} u.</dd>
              <dt className="text-muted">CA / jour</dt><dd className="text-right font-medium">{fmtMAD(p.revenuePerDay, { compact: true })}</dd>
              <dt className="text-muted">Transformation</dt><dd className="text-right font-medium">{p.conversion !== null ? `${Math.round(p.conversion)} %` : "—"}</dd>
              <dt className="text-muted">Progression 30 j</dt><dd className="text-right"><Delta value={p.progressionPct} size="xs" /></dd>
              <dt className="text-muted">Qualité reporting</dt><dd className="text-right font-medium">{Math.round(p.reportingQuality * 100)} %</dd>
              <dt className="text-muted">Top point de vente</dt><dd className="text-right font-medium truncate">{p.topClient ?? "—"}</dd>
              <dt className="text-muted">Top produit</dt><dd className="text-right font-medium truncate">{p.topProduct ?? "—"}</dd>
            </dl>
          </Card>
        ))}
        {perf.length === 0 && <Card><div className="text-sm text-muted">Aucune animatrice active. Créez des comptes avec le rôle « Animatrice » dans <Link href="/parametres" className="text-accent">Paramètres</Link>.</div></Card>}
      </div>
    </>
  );
}
