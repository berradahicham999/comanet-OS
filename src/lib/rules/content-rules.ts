import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, iso } from "@/lib/format";
import type { Rule, Recommendation } from "./types";

/**
 * Contenus du planning éditorial en retard.
 *
 * Deux retards, définis dans `src/lib/content/shared.ts` (`lateness()`) et recalculés ici en SQL
 * avec les mêmes drapeaux du référentiel `content_statuses` (aucun nom de statut en dur) :
 *  - deadline du livrable dépassée sans fichier déposé ;
 *  - date de publication passée sans passage à un statut « publié ».
 * La règle émet aussi la notification « deadline dépassée » au responsable, une seule fois par contenu.
 */
export const contentLateRule: Rule = {
  id: "content-late",
  label: "Contenus éditoriaux en retard",
  description: "Livrable non déposé après la deadline, ou publication non confirmée après la date prévue.",
  async run({ now: today }) {
    const t = iso(today);
    const r = await db.execute<{ id: string; title: string; brand: string; brand_id: string; date: string; deadline: string | null; status: string; responsible: string | null; responsible_id: string | null; has_deliverable: boolean; kind: "PUBLICATION" | "LIVRABLE" }>(sql`
      select c.id, c.title, b.name as brand, c.brand_id, c.date::text as date, c.deadline::text as deadline, s.label as status, u.name as responsible, c.responsible_id,
        exists (select 1 from content_assets a where a.content_id = c.id and a.kind = 'LIVRABLE') as has_deliverable,
        case when c.date < ${t}::date then 'PUBLICATION' else 'LIVRABLE' end as kind
      from content_items c join brands b on b.id = c.brand_id join content_statuses s on s.key = c.status left join users u on u.id = c.responsible_id
      where not s.is_published and not s.is_archived
        and (c.date < ${t}::date
             or (c.deadline < ${t}::date and not exists (select 1 from content_assets a where a.content_id = c.id and a.kind = 'LIVRABLE')))
      order by c.date`);
    const rows = r.rows;
    // Notification « deadline dépassée » : une seule par contenu et par responsable.
    const toNotify = rows.filter((x) => x.responsible_id);
    if (toNotify.length) {
      await db.execute(sql`
        insert into notifications (user_id, type, title, body, href, entity_type, entity_id)
        select v.user_id::uuid, 'DEADLINE_PASSED', v.title, v.body, v.href, 'content', v.entity_id::uuid
        from (values ${sql.join(toNotify.map((x) => sql`(${x.responsible_id}, ${`Retard : ${x.title}`}, ${x.kind === "PUBLICATION" ? `Publication prévue le ${fmtDate(x.date)} non confirmée.` : `Livrable attendu le ${fmtDate(x.deadline)} non déposé.`}, ${`/marketing/planning/${x.id}`}, ${x.id})`), sql`, `)}) as v(user_id, title, body, href, entity_id)
        where not exists (select 1 from notifications n where n.type = 'DEADLINE_PASSED' and n.entity_id = v.entity_id::uuid and n.user_id = v.user_id::uuid)`);
    }
    return rows.map((x): Recommendation => ({
      key: `content-late:${x.id}`,
      rule: "content-late",
      category: "MARKETING",
      priority: x.kind === "PUBLICATION" ? "HIGH" : "MEDIUM",
      title: `${x.brand} — ${x.title}`,
      subtitle: x.kind === "PUBLICATION" ? "Publication en retard" : "Livrable en retard",
      facts: [
        { label: "Statut", value: x.status },
        { label: x.kind === "PUBLICATION" ? "Publication prévue" : "Livrable attendu", value: fmtDate(x.kind === "PUBLICATION" ? x.date : x.deadline) },
        { label: "Responsable", value: x.responsible ?? "Non assigné" },
      ],
      why: x.kind === "PUBLICATION"
        ? "La date de publication est passée et le contenu n'est pas marqué publié : soit il n'est pas sorti, soit le planning n'est pas à jour."
        : "La deadline de livraison est dépassée sans fichier déposé : la validation et la publication vont glisser.",
      action: x.kind === "PUBLICATION" ? "Confirmer la publication (lien du post) ou replanifier la date." : "Relancer le responsable, ou déplacer la deadline et la date de publication.",
      task: { title: `Débloquer : ${x.title}`, dueInDays: 1, role: "MARKETING", priority: x.kind === "PUBLICATION" ? "HIGH" : "MEDIUM" },
      entity: { type: "content", id: x.id, href: `/marketing/planning/${x.id}` },
      brandId: x.brand_id,
    }));
  },
};
