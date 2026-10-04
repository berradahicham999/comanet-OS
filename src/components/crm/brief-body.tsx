import type { VisitBrief } from "@/lib/crm/intelligence";
import { OBJECTIVE_VERDICT_LABELS } from "@/lib/crm/portfolio-shared";

const mad = (v: number | string) => `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} MAD`;
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/**
 * Corps de la fiche pré-visite (rendu serveur ou client) : uniquement des données mesurées ; l'assortiment
 * manquant est une corrélation observée chez des clients comparables, présentée comme telle.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-[13px]"><span className="text-muted shrink-0">{label}</span><span className="text-ink text-right">{children}</span></div>;
}

export function BriefBody({ brief }: { brief: VisitBrief }) {
  const r = brief.rhythm;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {brief.client.contactName && <Row label="Contact">{brief.client.contactName}{brief.client.phone ? ` · ${brief.client.phone}` : ""}</Row>}
        <Row label="Dernière commande">{day(r.lastOrder)}{r.avgIntervalDays ? ` · tous les ${Math.round(r.avgIntervalDays)} j en moyenne` : ""}</Row>
        {r.daysUntilNext !== null && <Row label="Prochaine commande théorique">{r.daysUntilNext < 0 ? <span className="text-red">en retard de {-r.daysUntilNext} j</span> : `dans ${r.daysUntilNext} j`}</Row>}
        <Row label="CA 12 mois (HT)">{mad(r.revenue12)}</Row>
        {brief.objective && <Row label="Objectif du mois">{mad(brief.objective.realized)} / {mad(brief.objective.target)} · {brief.objective.pct === null ? "—" : `${Math.round(brief.objective.pct)} %`} · {OBJECTIVE_VERDICT_LABELS[brief.objective.verdict]}</Row>}
        {brief.receivables && (
          <Row label="Encours (factures)">
            {Number(brief.receivables.outstanding) > 0 ? <>{mad(brief.receivables.outstanding)}{Number(brief.receivables.overdue) > 0 && <span className="text-red"> dont {mad(brief.receivables.overdue)} échu{brief.receivables.oldestDaysLate ? ` (jusqu'à ${brief.receivables.oldestDaysLate} j)` : ""}</span>}</> : "aucun"}
          </Row>
        )}
        {brief.receivables?.lastPayment && <Row label="Dernier règlement">{day(brief.receivables.lastPayment.date)} · {mad(brief.receivables.lastPayment.amount)} · {brief.receivables.lastPayment.mode}</Row>}
        <Row label="Dernier relevé en rayon">{brief.lastReading ? `${day(brief.lastReading.date)} · ${brief.lastReading.products} produit(s), ${brief.lastReading.units} u.` : "jamais relevé"}</Row>
        {brief.salesUpTo && <div className="text-[11px] text-faint">Ventes connues jusqu&apos;au {day(brief.salesUpTo)}.</div>}
      </div>

      {brief.lastVisit && (
        <div>
          <div className="label mb-1">Dernière visite — {day(brief.lastVisit.date)}{brief.lastVisit.who ? ` · ${brief.lastVisit.who}` : ""}</div>
          <div className="text-[13px] text-ink-2">{[brief.lastVisit.result, brief.lastVisit.comment].filter(Boolean).join(" · ") || "Sans compte rendu."}</div>
          {brief.lastVisit.nextAction && <div className="text-[13px] text-ink mt-0.5">Prochaine action prévue : <b>{brief.lastVisit.nextAction}</b></div>}
        </div>
      )}

      {brief.usualProducts.length > 0 && (
        <div>
          <div className="label mb-1">Produits habituels (12 mois)</div>
          <ul className="text-[13px] space-y-0.5">
            {brief.usualProducts.map((p) => <li key={p.name} className="flex justify-between gap-2"><span className="truncate">{p.name}{p.brand ? <span className="text-muted"> · {p.brand}</span> : null}</span><span className="text-muted shrink-0">{Math.round(p.units)} u. · {day(p.lastDate)}</span></li>)}
          </ul>
        </div>
      )}

      <div>
        <div className="label mb-1">Assortiment manquant</div>
        {brief.missing.items.length ? (
          <>
            <ul className="text-[13px] space-y-0.5">
              {brief.missing.items.map((m) => <li key={m.productId} className="flex justify-between gap-2"><span className="truncate">{m.name}{m.brand ? <span className="text-muted"> · {m.brand}</span> : null}</span><span className="text-muted shrink-0">{m.buyers}/{brief.missing.peers} pairs</span></li>)}
            </ul>
            <div className="text-[11px] text-faint mt-1">Corrélation observée : produits achetés par des clients comparables ({brief.missing.basis}) et pas par celui-ci sur 12 mois.</div>
          </>
        ) : <div className="text-[13px] text-muted">Rien à signaler ({brief.missing.basis}).</div>}
      </div>

      {brief.openTasks.length > 0 && (
        <div>
          <div className="label mb-1">Tâches ouvertes</div>
          <ul className="text-[13px] space-y-0.5">{brief.openTasks.map((t) => <li key={t.id}>{t.title}{t.dueDate ? <span className="text-muted"> · {day(t.dueDate)}</span> : null}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
