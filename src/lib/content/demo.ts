import { sql } from "drizzle-orm";
import { db } from "@/db";
import { contentItems, contentProducts, contentStatusHistory, contentComments, brandValidators } from "@/db/schema";
import { iso, addDays, today } from "@/lib/format";

/**
 * Jeu de démonstration du planning éditorial, calé sur les VRAIES marques et produits en base.
 * Toutes les lignes portent « [DÉMO] » dans les notes de brief : `purgeContentDemo()` les retire
 * (historique, commentaires, produits liés et livrables suivent par cascade). Rien d'autre n'est touché.
 */
export const DEMO_TAG = "[DÉMO]";

const rand = (seed: { v: number }) => { seed.v = (seed.v * 9301 + 49297) % 233280; return seed.v / 233280; };
const pick = <T,>(seed: { v: number }, arr: T[]) => arr[Math.floor(rand(seed) * arr.length)];

export async function seedContentDemo(): Promise<number> {
  const seed = { v: 42 };
  const now = today();
  const [brands, products, users, statuses, platforms, formats, objectives] = await Promise.all([
    db.execute<{ id: string; name: string }>(sql`select id, name from brands where active order by name`),
    db.execute<{ id: string; name: string; brand_id: string }>(sql`select id, name, brand_id from products where active and brand_id is not null order by name`),
    db.execute<{ id: string; name: string; email: string }>(sql`select id, name, email from users where active order by name`),
    db.execute<{ key: string; awaiting: boolean; published: boolean; archived: boolean; production: boolean; sort: number }>(sql`select key, awaiting_validation as awaiting, is_published as published, is_archived as archived, in_production as production, sort from content_statuses where active order by sort`),
    db.execute<{ key: string }>(sql`select key from content_platforms where active order by sort`),
    db.execute<{ key: string }>(sql`select key from content_formats where active order by sort`),
    db.execute<{ key: string }>(sql`select key from content_objectives where active order by sort`),
  ]);
  if (!brands.rows.length || !statuses.rows.length) return 0;
  const byEmail = (frag: string) => users.rows.find((u) => u.email.toLowerCase().startsWith(frag));
  const creators = [byEmail("nasr"), byEmail("demzin"), byEmail("oumaima")].filter((u): u is { id: string; name: string; email: string } => !!u);
  const team = creators.length ? creators : users.rows.slice(0, 3);
  const dg = byEmail("hicham") ?? users.rows[0];
  const st = statuses.rows;
  const first = st[0].key;
  const awaiting = st.find((s) => s.awaiting)?.key ?? first;
  const published = st.find((s) => s.published)?.key ?? first;
  const archived = st.find((s) => s.archived)?.key ?? first;
  const production = st.filter((s) => s.production).map((s) => s.key);
  const validated = st.find((s) => !s.awaiting && !s.published && !s.archived && !s.production && s.sort > (st.find((x) => x.awaiting)?.sort ?? 0))?.key ?? first;

  const angles = ["bénéfices clés", "avant / après", "routine du soir", "témoignage cliente", "conseil pharmacien", "unboxing", "le geste du matin", "3 idées reçues", "question fréquente en officine"];
  const hooks = ["Vous connaissez ce geste du soir ?", "Ce que votre pharmacien ne vous dit pas assez…", "8 semaines. Une différence visible.", "Peau sensible ? Commencez par ça.", "La routine la plus simple qui marche."];
  const ctas = ["Disponible en pharmacie et parapharmacie.", "Demandez conseil à votre pharmacien.", "Commandez auprès de votre délégué COMANET."];
  const start = addDays(now, -20);
  const values: (typeof contentItems.$inferInsert)[] = [];
  const prodOf = new Map<string, { id: string; name: string }[]>();
  for (const p of products.rows) (prodOf.get(p.brand_id) ?? prodOf.set(p.brand_id, []).get(p.brand_id)!).push(p);

  for (let i = 0; i < 36; i++) {
    const brand = brands.rows[i % brands.rows.length];
    const date = addDays(start, Math.floor(i * 1.4) + (i % 3));
    const d = iso(date); const past = date < now;
    const prods = prodOf.get(brand.id) ?? [];
    const product = prods.length ? pick(seed, prods) : null;
    const platform = pick(seed, platforms.rows).key; const format = pick(seed, formats.rows).key;
    // Répartition : le passé est publié / archivé (avec un ou deux retards), le présent en production ou à valider, le futur en idée / brief.
    let status: string;
    if (past) status = i % 9 === 4 ? production[0] ?? first : rand(seed) < 0.25 ? archived : published;
    else if (date < addDays(now, 6)) status = i % 4 === 0 ? awaiting : i % 4 === 1 ? validated : pick(seed, production.length ? production : [first]);
    else status = i % 3 === 0 ? st[Math.min(1, st.length - 1)].key : first;
    const owner = team[i % team.length];
    values.push({
      brandId: brand.id, productId: product?.id ?? null, date: d, publishTime: pick(seed, ["09:30", "12:30", "18:00", "20:00"]),
      deadline: iso(addDays(date, -3)), title: `${product?.name ?? brand.name} — ${pick(seed, angles)}`,
      platform, format, objective: pick(seed, objectives.rows).key, status,
      responsibleId: owner?.id ?? null, validatorId: null, createdById: dg?.id ?? null,
      brief: `${DEMO_TAG} Reprendre l'angle marketing et les allégations autorisées de la fiche produit.`,
      keyMessage: "Un bénéfice, une preuve, un geste.", angle: pick(seed, angles), hook: pick(seed, hooks),
      caption: `${product?.name ?? brand.name} : ${pick(seed, ["une peau plus confortable dès les premiers jours", "le réflexe conseil du pharmacien", "la routine simple qui tient dans la salle de bain"])}. ${pick(seed, ctas)}`,
      hashtags: `#${brand.name.toLowerCase().replace(/[^a-z0-9]/g, "")} #pharmacie #dermocosmetique`, cta: pick(seed, ctas),
      constraints: "Packshot net, logo marque en bas à droite, sous-titres si vidéo.", mandatoryMentions: format === "REEL" ? "Sous-titres obligatoires." : null,
      forbiddenClaims: "Aucune allégation thérapeutique (guérit, soigne, traite).", deliverables: format === "STORY" ? "3 stories 1080×1920" : format === "REEL" ? "Reel 15–30 s + couverture" : "Visuel 1080×1350 + légende",
      link: status === published ? "https://www.instagram.com/p/exemple-demo/" : null,
      reach: status === published ? 1200 + Math.floor(rand(seed) * 9000) : null, engagement: status === published ? 40 + Math.floor(rand(seed) * 600) : null,
      publishedAt: status === published ? date : null, archivedAt: status === archived ? addDays(date, 10) : null,
    });
  }
  const rows = await db.insert(contentItems).values(values).returning({ id: contentItems.id, status: contentItems.status, productId: contentItems.productId, responsibleId: contentItems.responsibleId });
  await db.insert(contentProducts).values(rows.filter((r) => r.productId).map((r) => ({ contentId: r.id, productId: r.productId! }))).onConflictDoNothing();
  // Historique plausible : création par le DG, puis l'étape courante par le responsable.
  const hist: (typeof contentStatusHistory.$inferInsert)[] = [];
  for (const r of rows) {
    hist.push({ contentId: r.id, fromStatus: null, toStatus: first, userId: dg?.id ?? null, comment: `${DEMO_TAG} Création` });
    if (r.status !== first) hist.push({ contentId: r.id, fromStatus: first, toStatus: r.status, userId: r.responsibleId, comment: null });
  }
  await db.insert(contentStatusHistory).values(hist);
  const awaitingRows = rows.filter((r) => r.status === awaiting).slice(0, 3);
  if (awaitingRows.length) await db.insert(contentComments).values(awaitingRows.map((r) => ({ contentId: r.id, userId: r.responsibleId, body: `${DEMO_TAG} Livrable prêt, en attente de ton retour.` })));
  // Le DG est validateur de toutes les marques (démo).
  if (dg) await db.insert(brandValidators).values(brands.rows.map((b) => ({ brandId: b.id, userId: dg.id }))).onConflictDoNothing();
  return rows.length;
}

export async function purgeContentDemo(): Promise<number> {
  const r = await db.execute<{ n: number }>(sql`with d as (delete from content_items where brief like ${DEMO_TAG + "%"} returning 1) select count(*)::int as n from d`);
  await db.execute(sql`delete from tasks where source_key like 'content-brief:%' and not exists (select 1 from content_items c where 'content-brief:' || c.id::text = tasks.source_key)`);
  return r.rows[0]?.n ?? 0;
}
