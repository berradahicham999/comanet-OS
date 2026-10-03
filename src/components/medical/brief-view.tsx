import type { DoctorBrief } from "@/lib/medical/prescriptions";
import { cityTitle } from "@/lib/medical/prescriptions-shared";

const fmtD = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function Block({ title, tone, children }: { title: string; tone: "data" | "analysis" | "reco"; children: React.ReactNode }) {
  const cls = tone === "data" ? "border-line" : tone === "analysis" ? "border-blue/30 bg-blue-soft/40" : "border-green/30 bg-green-soft/40";
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cls}`}>
      <div className="label mb-1.5">{title}</div>
      <div className="text-[13px] text-ink-2 space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * Fiche pré-visite : Donnée (ce qui est enregistré), Analyse (potentiel et ses motifs), Recommandation
 * (3 produits à présenter, justifiés). Chaque bloc dit son nombre d'observations.
 */
export function BriefView({ brief, compact = false }: { brief: DoctorBrief; compact?: boolean }) {
  const p = brief.prescriptions;
  const computed = p?.potential.computed ?? null;
  return (
    <div className="space-y-2.5">
      {!compact && <div className="text-[13px] text-muted">{[brief.doctor.specialty, cityTitle(brief.doctor.city)].filter(Boolean).join(" · ")}</div>}

      <Block title="Donnée" tone="data">
        {brief.lastReport ? (
          <div>
            <b>Dernière visite ({fmtD(brief.lastReport.date)})</b>
            {brief.lastReport.products.length > 0 && <> · présenté : {brief.lastReport.products.join(", ")}</>}
            {brief.lastReport.interest && <> · intérêt {brief.lastReport.interest.toLowerCase()}</>}
            {brief.lastReport.result && <div>Résultat : {brief.lastReport.result}</div>}
            {brief.lastReport.nextAction && <div>Prochaine action prévue : {brief.lastReport.nextAction}</div>}
          </div>
        ) : <div>Aucune visite réalisée enregistrée.</div>}
        {brief.objections.length > 0 && (
          <div><b>Objections</b> : {brief.objections.map((o) => `${o.text} (${fmtD(o.date)})`).join(" · ")}</div>
        )}
        <div><b>Échantillons déjà remis</b> : {brief.samples.length ? brief.samples.map((x) => `${x.name} × ${x.quantity}`).join(", ") : "aucun"}</div>
        <div>
          <b>Ordonnances</b> : {p && p.observations ? (
            <>{p.observations} ligne(s) du {fmtD(p.firstDate!)} au {fmtD(p.lastDate!)} — {p.products.slice(0, 6).map((x) => `${x.name} (${x.lines})`).join(", ")}</>
          ) : "aucune ordonnance rapprochée de ce médecin."}
        </div>
      </Block>

      <Block title="Analyse" tone="analysis">
        <div>
          <b>Potentiel</b> : {brief.doctor.potential ?? "—"}
          {brief.doctor.potentialSource === "MANUELLE" ? " (saisi à la main)" : brief.doctor.potentialSource === "AUTO" ? " (calculé)" : ""}
          {computed?.level && brief.doctor.potentialSource === "MANUELLE" && computed.level !== brief.doctor.potential && <> — le calcul donnerait {computed.level}</>}
        </div>
        {computed ? computed.reasons.map((r, i) => <div key={i}>• {r}</div>) : <div>Non calculé : aucune ordonnance observée.</div>}
      </Block>

      <Block title={`Recommandation — à présenter${p?.recommendations.peers ? ` (${p.recommendations.peers} pairs observés)` : ""}`} tone="reco">
        {p && p.recommendations.items.length ? (
          <ol className="list-decimal pl-4 space-y-1">
            {p.recommendations.items.map((r) => <li key={r.productId}><b>{r.name}</b>{r.brand ? ` (${r.brand})` : ""} — {r.why}</li>)}
          </ol>
        ) : <div>{p?.recommendations.note ?? "Pas encore d'ordonnances importées : pas de recommandation."}</div>}
        <div className="text-[11px] text-faint">Déduit de ce que prescrivent les médecins de même spécialité : une tendance observée, pas une certitude.</div>
      </Block>
    </div>
  );
}
