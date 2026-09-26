import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { getCharge, listChargeCategories, listCharges } from "@/lib/pnl";
import { CHARGE_GROUPS, MONTHS_SHORT, RECURRENCES, type ChargeGroup } from "@/lib/pnl-shared";
import { listBrands } from "@/lib/users";
import { fmtMAD, today } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { PnlTabs } from "@/components/gestion/gestion-nav";
import { deleteChargeAction, reviseChargeAction, saveChargeAction, stopChargeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charges — P&L" };

const monthLabel = (d: string | null) => (d ? `${MONTHS_SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
const ym = (d: string | null | undefined) => (d ? d.slice(0, 7) : "");

export default async function ChargesPage(props: { searchParams: Promise<{ year?: string; new?: string; edit?: string; error?: string; done?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const now = today();
  const curYear = now.getUTCFullYear();
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= curYear + 1 ? Number(sp.year) : curYear;
  const thisMonth = `${curYear}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [charges, categories, brands, editing] = await Promise.all([
    listCharges(year), listChargeCategories(), listBrands(), sp.edit && /^[0-9a-f-]{36}$/i.test(sp.edit) ? getCharge(sp.edit) : Promise.resolve(null),
  ]);
  const visible = charges.filter((c) => c.yearAmount !== 0);
  const showForm = sp.new === "1" || !!editing;
  const groups = Object.keys(CHARGE_GROUPS) as ChargeGroup[];
  const activeNow = (c: (typeof charges)[number]) => c.recurrence === "MENSUELLE" && ym(c.startMonth) <= thisMonth && (!c.endMonth || ym(c.endMonth) >= thisMonth);
  const monthlyNow = charges.filter(activeNow).reduce((a, c) => a + c.amount, 0);
  const e = editing;

  return (
    <>
      <PageHeader
        eyebrow="P&L"
        title="Charges"
        subtitle="Salaires, loyer, internet, honoraires… Une charge mensuelle se déclare une fois et tombe chaque mois jusqu'à son arrêt ; une augmentation se fait par « Réviser à partir de », l'historique reste juste. Le marketing n'est pas à saisir ici : il vient des budgets et dépenses marketing."
        actions={!showForm ? <Link href={`/gestion/pnl/charges?year=${year}&new=1`} className="btn-primary btn-sm">+ Charge</Link> : undefined}
      >
        <PnlTabs current="/gestion/pnl/charges" year={year} />
      </PageHeader>

      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré. Le P&L est à jour.</div>}

      <div className="flex flex-wrap items-center gap-3 mb-4 text-[13px]">
        <form method="get" className="flex items-center gap-2">
          <select name="year" defaultValue={year} className="select h-9">{[curYear - 2, curYear - 1, curYear, curYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button className="btn-secondary btn-sm h-9">Voir</button>
        </form>
        <span className="text-muted">Charges fixes mensuelles en cours : <b className="text-ink">{fmtMAD(monthlyNow)}</b></span>
      </div>

      {showForm && (
        <Card className="mb-6 max-w-3xl" title={e ? `Modifier — ${e.label}` : "Nouvelle charge"}>
          <form action={saveChargeAction} className="grid sm:grid-cols-2 gap-3 text-[13px]">
            {e && <input type="hidden" name="id" value={e.id} />}
            <input type="hidden" name="year" value={year} />
            <label className="block sm:col-span-2"><span className="label block mb-1">Libellé *</span><input name="label" defaultValue={e?.label ?? ""} className="input h-9" placeholder="ex. Salaire Oumaima, Loyer bureau Casablanca" required /></label>
            <label className="block"><span className="label block mb-1">Poste *</span>
              <select name="categoryKey" defaultValue={e?.categoryKey ?? "SALAIRES"} className="select h-9">
                {groups.map((g) => <optgroup key={g} label={CHARGE_GROUPS[g]}>{categories.filter((c) => c.grp === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Montant HT (MAD) *</span><input name="amount" defaultValue={e?.amount ?? ""} className="input h-9" inputMode="decimal" placeholder="15000" required /></label>
            <label className="block"><span className="label block mb-1">Récurrence</span>
              <select name="recurrence" defaultValue={e?.recurrence ?? "MENSUELLE"} className="select h-9">{Object.entries(RECURRENCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="block"><span className="label block mb-1">Mois (début si mensuelle) *</span><input type="month" name="startMonth" defaultValue={ym(e?.startMonth) || thisMonth} className="input h-9" required /></label>
            <label className="block"><span className="label block mb-1">Mois de fin (mensuelle, facultatif)</span><input type="month" name="endMonth" defaultValue={ym(e?.endMonth)} className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Marque (si charge propre à une marque)</span>
              <select name="brandId" defaultValue={e?.brandId ?? ""} className="select h-9">
                <option value="">Frais communs</option>
                {brands.filter((b) => b.active && !b.mergedIntoId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2"><span className="label block mb-1">Note</span><input name="notes" defaultValue={e?.notes ?? ""} className="input h-9" /></label>
            <div className="sm:col-span-2 flex gap-2">
              <button className="btn-primary btn-sm">{e ? "Enregistrer" : "Ajouter"}</button>
              <Link href={`/gestion/pnl/charges?year=${year}`} className="btn-ghost btn-sm">Annuler</Link>
            </div>
          </form>

          {e && e.recurrence === "MENSUELLE" && (
            <div className="mt-5 pt-4 border-t border-line grid sm:grid-cols-2 gap-4 text-[13px]">
              <form action={reviseChargeAction} className="space-y-2">
                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="year" value={year} />
                <div className="font-medium">Réviser à partir de…</div>
                <p className="text-[12px] text-muted">Augmentation, nouveau loyer : l’ancien montant reste sur les mois passés.</p>
                <div className="flex gap-2">
                  <input type="month" name="fromMonth" defaultValue={thisMonth} className="input h-9" required />
                  <input name="amount" className="input h-9 w-32" inputMode="decimal" placeholder="Nouveau montant" required />
                </div>
                <button className="btn-secondary btn-sm">Réviser</button>
              </form>
              <form action={stopChargeAction} className="space-y-2">
                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="year" value={year} />
                <div className="font-medium">Arrêter la charge</div>
                <p className="text-[12px] text-muted">Départ d’un salarié, résiliation : dernier mois compté.</p>
                <input type="month" name="lastMonth" defaultValue={thisMonth} className="input h-9" required />
                <div><button className="btn-secondary btn-sm">Arrêter</button></div>
              </form>
            </div>
          )}
          {e && (
            <form action={deleteChargeAction} className="mt-4 pt-3 border-t border-line text-[12px] flex items-center gap-2">
              <input type="hidden" name="id" value={e.id} /><input type="hidden" name="year" value={year} />
              <span className="text-muted">Saisie erronée ?</span>
              <button className="text-red hover:underline">Supprimer cette charge</button>
            </form>
          )}
        </Card>
      )}

      {visible.length === 0 ? (
        <Empty
          title={`Aucune charge sur ${year}`}
          hint="Commencez par les charges fixes : salaires (une ligne par personne ou une ligne globale), charges sociales, loyer, internet et téléphone, comptable, véhicules. Déclarées une fois en « mensuelle », elles alimentent tous les mois du P&L."
          action={<Link href={`/gestion/pnl/charges?year=${year}&new=1`} className="btn-primary btn-sm">Saisir la première charge</Link>}
        />
      ) : (
        groups.map((g) => {
          const rows = visible.filter((c) => c.grp === g);
          if (!rows.length) return null;
          return (
            <div key={g} className="mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-semibold text-[14px]">{CHARGE_GROUPS[g]}</h3>
                <span className="text-[12px] text-muted">{year} : <b className="text-ink">{fmtMAD(rows.reduce((a, c) => a + c.yearAmount, 0))}</b></span>
              </div>
              <div className="card overflow-x-auto">
                <table className="tbl w-full text-[13px] tabular-nums">
                  <thead><tr><th className="text-left">Libellé</th><th className="text-left">Poste</th><th className="text-right">Montant</th><th className="text-left">Période</th><th className="text-left">Marque</th><th className="text-right">Sur {year}</th><th /></tr></thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.label}{c.notes && <div className="text-[11px] text-faint font-normal">{c.notes}</div>}</td>
                        <td className="text-muted">{c.categoryLabel}</td>
                        <td className="text-right">{fmtMAD(c.amount, { suffix: false })}{c.recurrence === "MENSUELLE" && <span className="text-faint">/mois</span>}</td>
                        <td>
                          {c.recurrence === "MENSUELLE"
                            ? <span className="inline-flex items-center gap-1.5">{activeNow(c) && <Badge tone="green" dot>en cours</Badge>}depuis {monthLabel(c.startMonth)}{c.endMonth && ` → ${monthLabel(c.endMonth)}`}</span>
                            : monthLabel(c.startMonth)}
                        </td>
                        <td className="text-muted">{c.brandName ?? "—"}</td>
                        <td className="text-right font-medium">{fmtMAD(c.yearAmount, { suffix: false })}</td>
                        <td className="text-right"><Link href={`/gestion/pnl/charges?year=${year}&edit=${c.id}`} className="btn-ghost btn-sm">Modifier</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
