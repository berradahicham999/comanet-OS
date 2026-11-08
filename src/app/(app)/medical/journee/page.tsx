import { requireAccess, isOwnOnly } from "@/lib/access";
import { delegateDay } from "@/lib/medical/day";
import { VisitDay, type DayData } from "@/components/medical/visit-day";
import { acceptGpsNoticeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ma journée" };

/**
 * Écran de la déléguée (mobile) : visites planifiées du jour, recherche d'un médecin, chrono de visite
 * (Démarrer / Terminer / non effectuée) et comptes rendus à compléter.
 */
export default async function JourneePage(props: { searchParams: Promise<{ doctor?: string; done?: string; planned?: string }> }) {
  const user = await requireAccess("medical");
  const sp = await props.searchParams;
  const data: DayData = {
    ...(await delegateDay(user.id, await isOwnOnly())),
    preselectDoctorId: sp.doctor ?? null,
    flash: sp.done ? "Compte rendu enregistré. Merci !" : sp.planned ? "Visite planifiée." : null,
  };

  return <VisitDay data={data} acceptNotice={acceptGpsNoticeAction} />;
}
