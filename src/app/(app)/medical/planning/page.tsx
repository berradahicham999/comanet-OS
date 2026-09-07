import Link from "next/link";
import { listDelegates } from "@/lib/users";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { suggestRoute } from "@/lib/medical/planning";
import { delegateDashboard } from "@/lib/medical/delegates";
import { today, fmtDateShort } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning / tournée" };

export default async function PlanningPage(props: { searchParams: Promise<{ delegate?: string }> }) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  const isDelegate = await isOwnOnly();

  const delegatesRes = isDelegate ? null : await listDelegates().then((rows) => ({ rows }));
  const delegates = (delegatesRes?.rows ?? []) as { id: string; name: string }[];
  const delegateId = isDelegate ? user.id : sp.delegate || delegates[0]?.id;

  if (!delegateId) {
    return (
      <>
        <PageHeader eyebrow="Médical" title="Planning / tournée" />
        <Empty title="Aucun délégué médical" hint="Créez un utilisateur avec le rôle Délégué médical depuis Paramètres." />
      </>
    );
  }

  const ref = today();
  const [route, dash] = await Promise.all([suggestRoute(delegateId), delegateDashboard(delegateId, ref)]);
  const bySector = new Map<string, typeof route>();
  for (const stop of route) {
    const key = stop.sectorName ?? "Sans secteur";
    bySector.set(key, [...(bySector.get(key) ?? []), stop]);
  }

  return (
    <>
      <PageHeader
        eyebrow="Médical"
        title="Planning / tournée"
        subtitle="Tournée suggérée : médecins jamais visités puis en retard, triés par potentiel. Pas d'optimisation de distance en V1."
      >
        {!isDelegate && (
          <form action="/medical/planning" method="get" className="flex gap-2">
            <select name="delegate" defaultValue={delegateId} className="select h-9 w-auto">
              {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="btn-secondary h-9" type="submit">Afficher</button>
          </form>
        )}
      </PageHeader>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Cette semaine">
          {dash.weekVisits.length === 0 ? (
            <Empty title="Aucune visite planifiée" hint="Utilisez la saisie de visite pour planifier depuis la tournée suggérée." />
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

        <Card title="Tournée suggérée">
          {route.length === 0 ? (
            <Empty title="Rien à planifier" hint="Tous les médecins de ce délégué sont visités dans les délais." />
          ) : (
            <div className="space-y-4">
              {[...bySector.entries()].map(([sector, stops]) => (
                <div key={sector}>
                  <div className="label mb-1.5">{sector}</div>
                  <ul className="space-y-1.5 text-[13px]">
                    {stops.map((s) => (
                      <li key={s.doctorId} className="flex items-center justify-between gap-2">
                        <Link href={`/medical/visites/saisie?doctor=${s.doctorId}`} className="hover:underline truncate">{s.name}{s.city ? ` — ${s.city}` : ""}</Link>
                        <span className="text-muted text-[12px] shrink-0">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
