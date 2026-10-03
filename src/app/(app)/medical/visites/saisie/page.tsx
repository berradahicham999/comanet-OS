import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { PageHeader, Card } from "@/components/ui";
import { MedicalVisitForm } from "@/components/medical-visit-form";
import { saveVisitAction } from "../actions";
import { iso, fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saisie de visite" };

export default async function SaisieVisitePage(props: { searchParams: Promise<{ doctor?: string; done?: string }> }) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  const isDelegate = await isOwnOnly();
  const [doctorsRes, productsRes, recentRes] = await Promise.all([
    db.execute(sql`select id, (first_name || ' ' || last_name) as name, city from doctors where status <> 'INACTIF' ${isDelegate ? sql`and delegate_id = ${user.id}::uuid` : sql``} order by last_name, first_name`),
    db.execute(sql`select id, name from products where active order by name`),
    db.execute(sql`
      select v.id, v.date::text as date, (d.first_name || ' ' || d.last_name) as doctor_name
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.delegate_id = ${user.id}::uuid order by v.created_at desc limit 5`),
  ]);
  const doctors = doctorsRes.rows as { id: string; name: string; city: string | null }[];
  const products = productsRes.rows as { id: string; name: string }[];
  const recent = recentRes.rows as { id: string; date: string; doctor_name: string }[];

  return (
    <>
      <PageHeader
        eyebrow="Médical"
        title={isDelegate ? "Planifier une visite" : "Saisie de visite"}
        subtitle={isDelegate
          ? "Planifiez une visite ; le jour J, démarrez-la depuis « Ma journée » (chrono et position)."
          : "Saisie au formulaire (hors chrono) : la visite n'aura ni heure ni contrôle GPS. Les déléguées passent par « Ma journée »."}
        actions={<Link href="/medical/journee" className="btn-primary">Ma journée</Link>}
      />
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Visite enregistrée. Merci !</div>}
      <div className="grid lg:grid-cols-[minmax(0,560px)_1fr] gap-4">
        <Card>
          <MedicalVisitForm mode={isDelegate ? "planning" : "full"} action={saveVisitAction} doctors={doctors} products={products} initial={{ doctorId: sp.doctor ?? "", status: isDelegate ? "PLANIFIEE" : undefined }} today={iso(new Date())} submitLabel={isDelegate ? "Planifier la visite" : undefined} />
        </Card>
        <div>
          <Card title="Mes dernières visites">
            {recent.length === 0 ? <div className="text-sm text-muted">Aucune visite pour le moment.</div> : (
              <ul className="text-[13px] space-y-2">
                {recent.map((r) => <li key={r.id}><Link href={`/medical/visites/${r.id}`} className="hover:underline">{fmtDateShort(r.date)} · {r.doctor_name}</Link></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
