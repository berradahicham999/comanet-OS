import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { delegatePerformance } from "@/lib/medical/delegates";
import { today, fmtPct } from "@/lib/format";
import { PageHeader, Card, Progress } from "@/components/ui";
import { saveDelegateProfile } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Délégués médicaux" };

export default async function DeleguesPage() {
  await requireAccess("medical");
  const ref = today();
  const [perf, sectors, managersRes, detailRes] = await Promise.all([
    delegatePerformance(ref),
    db.query.medicalSectors.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.execute(sql`select id, name from users where role in ('MANAGER_MEDICAL','ADMIN') and active order by name`),
    db.execute(sql`
      select md.user_id, md.id as delegate_id, md.manager_id, coalesce(array_agg(mds.sector_id) filter (where mds.sector_id is not null), '{}') as sector_ids
      from medical_delegates md left join medical_delegate_sectors mds on mds.delegate_id = md.id
      group by md.user_id, md.id, md.manager_id`),
  ]);
  const managers = managersRes.rows as { id: string; name: string }[];
  const details = new Map(
    (detailRes.rows as { user_id: string; delegate_id: string; manager_id: string | null; sector_ids: string[] }[]).map((r) => [r.user_id, r]),
  );

  return (
    <>
      <PageHeader eyebrow="Médical" title="Délégués médicaux" subtitle="Objectifs, secteurs couverts et performance de visites du mois en cours." />
      <div className="space-y-3">
        {perf.map((d) => {
          const detail = details.get(d.id);
          return (
            <Card key={d.id}>
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Link href={`/medical/delegues/${d.id}`} className="font-semibold hover:underline">{d.name}</Link>
                      <div className="text-[12px] text-muted mt-0.5">{d.zone ?? "Zone non définie"} · {d.assignedDoctors} médecin(s) · {d.activeDoctors} actif(s) ce mois</div>
                    </div>
                    <div className="flex items-center gap-4 text-[13px]">
                      <div className="text-right"><div className="font-medium">{d.visitsMonth} / {d.monthlyObjective || "—"}</div><div className="text-[11px] text-muted">visites ce mois</div></div>
                      {d.realisationPct !== null && <div className="w-28"><Progress value={d.realisationPct} tone={d.realisationPct >= 85 ? "green" : d.realisationPct >= 60 ? "yellow" : "red"} /><div className="text-[11px] text-muted mt-1">{fmtPct(d.realisationPct)}</div></div>}
                    </div>
                  </div>
                </summary>
                <form action={saveDelegateProfile} className="mt-4 grid sm:grid-cols-2 gap-3 text-[13px] border-t border-line pt-4">
                  <input type="hidden" name="userId" value={d.id} />
                  <label className="block"><span className="label block mb-1">Zone</span><input name="zone" defaultValue={d.zone ?? ""} className="input h-9" /></label>
                  <label className="block">
                    <span className="label block mb-1">Manager</span>
                    <select name="managerId" defaultValue={detail?.manager_id ?? ""} className="select h-9">
                      <option value="">—</option>
                      {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                  <label className="block"><span className="label block mb-1">Objectif mensuel (visites)</span><input name="monthlyVisitObjective" type="number" defaultValue={d.monthlyObjective} className="input h-9" /></label>
                  <label className="block"><span className="label block mb-1">Objectif hebdomadaire (visites)</span><input name="weeklyVisitObjective" type="number" defaultValue={d.weeklyObjective} className="input h-9" /></label>
                  <div className="sm:col-span-2">
                    <span className="label block mb-1">Secteurs couverts</span>
                    <div className="flex flex-wrap gap-3">
                      {sectors.map((s) => (
                        <label key={s.id} className="flex items-center gap-1.5">
                          <input type="checkbox" name="sectorIds" value={s.id} defaultChecked={detail?.sector_ids.includes(s.id) ?? false} /> {s.name}
                        </label>
                      ))}
                      {sectors.length === 0 && <span className="text-faint">Aucun secteur — créez-en depuis Médical → Secteurs.</span>}
                    </div>
                  </div>
                  <div className="sm:col-span-2"><button className="btn-secondary btn-sm" type="submit">Enregistrer</button></div>
                </form>
              </details>
            </Card>
          );
        })}
        {perf.length === 0 && (
          <Card>
            <div className="text-center text-muted py-8">Aucun délégué médical. Créez un utilisateur avec le rôle « Délégué médical » depuis Paramètres.</div>
          </Card>
        )}
      </div>
    </>
  );
}
