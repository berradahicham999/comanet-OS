import Link from "next/link";
import clsx from "clsx";
import { Badge } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct } from "@/lib/format";
import { ATTRIBUTION_LABELS, type AttributionMode, type Measured, type MetricUnit } from "@/lib/analytics-marketing/shared";

/**
 * Affichage d'une valeur mesurée : le chiffre avec sa complétude et son mode d'attribution,
 * ou « données insuffisantes » avec la raison, le responsable et le lien pour corriger.
 * Aucune page n'affiche un 0 fabriqué : c'est ce composant qui porte la règle.
 */
export function formatMetric(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "MAD": return fmtMAD(value, { compact: Math.abs(value) >= 100_000 });
    case "PCT": return fmtPct(value, Math.abs(value) < 10 ? 1 : 0);
    case "MULTIPLE": return `${value.toFixed(2)}×`;
    case "RATIO": return value.toFixed(2);
    case "SCORE": return `${Math.round(value)} / 100`;
    case "POINTS": return `${value > 0 ? "+" : ""}${value.toFixed(1)} pt`;
    default: return fmtNum(value);
  }
}

export function Insufficient({ m, compact }: { m: Extract<Measured, { ok: false }>; compact?: boolean }) {
  return (
    <span className={clsx("inline-flex flex-col", compact ? "text-[11px]" : "text-xs")}>
      <span className="font-medium text-ink-2">données insuffisantes</span>
      <span className="text-muted">{m.reason}{m.owner ? ` · ${m.owner}` : ""}</span>
      {m.href && <Link href={m.href} className="text-accent underline-offset-2 hover:underline">{m.href.startsWith("/marketing/analytics/qualite") ? "voir la qualité des données" : "corriger"}</Link>}
    </span>
  );
}

export function MeasuredValue({ m, unit, attribution = "NONE", size = "md" }: { m: Measured<number>; unit: MetricUnit; attribution?: AttributionMode; size?: "sm" | "md" | "lg" }) {
  if (!m.ok) return <Insufficient m={m} compact={size === "sm"} />;
  const cls = size === "lg" ? "text-2xl font-semibold" : size === "md" ? "text-base font-semibold" : "text-sm font-medium";
  return (
    <span className="inline-flex flex-col">
      <span className={clsx(cls, "tabular-nums text-ink")}>{formatMetric(m.value, unit)}</span>
      <span className="text-[11px] text-muted leading-tight">
        {attribution !== "NONE" && <Badge tone={attribution === "MEASURED" ? "green" : "yellow"} className="mr-1">{ATTRIBUTION_LABELS[attribution]}</Badge>}
        {m.completeness !== null && m.completeness !== undefined && m.completeness < 1 && <span>complétude {Math.round(m.completeness * 100)} %</span>}
        {m.note && <span>{m.completeness !== null && m.completeness !== undefined && m.completeness < 1 ? " · " : ""}{m.note}</span>}
      </span>
    </span>
  );
}

export const ANALYTICS_TABS = [
  { href: "/marketing/analytics", label: "Synthèse" },
  { href: "/marketing/analytics/marques", label: "Par marque" },
  { href: "/marketing/analytics/canaux", label: "Par canal" },
  { href: "/marketing/analytics/produits", label: "Par produit" },
  { href: "/marketing/analytics/qualite", label: "Qualité des données" },
];
