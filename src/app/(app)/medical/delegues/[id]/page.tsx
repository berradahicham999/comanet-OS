import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { delegateDashboard } from "@/lib/medical/delegates";
import { today, fmtDateShort, fmtPct } from "@/lib/format";
import { PageHeader, Card, Kpi, Progress, Badge, Empty } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DelegueDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("medical");
  const { id } = await params;
  if ((await isOwnOnly()) && user.id !== id) redirect(`/medical/delegues/${user.id}`);
  const delegate = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!delegate) notFound();

  const ref = today();
  const dash = await delegateDashboard(id, ref);
  const perf = dash.perf;

  return (
    <>
      <PageHeader eyebrow="Médical" title={delegate.name} subtitle={perf?.zone ?? "Zone non définie"} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Objectif du mois" value={perf?.monthlyObjective || "—"} sub="visites" />
        <Kpi label="Réalisées" value={perf?.visitsMonth ?? 0} sub={perf?.realisationPct !== null && perf?.realisationPct !== undefined ? fmtPct(perf.realisationPct) : undefined} />
        <Kpi label="Cette semaine" value={perf?.visitsWeek ?? 0} sub={perf ? `objectif ${perf.weeklyObjective || "—"}` : undefined} />
        <Kpi label="Médecins actifs" value={perf?.activeDoctors ?? 0} sub={perf ? `sur ${perf.assignedDoctors} affectés` : undefined} />
      </div>
      {perf?.realisationPct !== null && perf?.realisationPct !== undefined && (
        <Card className="mb-4">
          <div className="flex items-center justify-between text-[13px] mb-2"><span className="label">Progression vers l&apos;objectif mensuel</span><span className="font-medium">{fmtPct(perf.realisationPct)}</span></div>
          <Progress value={perf.realisationPct} tone={perf.realisationPct >= 85 ? "green" : perf.realisationPct >= 60 ? "yellow" : "red"} />
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Médecins prioritaires">
          {dash.priorityDoctors.length === 0 ? (
            <Empty title="Rien à signaler" hint="Tous les médecins sont visités dans les délais." />
          ) : (
            <ul className="space-y-2 text-[13px]">
              {dash.priorityDoctors.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <Link href={`/medical/medecins/${d.id}`} className="hover:underline truncate">Dr {d.firstName} {d.lastName}</Link>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {d.potential && <Badge tone={d.potential === "A" ? "green" : d.potential === "B" ? "blue" : "gray"}>{d.potential}</Badge>}
                    <span className="text-muted">{d.neverVisited ? "Jamais visité" : `${d.daysSinceLastVisit} j`}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Planning de la semaine">
          {dash.weekVisits.length === 0 ? (
            <Empty title="Aucune visite planifiée cette semaine" hint="Utilisez Médical → Planning pour générer une tournée suggérée." />
          ) : (
            <ul className="space-y-2 text-[13px]">
              {dash.weekVisits.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>{fmtDateShort(v.date)} · {v.doctorName}</span>
                  <Badge tone={v.status === "REALISEE" ? "green" : "blue"}>{v.status === "REALISEE" ? "Réalisée" : "Planifiée"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
