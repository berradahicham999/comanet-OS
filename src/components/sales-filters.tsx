import { PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { NO_SECTOR } from "@/lib/sectors";

export type FilterValues = {
  period?: PeriodParam; start?: string; end?: string; brand?: string; channel?: string; rep?: string; type?: string; dim?: string;
  /** Un paramètre `sector` par secteur coché (Next fournit une chaîne ou un tableau). */
  sector?: string | string[];
};

/** Secteurs retenus dans l'URL, sous forme de liste. */
export function selectedSectors(v: FilterValues["sector"]): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).filter(Boolean);
}

export function SalesFilters({ values, options, action, hidden = [] }: {
  values: FilterValues;
  options: { sectors: string[]; channels: string[]; reps: string[]; brands: { id: string; name: string }[] };
  action: string;
  hidden?: string[];
}) {
  const sectors = selectedSectors(values.sector);
  const summary = sectors.length === 0 ? "Tous" : sectors.length === 1 ? (sectors[0] === NO_SECTOR ? "Non affecté" : sectors[0]) : `${sectors.length} secteurs`;
  return (
    <form action={action} method="get" className="card card-pad grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 items-end">
      {values.dim && <input type="hidden" name="dim" value={values.dim} />}
      <label className="text-[12px] col-span-2 xl:col-span-2">
        <span className="label block mb-1">Période</span>
        <select name="period" defaultValue={values.period ?? "month"} className="select h-9">
          {PERIOD_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <label className="text-[12px]">
        <span className="label block mb-1">Du</span>
        <input type="date" name="start" defaultValue={values.start ?? ""} className="input h-9" />
      </label>
      <label className="text-[12px]">
        <span className="label block mb-1">Au</span>
        <input type="date" name="end" defaultValue={values.end ?? ""} className="input h-9" />
      </label>
      {!hidden.includes("brand") && (
        <label className="text-[12px]">
          <span className="label block mb-1">Marque</span>
          <select name="brand" defaultValue={values.brand ?? ""} className="select h-9">
            <option value="">Toutes</option>
            {options.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <label className="text-[12px]">
        <span className="label block mb-1">Canal / site</span>
        <select name="channel" defaultValue={values.channel ?? ""} className="select h-9">
          <option value="">Tous</option>
          {options.channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="text-[12px] relative">
        <span className="label block mb-1">Secteurs</span>
        <details className="group">
          <summary className="select h-9 flex items-center cursor-pointer list-none truncate" title={sectors.join(", ")}>{summary}</summary>
          <div className="absolute z-20 mt-1 w-56 max-h-72 overflow-y-auto card card-pad shadow-lg space-y-1">
            {options.sectors.map((sct) => (
              <label key={sct} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" name="sector" value={sct} defaultChecked={sectors.includes(sct)} /> {sct}
              </label>
            ))}
            <label className="flex items-center gap-2 text-[13px] cursor-pointer text-muted border-t border-line pt-1 mt-1">
              <input type="checkbox" name="sector" value={NO_SECTOR} defaultChecked={sectors.includes(NO_SECTOR)} /> Non affecté
            </label>
          </div>
        </details>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary h-9 flex-1" type="submit">Appliquer</button>
      </div>
    </form>
  );
}
