import { notFound } from "next/navigation";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { getDoctor, doctorVisitHistory, buildDoctorRecommendation, effectiveFrequencyDays } from "@/lib/medical/doctors";
import { getSettings } from "@/lib/settings";
import { today, fmtDate, fmtDateShort } from "@/lib/format";
import { listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, Facts, Empty } from "@/components/ui";
import { DoctorFormFields } from "@/components/medical-doctor-form";
import { RecommendationCard } from "@/components/recommendation-card";
import { saveDoctor } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_TONE = { NOUVEAU: "blue", ACTIF: "green", A_REACTIVER: "orange", INACTIF: "gray" } as const;
const STATUS_LABEL = { NOUVEAU: "Nouveau", ACTIF: "Actif", A_REACTIVER: "À réactiver", INACTIF: "Inactif" } as const;
const VISIT_STATUS_LABEL: Record<string, string> = { PLANIFIEE: "Planifiée", REALISEE: "Réalisée", ANNULEE: "Annulée", REPORTEE: "Reportée", NON_EFFECTUEE: "Non effectuée" };

export default async function MedecinFichePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("medical");
  const { id } = await params;
  const doctor = await getDoctor(id);
  if (!doctor) notFound();

  const [visits, settings, specialties, sectors, delegatesRes, allUsers] = await Promise.all([
    doctorVisitHistory(id),
    getSettings(),
    db.query.medicalSpecialties.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.query.medicalSectors.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "DELEGUE_MEDICAL")),
    listUsers(),
  ]);
  const ref = today();
  const rec = buildDoctorRecommendation(doctor, settings, ref);
  const existingTask = rec
    ? await db.query.tasks.findFirst({ where: and(eq(tasks.sourceKey, rec.key), inArray(tasks.status, ["TODO", "IN_PROGRESS"])), with: { assignee: true } })
    : null;

  return (
    <>
      <PageHeader
        eyebrow={doctor.specialtyName ?? "Médical"}
        title={`Dr ${doctor.firstName} ${doctor.lastName}`}
        subtitle={<>
          <Badge tone={STATUS_TONE[doctor.status]}>{STATUS_LABEL[doctor.status]}</Badge>
          {doctor.potential && <Badge tone={doctor.potential === "A" ? "green" : doctor.potential === "B" ? "blue" : "gray"} className="ml-2">Potentiel {doctor.potential}</Badge>}
          {doctor.sectorName && <span className="ml-2">{doctor.sectorName}</span>}
        </>}
        actions={<a href={`/medical/visites/saisie?doctor=${doctor.id}`} className="btn-primary">Nouvelle visite</a>}
      />

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          {rec && (
            <RecommendationCard
              rec={{ ...rec, existingTask: existingTask ? { id: existingTask.id, status: existingTask.status, assignee: existingTask.assignee?.name ?? null } : null }}
              users={allUsers}
              redirectTo={`/medical/medecins/${doctor.id}`}
            />
          )}

          <Card title="Profil">
            <Facts
              cols={3}
              items={[
                { label: "Téléphone", value: doctor.phone ?? "—" },
                { label: "Email", value: doctor.email ?? "—" },
                { label: "Sous-spécialité", value: doctor.subSpecialty ?? "—" },
                { label: "Adresse", value: doctor.addressLine ?? "—" },
                { label: "Ville", value: doctor.city ?? "—" },
                { label: "Délégué", value: doctor.delegateName ?? "—" },
                { label: "Fréquence recommandée", value: `${effectiveFrequencyDays(doctor.visitFrequencyDays, settings)} j` },
                { label: "Dernière visite", value: doctor.lastVisitAt ? fmtDate(doctor.lastVisitAt) : "Jamais" },
                { label: "Visites réalisées", value: String(doctor.visitCount) },
              ]}
            />
            {doctor.comments && <p className="text-[13px] text-ink-2 mt-3"><span className="label mr-1.5">Commentaires</span>{doctor.comments}</p>}
            {doctor.notes && <p className="text-[13px] text-ink-2 mt-2"><span className="label mr-1.5">Notes</span>{doctor.notes}</p>}
          </Card>

          <Card title="Historique des visites">
            {visits.length === 0 ? (
              <Empty title="Aucune visite enregistrée" hint="Enregistrez la première visite depuis « Nouvelle visite »." />
            ) : (
              <div className="space-y-3">
                {visits.map((v) => (
                  <div key={v.id} className="border-b border-line last:border-0 pb-3 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-medium">{fmtDateShort(v.date)}</span>
                      <Badge tone={v.status === "REALISEE" ? "green" : v.status === "ANNULEE" || v.status === "NON_EFFECTUEE" ? "gray" : "blue"}>{VISIT_STATUS_LABEL[v.status] ?? v.status}</Badge>
                      {v.delegateName && <span className="text-muted">{v.delegateName}</span>}
                      {v.doctorInterest && <span className="text-muted">· Intérêt : {v.doctorInterest.toLowerCase()}</span>}
                    </div>
                    {v.products.length > 0 && <div className="text-[12px] text-ink-2 mt-1">Produits présentés : {v.products.join(", ")}</div>}
                    {v.samples.length > 0 && <div className="text-[12px] text-ink-2 mt-1">Échantillons : {v.samples.map((s) => `${s.product} ×${s.quantity}`).join(", ")}</div>}
                    {v.comment && <div className="text-[12px] text-ink-2 mt-1">{v.comment}</div>}
                    {v.nextAction && <div className="text-[12px] text-accent mt-1">→ {v.nextAction}{v.nextVisitDate ? ` (${fmtDateShort(v.nextVisitDate)})` : ""}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Modifier la fiche">
          <form action={saveDoctor}>
            <DoctorFormFields
              doctor={doctor}
              options={{ specialties, sectors, delegates: delegatesRes, showDelegate: user.role !== "DELEGUE_MEDICAL" }}
            />
            <div className="mt-4"><button className="btn-secondary btn-sm" type="submit">Enregistrer</button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
