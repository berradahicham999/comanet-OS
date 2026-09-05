import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { getSettings } from "./settings";
import { addDays, iso, today } from "./format";

/**
 * Automatisations « à la demande » (exécutées à l'ouverture des écrans concernés, idempotentes) :
 *  - dossier réglementaire dans le délai de renouvellement → tâche réglementaire ;
 * D'autres automatisations (rapports hebdo, emails) viendront en V3 avec un planificateur.
 */
export async function ensureRegulatoryTasks() {
  const s = await getSettings();
  const t = today();
  const limit = iso(addDays(t, s.regulatoryRenewalDays));
  const r = await db.execute(sql`
    select rf.id, rf.dossier, rf.expiry_date::text as expiry_date, rf.responsible_id, rf.brand_id, p.name as product_name, rf.status::text as status
    from regulatory_files rf left join products p on p.id = rf.product_id
    where rf.expiry_date is not null and rf.expiry_date <= ${limit}::date and rf.status <> 'VALIDE'
      and not exists (select 1 from tasks t where t.source_key = 'regulatory-expiry:' || rf.id::text and t.status in ('TODO','IN_PROGRESS'))
      and not exists (select 1 from tasks t where t.source_key = 'regulatory-expiry:' || rf.id::text and t.status = 'DONE' and t.completed_at > now() - interval '180 days')`);
  const rows = r.rows as { id: string; dossier: string; expiry_date: string; responsible_id: string | null; brand_id: string | null; product_name: string | null; status: string }[];
  let created = 0;
  for (const row of rows) {
    const expiry = new Date(row.expiry_date + "T12:00:00Z");
    const daysLeft = Math.round((expiry.getTime() - t.getTime()) / 86400000);
    const responsible = row.responsible_id ?? (await db.execute(sql`select id from users where role = 'REGLEMENTAIRE' and active limit 1`)).rows[0]?.id as string | undefined;
    await db.insert(tasks).values({
      title: `Renouvellement ${row.dossier}${row.product_name ? " — " + row.product_name : ""}`,
      description: `Autorisation ${daysLeft < 0 ? "expirée depuis " + Math.abs(daysLeft) + " jours" : "expirant dans " + daysLeft + " jours"} (${row.expiry_date}). Tâche créée automatiquement par COMANET OS.`,
      status: "TODO", priority: daysLeft <= 30 ? "CRITICAL" : daysLeft <= 90 ? "HIGH" : "MEDIUM",
      dueDate: iso(addDays(t, Math.max(2, Math.min(14, daysLeft - 60)))),
      assigneeId: responsible ?? null, brandId: row.brand_id, source: "REGLEMENTAIRE", sourceKey: `regulatory-expiry:${row.id}`,
      entityType: "regulatory", entityId: row.id, expectedImpact: "Continuité de commercialisation",
    });
    created++;
  }
  return created;
}
