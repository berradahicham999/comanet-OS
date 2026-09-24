import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can, requireAccessContext } from "@/lib/access";
import { auditTrail } from "@/lib/audit";
import { listBrands } from "@/lib/users";
import { gapAnalysis, getCount } from "@/lib/gestion/counts";
import { COUNT_STATUS_META, countStats, type CountStatus } from "@/lib/gestion/counts-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, fmtTime } from "@/lib/format";
import { PageHeader, Card, Badge, Kpi } from "@/components/ui";
import { AuditTrail } from "@/components/gestion/audit-trail";
import { CountReconcile } from "@/components/gestion/count-reconcile";
import { cancelCountAction, deleteCountAction, setReasonAction, startCountAction, updateCountAction, validateCountAction, zeroUncountedAction } from "../actions";

export const dynamic = "force-dynamic";

const Banner = ({ tone, children }: { tone: "red" | "green" | "orange"; children: React.ReactNode }) => (
  <div className={`mb-4 rounded-2xl px-4 py-3 text-[13px] border ${tone === "red" ? "bg-red-soft border-red/30 text-red" : tone === "green" ? "bg-green-soft border-green/30 text-green" : "bg-orange-soft border-orange/30 text-orange"}`}>{children}</div>
);

export default async function CountPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string; started?: string; validated?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "stock", "view")) redirect(a.home);
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getCount(id);
  if (!c) notFound();
  const status = c.status as CountStatus;
  const canCreate = can(a.perms, "stock", "create");
  const canValidate = can(a.perms, "stock", "validate");
  const [history, reasons] = await Promise.all([
    auditTrail("stock_count", id),
    db.execute<{ key: string; label: string }>(sql`select key, label from count_gap_reasons where active order by sort, key`),
  ]);
  const stats = status === "VALIDE" && c.stats ? (c.stats as ReturnType<typeof countStats>) : countStats(c.lines.map((l) => ({ theoreticalQty: l.theoreticalQty, countedQty: l.counted, cmup: l.cmup })));
  const analysis = status !== "BROUILLON" && canValidate ? await gapAnalysis(id) : [];
  const counted = c.lines.filter((l) => l.counted !== null).length;
  const gapsWithoutReason = c.lines.filter((l) => l.counted !== null && Number(l.gapQty) !== 0 && !l.reasonKey).length;
  // Un compteur sans le droit de valider ne voit pas le théorique d'un inventaire à l'aveugle en cours.
  const hideTheory = c.blind && status === "EN_COURS" && !canValidate;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/gestion/inventaires" className="hover:underline">Inventaires</Link>}
        title={<span className="flex items-center gap-2 flex-wrap">{c.title}{c.number && <span className="font-mono text-[14px] text-muted">{c.number}</span>}<Badge tone={COUNT_STATUS_META[status].tone}>{COUNT_STATUS_META[status].label}</Badge>{c.blind && <Badge tone="gray">à l&apos;aveugle</Badge>}</span>}
        subtitle={`${c.warehouseKey} · ${fmtDate(c.countDate)} · ${c.brands.length ? c.brands.map((b) => b.name).join(", ") : "tout le stock"}${c.startedAt ? ` · théorique figé le ${fmtDate(c.startedAt)} à ${fmtTime(c.startedAt)}` : ""}`}
        actions={status === "EN_COURS" && canCreate ? <Link href={`/gestion/inventaires/${id}/compter`} className="btn-primary btn-sm">Compter</Link> : undefined}
      />
      {sp.error && <Banner tone="red">{sp.error}</Banner>}
      {sp.done && <Banner tone="green">Enregistré.</Banner>}
      {sp.started && <Banner tone="green">Comptage ouvert : le stock théorique est figé. Les compteurs ouvrent « Compter » sur leur téléphone.</Banner>}
      {sp.validated && <Banner tone="green">Inventaire validé : les écarts sont passés en ajustements dans le journal de stock.</Banner>}
      {c.cancelReason && <Banner tone="orange">Annulé : {c.cancelReason}</Banner>}

      {status === "BROUILLON" ? (
        <div className="grid lg:grid-cols-[1fr_340px] gap-4">
          <Card title="Préparation">
            {canCreate ? (
              <form action={updateCountAction} className="space-y-3 text-[13px]">
                <input type="hidden" name="id" value={id} />
                <label className="block"><span className="label block mb-1">Nom</span><input name="title" defaultValue={c.title} className="input h-9" required /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label block mb-1">Date du comptage</span><input type="date" name="countDate" defaultValue={c.countDate} className="input h-9" required /></label>
                  <input type="hidden" name="warehouseKey" value={c.warehouseKey} />
                  <div><span className="label block mb-1">Dépôt</span><div className="h-9 flex items-center">{c.warehouseKey}</div></div>
                </div>
                <div><span className="label block mb-1">Marques (aucune cochée = tout le stock)</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">{(await listBrands()).map((b) => <label key={b.id} className="flex items-center gap-1"><input type="checkbox" name="brandIds" value={b.id} defaultChecked={c.brandIds.includes(b.id)} /> {b.name}</label>)}</div></div>
                <label className="flex items-center gap-2"><input type="checkbox" name="blind" defaultChecked={c.blind} /> À l&apos;aveugle</label>
                <label className="block"><span className="label block mb-1">Consignes</span><textarea name="notes" defaultValue={c.notes ?? ""} className="input min-h-14 py-2" /></label>
                <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>
              </form>
            ) : <p className="text-[13px] text-muted">En préparation.</p>}
          </Card>
          {canCreate && (
            <div className="space-y-4">
              <Card title="Démarrer le comptage">
                <form action={startCountAction} className="space-y-2 text-[13px]">
                  <input type="hidden" name="id" value={id} />
                  <p className="text-muted">Le stock théorique de chaque article et lot du périmètre est figé à cet instant. Idéalement, plus aucun BL ni réception n&apos;est validé sur ce dépôt jusqu&apos;à la fin du comptage : sinon l&apos;écart le signalera.</p>
                  <button className="btn-primary btn-sm" type="submit">Démarrer</button>
                </form>
              </Card>
              <form action={deleteCountAction} className="flex justify-end"><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer cette préparation</button></form>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Lignes comptées" value={`${counted} / ${c.lines.length}`} sub={stats.uncounted ? `${stats.uncounted} non comptée(s) : pas d'ajustement` : "tout est compté"} />
            {!hideTheory && <Kpi label="Fiabilité (lignes)" value={stats.accuracyLines !== null ? `${stats.accuracyLines.toLocaleString("fr-FR")} %` : "—"} sub={`${stats.withGap} ligne(s) en écart`} />}
            {!hideTheory && <Kpi label="Fiabilité (valeur)" value={stats.accuracyValue !== null ? `${stats.accuracyValue.toLocaleString("fr-FR")} %` : "—"} sub={`théorique ${fmtMoney(stats.valueTheoretical, 0)} MAD`} />}
            {!hideTheory && <Kpi label="Écart net" value={`${fmtMoney(stats.gapValueNet, 0)} MAD`} sub={`en valeur absolue ${fmtMoney(stats.gapValueAbs, 0)} MAD${stats.missingCost ? ` · ${stats.missingCost} sans CMUP` : ""}`} />}
          </div>

          {status === "EN_COURS" && canValidate && (
            <Card title="Clôture">
              <div className="flex flex-wrap gap-3 items-start text-[13px]">
                <form action={zeroUncountedAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit" disabled={!stats.uncounted}>Non comptés → 0 ({stats.uncounted})</button>
                  <p className="text-[11.5px] text-faint mt-1 max-w-64">Seulement si ces rayons ont été vérifiés vides : sinon, laissez-les non comptés (aucun ajustement).</p></form>
                <form action={validateCountAction}><input type="hidden" name="id" value={id} /><button className="btn-primary btn-sm" type="submit" disabled={gapsWithoutReason > 0 || counted === 0}>Valider l&apos;inventaire</button>
                  <p className="text-[11.5px] text-faint mt-1 max-w-64">{gapsWithoutReason ? `${gapsWithoutReason} écart(s) sans motif.` : "Chaque écart devient un ajustement du journal, à la date du comptage."}</p></form>
                <form action={cancelCountAction} className="flex gap-2 items-start ml-auto"><input type="hidden" name="id" value={id} /><input name="reason" className="input h-8 w-52" placeholder="Motif d'annulation" required /><button className="btn-ghost btn-sm text-red" type="submit">Annuler</button></form>
              </div>
              {c.counters.length > 0 && <p className="text-[12px] text-muted mt-3">Compteurs : {c.counters.map((x) => `${x.name} (${x.entries})`).join(", ")}</p>}
            </Card>
          )}

          {!hideTheory ? (
            <Card title={status === "VALIDE" ? "Résultat" : "Rapprochement"}>
              <CountReconcile countId={id} lines={c.lines} reasons={reasons.rows} editable={status === "EN_COURS" && canValidate} save={setReasonAction} />
            </Card>
          ) : (
            <Card title="Comptage à l'aveugle"><p className="text-[13px] text-muted">Le rapprochement avec le stock théorique est réservé à la personne qui valide l&apos;inventaire.</p></Card>
          )}

          {analysis.length > 0 && (
            <Card title="Pistes d'explication des écarts">
              <p className="text-[12px] text-muted mb-3">Pour chaque écart : des faits mesurés dans l&apos;application (donnée) et ce qu&apos;ils pourraient expliquer (hypothèse). Rien n&apos;est une cause certaine : c&apos;est une liste de choses à vérifier.</p>
              <ul className="space-y-3 text-[13px]">
                {analysis.map((r) => (
                  <li key={r.lineId} className="border-b border-line pb-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.product}{r.lotNumber ? <span className="text-faint font-normal"> · lot {r.lotNumber}</span> : null}</span>
                      <Badge tone={Number(r.gapQty) < 0 ? "red" : "green"}>{Number(r.gapQty) > 0 ? "+" : ""}{Number(r.gapQty).toLocaleString("fr-FR")} u.{r.gapValue ? ` · ${fmtMoney(r.gapValue)} MAD` : ""}</Badge>
                      {r.gapOverOutflows !== null && <span className="text-[12px] text-muted">{r.gapOverOutflows.toLocaleString("fr-FR")} % des sorties de la période ({Number(r.outflows).toLocaleString("fr-FR")} u.)</span>}
                      {r.recurring > 1 && <Badge tone="orange">en écart dans {r.recurring} inventaires</Badge>}
                    </div>
                    {r.leads.length ? (
                      <ul className="mt-1.5 space-y-1">{r.leads.map((l, i) => <li key={i} className="pl-3 border-l-2 border-line"><div><span className="text-faint text-[11px] uppercase tracking-wide">Donnée</span> {l.data}</div><div className="text-muted"><span className="text-faint text-[11px] uppercase tracking-wide">Hypothèse</span> {l.hypothesis}</div></li>)}</ul>
                    ) : <p className="text-muted mt-1">Aucune piste dans les données : BL, réceptions, avoirs, échantillons et lots ne montrent rien d&apos;anormal sur la période. Reste l&apos;erreur de comptage, la casse ou la perte.</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Historique"><AuditTrail rows={history} /></Card>
        </div>
      )}
    </>
  );
}
