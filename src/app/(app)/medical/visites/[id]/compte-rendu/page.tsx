import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { MedicalVisitForm } from "@/components/medical-visit-form";
import { doctorPrescriptionProfile } from "@/lib/medical/prescriptions";
import { fmtTime, iso } from "@/lib/format";
import { saveReportAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compte rendu de visite" };

/**
 * Compte rendu après « Terminer » (ou plus tard dans la journée). Les heures, la durée et le statut
 * viennent du chrono et s'affichent en lecture seule. Produits pré-sélectionnés : la dernière visite et
 * les produits recommandés pour ce médecin.
 */
export default async function CompteRenduPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireAccess("medical");
  const { id } = await params;
  const sp = await searchParams;
  const own = await isOwnOnly();
  const v = (await db.execute(sql`
    select v.*, d.first_name || ' ' || d.last_name as doctor_name, d.city as doctor_city,
      coalesce((select array_agg(vp.product_id) from visit_products vp where vp.visit_id = v.id), '{}') as product_ids,
      coalesce((select json_agg(json_build_object('productId', vs.product_id, 'qty', vs.quantity::text)) from visit_samples vs where vs.visit_id = v.id), '[]') as samples,
      (select array_agg(vp.product_id) from visit_products vp where vp.visit_id = (
         select pv.id from doctor_visits pv where pv.doctor_id = v.doctor_id and pv.id <> v.id and pv.status = 'REALISEE' order by pv.date desc limit 1)) as last_product_ids
    from doctor_visits v join doctors d on d.id = v.doctor_id where v.id = ${id}::uuid`)).rows[0] as Record<string, unknown> | undefined;
  if (!v) notFound();
  if (own && v.delegate_id !== user.id) notFound();

  const [productsRes, profile] = await Promise.all([
    db.execute(sql`select id, name from products where active order by name`),
    doctorPrescriptionProfile(v.doctor_id as string),
  ]);
  const products = productsRes.rows as { id: string; name: string }[];
  const initialProducts = (v.product_ids as string[]) ?? [];
  const suggested = [...new Set([
    ...((v.last_product_ids as string[] | null) ?? []),
    ...(profile?.recommendations.items.map((r) => r.productId) ?? []),
    ...(profile?.products.slice(0, 5).map((p) => p.productId) ?? []),
  ])];
  const status = v.status as string;

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-10">
      <div>
        <Link href={own ? "/medical/journee" : `/medical/visites/${id}`} className="text-[13px] text-muted hover:underline">← Retour</Link>
        <h1 className="text-[20px] font-semibold text-ink mt-1">Compte rendu — Dr {v.doctor_name as string}</h1>
        <div className="text-[13px] text-muted">
          {v.started_at ? `${fmtTime(v.started_at as string)} → ${v.ended_at ? fmtTime(v.ended_at as string) : "en cours"}` : ""}
          {v.duration_minutes !== null && v.duration_minutes !== undefined ? ` · ${v.duration_minutes} min` : v.auto_closed ? " · clôture automatique (durée non mesurée)" : ""}
          {status === "NON_EFFECTUEE" ? ` · non effectuée (${(v.not_done_reason as string) ?? ""})` : ""}
        </div>
      </div>
      {sp.error && <div className="rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{sp.error}</div>}
      {status === "EN_COURS" ? (
        <div className="rounded-2xl bg-orange-soft border border-orange/30 px-4 py-3 text-[13px]">Visite en cours : terminez-la depuis « Ma journée » avant de remplir le compte rendu.</div>
      ) : (
        <div className="rounded-2xl bg-surface border border-line p-4">
          <MedicalVisitForm
            mode="report"
            action={saveReportAction}
            doctors={[{ id: v.doctor_id as string, name: v.doctor_name as string, city: (v.doctor_city as string | null) ?? null }]}
            products={products}
            suggestedProductIds={suggested}
            today={iso(new Date())}
            submitLabel="Valider le compte rendu"
            initial={{
              id,
              doctorId: v.doctor_id as string,
              date: v.date as string,
              visitType: v.visit_type as string,
              objective: v.objective as string | null,
              result: v.result as string | null,
              doctorInterest: v.doctor_interest as string | null,
              comment: v.comment as string | null,
              nextAction: v.next_action as string | null,
              nextVisitDate: v.next_visit_date as string | null,
              objections: v.objections as string | null,
              documentation: v.documentation as string | null,
              productIds: initialProducts,
              samples: ((v.samples as { productId: string; qty: string }[]) ?? []).map((s) => ({ productId: s.productId, qty: s.qty })),
            }}
          />
        </div>
      )}
    </div>
  );
}
