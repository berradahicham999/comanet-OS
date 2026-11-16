import { Card, Badge } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { webCheckConfigured, webCheckOverview } from "@/lib/places/web-check";
import { WEB_VERDICT_LABELS, fmtDistance, type PlaceKind, type WebVerdict } from "@/lib/places/web-check-shared";
import { mapsUrl } from "@/lib/medical/gps-shared";
import { RunWebChecksButton, UseWebPositionButton } from "./web-check-controls";

const TONE: Record<WebVerdict, "green" | "red" | "orange" | "blue" | "gray" | "yellow"> = {
  CONCORDE: "green", ECART: "red", AMBIGU: "orange", INTROUVABLE: "gray", SOURCE_INTERNET: "blue", SANS_POSITION: "yellow", NON_VERIFIE: "gray",
};
const ORDER: WebVerdict[] = ["CONCORDE", "ECART", "SOURCE_INTERNET", "SANS_POSITION", "AMBIGU", "INTROUVABLE", "NON_VERIFIE"];
const SOURCE_LABEL: Record<string, string> = { PREMIERE_VISITE: "premier démarrage", HISTORIQUE: "historique CRM", MANUELLE: "carte", ADRESSE: "adresse", INTERNET: "Google" };

/**
 * Contrôle Internet des positions (direction) : comptes par verdict, écarts à trancher, lancement d'un lot.
 * Le verdict est calculé à la lecture (`webCheckOverview()`), contre la position actuelle de chaque fiche.
 */
export async function WebCheckPanel({ kind }: { kind: PlaceKind }) {
  const noun = kind === "doctor" ? "cabinets" : "points de vente";
  const cfg = (await getSettings()).webPlaces;
  if (!webCheckConfigured()) {
    return (
      <Card className="mb-6" title={`Positions des ${noun} vérifiées sur Internet`}>
        <p className="text-[13px] text-muted">
          Contrôle désactivé : ajoutez la clé <code>GOOGLE_MAPS_API_KEY</code> (Google Cloud → API « Places API (New) ») dans les variables
          d&apos;environnement Vercel, puis redéployez. Chaque fiche sera alors recherchée sur Google Maps par son nom et sa ville, et sa
          position comparée à celle relevée sur le terrain.
        </p>
      </Card>
    );
  }
  const { rows, counts } = await webCheckOverview(kind);
  const gaps = rows.filter((r) => r.verdict === "ECART").sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0));
  const unsure = rows.filter((r) => (r.verdict === "AMBIGU" || r.verdict === "INTROUVABLE") && r.position);
  const name = (n: string) => (kind === "doctor" ? `Dr ${n}` : n);

  return (
    <Card className="mb-6" title={<span id="positions-internet">Positions des {noun} vérifiées sur Internet (Google Maps)</span>} action={<RunWebChecksButton kind={kind} batch={cfg.batchPerRun || 40} />}>
      <p className="text-[13px] text-muted mb-3">
        Chaque fiche est recherchée sur Google Maps (nom + ville). Une position « à valider » qui concorde avec Google à moins de {fmtDistance(cfg.concordanceM)} est
        validée automatiquement ; une fiche sans position reçoit la position Google, validée seulement quand une visite démarre sur place.
        Une position déjà validée n&apos;est jamais modifiée : un écart s&apos;affiche ici, à vous de trancher. {cfg.batchPerRun} fiches sont vérifiées chaque heure.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {ORDER.filter((v) => counts[v]).map((v) => <Badge key={v} tone={TONE[v]}>{WEB_VERDICT_LABELS[v]} : {counts[v]}</Badge>)}
      </div>

      {gaps.length > 0 ? (
        <div className="table-wrap">
          <table className="tbl text-[12.5px]">
            <thead><tr><th>{kind === "doctor" ? "Médecin" : "Point de vente"}</th><th>Ville</th><th>Position de la fiche</th><th className="num">Écart</th><th>Lieu trouvé sur Google</th><th>Voir</th><th /></tr></thead>
            <tbody>
              {gaps.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{name(r.name)}</td>
                  <td>{r.city ?? "—"}</td>
                  <td>{r.validated ? <Badge tone="green">validée</Badge> : <Badge tone="orange">à valider</Badge>} <span className="text-muted">{r.source ? SOURCE_LABEL[r.source] ?? r.source : ""}</span></td>
                  <td className="num font-medium text-red">{r.distanceM !== null ? fmtDistance(r.distanceM) : "—"}</td>
                  <td>{r.web?.name ?? "—"}<div className="text-[11.5px] text-muted">{r.web?.address}</div></td>
                  <td className="whitespace-nowrap">
                    {r.position && <a className="text-accent-2 hover:underline mr-2" target="_blank" rel="noopener" href={mapsUrl(r.position)}>Fiche</a>}
                    {r.web && <a className="text-accent-2 hover:underline" target="_blank" rel="noopener" href={mapsUrl(r.web)}>Google</a>}
                  </td>
                  <td>{r.web && <UseWebPositionButton kind={kind} id={r.id} lat={r.web.lat} lng={r.web.lng} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {gaps.length > 50 && <p className="mt-2 text-[12px] text-muted">… et {gaps.length - 50} autre(s) écart(s).</p>}
        </div>
      ) : (
        <p className="text-[13px] text-muted">Aucun écart entre les positions des fiches et Google Maps pour l&apos;instant.</p>
      )}

      {unsure.length > 0 && (
        <details className="mt-4 text-[12.5px]">
          <summary className="cursor-pointer text-muted">{unsure.length} fiche(s) avec une position mais rien de sûr sur Google (à contrôler sur la carte)</summary>
          <ul className="mt-2 space-y-1">
            {unsure.slice(0, 100).map((r) => (
              <li key={r.id}>
                <span className="font-medium">{name(r.name)}</span>{r.city ? ` · ${r.city}` : ""} — {WEB_VERDICT_LABELS[r.verdict]}{r.note ? ` : ${r.note}` : ""}
                {r.position && <> · <a className="text-accent-2 hover:underline" target="_blank" rel="noopener" href={mapsUrl(r.position)}>position de la fiche</a></>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
