import Link from "next/link";
import { redirect } from "next/navigation";
import { can, clientFilter, requireAccessContext } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { reminderCandidates } from "@/lib/gestion/payments";
import { reminderText } from "@/lib/gestion/receivables-shared";
import { emitsReal, waPhone } from "@/lib/gestion/documents-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Badge, Card, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { RemindButtons } from "@/components/gestion/remind-buttons";
import { recordReminderAction } from "../reglements/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relances" };

export default async function RemindersPage() {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view")) redirect(a.home);
  const g = (await getSettings()).gestion;
  const simulation = !emitsReal(g.cutover, { date: iso(today()), site: g.cutover.sites[0] ?? "COMANET" });
  const list = await reminderCandidates({ clientIds: await clientFilter(), simulation });
  const canEdit = can(a.perms, "facturation", "edit");
  const company = g.company.legalName || "COMANET";
  const todo = list.filter((c) => c.due), recent = list.filter((c) => !c.due);
  const levels = g.receivables.reminderDays;

  const card = (c: (typeof list)[number]) => (
    <li key={c.clientId} className="py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/clients/${c.clientId}?tab=infos`} className="font-medium hover:underline">{c.client}</Link>
        <Badge tone={c.level >= 3 ? "red" : c.level === 2 ? "orange" : "gray"}>Niveau {c.level}</Badge>
        <span className="text-muted">{c.oldestDays} j de retard au plus</span>
        <span className="ml-auto font-semibold tabular-nums">{fmtMoney(c.overdue)} MAD échu</span>
      </div>
      <div className="text-[12px] text-muted">{c.invoices.map((i) => `${i.number} (${fmtMoney(i.balance)}, ${i.daysLate} j)`).join(" · ")}</div>
      {c.lastReminder && <div className="text-[12px] text-faint">Dernière relance : niveau {c.lastReminder.level}, le {fmtDate(c.lastReminder.sentAt)}</div>}
      {canEdit && <RemindButtons clientId={c.clientId} level={c.level} wa={waPhone(c.phone)} email={c.email} subject={`Factures échues — ${c.client}`}
        text={reminderText(c.level, company, c.client, c.invoices)} invoices={c.invoices.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, balance: i.balance }))} record={recordReminderAction} />}
    </li>
  );

  return (
    <>
      <PageHeader eyebrow={<Link href="/gestion/reglements" className="hover:underline">Règlements</Link>} title="Relances"
        subtitle={`Clients avec des factures échues. Niveau 1 dès ${levels[0]} j de retard, 2 dès ${levels[1]} j, 3 dès ${levels[2]} j ; une relance du même niveau ne se refait pas avant ${g.receivables.reminderCooldownDays} j. Chaque relance est enregistrée.`}>
        <GestionTabs current="/gestion/reglements" />
      </PageHeader>
      {list.length === 0 ? <Empty title="Aucune facture échue" hint="Dès qu'une facture dépasse son échéance, son client apparaît ici avec le message de relance prêt à envoyer." /> : (
        <div className="space-y-4">
          <Card title={`À relancer (${todo.length})`}>{todo.length ? <ul className="divide-y divide-line text-[13px]">{todo.map(card)}</ul> : <p className="text-[13px] text-muted">Tout le monde a été relancé récemment.</p>}</Card>
          {recent.length > 0 && <Card title={`Déjà relancés (${recent.length})`}><ul className="divide-y divide-line text-[13px]">{recent.map(card)}</ul></Card>}
        </div>
      )}
    </>
  );
}
