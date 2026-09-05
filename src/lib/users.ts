import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const listUsers = cache(async () => {
  return db.select({ id: users.id, name: users.name, role: users.role, email: users.email, active: users.active }).from(users).where(eq(users.active, true)).orderBy(asc(users.name));
});

export const listBrands = cache(async () => {
  return db.query.brands.findMany({ orderBy: (b, { asc }) => [asc(b.name)] });
});
