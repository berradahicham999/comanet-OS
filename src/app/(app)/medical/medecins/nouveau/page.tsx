import { db } from "@/db";
import { sql } from "drizzle-orm";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card } from "@/components/ui";
import { DoctorFormFields } from "@/components/medical-doctor-form";
import { saveDoctor } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau médecin" };

export default async function NouveauMedecinPage() {
  const user = await requireAccess("medical");
  const [specialties, sectors, delegatesRes] = await Promise.all([
    db.query.medicalSpecialties.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.query.medicalSectors.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.execute(sql`select id, name from users where role = 'DELEGUE_MEDICAL' and active order by name`),
  ]);
  const delegates = delegatesRes.rows as { id: string; name: string }[];

  return (
    <>
      <PageHeader eyebrow="Médical" title="Nouveau médecin" />
      <Card className="max-w-2xl">
        <form action={saveDoctor}>
          <DoctorFormFields options={{ specialties, sectors, delegates, showDelegate: user.role !== "DELEGUE_MEDICAL" }} />
          <div className="mt-4"><button className="btn-primary" type="submit">Créer la fiche</button></div>
        </form>
      </Card>
    </>
  );
}
