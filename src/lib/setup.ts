import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db";
import { getSession } from "./auth";

/* ------------------------------------------------------------------ */
/* Accès à la page d'installation                                      */
/* ------------------------------------------------------------------ */

export const SETUP_COOKIE = "comanet_setup";

/** Clé d'installation (variable d'environnement SETUP_KEY). */
export function setupKey() {
  const k = process.env.SETUP_KEY?.trim();
  return k && k.length >= 8 ? k : null;
}

function sign(value: string) {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "comanet").update(value).digest("hex");
}

export function checkSetupKey(candidate: string) {
  const k = setupKey();
  if (!k) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(k);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function grantSetupAccess() {
  const jar = await cookies();
  jar.set(SETUP_COOKIE, sign(setupKey() ?? ""), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/installation", maxAge: 3600 * 6 });
}

/** Accès autorisé : cookie signé par la clé d'installation, ou session ADMIN. */
export async function hasSetupAccess(): Promise<boolean> {
  const jar = await cookies();
  const c = jar.get(SETUP_COOKIE)?.value;
  const k = setupKey();
  if (c && k) {
    const expected = sign(k);
    const a = Buffer.from(c);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  try {
    const s = await getSession();
    return s?.role === "ADMIN";
  } catch {
    return false; // base non initialisée
  }
}

/* ------------------------------------------------------------------ */
/* État de la base                                                     */
/* ------------------------------------------------------------------ */

export type SetupStatus = {
  connected: boolean;
  error?: string;
  host?: string;
  schemaReady: boolean;
  migrations: { applied: number; available: number; pending: string[] };
  users: number;
  brands: number;
  settings: boolean;
  sales: number;
  lastSale: string | null;
  products: number;
  clients: number;
  imports: number;
};

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

type JournalEntry = { idx: number; when: number; tag: string };
function journal(): JournalEntry[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] };
    return j.entries ?? [];
  } catch {
    return [];
  }
}

function hostOf(url: string | undefined) {
  try { return url ? new URL(url).host : undefined; } catch { return undefined; }
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const entries = journal();
  const base: SetupStatus = { connected: false, host: hostOf(process.env.DATABASE_URL), schemaReady: false, migrations: { applied: 0, available: entries.length, pending: entries.map((e) => e.tag) }, users: 0, brands: 0, settings: false, sales: 0, lastSale: null, products: 0, clients: 0, imports: 0 };
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
  base.connected = true;
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => (r as { table_name: string }).table_name);
  base.schemaReady = ["users", "brands", "sales", "settings"].every((t) => tables.includes(t));
  const applied = (await db.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at`).catch(() => ({ rows: [] as unknown[] }))).rows as { created_at: string | number }[];
  const lastApplied = applied.length ? Number(applied[applied.length - 1].created_at) : 0;
  base.migrations = { applied: applied.length, available: entries.length, pending: entries.filter((e) => e.when > lastApplied).map((e) => e.tag) };
  if (base.schemaReady && applied.length === 0) base.migrations.pending = entries.slice(1).map((e) => e.tag); // schéma créé via db:push : la migration initiale sera « adoptée »
  if (!base.schemaReady) return base;
  const r = (await db.execute(sql`
    select (select count(*) from users)::int as users, (select count(*) from brands)::int as brands,
           (select count(*) from settings)::int as settings, (select count(*) from sales)::int as sales,
           (select max(date)::text from sales) as last_sale, (select count(*) from products)::int as products,
           (select count(*) from clients)::int as clients, (select count(*) from imports)::int as imports`)).rows[0] as Record<string, number | string | null>;
  return { ...base, users: Number(r.users), brands: Number(r.brands), settings: Number(r.settings) > 0, sales: Number(r.sales), lastSale: (r.last_sale as string | null) ?? null, products: Number(r.products), clients: Number(r.clients), imports: Number(r.imports) };
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/**
 * Applique les migrations SQL du dossier `drizzle/` (drizzle-orm migrator).
 * Si le schéma existe déjà sans historique de migrations (créé par `npm run db:push`),
 * la migration initiale est adoptée sans être rejouée.
 */
export async function applyMigrations(): Promise<{ applied: string[]; adopted: string[] }> {
  const entries = journal();
  if (!entries.length) throw new Error("Aucune migration trouvée dans drizzle/meta/_journal.json");
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => (r as { table_name: string }).table_name);
  const schemaExists = tables.includes("users") && tables.includes("sales");
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
  const applied = (await db.execute(sql`select created_at from drizzle.__drizzle_migrations order by created_at`)).rows as { created_at: string | number }[];
  const adopted: string[] = [];
  if (schemaExists && applied.length === 0) {
    const first = entries[0];
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${first.tag}.sql`), "utf8");
    const hash = (await import("node:crypto")).createHash("sha256").update(sqlText).digest("hex");
    await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${first.when})`);
    adopted.push(first.tag);
  }
  const before = Number(((await db.execute(sql`select max(created_at) as m from drizzle.__drizzle_migrations`)).rows[0] as { m: string | null }).m ?? 0);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const appliedNow = entries.filter((e) => e.when > before && !adopted.includes(e.tag)).map((e) => e.tag);
  return { applied: appliedNow, adopted };
}
