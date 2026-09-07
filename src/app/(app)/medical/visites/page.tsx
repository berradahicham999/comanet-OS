import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listDelegates } from "@/lib/users";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { PageHeader, Badge } from "@/components/ui";
import { fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visites médicales" };

const STATUS_TONE: Record<string, "green" | "blue" | "gray" | "orange"> = { REALISEE: "green", PLANIFIEE: "blue", REPORTEE: "orange", ANNULEE: "gray", NON_EFFECTUEE: "gray" };
const STATUS_LABEL: Record<string, string> = { REALISEE: "Réalisée", PLANIFIEE: "Planifiée", REPORTEE: "Reportée", ANNULEE: "Annulée", NON_EFFECTUEE: "Non effectuée" };

export default async function VisitesPage(props: { searchParams: Promise<{ delegate?: string; status?: string; doctor?: string }> }) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  const isDelegate = await isOwnOnly();
  const delegateFilter = isDelegate ? user.id : sp.delegate;

  const [rowsRes, delegatesRes] = await Promise.all([
    db.execute(sql`
      select v.id, v.date::text as date, v.status, v.doctor_interest,
        (d.first_name || ' ' || d.last_name) as doctor_name, d.id as doctor_id,
        u.name as delegate_name
      from doctor_visits v
      join doctors d on d.id = v.doctor_id
      left join users u on u.id = v.delegate_id
      where 1 = 1
        ${delegateFilter ? sql`and v.delegate_id = ${delegateFilter}::uuid` : sql``}
        ${sp.status ? sql`and v.status = ${sp.status}` : sql``}
        ${sp.doctor ? sql`and v.doctor_id = ${sp.doctor}::uuid` : sql``}
      order by v.date desc, v.created_at desc limit 300`),
    listDelegates().then((rows) => ({ rows })),
  ]);
  const rows = rowsRes.rows as { id: string; date: string; status: string; doctor_interest: string | null; doctor_name: string; doctor_id: string; delegate_name: string | null }[];
  const delegates = delegatesRes.rows as { id: string; name: string }[];

  return (
    <>
      <PageHeader eyebrow="Médical" title="Visites" subtitle={`${rows.length} visite(s)`} actions={<Link href="/medical/visites/saisie" className="btn-primary">Nouvelle visite</Link>}>
        <form action="/medical/visites" method="get" className="flex flex-wrap gap-2 items-center">
          {!isDelegate && (
            <select name="delegate" defaultValue={sp.delegate ?? ""} className="select h-9 w-auto">
              <option value="">Tous délégués</option>
              {delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select name="status" defaultValue={sp.status ?? ""} className="select h-9 w-auto">
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn-secondary h-9" type="submit">Filtrer</button>
          {(sp.delegate || sp.status) && <Link href="/medical/visites" className="btn-ghost h-9">Réinitialiser</Link>}
        </form>
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Médecin</th>{!isDelegate && <th>Délégué</th>}<th>Statut</th><th>Intérêt</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{fmtDateShort(r.date)}</td>
                <td><Link href={`/medical/medecins/${r.doctor_id}`} className="font-medium hover:underline">Dr {r.doctor_name}</Link></td>
                {!isDelegate && <td className="text-muted">{r.delegate_name ?? "—"}</td>}
                <td><Badge tone={STATUS_TONE[r.status] ?? "gray"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="text-muted">{r.doctor_interest ? r.doctor_interest.toLowerCase() : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={isDelegate ? 4 : 5} className="text-center text-muted py-8">Aucune visite.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
