import { db } from "@/db";
import { listDelegates, listBrands } from "@/lib/users";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { PageHeader, Card } from "@/components/ui";
import { DoctorFormFields } from "@/components/medical-doctor-form";
import { saveDoctor } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau médecin" };

export default async function NouveauMedecinPage() {
  await requireAccess("medical");
  const [specialties, sectors, delegatesRes, brands] = await Promise.all([
    db.query.medicalSpecialties.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    db.query.medicalSectors.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    listDelegates().then((rows) => ({ rows })),
    listBrands(),
  ]);
  const delegates = delegatesRes.rows as { id: string; name: string }[];

  return (
    <>
      <PageHeader eyebrow="Médical" title="Nouveau médecin" />
      <Card className="max-w-2xl">
        <form action={saveDoctor}>
          <DoctorFormFields options={{ specialties, sectors, delegates, showDelegate: !(await isOwnOnly()), brands: brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })) }} />
          <div className="mt-4"><button className="btn-primary" type="submit">Créer la fiche</button></div>
        </form>
      </Card>
    </>
  );
}
