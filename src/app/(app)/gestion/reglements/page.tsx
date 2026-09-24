import Link from "next/link";
import { redirect } from "next/navigation";
import { can, clientFilter, requireAccessContext } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listPayments, openInvoices, toDeposit } from "@/lib/gestion/payments";
import { AGING_BUCKETS, AGING_LABELS, PAYMENT_STATUS_META, agedBalance } from "@/lib/gestion/receivables-shared";
import { emitsReal } from "@/lib/gestion/documents-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Badge, Card, Empty, Kpi, Tabs } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { setPaymentStatusAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Règlements" };

const TABS = [["reglements", "Règlements"], ["echeancier", "Échéancier"], ["balance", "Balance âgée"], ["banque", "À remettre en banque"]] as const;

export default async function PaymentsPage(props: { searchParams: Promise<{ tab?: string; error?: string; done?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view")) redirect(a.home);
  const sp = await props.searchParams;
  const tab = (TABS.map((t) => t[0]) as string[]).includes(sp.tab ?? "") ? sp.tab! : "reglements";
  const g = (await getSettings()).gestion;
  const t = iso(today());
  // Avant la bascule, règlements et factures sont des simulations ; après, des pièces réelles.
  const simulation = !emitsReal(g.cutover, { date: t, site: g.cutover.sites[0] ?? "COMANET" });
  const scope = await clientFilter();
  const [payments, open, deposit] = await Promise.all([listPayments({ clientIds: scope }), openInvoices({ clientIds: scope, simulation }), toDeposit(g.receivables.depositLeadDays)]);
  const aged = agedBalance(open.map((i) => ({ clientId: i.clientId, dueDate: i.dueDate, balance: i.balance })), t);
  const sum = (xs: string[]) => xs.reduce((s, x) => s + Number(x), 0);
  const overdue = open.filter((i) => (i.daysLate ?? 0) > 0);
  const portfolio = payments.filter((p) => p.status === "PORTEFEUILLE" || p.status === "REMIS");
  const canCreate = can(a.perms, "facturation", "create");
  const canEdit = can(a.perms, "facturation", "edit");
  const names = new Map(open.map((i) => [i.clientId, { name: i.client, city: i.city }]));

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Règlements"
        subtitle={`Encaissements, échéances et relances${simulation ? " — période de simulation : règlements et factures de simulation, sans valeur légale" : ""}.`}
        actions={<span className="flex gap-2 flex-wrap"><Link href="/gestion/relances" className="btn-secondary btn-sm">Relances</Link>{canCreate && <Link href="/gestion/reglements/nouveau" className="btn-primary btn-sm">+ Règlement</Link>}</span>}>
        <GestionTabs current="/gestion/reglements" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Reste à encaisser" value={`${fmtMoney(sum(open.map((i) => i.balance)).toFixed(2), 0)} MAD`} sub={`${open.length} facture(s) ouverte(s)`} />
        <Kpi label="Échu" value={`${fmtMoney(sum(overdue.map((i) => i.balance)).toFixed(2), 0)} MAD`} sub={`${overdue.length} facture(s) en retard`} tone={overdue.length ? "red" : undefined} />
        <Kpi label="En portefeuille / remis" value={`${fmtMoney(sum(portfolio.map((p) => p.amount)).toFixed(2), 0)} MAD`} sub={`${portfolio.length} chèque(s) ou effet(s) pas encore encaissé(s)`} />
        <Kpi label="À remettre en banque" value={String(deposit.length)} sub={`échéance dans ${g.receivables.depositLeadDays} j ou dépassée`} tone={deposit.length ? "orange" : undefined} />
      </div>
      <div className="mb-4"><Tabs current={`/gestion/reglements?tab=${tab}`} tabs={TABS.map(([k, l]) => ({ href: `/gestion/reglements?tab=${k}`, label: l }))} /></div>

      {tab === "reglements" && (payments.length === 0 ? (
        <Empty title="Aucun règlement" hint="Un règlement (chèque, effet, virement, espèces) s'enregistre depuis « + Règlement » ou depuis une facture ; il s'impute sur les factures du client, les plus anciennes d'abord." />
      ) : (
        <DataTable
          columns={[{ key: "number", label: "N°" }, { key: "date", label: "Date" }, { key: "client", label: "Client" }, { key: "mode", label: "Mode" }, { key: "status", label: "Statut" }, { key: "amount", label: "Montant", num: true }, { key: "left", label: "Non imputé", num: true, hideOnMobile: true }]}
          rows={payments.map((p) => {
            const left = Number(p.amount) - Number(p.allocated);
            return {
              id: p.id, href: `/gestion/reglements/${p.id}`, muted: p.status === "ANNULE",
              cells: {
                number: <span className="flex gap-2 items-center"><Link href={`/gestion/reglements/${p.id}`} className="font-mono font-medium hover:underline">{p.number}</Link>{p.isSimulation && <Badge tone="purple">simulation</Badge>}</span>,
                date: fmtDate(p.date), client: p.client, mode: <span>{p.mode}{p.reference ? <span className="text-faint"> · {p.reference}</span> : null}{p.dueDate ? <span className="text-faint"> · éch. {fmtDate(p.dueDate)}</span> : null}</span>,
                status: <Badge tone={PAYMENT_STATUS_META[p.status].tone}>{PAYMENT_STATUS_META[p.status].label}</Badge>,
                amount: <span className="font-medium">{fmtMoney(p.amount)}</span>, left: left > 0.004 ? <span className="text-orange">{fmtMoney(left.toFixed(2))}</span> : "—",
              },
              sort: { number: p.number, date: p.date, client: p.client, amount: Number(p.amount), left },
              search: `${p.number} ${p.client} ${p.reference ?? ""}`,
              filters: { status: p.status, mode: p.modeKey },
            };
          })}
          filters={[
            { key: "status", label: "Statut", options: Object.entries(PAYMENT_STATUS_META).map(([value, m]) => ({ value, label: m.label })) },
            { key: "mode", label: "Mode", options: [...new Map(payments.map((p) => [p.modeKey, p.mode]))].map(([value, label]) => ({ value, label })) },
          ]}
          initialSort={{ key: "date", dir: "desc" }}
          searchPlaceholder="N°, client, référence…"
        />
      ))}

      {tab === "echeancier" && (open.length === 0 ? <Empty title="Aucune facture ouverte" hint="Les factures validées non soldées apparaissent ici, par échéance." /> : (
        <DataTable
          columns={[{ key: "due", label: "Échéance" }, { key: "number", label: "Facture" }, { key: "client", label: "Client" }, { key: "late", label: "Retard", num: true }, { key: "balance", label: "Solde", num: true }, { key: "act", label: "" }]}
          rows={open.map((i) => ({
            id: i.id, href: `/gestion/pieces/${i.id}`,
            cells: {
              due: i.dueDate ? fmtDate(i.dueDate) : "—", number: <span className="font-mono">{i.number}{i.source === "SAGE_REPRISE" && <span className="text-faint font-sans text-[11px]"> · reprise Sage</span>}</span>,
              client: <span>{i.client}{i.city && <span className="text-faint"> · {i.city}</span>}</span>,
              late: i.daysLate && i.daysLate > 0 ? <span className="text-red">{i.daysLate} j</span> : "—", balance: <span className="font-medium">{fmtMoney(i.balance)}</span>,
              act: canCreate ? <Link href={`/gestion/reglements/nouveau?client=${i.clientId}`} className="btn-ghost btn-sm">Encaisser</Link> : null,
            },
            sort: { due: i.dueDate ?? i.date, number: i.number, client: i.client, late: i.daysLate ?? -9999, balance: Number(i.balance) },
            search: `${i.number} ${i.client}`, filters: { bucket: i.bucket },
          }))}
          filters={[{ key: "bucket", label: "Retard", options: AGING_BUCKETS.map((b) => ({ value: b, label: AGING_LABELS[b] })) }]}
          initialSort={{ key: "due", dir: "asc" }}
        />
      ))}

      {tab === "balance" && (aged.size === 0 ? <Empty title="Aucun encours" hint="La balance âgée répartit les soldes des factures ouvertes par ancienneté du retard sur l'échéance." /> : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead><tr className="text-faint border-b border-line"><th className="px-3 py-2 text-left font-medium">Client</th>{AGING_BUCKETS.map((b) => <th key={b} className="px-3 py-2 text-right font-medium">{AGING_LABELS[b]}</th>)}<th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
              <tbody>
                {[...aged].sort((x, y) => Number(y[1].total) - Number(x[1].total)).map(([id, b]) => (
                  <tr key={id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><Link href={`/clients/${id}?tab=infos`} className="hover:underline">{names.get(id)?.name}</Link></td>
                    {AGING_BUCKETS.map((k) => <td key={k} className={`px-3 py-2 text-right ${k !== "NON_ECHU" && Number(b[k]) > 0 ? "text-red" : ""}`}>{Number(b[k]) ? fmtMoney(b[k], 0) : "—"}</td>)}
                    <td className="px-3 py-2 text-right font-semibold">{fmtMoney(b.total, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {tab === "banque" && (deposit.length === 0 ? <Empty title="Rien à remettre" hint={`Les chèques et effets en portefeuille dont l'échéance tombe dans les ${g.receivables.depositLeadDays} prochains jours (ou est passée) apparaissent ici.`} /> : (
        <Card pad={false}>
          <ul className="divide-y divide-line text-[13px]">
            {deposit.map((p) => (
              <li key={p.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <Link href={`/gestion/reglements/${p.id}`} className="font-mono hover:underline">{p.number}</Link>
                <span>{p.client}</span><span className="text-muted">{p.mode}{p.reference ? ` · ${p.reference}` : ""}</span>
                <span className="text-muted">éch. {p.due_date ? fmtDate(p.due_date) : "—"}</span>
                <span className="ml-auto font-medium tabular-nums">{fmtMoney(p.amount)} MAD</span>
                {canEdit && (
                  <form action={setPaymentStatusAction} className="flex gap-1">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="to" value="REMIS" /><input type="hidden" name="date" value={t} /><input type="hidden" name="back" value="/gestion/reglements?tab=banque" />
                    <button className="btn-secondary btn-sm" type="submit">Remis en banque</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
