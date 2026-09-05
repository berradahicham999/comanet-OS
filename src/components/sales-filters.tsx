import { PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";

export type FilterValues = {
  period?: PeriodParam; start?: string; end?: string; brand?: string; city?: string; channel?: string; rep?: string; type?: string; dim?: string;
};

export function SalesFilters({ values, options, action, hidden = [] }: {
  values: FilterValues;
  options: { cities: string[]; channels: string[]; reps: string[]; brands: { id: string; name: string }[] };
  action: string;
  hidden?: string[];
}) {
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
      <label className="text-[12px]">
        <span className="label block mb-1">Ville</span>
        <select name="city" defaultValue={values.city ?? ""} className="select h-9">
          <option value="">Toutes</option>
          {options.cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <button className="btn-primary h-9 flex-1" type="submit">Appliquer</button>
      </div>
    </form>
  );
}
