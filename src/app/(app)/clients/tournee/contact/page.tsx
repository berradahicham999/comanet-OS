import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, clientFilter, canDo } from "@/lib/access";
import { iso, today } from "@/lib/format";
import { pgArray } from "@/lib/sql-array";
import { PageHeader, Card, Empty } from "@/components/ui";
import { VISIT_RESULTS } from "@/lib/crm/visits-shared";
import { assignableUsers } from "@/lib/crm/portfolio";
import { logContactAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Noter un contact" };

/**
 * Appel ou message (WhatsApp, e-mail) noté après coup : il entre dans la chronologie du client, pas dans la
 * progression des visites (réglable dans Paramètres → CRM commercial). Une visite physique se chronomètre
 * depuis Ma tournée ; seul un manager (Valider sur Clients) ressaisit une visite faite sans chrono.
 */
export default async function ContactPage(props: { searchParams: Promise<{ client?: string; error?: string }> }) {
  const user = await requireAccess("clients");
  const sp = await props.searchParams;
  const [canCreate, manage, scope] = await Promise.all([canDo("clients", "create"), canDo("clients", "validate"), clientFilter()]);
  if (!canCreate) return <Empty title="Droit « Créer » sur Clients requis" hint="Demandez-le à la direction (Paramètres → Utilisateurs)." />;
  const clients = await db.execute<{ id: string; name: string; city: string | null; mine: boolean }>(sql`
    select c.id, c.name, c.city, (c.account_manager_id = ${user.id}::uuid) as mine from clients c
    where c.active ${scope ? (scope.length ? sql`and c.id = any(${pgArray(scope)})` : sql`and false`) : sql``}
    order by (c.account_manager_id = ${user.id}::uuid) desc nulls last, c.name limit 3000`);
  const users = manage ? await assignableUsers() : [];
  const d = iso(today());
  return (
    <>
      <PageHeader eyebrow={<Link href="/clients/tournee" className="hover:underline">Ma tournée</Link>} title="Noter un contact" subtitle="Appel ou message : il rejoint la chronologie du client. Une visite se démarre et se termine depuis Ma tournée." />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <Card className="max-w-xl">
        <form action={logContactAction} className="space-y-3 text-[13px]">
          <label className="block"><span className="label block mb-1">Client</span>
            <select name="clientId" required defaultValue={sp.client ?? ""} className="select h-11">
              <option value="" disabled>Choisir…</option>
              {clients.rows.map((c) => <option key={c.id} value={c.id}>{c.mine ? "★ " : ""}{c.name}{c.city ? ` — ${c.city}` : ""}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label block mb-1">Type</span>
              <select name="kind" defaultValue="APPEL" className="select h-11">
                <option value="APPEL">Appel</option>
                <option value="MESSAGE">Message (WhatsApp, e-mail)</option>
                {manage && <option value="VISITE">Visite faite sans chrono (ressaisie)</option>}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={d} max={d} required className="input h-11" /></label>
          </div>
          {manage && (
            <label className="block"><span className="label block mb-1">Commerciale concernée</span>
              <select name="userId" defaultValue={user.id} className="select h-11">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
          )}
          <label className="block"><span className="label block mb-1">Résultat</span>
            <input name="result" list="crm-results" className="input h-11" placeholder="ex. Commande à venir" />
            <datalist id="crm-results">{VISIT_RESULTS.map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <label className="block"><span className="label block mb-1">Commentaire</span><textarea name="comment" className="textarea min-h-[72px]" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="label block mb-1">Prochaine action</span><input name="nextAction" className="input h-11" /></label>
            <label className="block"><span className="label block mb-1">Prochaine visite</span><input type="date" name="nextVisitDate" min={d} className="input h-11" /></label>
          </div>
          <button className="btn-primary w-full h-11">Enregistrer</button>
        </form>
      </Card>
    </>
  );
}
