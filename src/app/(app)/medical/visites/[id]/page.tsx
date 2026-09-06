import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card } from "@/components/ui";
import { MedicalVisitForm } from "@/components/medical-visit-form";
import { saveVisitAction, deleteVisitAction } from "../actions";
import { iso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VisiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("medical");
  const { id } = await params;
  const isDelegate = user.role === "DELEGUE_MEDICAL";

  const [visitRes, productsRes, doctorsRes] = await Promise.all([
    db.execute(sql`
      select v.*, (d.first_name || ' ' || d.last_name) as doctor_name, d.city as doctor_city,
        coalesce((select array_agg(vp.product_id) from visit_products vp where vp.visit_id = v.id), '{}') as product_ids,
        coalesce((select json_agg(json_build_object('productId', vs.product_id, 'qty', vs.quantity::text)) from visit_samples vs where vs.visit_id = v.id), '[]') as samples
      from doctor_visits v join doctors d on d.id = v.doctor_id
      where v.id = ${id}::uuid`),
    db.execute(sql`select id, name from products where active order by name`),
    db.execute(sql`select id, (first_name || ' ' || last_name) as name, city from doctors where status <> 'INACTIF' order by last_name, first_name`),
  ]);
  const visit = visitRes.rows[0] as Record<string, unknown> | undefined;
  if (!visit) notFound();
  if (isDelegate && visit.delegate_id !== user.id) notFound();

  const products = productsRes.rows as { id: string; name: string }[];
  const doctors = doctorsRes.rows as { id: string; name: string; city: string | null }[];

  return (
    <>
      <PageHeader eyebrow="Médical" title={`Visite — Dr ${visit.doctor_name}`} subtitle={visit.doctor_city as string | null ?? undefined} />
      <Card className="max-w-2xl">
        <MedicalVisitForm
          action={saveVisitAction}
          doctors={doctors}
          products={products}
          today={iso(new Date())}
          submitLabel="Enregistrer les modifications"
          initial={{
            id: visit.id as string,
            doctorId: visit.doctor_id as string,
            date: visit.date as string,
            status: visit.status as string,
            durationMinutes: visit.duration_minutes as number | null,
            visitType: visit.visit_type as string,
            objective: visit.objective as string | null,
            result: visit.result as string | null,
            doctorInterest: visit.doctor_interest as string | null,
            comment: visit.comment as string | null,
            nextAction: visit.next_action as string | null,
            nextVisitDate: visit.next_visit_date as string | null,
            productIds: (visit.product_ids as string[]) ?? [],
            samples: ((visit.samples as { productId: string; qty: string }[]) ?? []).map((s) => ({ productId: s.productId, qty: s.qty })),
          }}
        />
        {!isDelegate && (
          <form action={deleteVisitAction} className="mt-4 pt-4 border-t border-line">
            <input type="hidden" name="id" value={visit.id as string} />
            <input type="hidden" name="doctorId" value={visit.doctor_id as string} />
            <button className="btn-ghost btn-sm text-red" type="submit">Supprimer cette visite</button>
          </form>
        )}
      </Card>
    </>
  );
}
