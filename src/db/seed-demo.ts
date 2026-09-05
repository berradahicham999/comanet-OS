/**
 * Données de DÉMONSTRATION pour les modules non couverts par les imports Sage :
 * terrain, réglementaire, tâches, planning éditorial, campagnes & dépenses.
 * Toutes les entrées portent la marque « [DÉMO] » et se purgent d'un clic (Paramètres).
 *   npm run db:seed:demo
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ri = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const TAG = "[DÉMO]";

export async function purgeDemo() {
  await db.execute(sql`delete from animations where comment like ${TAG + "%"}`);
  await db.execute(sql`delete from regulatory_files where notes like ${TAG + "%"}`);
  await db.execute(sql`delete from tasks where description like ${TAG + "%"}`);
  await db.execute(sql`delete from content_items where brief like ${TAG + "%"}`);
  await db.execute(sql`delete from marketing_expenses where notes like ${TAG + "%"}`);
  await db.execute(sql`delete from campaigns where notes like ${TAG + "%"}`);
  await db.execute(sql`delete from users where email like '%@demo.comanet.ma'`);
}

export async function seedDemo() {
  await purgeDemo();
  const today = new Date(); today.setUTCHours(12, 0, 0, 0);
  const hash = await bcrypt.hash("comanet2026", 10);
  const animUsers = await db.insert(s.users).values([
    { name: "Fatima-Zahra (démo)", email: "fz@demo.comanet.ma", passwordHash: hash, role: "ANIMATRICE" },
    { name: "Imane (démo)", email: "imane@demo.comanet.ma", passwordHash: hash, role: "ANIMATRICE" },
    { name: "Kenza (démo)", email: "kenza@demo.comanet.ma", passwordHash: hash, role: "ANIMATRICE" },
  ]).returning();
  const users = await db.select().from(s.users);
  const U = (role: string) => users.find((u) => u.role === role && !u.email.endsWith("@demo.comanet.ma")) ?? users[0];
  const brands = await db.select().from(s.brands).where(sql`active`);
  const products = await db.select().from(s.products).where(sql`active and brand_id is not null`);
  const topProducts = (await db.execute(sql`select product_id from sales where date >= current_date - 400 group by product_id order by sum(amount) desc limit 40`)).rows.map((r) => (r as { product_id: string }).product_id);
  const prodList = products.filter((p) => topProducts.includes(p.id));
  const clients = (await db.execute(sql`select c.id, c.name from clients c join sales sa on sa.client_id = c.id where c.type <> 'GROSSISTE' and c.active group by c.id, c.name order by sum(sa.amount) desc limit 40`)).rows as { id: string; name: string }[];
  const byBrand = (id: string) => prodList.filter((p) => p.brandId === id);

  // ---- Animations : 90 jours passés + 14 jours à venir
  const animValues: (typeof s.animations.$inferInsert)[] = [];
  for (let d = -90; d <= 14; d++) {
    const date = addDays(today, d);
    if (date.getUTCDay() === 0) continue;
    const n = d === 0 ? 2 : rand() < 0.4 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const brand = pick(brands.filter((b) => byBrand(b.id).length > 0));
      animValues.push({
        date: iso(date), clientId: pick(clients).id, animatriceId: pick(animUsers).id, brandId: brand.id,
        status: d > 0 ? "PLANNED" : "DONE", cost: String(pick([650, 700, 800, 900])), durationHours: "8",
        customersAdvised: d > 0 ? 0 : ri(15, 60), samples: d > 0 ? 0 : ri(10, 50),
        comment: `${TAG} ${pick(["Bonne affluence, forte demande.", "Rayon peu visible, PLV à renforcer.", "Cliente fidèle, réassort demandé.", "Rupture d'un produit en rayon.", "Journée calme, beaucoup d'échantillons distribués."])}`,
      });
    }
  }
  const anims = await db.insert(s.animations).values(animValues).returning();
  const lineValues: (typeof s.animationLines.$inferInsert)[] = [];
  for (const a of anims) {
    if (a.status !== "DONE") continue;
    const prods = byBrand(a.brandId!).slice(0, ri(2, 4));
    for (const p of prods) lineValues.push({ animationId: a.id, productId: p.id, quantitySold: ri(2, 25), stockObserved: ri(0, 30) });
  }
  if (lineValues.length) await db.insert(s.animationLines).values(lineValues);

  // ---- Réglementaire : 1 dossier par produit majeur, échéances réparties
  const regUser = U("REGLEMENTAIRE");
  const expiryPlan = [42, 15, 10, 70, -20, 200, 115, 55, 25, 300, 500, 90, 150, 400, 600, 800, 180, 365, 30, 120];
  const regValues = prodList.slice(0, 20).map((p, i) => {
    const days = expiryPlan[i % expiryPlan.length];
    const expiry = addDays(today, days);
    return {
      productId: p.id, brandId: p.brandId, dossier: /GUMMIES|COLLAGEN|BOOST|DREAMS|IMMUNITY|KIDS/i.test(p.name) ? "Autorisation complément alimentaire" : "Enregistrement produit cosmétique",
      authorizationNumber: `AUT-${ri(1000, 9999)}-${expiry.getUTCFullYear()}`, filingDate: iso(addDays(expiry, -5 * 365 - 90)), validationDate: iso(addDays(expiry, -5 * 365)),
      expiryDate: iso(expiry), status: (days < 0 ? "EXPIRE" : days <= 120 ? "RENOUVELLEMENT" : "VALIDE") as "EXPIRE" | "RENOUVELLEMENT" | "VALIDE",
      missingDocuments: i % 6 === 1 ? "Certificat de vente libre, fiche de sécurité" : i % 6 === 3 ? "Rapport de sécurité (CPSR)" : null,
      responsibleId: regUser.id, notes: `${TAG} dossier fictif`,
    };
  });
  await db.insert(s.regulatoryFiles).values(regValues);

  // ---- Campagnes & dépenses 2026 (cohérentes avec les budgets importés)
  const year = today.getUTCFullYear();
  const budgets = (await db.execute(sql`select brand_id, amount::float8 as amount from budgets where year = ${year}`)).rows as { brand_id: string; amount: number }[];
  for (const b of brands) {
    const bud = budgets.find((x) => x.brand_id === b.id)?.amount ?? 200000;
    const [camp] = await db.insert(s.campaigns).values({ brandId: b.id, name: `${b.name} — Always-on Meta ${year}`, channel: "META", objective: "Conversions + drive-to-pharmacie", startDate: `${year}-02-01`, endDate: `${year}-12-31`, budget: String(Math.round(bud * 0.35)), status: "ACTIVE", notes: `${TAG} campagne fictive` }).returning();
    const monthly = Math.round((bud * 0.35) / 11);
    const perf = rand();
    for (let m = 2; m <= Math.min(today.getUTCMonth() + 1, 12); m++) {
      const date = `${year}-${String(m).padStart(2, "0")}-15`;
      const late = m >= today.getUTCMonth();
      const roas = perf < 0.3 ? 1.0 + rand() * 0.4 : perf < 0.7 ? 2.2 + rand() : 3.5 + rand();
      const degraded = perf < 0.5 && late ? 0.6 : 1;
      await db.insert(s.marketingExpenses).values({
        brandId: b.id, campaignId: camp.id, category: "META", label: `Meta Ads ${b.name} ${date.slice(0, 7)}`, amount: String(monthly), status: m < today.getUTCMonth() + 1 ? "SPENT" : "COMMITTED", date,
        attributedRevenue: String(Math.round(monthly * roas * degraded)), conversions: Math.round((monthly / 120) * degraded), notes: `${TAG} dépense fictive`,
      });
    }
    await db.insert(s.marketingExpenses).values([
      { brandId: b.id, category: "INFLUENCE", label: `Micro-influence ${b.name} S1`, amount: String(Math.round(bud * 0.12)), status: "SPENT", date: `${year}-04-10`, attributedRevenue: String(Math.round(bud * 0.12 * 2.4)), notes: `${TAG} dépense fictive` },
      { brandId: b.id, category: "ANIMATION", label: `Animations pharmacies ${b.name} T2`, amount: String(Math.round(bud * 0.08)), status: "SPENT", date: `${year}-06-05`, notes: `${TAG} dépense fictive` },
      { brandId: b.id, category: "PLV", label: `PLV & présentoirs ${b.name}`, amount: String(Math.round(bud * 0.05)), status: "COMMITTED", date: iso(addDays(today, 10)), notes: `${TAG} dépense fictive` },
      { brandId: b.id, category: "EVENEMENT", label: `Événement ${b.name} Q4`, amount: String(Math.round(bud * 0.1)), status: "PLANNED", date: `${year}-11-15`, notes: `${TAG} dépense fictive` },
    ]);
  }

  // ---- Planning éditorial : mois courant + suivant
  const mk = U("MARKETING");
  const formats = ["Reel", "Carrousel", "Story", "UGC", "Post"], platforms = ["Instagram", "TikTok", "Facebook"], objectives = ["Notoriété", "Conversion", "Éducation", "Engagement", "Drive-to-store"];
  const statuses: s.ContentStatus[] = ["IDEE", "BRIEF", "CREATION", "VALIDATION", "PROGRAMME", "PUBLIE", "ANALYSE"];
  const contentValues: (typeof s.contentItems.$inferInsert)[] = [];
  const som = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12));
  for (let i = 0; i < 24; i++) {
    const p = pick(prodList);
    const date = addDays(som, i * 2 + 1);
    contentValues.push({ date: iso(date), brandId: p.brandId!, productId: p.id, title: `${p.name} — ${pick(["bénéfices clés", "avant / après", "routine du soir", "témoignage cliente", "conseil pharmacien", "unboxing"])}`, format: formats[i % 5], platform: platforms[i % 3], objective: objectives[i % 5], responsibleId: mk.id, status: date < today ? pick(["PUBLIE", "ANALYSE", "PROGRAMME"]) : statuses[i % 5], brief: `${TAG} Reprendre l'angle marketing et les claims autorisés de la fiche produit.` });
  }
  await db.insert(s.contentItems).values(contentValues);

  // ---- Tâches
  const admin = U("ADMIN"), trade = U("TRADE"), reg = U("REGLEMENTAIRE");
  await db.insert(s.tasks).values([
    { title: "Relancer le fournisseur sur la date de livraison Alphascience", status: "IN_PROGRESS", priority: "CRITICAL", dueDate: iso(addDays(today, -3)), assigneeId: admin.id, createdById: admin.id, brandId: brands.find((b) => b.slug === "alphascience")?.id, source: "STOCK", description: `${TAG} Tâche fictive`, expectedImpact: "Fin de rupture" },
    { title: "Planning animatrices du mois prochain", status: "TODO", priority: "MEDIUM", dueDate: iso(addDays(today, 10)), assigneeId: trade.id, createdById: admin.id, source: "TERRAIN", description: `${TAG} Tâche fictive` },
    { title: "Qualifier les clients importés sans ville", status: "IN_PROGRESS", priority: "MEDIUM", dueDate: iso(addDays(today, 20)), assigneeId: trade.id, createdById: admin.id, source: "COMMERCIAL", description: `${TAG} Tâche fictive` },
    { title: "Brief créatif rentrée — visuels Beauty Boost", status: "DONE", priority: "MEDIUM", dueDate: iso(addDays(today, -8)), assigneeId: mk.id, createdById: admin.id, brandId: brands.find((b) => b.slug === "cygnelab")?.id, source: "MARKETING", description: `${TAG} Tâche fictive`, completedAt: addDays(today, -9) },
    { title: "Préparer les pièces du dossier de renouvellement", status: "TODO", priority: "HIGH", dueDate: iso(addDays(today, 5)), assigneeId: reg.id, createdById: admin.id, source: "REGLEMENTAIRE", description: `${TAG} Tâche fictive` },
  ]);
  console.log(`✓ Démo : ${anims.length} animations, ${regValues.length} dossiers, campagnes/dépenses, ${contentValues.length} contenus, 5 tâches, 3 animatrices`);
}

if (require.main === module) {
  seedDemo().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
