import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __comanetPool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant (voir .env.example)");
  return new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    // En serverless (Vercel), chaque instance a son propre pool : rester modeste pour ne pas saturer
    // le pooler Supabase. Réglable via DATABASE_POOL_MAX.
    max: Number(process.env.DATABASE_POOL_MAX) || (process.env.VERCEL ? 5 : 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

const pool = global.__comanetPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.__comanetPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };
