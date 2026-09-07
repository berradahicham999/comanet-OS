import type { DoctorPotential, DoctorStatus } from "@/db/schema";

export type DoctorFormOptions = {
  specialties: { id: string; name: string }[];
  sectors: { id: string; name: string }[];
  delegates: { id: string; name: string }[];
  showDelegate: boolean;
  brands?: { id: string; name: string }[];
};

export type DoctorFormValue = {
  id?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  specialtyId?: string | null;
  subSpecialty?: string | null;
  addressLine?: string | null;
  city?: string | null;
  sectorId?: string | null;
  delegateId?: string | null;
  status?: DoctorStatus;
  potential?: DoctorPotential | null;
  visitFrequencyDays?: number | null;
  comments?: string | null;
  notes?: string | null;
  brandIds?: string[];
};

/** Champs de la fiche médecin — partagés entre la création et l'édition. */
export function DoctorFormFields({ doctor, options }: { doctor?: DoctorFormValue; options: DoctorFormOptions }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
      {doctor?.id && <input type="hidden" name="id" value={doctor.id} />}
      <label className="block"><span className="label block mb-1">Prénom</span><input name="firstName" defaultValue={doctor?.firstName ?? ""} className="input h-9" required /></label>
      <label className="block"><span className="label block mb-1">Nom</span><input name="lastName" defaultValue={doctor?.lastName ?? ""} className="input h-9" required /></label>
      <label className="block"><span className="label block mb-1">Téléphone</span><input name="phone" defaultValue={doctor?.phone ?? ""} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Email</span><input name="email" type="email" defaultValue={doctor?.email ?? ""} className="input h-9" /></label>
      <label className="block">
        <span className="label block mb-1">Spécialité</span>
        <select name="specialtyId" defaultValue={doctor?.specialtyId ?? ""} className="select h-9">
          <option value="">—</option>
          {options.specialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="block"><span className="label block mb-1">Sous-spécialité</span><input name="subSpecialty" defaultValue={doctor?.subSpecialty ?? ""} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Adresse cabinet</span><input name="addressLine" defaultValue={doctor?.addressLine ?? ""} className="input h-9" /></label>
      <label className="block"><span className="label block mb-1">Ville</span><input name="city" defaultValue={doctor?.city ?? ""} className="input h-9" /></label>
      <label className="block">
        <span className="label block mb-1">Secteur</span>
        <select name="sectorId" defaultValue={doctor?.sectorId ?? ""} className="select h-9">
          <option value="">—</option>
          {options.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {options.showDelegate && (
        <label className="block">
          <span className="label block mb-1">Délégué responsable</span>
          <select name="delegateId" defaultValue={doctor?.delegateId ?? ""} className="select h-9">
            <option value="">—</option>
            {options.delegates.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label block mb-1">Statut</span>
        <select name="status" defaultValue={doctor?.status ?? "NOUVEAU"} className="select h-9">
          <option value="NOUVEAU">Nouveau</option>
          <option value="ACTIF">Actif</option>
          <option value="A_REACTIVER">À réactiver</option>
          <option value="INACTIF">Inactif</option>
        </select>
      </label>
      <label className="block">
        <span className="label block mb-1">Potentiel</span>
        <select name="potential" defaultValue={doctor?.potential ?? ""} className="select h-9">
          <option value="">Non classé</option>
          <option value="A">A — Très fort potentiel</option>
          <option value="B">B — Potentiel moyen</option>
          <option value="C">C — Faible potentiel</option>
        </select>
      </label>
      <label className="block">
        <span className="label block mb-1">Fréquence de visite recommandée (j)</span>
        <input name="visitFrequencyDays" type="number" defaultValue={doctor?.visitFrequencyDays ?? ""} placeholder="Défaut des réglages" className="input h-9" />
      </label>
      {options.brands && options.brands.length > 0 && (
        <div className="block sm:col-span-2">
          <span className="label block mb-1">Marques concernées</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {options.brands.map((b) => <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" name="brandIds" value={b.id} defaultChecked={doctor?.brandIds?.includes(b.id)} />{b.name}</label>)}
          </div>
        </div>
      )}
      <label className="block sm:col-span-2"><span className="label block mb-1">Commentaires</span><textarea name="comments" defaultValue={doctor?.comments ?? ""} className="input min-h-16" /></label>
      <label className="block sm:col-span-2"><span className="label block mb-1">Notes du délégué</span><textarea name="notes" defaultValue={doctor?.notes ?? ""} className="input min-h-16" /></label>
    </div>
  );
}
