import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can, clientFilter, clientInScope, requireAccessContext } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { pgArray } from "@/lib/sql-array";
import { openInvoices } from "@/lib/gestion/payments";
import { listPaymentModes } from "@/lib/gestion/refs";
import { emitsReal } from "@/lib/gestion/documents-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { iso, today } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui";
import { PaymentForm } from "@/components/gestion/payment-form";
import { createPaymentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau règlement" };

export default async function NewPaymentPage(props: { searchParams: Promise<{ client?: string; q?: string; error?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "create")) redirect(a.home);
  const sp = await props.searchParams;
  const g = (await getSettings()).gestion;
  const t = iso(today());
  const simulation = !emitsReal(g.cutover, { date: t, site: g.cutover.sites[0] ?? "COMANET" });
  const scope = await clientFilter();
  const clientId = sp.client && /^[0-9a-f-]{36}$/i.test(sp.client) && (await clientInScope(sp.client)) ? sp.client : null;

  if (!clientId) {
    // Choix du client : ceux qui ont des factures ouvertes d'abord, puis recherche par nom.
    const open = await openInvoices({ clientIds: scope, simulation });
    const byClient = new Map<string, { name: string; city: string | null; balance: number; n: number }>();
    for (const i of open) { const c = byClient.get(i.clientId) ?? { name: i.client, city: i.city, balance: 0, n: 0 }; c.balance += Number(i.balance); c.n++; byClient.set(i.clientId, c); }
    const q = (sp.q ?? "").trim();
    const found = q ? (await db.execute<{ id: string; name: string; city: string | null }>(sql`
      select id, name, city from clients where active and (name ilike ${`%${q}%`} or legal_name ilike ${`%${q}%`}) ${scope ? (scope.length ? sql`and id = any(${pgArray(scope)})` : sql`and false`) : sql``} order by name limit 20`)).rows : [];
    return (
      <>
        <PageHeader eyebrow={<Link href="/gestion/reglements" className="hover:underline">Règlements</Link>} title="Nouveau règlement" subtitle="Choisissez le client qui règle." />
        {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Clients avec des factures ouvertes">
            {byClient.size === 0 ? <p className="text-[13px] text-muted">Aucune facture ouverte{simulation ? " (simulation)" : ""}.</p> : (
              <ul className="divide-y divide-line text-[13px]">
                {[...byClient].sort((x, y) => y[1].balance - x[1].balance).map(([id, c]) => (
                  <li key={id}><Link href={`/gestion/reglements/nouveau?client=${id}`} className="flex items-center gap-2 py-2 hover:underline"><span className="flex-1">{c.name}{c.city && <span className="text-faint"> · {c.city}</span>}</span><span className="text-muted">{c.n} facture(s)</span><span className="tabular-nums font-medium">{fmtMoney(c.balance.toFixed(2))} MAD</span></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Autre client (acompte, avance)">
            <form className="flex gap-2 text-[13px]"><input name="q" defaultValue={q} className="input h-9" placeholder="Nom ou raison sociale…" /><button className="btn-secondary btn-sm" type="submit">Chercher</button></form>
            {found.length > 0 && <ul className="mt-2 divide-y divide-line text-[13px]">{found.map((c) => <li key={c.id}><Link href={`/gestion/reglements/nouveau?client=${c.id}`} className="block py-2 hover:underline">{c.name}{c.city && <span className="text-faint"> · {c.city}</span>}</Link></li>)}</ul>}
          </Card>
        </div>
      </>
    );
  }

  const [client, invoices, modes] = await Promise.all([
    db.execute<{ name: string; city: string | null }>(sql`select name, city from clients where id = ${clientId}::uuid`),
    openInvoices({ clientId, simulation }),
    listPaymentModes(),
  ]);
  const c = client.rows[0];
  return (
    <>
      <PageHeader eyebrow={<Link href="/gestion/reglements" className="hover:underline">Règlements</Link>} title={`Règlement — ${c?.name ?? ""}`}
        subtitle={simulation ? "Période de simulation : ce règlement ne s'impute que sur des factures de simulation." : "Le règlement reçoit un numéro RG et s'impute sur les factures choisies."}
        actions={<Link href="/gestion/reglements/nouveau" className="btn-ghost btn-sm">Changer de client</Link>} />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <PaymentForm clientId={clientId} today={t} action={createPaymentAction}
        modes={modes.filter((m) => m.active).map((m) => ({ key: m.key, label: m.label, requiresDueDate: m.requiresDueDate, collectedOnReceipt: m.collectedOnReceipt }))}
        invoices={invoices.map((i) => ({ id: i.id, number: i.number, date: i.date, dueDate: i.dueDate, balance: i.balance, daysLate: i.daysLate, isSimulation: i.isSimulation }))} />
    </>
  );
}
