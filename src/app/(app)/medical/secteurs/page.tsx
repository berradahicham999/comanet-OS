import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { PageHeader, Card, Badge } from "@/components/ui";
import { saveSector } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Secteurs médicaux" };

export default async function SecteursPage() {
  await requireAccess("medical");
  const sectors = await db.query.medicalSectors.findMany({ orderBy: (s, { asc }) => [asc(s.name)] });

  return (
    <>
      <PageHeader eyebrow="Médical" title="Secteurs" subtitle="Découpage géographique des médecins et des tournées — un secteur regroupe une ou plusieurs villes." />
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Secteur</th><th>Ville</th><th>Statut</th></tr></thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s.id}>
                  <td>
                    <details>
                      <summary className="cursor-pointer font-medium list-none hover:underline">{s.name}</summary>
                      <form action={saveSector} className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                        <input type="hidden" name="id" value={s.id} />
                        <input name="name" defaultValue={s.name} className="input h-8 w-40" required />
                        <input name="city" defaultValue={s.city ?? ""} placeholder="Ville" className="input h-8 w-32" />
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={s.active} /> Actif</label>
                        <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>
                      </form>
                    </details>
                  </td>
                  <td className="text-muted">{s.city ?? "—"}</td>
                  <td>{s.active ? <Badge tone="green">actif</Badge> : <Badge tone="gray">inactif</Badge>}</td>
                </tr>
              ))}
              {sectors.length === 0 && <tr><td colSpan={3} className="text-center text-muted py-8">Aucun secteur.</td></tr>}
            </tbody>
          </table>
        </div>
        <Card title="Nouveau secteur">
          <form action={saveSector} className="space-y-2 text-[13px]">
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required /></label>
            <label className="block"><span className="label block mb-1">Ville</span><input name="city" className="input h-9" /></label>
            <button className="btn-primary btn-sm w-full" type="submit">Créer</button>
          </form>
        </Card>
      </div>
    </>
  );
}
