import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card, Badge } from "@/components/ui";
import { saveSpecialty } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spécialités médicales" };

export default async function SpecialitesPage() {
  await requireAccess("medical");
  const specialties = await db.query.medicalSpecialties.findMany({ orderBy: (s, { asc }) => [asc(s.name)] });

  return (
    <>
      <PageHeader eyebrow="Médical" title="Spécialités" subtitle="Référentiel des spécialités médicales utilisé sur les fiches médecin et les analyses par spécialité." />
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Spécialité</th><th>Statut</th></tr></thead>
            <tbody>
              {specialties.map((s) => (
                <tr key={s.id}>
                  <td>
                    <details>
                      <summary className="cursor-pointer font-medium list-none hover:underline">{s.name}</summary>
                      <form action={saveSpecialty} className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                        <input type="hidden" name="id" value={s.id} />
                        <input name="name" defaultValue={s.name} className="input h-8 w-48" required />
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={s.active} /> Actif</label>
                        <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>
                      </form>
                    </details>
                  </td>
                  <td>{s.active ? <Badge tone="green">actif</Badge> : <Badge tone="gray">inactif</Badge>}</td>
                </tr>
              ))}
              {specialties.length === 0 && <tr><td colSpan={2} className="text-center text-muted py-8">Aucune spécialité.</td></tr>}
            </tbody>
          </table>
        </div>
        <Card title="Nouvelle spécialité">
          <form action={saveSpecialty} className="space-y-2 text-[13px]">
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required /></label>
            <button className="btn-primary btn-sm w-full" type="submit">Créer</button>
          </form>
        </Card>
      </div>
    </>
  );
}
