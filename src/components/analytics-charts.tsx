/**
 * Graphiques de l'analytics marketing rendus côté serveur (SVG pur, sans dépendance) :
 *  - `Matrix` : nuage à deux axes (part du budget × part du CA ; poussé × se vend) ;
 *  - `Bars` : barres horizontales comparatives avec référence.
 * Volontairement simples et lisibles sur téléphone.
 */
import clsx from "clsx";

export type MatrixPoint = { id: string; label: string; x: number; y: number; color?: string; size?: number; href?: string };

export function Matrix({ points, xLabel, yLabel, diagonal = true, quadrants, height = 280, unit = "%" }: {
  points: MatrixPoint[]; xLabel: string; yLabel: string; diagonal?: boolean;
  /** Libellés des quadrants (haut-gauche, haut-droit, bas-gauche, bas-droit) et seuils. */
  quadrants?: { tl: string; tr: string; bl: string; br: string; xSplit: number; ySplit: number };
  height?: number; unit?: string;
}) {
  const W = 560, H = height, P = { l: 44, r: 16, t: 16, b: 36 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const maxX = Math.max(1, ...xs, quadrants?.xSplit ?? 0) * 1.1, maxY = Math.max(1, ...ys, quadrants?.ySplit ?? 0) * 1.1;
  const sx = (v: number) => P.l + (v / maxX) * (W - P.l - P.r);
  const sy = (v: number) => H - P.b - (v / maxY) * (H - P.t - P.b);
  const ticks = (max: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${yLabel} en fonction de ${xLabel}`}>
      {ticks(maxX).map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={P.t} y2={H - P.b} stroke="#e5e7eb" /><text x={sx(t)} y={H - P.b + 14} fontSize="10" fill="#6b7280" textAnchor="middle">{t}{unit}</text></g>)}
      {ticks(maxY).map((t) => <g key={`y${t}`}><line y1={sy(t)} y2={sy(t)} x1={P.l} x2={W - P.r} stroke="#e5e7eb" /><text x={P.l - 6} y={sy(t) + 3} fontSize="10" fill="#6b7280" textAnchor="end">{t}{unit}</text></g>)}
      {diagonal && <line x1={sx(0)} y1={sy(0)} x2={sx(Math.min(maxX, maxY))} y2={sy(Math.min(maxX, maxY))} stroke="#9ca3af" strokeDasharray="4 4" />}
      {quadrants && <>
        <line x1={sx(quadrants.xSplit)} x2={sx(quadrants.xSplit)} y1={P.t} y2={H - P.b} stroke="#9ca3af" strokeDasharray="4 4" />
        <line y1={sy(quadrants.ySplit)} y2={sy(quadrants.ySplit)} x1={P.l} x2={W - P.r} stroke="#9ca3af" strokeDasharray="4 4" />
        <text x={P.l + 6} y={P.t + 12} fontSize="10" fill="#6b7280">{quadrants.tl}</text>
        <text x={W - P.r - 6} y={P.t + 12} fontSize="10" fill="#6b7280" textAnchor="end">{quadrants.tr}</text>
        <text x={P.l + 6} y={H - P.b - 6} fontSize="10" fill="#6b7280">{quadrants.bl}</text>
        <text x={W - P.r - 6} y={H - P.b - 6} fontSize="10" fill="#6b7280" textAnchor="end">{quadrants.br}</text>
      </>}
      <text x={(W + P.l) / 2} y={H - 4} fontSize="11" fill="#374151" textAnchor="middle">{xLabel}</text>
      <text transform={`translate(12 ${(H - P.b + P.t) / 2}) rotate(-90)`} fontSize="11" fill="#374151" textAnchor="middle">{yLabel}</text>
      {points.map((p) => {
        const r = 5 + Math.min(10, Math.sqrt(p.size ?? 0));
        const node = (
          <g key={p.id}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={r} fill={p.color ?? "#0f766e"} fillOpacity="0.75" stroke="white" strokeWidth="1.5"><title>{p.label} : {xLabel} {p.x.toFixed(1)}{unit}, {yLabel} {p.y.toFixed(1)}{unit}</title></circle>
            <text x={sx(p.x) + r + 3} y={sy(p.y) + 3} fontSize="10" fill="#111827">{p.label}</text>
          </g>
        );
        return p.href ? <a key={p.id} href={p.href}>{node}</a> : node;
      })}
    </svg>
  );
}

export function Bars({ rows, max, money = true, refLabel }: { rows: { label: string; value: number | null; ref?: number | null; color?: string; href?: string; sub?: string }[]; max?: number; money?: boolean; refLabel?: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Math.max(r.value ?? 0, r.ref ?? 0)));
  const fmt = (v: number) => (money ? `${Math.round(v).toLocaleString("fr-FR")} MAD` : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="text-xs">
          <div className="flex justify-between gap-2"><span className="truncate text-ink">{r.href ? <a href={r.href} className="hover:underline">{r.label}</a> : r.label}{r.sub && <span className="text-muted"> · {r.sub}</span>}</span><span className="tabular-nums text-ink-2 shrink-0">{r.value === null ? "—" : fmt(r.value)}</span></div>
          <div className="relative h-2 mt-1 rounded bg-black/5">
            {r.value !== null && <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, (r.value / m) * 100)}%`, background: r.color ?? "#0f766e" }} />}
            {r.ref !== null && r.ref !== undefined && <div className={clsx("absolute -top-0.5 h-3 w-0.5 bg-ink")} style={{ left: `${Math.min(100, (r.ref / m) * 100)}%` }} title={refLabel} />}
          </div>
        </div>
      ))}
    </div>
  );
}
