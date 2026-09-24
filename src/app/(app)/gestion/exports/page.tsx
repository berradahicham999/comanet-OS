import { redirect } from "next/navigation";
import { can, hasFlag, requireAccessContext } from "@/lib/access";
import { PIECES_PER_ZIP, exportPieces } from "@/lib/gestion/exports";
import { fmtMoney } from "@/lib/gestion/money";
import { iso, today } from "@/lib/format";
import { PageHeader, Card, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Envoi au comptable" };

/** Envoi au comptable : les mêmes pièces que les clients (sans UG), par lots de ZIP, et un récapitulatif Excel. */
export default async function ExportsPage(props: { searchParams: Promise<{ month?: string; sim?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view")) redirect(a.home);
  const allowed = (await hasFlag("exportData")) || can(a.perms, "administration", "validate");
  const sp = await props.searchParams;
  const t = iso(today());
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : t.slice(0, 7);
  const sim = sp.sim === "1";
  const pieces = await exportPieces(month, sim);
  const parts = Math.ceil(pieces.length / PIECES_PER_ZIP);
  const q = `month=${month}${sim ? "&sim=1" : ""}`;
  const total = (type: string) => pieces.filter((p) => p.type === type).reduce((s, p) => s + Number(p.ttc), 0);

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Envoi au comptable" subtitle="Les factures et avoirs du mois, en PDF, tels qu'envoyés aux clients (sans UG), et un récapitulatif Excel : journal des ventes, TVA par taux, journal des achats, règlements, balance âgée.">
        <GestionTabs current="/gestion/exports" />
      </PageHeader>
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3 items-end text-[13px]">
          <label className="block"><span className="label block mb-1">Mois</span><input type="month" name="month" defaultValue={month} className="input h-9" /></label>
          <label className="flex items-center gap-2 h-9"><input type="checkbox" name="sim" value="1" defaultChecked={sim} /> Pièces de simulation (période parallèle)</label>
          <button className="btn-secondary btn-sm" type="submit">Afficher</button>
        </form>
      </Card>
      {!allowed ? (
        <Empty title="Export réservé" hint="L'envoi au comptable demande l'interrupteur « Exporter les données » (Utilisateurs & droits) ou le rôle administrateur." />
      ) : pieces.length === 0 ? (
        <Empty title="Aucune pièce ce mois-ci" hint={sim ? "Aucune facture ni avoir de simulation validé ce mois-ci." : "Aucune facture ni avoir validé émis par COMANET OS ce mois-ci. Avant la bascule, les pièces légales sont celles de Sage."} />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title={`${pieces.length} pièce(s)`}>
            <div className="text-[13px] space-y-2">
              <p>{pieces.filter((p) => p.type === "FACTURE").length} facture(s) · {fmtMoney(total("FACTURE").toFixed(2))} MAD TTC</p>
              <p>{pieces.filter((p) => p.type === "AVOIR").length} avoir(s) · {fmtMoney(total("AVOIR").toFixed(2))} MAD TTC</p>
              <div className="flex flex-wrap gap-2 pt-2">
                {Array.from({ length: parts }, (_, i) => (
                  <a key={i} href={`/gestion/exports/zip?${q}&part=${i + 1}`} className="btn-primary btn-sm">PDF {parts > 1 ? `${i * PIECES_PER_ZIP + 1}–${Math.min((i + 1) * PIECES_PER_ZIP, pieces.length)}` : ""} (ZIP)</a>
                ))}
                <a href={`/gestion/exports/recap?${q}`} className="btn-secondary btn-sm">Récapitulatif (Excel)</a>
              </div>
              {parts > 1 && <p className="text-[11.5px] text-faint">Par lots de {PIECES_PER_ZIP} pièces (taille maximale d&apos;un téléchargement).</p>}
            </div>
          </Card>
          <Card title="Pièces">
            <ul className="text-[12.5px] divide-y divide-line max-h-80 overflow-auto">
              {pieces.map((p) => <li key={p.id} className="py-1.5 flex gap-2"><a href={`/gestion/pieces/${p.id}/pdf`} target="_blank" className="font-mono hover:underline">{p.number}</a><span className="text-muted truncate flex-1">{p.client}</span><span className="tabular-nums">{fmtMoney(p.ttc)}</span></li>)}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
