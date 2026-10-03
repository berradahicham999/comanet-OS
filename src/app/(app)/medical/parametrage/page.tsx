import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { PageHeader, Card } from "@/components/ui";
import { updateMedicalSettings, updateMedicalFieldSettings } from "./actions";
import { DEFAULT_MEDICAL_FIELD } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramétrage médical" };

function Field({ name, label, value, hint, step = "1" }: { name: string; label: string; value: number; hint?: string; step?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} type="number" step={step} defaultValue={value} className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function MedicalParametragePage() {
  await requireAccess("medical");
  const s = await getSettings();
  const f = s.medicalField;
  const D = DEFAULT_MEDICAL_FIELD;

  return (
    <>
      <PageHeader eyebrow="Médical" title="Paramétrage médical" subtitle="Seuils utilisés par le dashboard et l'Action Center médical. Aucun seuil n'est codé en dur." />
      <Card className="max-w-xl">
        <form action={updateMedicalSettings} className="grid sm:grid-cols-2 gap-3">
          <Field name="medicalDefaultVisitFrequencyDays" label="Fréquence de visite par défaut (j)" value={s.medicalDefaultVisitFrequencyDays} hint="Utilisée si la fiche médecin ne précise pas de fréquence." />
          <Field name="medicalOverdueVisitDays" label="Seuil de retard (j)" value={s.medicalOverdueVisitDays} hint="Au-delà, un médecin jamais visité est signalé en retard." />
          <Field name="medicalSamplesPerVisitDefault" label="Échantillons moyens / visite" value={s.medicalSamplesPerVisitDefault} hint="Utilisé pour estimer le besoin en échantillons des visites planifiées." />
          <div className="sm:col-span-2"><button className="btn-primary" type="submit">Enregistrer</button></div>
        </form>
      </Card>

      <Card className="max-w-3xl mt-6" title="Visites chronométrées et contrôle GPS">
        <form action={updateMedicalFieldSettings} className="grid sm:grid-cols-3 gap-3">
          <Field name="radiusM" label="Rayon du cabinet (m)" value={f.radiusM} hint={`Démarrer / Terminer dans ce rayon = chez le médecin. Défaut ${D.radiusM}.`} />
          <Field name="maxAccuracyM" label="Précision GPS maximale (m)" value={f.maxAccuracyM} hint={`Au-delà, la position ne prouve rien. Défaut ${D.maxAccuracyM}.`} />
          <Field name="maxStartStopM" label="Écart Démarrer → Terminer (m)" value={f.maxStartStopM} hint={`Défaut ${D.maxStartStopM}.`} />
          <Field name="minDurationMin" label="Durée minimale (min)" value={f.minDurationMin} hint={`Défaut ${D.minDurationMin}.`} />
          <Field name="maxDurationMin" label="Durée maximale (min)" value={f.maxDurationMin} hint={`Défaut ${D.maxDurationMin}.`} />
          <Field name="autoCloseHours" label="Clôture automatique après (h)" value={f.autoCloseHours} step="0.5" hint={`Visite oubliée. Défaut ${D.autoCloseHours}.`} />
          <Field name="lateSyncHours" label="Envoi différé toléré (h)" value={f.lateSyncHours} step="0.5" hint={`Au-delà : à vérifier. Défaut ${D.lateSyncHours}.`} />
          <Field name="clockSkewMin" label="Décalage d'horloge toléré (min)" value={f.clockSkewMin} hint={`Défaut ${D.clockSkewMin}.`} />
          <Field name="maxSpeedKmh" label="Vitesse max entre deux visites (km/h)" value={f.maxSpeedKmh} hint={`Au-delà : déplacement impossible. Défaut ${D.maxSpeedKmh}.`} />
          <Field name="gpsTimeoutS" label="Attente de la position (s)" value={f.gpsTimeoutS} hint={`Défaut ${D.gpsTimeoutS}.`} />
          <label className="block text-[13px]">
            <span className="label block mb-1">Jours travaillés</span>
            <input name="workDays" defaultValue={f.workDays.join(",")} className="input h-9" />
            <span className="text-[11px] text-faint block mt-0.5">1 = lundi … 7 = dimanche. Alerte « journée sans visite ». Défaut {D.workDays.join(",")}.</span>
          </label>
          <div className="sm:col-span-3 label mt-2">Ordonnances</div>
          <Field name="matchAutoScore" label="Rapprochement automatique dès (0-1)" value={f.matchAutoScore} step="0.01" hint={`Défaut ${D.matchAutoScore}.`} />
          <Field name="matchSuggestScore" label="Suggestion dès (0-1)" value={f.matchSuggestScore} step="0.01" hint={`Défaut ${D.matchSuggestScore}.`} />
          <Field name="potentialMonths" label="Fenêtre du potentiel (mois)" value={f.potentialMonths} hint={`Défaut ${D.potentialMonths}.`} />
          <Field name="potentialTopAPct" label="Potentiel A : meilleurs (%)" value={f.potentialTopAPct} hint={`Parmi les prescripteurs de la spécialité. Défaut ${D.potentialTopAPct}.`} />
          <Field name="potentialTopBPct" label="Potentiel A+B : meilleurs (%)" value={f.potentialTopBPct} hint={`Défaut ${D.potentialTopBPct}.`} />
          <Field name="potentialMinPrescriptions" label="Ordonnances min. pour un potentiel" value={f.potentialMinPrescriptions} hint={`Défaut ${D.potentialMinPrescriptions}.`} />
          <Field name="trendMonths" label="Tendance : mois comparés" value={f.trendMonths} hint={`Derniers N mois vs N précédents. Défaut ${D.trendMonths}.`} />
          <Field name="trendPct" label="Tendance nette dès (%)" value={f.trendPct} hint={`Défaut ${D.trendPct}.`} />
          <Field name="recoMinPeers" label="Pairs min. (même spécialité et ville)" value={f.recoMinPeers} hint={`Sinon repli national. Défaut ${D.recoMinPeers}.`} />
          <Field name="recoMinSupport" label="Médecins min. derrière une association" value={f.recoMinSupport} hint={`Défaut ${D.recoMinSupport}.`} />
          <Field name="recoTopN" label="Produits recommandés" value={f.recoTopN} hint={`Défaut ${D.recoTopN}.`} />
          <Field name="tourSize" label="Tournée : médecins proposés" value={f.tourSize} hint={`Défaut ${D.tourSize}.`} />
          <Field name="tourWeightA" label="Tournée : poids potentiel A" value={f.tourWeights.A} step="0.5" hint={`Défaut ${D.tourWeights.A}.`} />
          <Field name="tourWeightB" label="Tournée : poids potentiel B" value={f.tourWeights.B} step="0.5" hint={`Défaut ${D.tourWeights.B}.`} />
          <Field name="tourWeightC" label="Tournée : poids potentiel C" value={f.tourWeights.C} step="0.5" hint={`Défaut ${D.tourWeights.C}.`} />
          <Field name="tourWeightNone" label="Tournée : poids non classé" value={f.tourWeights.none} step="0.5" hint={`Défaut ${D.tourWeights.none}.`} />
          <Field name="historyMinPoints" label="Cabinet depuis l'historique : visites min." value={f.historyMinPoints} hint={`Défaut ${D.historyMinPoints}.`} />
          <Field name="historyMinShare" label="… part des visites dans le rayon (0-1)" value={f.historyMinShare} step="0.05" hint={`Défaut ${D.historyMinShare}.`} />
          <Field name="impactWindowDays" label="Impact des visites : fenêtre (j)" value={f.impactWindowDays} hint={`Avant / après. Défaut ${D.impactWindowDays}.`} />
          <div className="sm:col-span-3"><button className="btn-primary" type="submit">Enregistrer</button></div>
        </form>
      </Card>
    </>
  );
}
