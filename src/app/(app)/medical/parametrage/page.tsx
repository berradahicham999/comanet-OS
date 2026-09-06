import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { PageHeader, Card } from "@/components/ui";
import { updateMedicalSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramétrage médical" };

function Field({ name, label, value, hint }: { name: string; label: string; value: number; hint?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} type="number" step="1" defaultValue={value} className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function MedicalParametragePage() {
  await requireAccess("medical");
  const s = await getSettings();

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
    </>
  );
}
