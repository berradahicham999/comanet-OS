import Link from "next/link";
import { db } from "@/db";
import { listDelegates } from "@/lib/users";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { listDoctors } from "@/lib/medical/doctors";
import { PageHeader, Badge } from "@/components/ui";
import { fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Médecins" };

const STATUS_TONE = { NOUVEAU: "blue", ACTIF: "green", A_REACTIVER: "orange", INACTIF: "gray" } as const;
const STATUS_LABEL = { NOUVEAU: "Nouveau", ACTIF: "Actif", A_REACTIVER: "À réactiver", INACTIF: "Inactif" } as const;

export default async function MedecinsPage(props: {
  searchParams: Promise<{ sector?: string; delegate?: string; status?: string; potential?: string; q?: string }>;
}) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  const isDelegate = await isOwnOnly();
  const [doctors, sectors, delegates] = await Promise.all([
    listDoctors({
      sectorId: sp.sector, delegateId: isDelegate ? user.id : sp.delegate, status: sp.status, potential: sp.potential, search: sp.q,
    }),
    db.query.medicalSectors.findMany({ where: (s, { eq }) => eq(s.active, true), orderBy: (s, { asc }) => [asc(s.name)] }),
    listDelegates().then((rows) => ({ rows })),
  ]);
  const delegateRows = delegates.rows as { id: string; name: string }[];

  return (
    <>
      <PageHeader
        eyebrow="Médical"
        title="Médecins"
        subtitle={`${doctors.length} médecin${doctors.length > 1 ? "s" : ""} · ${doctors.filter((d) => d.neverVisited).length} jamais visité(s) · ${doctors.filter((d) => d.overdue).length} en retard`}
        actions={<Link href="/medical/medecins/nouveau" className="btn-primary">Nouveau médecin</Link>}
      >
        <form action="/medical/medecins" method="get" className="flex flex-wrap gap-2 items-center">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher un médecin…" className="input h-9 max-w-xs" />
          <select name="sector" defaultValue={sp.sector ?? ""} className="select h-9 w-auto">
            <option value="">Tous secteurs</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!isDelegate && (
            <select name="delegate" defaultValue={sp.delegate ?? ""} className="select h-9 w-auto">
              <option value="">Tous délégués</option>
              {delegateRows.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select name="status" defaultValue={sp.status ?? ""} className="select h-9 w-auto">
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="potential" defaultValue={sp.potential ?? ""} className="select h-9 w-auto">
            <option value="">Tout potentiel</option>
            <option value="A">A — Très fort potentiel</option>
            <option value="B">B — Potentiel moyen</option>
            <option value="C">C — Faible potentiel</option>
          </select>
          <button className="btn-secondary h-9" type="submit">Filtrer</button>
          {(sp.sector || sp.delegate || sp.status || sp.potential || sp.q) && <Link href="/medical/medecins" className="btn-ghost h-9">Réinitialiser</Link>}
        </form>
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Médecin</th><th>Spécialité</th><th>Ville / secteur</th>{!isDelegate && <th>Délégué</th>}
              <th>Statut</th><th>Potentiel</th><th>Dernière visite</th><th>Visites</th>
            </tr>
          </thead>
          <tbody>
            {doctors.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/medical/medecins/${d.id}`} className="font-medium hover:underline">Dr {d.firstName} {d.lastName}</Link>
                  {d.overdue && <Badge tone="orange" className="ml-2">en retard</Badge>}
                  {d.neverVisited && <Badge tone="red" className="ml-2">jamais visité</Badge>}
                </td>
                <td className="text-muted">{d.specialtyName ?? "—"}</td>
                <td className="text-muted">{d.city ?? "—"}{d.sectorName ? ` · ${d.sectorName}` : ""}</td>
                {!isDelegate && <td className="text-muted">{d.delegateName ?? "—"}</td>}
                <td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></td>
                <td>{d.potential ? <Badge tone={d.potential === "A" ? "green" : d.potential === "B" ? "blue" : "gray"}>{d.potential}</Badge> : <span className="text-faint">—</span>}</td>
                <td className="whitespace-nowrap">{d.lastVisitAt ? fmtDateShort(d.lastVisitAt) : <span className="text-faint">Jamais</span>}</td>
                <td className="num">{d.visitCount}</td>
              </tr>
            ))}
            {doctors.length === 0 && <tr><td colSpan={isDelegate ? 7 : 8} className="text-center text-muted py-8">Aucun médecin. Créez une fiche ou importez votre référentiel depuis Imports.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
