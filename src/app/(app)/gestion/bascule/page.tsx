import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireAccessContext } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { controlReport, cutoverChecklist } from "@/lib/gestion/cutover";
import { cutoverBlockers } from "@/lib/gestion/receivables-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Badge, Card } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { importRepriseAction, setModeAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bascule" };

const MODE = { OFF: { label: "Sage fait foi", tone: "gray" }, PARALLELE: { label: "Période parallèle", tone: "purple" }, ACTIF: { label: "COMANET OS émet", tone: "green" } } as const;

export default async function CutoverPage(props: { searchParams: Promise<{ month?: string; error?: string; done?: string; reprise?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "administration", "view")) redirect(a.home);
  const isAdmin = can(a.perms, "administration", "validate");
  const sp = await props.searchParams;
  const g = (await getSettings()).gestion;
  const t = iso(today());
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : t.slice(0, 7);
  const [checks, report] = await Promise.all([cutoverChecklist(g), controlReport(month)]);
  const blockers = cutoverBlockers(checks);
  const c = g.cutover;
  const prevMonth = (() => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const nextMonth = (() => { const d = new Date(`${month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Bascule depuis Sage"
        subtitle={`Sites ${c.sites.join(", ")} · date prévue ${c.date ? fmtDate(c.date) : "non fixée"}. Les autres sites (Cospharma, Pharmafirst) restent importés.`}>
        <GestionTabs current="/gestion/bascule" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Mode enregistré : {MODE[sp.done as keyof typeof MODE]?.label ?? sp.done}.</div>}
      {sp.reprise && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{sp.reprise}</div>}

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 mb-4">
        <Card title="Contrôles avant la bascule">
          <ul className="space-y-2 text-[13px]">
            {checks.map((k) => (
              <li key={k.key} className="flex gap-2">
                <span className={`mt-0.5 ${k.ok ? "text-green" : k.blocking ? "text-red" : "text-orange"}`}>{k.ok ? "✓" : k.blocking ? "✕" : "!"}</span>
                <div><div className="font-medium">{k.label}{!k.ok && k.blocking && <span className="text-red text-[11px] font-normal"> · bloquant</span>}</div><div className="text-muted text-[12px]">{k.detail}</div></div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Mode">
            <div className="space-y-3 text-[13px]">
              <div className="flex items-center gap-2">Actuel : <Badge tone={MODE[c.mode].tone}>{MODE[c.mode].label}</Badge></div>
              <ul className="text-[12px] text-muted space-y-1">
                <li><b>Sage fait foi</b> : les pièces saisies ici sont des tests (séries SIM).</li>
                <li><b>Période parallèle</b> (décembre) : on saisit tout en double, en simulation, puis on compare avec le rapport de contrôle.</li>
                <li><b>COMANET OS émet</b> : à partir du {c.date ? fmtDate(c.date) : "jour de bascule"}, pièces légales (BL / FA / AV), ventes alimentées par COMANET OS, import Sage refusé pour ces sites, stock lu dans le journal.</li>
              </ul>
              {isAdmin && (
                <div className="space-y-2 pt-2 border-t border-line">
                  {c.mode !== "OFF" && <form action={setModeAction}><input type="hidden" name="mode" value="OFF" /><button className="btn-ghost btn-sm" type="submit">Revenir à « Sage fait foi »</button></form>}
                  {c.mode !== "PARALLELE" && <form action={setModeAction}><input type="hidden" name="mode" value="PARALLELE" /><button className="btn-secondary btn-sm" type="submit">Passer en période parallèle</button></form>}
                  {c.mode !== "ACTIF" && (
                    <form action={setModeAction} className="space-y-1">
                      <input type="hidden" name="mode" value="ACTIF" />
                      {blockers.length > 0 ? <p className="text-red text-[12px]">Bloqué : {blockers.map((b) => b.label.toLowerCase()).join(", ")}.</p> : <p className="text-[12px] text-muted">Tapez BASCULER pour confirmer. Réversible (retour à la période parallèle), mais les pièces légales émises restent.</p>}
                      <div className="flex gap-2"><input name="confirm" className="input h-9" placeholder="BASCULER" autoComplete="off" disabled={blockers.length > 0} /><button className="btn-primary btn-sm" type="submit" disabled={blockers.length > 0}>Activer la bascule</button></div>
                    </form>
                  )}
                  <p className="text-[11.5px] text-faint">Date et sites : <Link href="/parametres/gestion#politiques" className="text-accent hover:underline">Paramètres → Gestion commerciale</Link> · prochains numéros : même page, « Numérotation ».</p>
                </div>
              )}
            </div>
          </Card>
          <Card title="Reprise des factures ouvertes de Sage">
            <div className="text-[13px] space-y-2">
              <p className="text-muted text-[12.5px]">Au jour de la bascule : exportez de Sage l&apos;état des factures non soldées (code client, n° pièce, date, échéance, montant TTC, reste à payer). Chaque facture devient une pièce figée, encaissée et relancée ensuite dans COMANET OS — sans être recomptée dans les ventes.</p>
              {isAdmin && (
                <form action={importRepriseAction} className="space-y-2">
                  <input type="file" name="file" accept=".xlsx,.xls,.csv" className="block text-[12px]" required />
                  <button className="btn-secondary btn-sm" type="submit">Reprendre les factures</button>
                </form>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card title={`Rapport de contrôle — ${fmtDate(`${month}-01`).replace(/^1 /, "")}`} action={<span className="flex gap-2"><Link href={`/gestion/bascule?month=${prevMonth}`} className="btn-ghost btn-sm">← Mois précédent</Link><Link href={`/gestion/bascule?month=${nextMonth}`} className="btn-ghost btn-sm">Mois suivant →</Link></span>}>
        <p className="text-[12.5px] text-muted mb-3">COMANET OS (pièces du mois, simulation comprise) contre Sage (ventes importées) pour les sites qui basculent. Un écart d&apos;un centime par pièce au plus est un écart d&apos;arrondi, pas une anomalie.</p>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead><tr className="text-faint border-b border-line text-right"><th className="px-2 py-2 text-left font-medium">Site</th><th className="px-2 py-2 font-medium">CA HT COMANET OS</th><th className="px-2 py-2 font-medium">CA HT Sage</th><th className="px-2 py-2 font-medium">Écart</th><th className="px-2 py-2 font-medium">BL OS / Sage</th><th className="px-2 py-2 font-medium">Factures OS / Sage</th><th className="px-2 py-2 font-medium">Avoirs OS</th></tr></thead>
            <tbody>
              {report.sites.map((r) => (
                <tr key={r.site} className="border-b border-line last:border-0 text-right">
                  <td className="px-2 py-2 text-left font-medium">{r.site}</td><td className="px-2 py-2">{fmtMoney(r.osHt)}</td><td className="px-2 py-2">{fmtMoney(r.sageHt)}</td>
                  <td className={`px-2 py-2 ${Number(r.gap) === 0 ? "text-green" : r.rounding ? "text-orange" : "text-red"}`}>{fmtMoney(r.gap)}{r.rounding ? " (arrondi)" : ""}</td>
                  <td className="px-2 py-2">{r.osBl} / {r.sageBl}</td><td className="px-2 py-2">{r.osFa} / {r.sageFa}</td><td className="px-2 py-2">{r.osAv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4 className="font-medium text-[13px] mb-2">Stock : journal (fin de mois) contre dernière photo Sage du mois — {report.stockGaps} écart(s)</h4>
        {report.stock.filter((s) => s.gap !== null && Number(s.gap) !== 0).length === 0 ? <p className="text-[12.5px] text-muted">{report.stock.some((s) => s.photo !== null) ? "Aucun écart sur les articles photographiés." : "Aucune photo de stock Sage de l'entrepôt ce mois-ci : importez-en une (Imports → Stock) pour comparer."}</p> : (
          <table className="w-full text-[12.5px] tabular-nums">
            <thead><tr className="text-faint border-b border-line text-right"><th className="px-2 py-2 text-left font-medium">Article</th><th className="px-2 py-2 font-medium">Journal</th><th className="px-2 py-2 font-medium">Photo Sage</th><th className="px-2 py-2 font-medium">Écart</th></tr></thead>
            <tbody>{report.stock.filter((s) => s.gap !== null && Number(s.gap) !== 0).slice(0, 200).map((s) => (
              <tr key={s.productId} className="border-b border-line last:border-0 text-right"><td className="px-2 py-1.5 text-left"><Link href={`/produits/${s.productId}`} className="hover:underline">{s.product}</Link></td><td className="px-2 py-1.5">{Number(s.ledger).toLocaleString("fr-FR")}</td><td className="px-2 py-1.5">{Number(s.photo).toLocaleString("fr-FR")}{s.photoDate ? <span className="text-faint"> ({fmtDate(s.photoDate)})</span> : null}</td><td className={`px-2 py-1.5 ${Number(s.gap) < 0 ? "text-red" : "text-green"}`}>{Number(s.gap).toLocaleString("fr-FR")}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
