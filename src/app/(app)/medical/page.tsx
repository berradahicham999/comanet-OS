import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { medicalDashboard } from "@/lib/medical/dashboard";
import { today, fmtNum, fmtPct } from "@/lib/format";
import { PageHeader, Card, Kpi, Progress, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard médical" };

export default async function MedicalDashboardPage() {
  const user = await requireAccess("medical");
  if (user.role === "DELEGUE_MEDICAL") redirect(`/medical/delegues/${user.id}`);
  const ref = today();
  const d = await medicalDashboard(ref);

  return (
    <>
      <PageHeader eyebrow="Médical" title="Dashboard médical" subtitle="Activité de visite médicale, performance des délégués et couverture des médecins." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Délégués actifs" value={d.activeDelegates} />
        <Kpi label="Médecins dans la base" value={fmtNum(d.totalDoctors)} />
        <Kpi label="Visités aujourd'hui" value={d.visitedToday} />
        <Kpi label="Visites cette semaine" value={fmtNum(d.visitsWeek)} />
        <Kpi label="Visites ce mois" value={fmtNum(d.visitsMonth)} sub={d.monthlyObjective ? `objectif ${fmtNum(d.monthlyObjective)}` : undefined} />
        <Kpi label="Réalisation" value={d.realisationPct !== null ? fmtPct(d.realisationPct) : "—"} />
        <Kpi label="Moy. visites / délégué" value={fmtNum(d.avgVisitsPerDelegate, 1)} />
        <Kpi label="Moy. visites / médecin" value={fmtNum(d.avgVisitsPerDoctor, 1)} />
        <Kpi label="Jamais visités" value={d.neverVisited} tone={d.neverVisited > 0 ? "orange" : undefined} />
        <Kpi label="En retard de visite" value={d.overdue} tone={d.overdue > 0 ? "red" : undefined} />
      </div>

      <Card title="Performance équipe" className="mb-4">
        {d.team.length === 0 ? <Empty title="Aucun délégué médical" hint="Créez un utilisateur avec le rôle Délégué médical depuis Paramètres." /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Délégué</th><th className="num">Objectif</th><th className="num">Visites</th><th>Réalisation</th><th className="num">Médecins actifs</th></tr></thead>
              <tbody>
                {d.team.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.name}</td>
                    <td className="num">{t.monthlyObjective || "—"}</td>
                    <td className="num">{t.visitsMonth}</td>
                    <td className="w-32">{t.realisationPct !== null ? <><Progress value={t.realisationPct} tone={t.realisationPct >= 85 ? "green" : t.realisationPct >= 60 ? "yellow" : "red"} /><span className="text-[11px] text-muted">{fmtPct(t.realisationPct)}</span></> : <span className="text-faint">—</span>}</td>
                    <td className="num">{t.activeDoctors} / {t.assignedDoctors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Analyse par secteur">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Secteur</th><th className="num">Médecins</th><th className="num">Actifs</th><th className="num">Visites/médecin</th></tr></thead>
              <tbody>
                {d.bySector.map((s) => (
                  <tr key={s.sectorId ?? "none"}>
                    <td className="font-medium">{s.sectorName}</td>
                    <td className="num">{s.doctors}</td>
                    <td className="num">{s.activeDoctors}</td>
                    <td className="num">{s.doctors ? fmtNum(s.visits / s.doctors, 1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Analyse par spécialité">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Spécialité</th><th className="num">Médecins</th><th className="num">Visites (mois)</th><th className="num">Fréquence moy.</th></tr></thead>
              <tbody>
                {d.bySpecialty.map((s) => (
                  <tr key={s.specialtyId ?? "none"}>
                    <td className="font-medium">{s.specialtyName}</td>
                    <td className="num">{s.doctors}</td>
                    <td className="num">{s.visits}</td>
                    <td className="num">{s.avgFrequencyDays ? `${s.avgFrequencyDays} j` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
