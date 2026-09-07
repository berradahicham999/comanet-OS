import { sql, type SQL } from "drizzle-orm";

/**
 * Tableau Postgres à partir d'un tableau JavaScript, pour `= any(...)` / `<> all(...)`.
 *
 * `sql\`${["a","b"]}::text[]\`` ne fait PAS ce qu'on croit : drizzle développe un tableau en
 * liste de paramètres (`($1, $2)::text[]`), ce qui est une erreur SQL. On passe donc le
 * tableau en JSON et on le déplie côté base.
 */
export function pgArray(values: readonly string[], type: "uuid" | "text" = "uuid"): SQL {
  return sql`(array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))::${sql.raw(type)}[])`;
}
