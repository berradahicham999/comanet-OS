/**
 * Socle : utilisateurs, marques du portefeuille (avec alias) et paramètres.
 *   npm run db:seed:base
 * Idempotent (upsert) — ne touche pas aux ventes / clients / produits.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { MODULE_KEYS } from "@/lib/access-shared";
import { db } from "./index";
import * as s from "./schema";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../lib/settings";

export const BRAND_SEED = [
  { name: "Gamarde", slug: "gamarde", color: "#3f6212", aliases: ["GAMARDE"], positioning: "Dermo-cosmétique bio & naturelle" },
  { name: "Auracos", slug: "auracos", color: "#b45309", aliases: ["AURACOS"], positioning: "Nutricosmétique — Pro Collagenium" },
  { name: "CygneLab", slug: "cygnelab", color: "#6d28d9", aliases: ["CYGNE", "CYGNE LAB", "CYGNELAB"], positioning: "Compléments beauté & bien-être (Beauty Boost, Sweet Dreams)" },
  { name: "Alphascience", slug: "alphascience", color: "#0e7490", aliases: ["ALPHASCIENCE", "ALPHA SCIENCE"], positioning: "Cosméceutique anti-oxydante" },
  { name: "Ainhoa", slug: "ainhoa", color: "#be185d", aliases: ["AINHOA"], positioning: "Cosmétique professionnelle" },
  { name: "Dulcima", slug: "dulcima", color: "#c2410c", aliases: ["DULCIMA"], positioning: "Soins sensoriels" },
  { name: "Makari", slug: "makari", color: "#a16207", aliases: ["MAKARI"], positioning: "Éclat & uniformité du teint" },
  { name: "Poderm", slug: "poderm", color: "#1d4ed8", aliases: ["PODERM"], active: false, positioning: "Pipeline — en développement" },
  { name: "Korres", slug: "korres", color: "#15803d", aliases: ["KORRES"], active: false, positioning: "Pipeline — en développement" },
];

export async function seedBase() {
  const hash = await bcrypt.hash("comanet2026", 10);
  const users = [
    { name: "Hicham", email: "hicham@comanet.ma", role: "ADMIN" as const },
    { name: "Samy", email: "samy@comanet.ma", role: "ADMIN" as const },
    { name: "Nasr", email: "nasr@comanet.ma", role: "MARKETING" as const },
    { name: "Demzin", email: "demzin@comanet.ma", role: "MARKETING" as const },
    { name: "Oumaima", email: "oumaima@comanet.ma", role: "TRADE" as const },
    { name: "Réglementaire", email: "reglementaire@comanet.ma", role: "REGLEMENTAIRE" as const },
    { name: "Animatrice démo", email: "animatrice@comanet.ma", role: "ANIMATRICE" as const },
  ];
  for (const u of users) {
    await db.insert(s.users).values({ ...u, passwordHash: hash }).onConflictDoNothing({ target: s.users.email });
  }
  // Les droits vivent dans la matrice par utilisateur : les deux administrateurs reçoivent
  // tous les modules et tous les interrupteurs, les autres seront configurés depuis l'écran
  // « Utilisateurs & droits » (ou par la migration 0012 s'ils existaient déjà).
  await db.execute(sql`
    insert into user_permissions (user_id, module, can_view, can_create, can_edit, can_validate)
    select u.id, m.module, true, true, true, true
    from users u cross join unnest(array[${sql.join(MODULE_KEYS.map((m) => sql`${m}`), sql`, `)}]::text[]) as m(module)
    where u.role = 'ADMIN'
    on conflict do nothing`);
  await db.execute(sql`
    insert into user_flags (user_id, see_margins, see_global_budgets, see_internal_costs, approve_spend, export_data, read_activity_log)
    select id, true, true, true, true, true, true from users where role = 'ADMIN' on conflict do nothing`);
  await db.execute(sql`insert into user_scope (user_id, scope) select id, 'ALL' from users where role = 'ADMIN' on conflict do nothing`);
  for (const b of BRAND_SEED) {
    await db.insert(s.brands).values(b).onConflictDoUpdate({ target: s.brands.slug, set: { aliases: b.aliases, color: b.color } });
  }
  await db.insert(s.settings).values({ key: SETTINGS_KEY, value: DEFAULT_SETTINGS }).onConflictDoNothing();
  console.log(`✓ ${users.length} utilisateurs, ${BRAND_SEED.length} marques, paramètres par défaut. Connexion : hicham@comanet.ma / comanet2026`);
}

if (require.main === module) {
  seedBase().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
