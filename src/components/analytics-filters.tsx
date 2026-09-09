import { PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";

/**
 * Filtres combinables des pages d'analyse (GET, sans JavaScript) : période, marque, canal, ville.
 * Les valeurs vides sont omises de l'URL.
 */
export function AnalyticsFilters({ period, brand, channel, city, brands, channels, cities, hide = [] }: {
  period: PeriodParam; brand: string | null; channel: string | null; city: string | null;
  brands: { id: string; name: string }[]; channels?: { key: string; label: string }[]; cities?: string[];
  hide?: ("brand" | "channel" | "city")[];
}) {
  const sel = "h-9 rounded-lg border border-line-2 bg-surface px-2 text-sm";
  return (
    <form method="get" className="flex flex-wrap gap-2 items-center mb-4">
      <select name="period" defaultValue={period} className={sel} aria-label="Période">
        {PERIOD_OPTIONS.filter((o) => o.key !== "custom").map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {!hide.includes("brand") && (
        <select name="brand" defaultValue={brand ?? ""} className={sel} aria-label="Marque">
          <option value="">Toutes les marques</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {!hide.includes("channel") && channels && (
        <select name="channel" defaultValue={channel ?? ""} className={sel} aria-label="Canal">
          <option value="">Tous les canaux</option>
          {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}
      {!hide.includes("city") && cities && cities.length > 0 && (
        <select name="city" defaultValue={city ?? ""} className={sel} aria-label="Ville">
          <option value="">Toutes les villes</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <button type="submit" className="btn-ghost btn-sm">Appliquer</button>
    </form>
  );
}
