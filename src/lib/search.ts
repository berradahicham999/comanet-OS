/**
 * Recherche universelle — la même requête que la page /recherche, réutilisée par l'outil
 * `search_entities` du copilote. Le filtrage par module se fait chez l'appelant.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normKey } from "@/lib/import/normalize";

export type SearchHit = { id: string; label: string; sub: string | null; href: string; clientId?: string };
export type SearchResult = {
  products: SearchHit[]; clients: SearchHit[]; brands: SearchHit[]; tasks: SearchHit[];
  regulatory: SearchHit[]; campaigns: SearchHit[]; contents: SearchHit[]; users: SearchHit[];
  /** Pièces de vente par numéro : bons de livraison (module livraisons), factures et avoirs (module facturation). */
  deliveries?: SearchHit[]; invoices?: SearchHit[];
};

const EMPTY: SearchResult = { products: [], clients: [], brands: [], tasks: [], regulatory: [], campaigns: [], contents: [], users: [] };

export async function searchEntities(q: string, limit = 10): Promise<SearchResult> {
  const key = normKey(q);
  if (!key) return EMPTY;
  const like = `%${key}%`;
  type R = Record<string, string | number | null>;
  const rows = async (query: ReturnType<typeof sql>) => ((await db.execute(query).catch(() => ({ rows: [] }))).rows as R[]);
  const [products, clients, brands, tasks, regs, campaigns, contents, users, pieces] = await Promise.all([
    rows(sql`select p.id, p.name, p.sku, b.name as brand from products p left join brands b on b.id = p.brand_id where p.name_key like ${like} or p.sku like ${like} or exists (select 1 from product_aliases a where a.product_id = p.id and a.alias like ${like}) order by p.name limit ${limit}`),
    rows(sql`select c.id, c.name, c.city, c.code from clients c where c.name_key like ${like} or upper(coalesce(c.city,'')) like ${like} or upper(coalesce(c.code,'')) like ${like} or exists (select 1 from client_aliases a where a.client_id = c.id and a.alias like ${like}) order by c.name limit ${limit}`),
    rows(sql`select id, name from brands where active and (upper(name) like ${like} or exists (select 1 from jsonb_array_elements_text(aliases) a where upper(a) like ${like})) limit ${limit}`),
    rows(sql`select t.id, t.title, t.status::text as status from tasks t where upper(t.title) like ${like} and t.status <> 'PROPOSED' order by t.created_at desc limit ${limit}`),
    rows(sql`select rf.id, rf.dossier, rf.expiry_date::text as expiry_date, p.name as product from regulatory_files rf left join products p on p.id = rf.product_id where upper(coalesce(rf.dossier,'')) like ${like} or upper(coalesce(rf.authorization_number,'')) like ${like} or upper(coalesce(p.name,'')) like ${like} limit ${limit}`),
    rows(sql`select c.id, c.name, c.status::text as status, b.name as brand from campaigns c join brands b on b.id = c.brand_id where upper(c.name) like ${like} limit ${limit}`),
    rows(sql`select c.id, c.title, c.date::text as date, b.name as brand from content_items c join brands b on b.id = c.brand_id where upper(c.title) like ${like} order by c.date desc limit ${limit}`),
    rows(sql`select u.id, u.name, u.role::text as role from users u where u.active and upper(u.name) like ${like} order by u.name limit ${limit}`),
    rows(sql`select d.id, d.type, d.number, d.date::text as date, d.ttc::text as ttc, d.client_id, c.name as client from sales_documents d join clients c on c.id = d.client_id
      where d.number is not null and upper(d.number) like ${`%${q.trim().toUpperCase()}%`} order by d.date desc limit ${limit * 2}`),
  ]);
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    products: products.map((r) => ({ id: String(r.id), label: String(r.name), sub: [s(r.brand), s(r.sku)].filter(Boolean).join(" · ") || null, href: `/produits/${r.id}` })),
    clients: clients.map((r) => ({ id: String(r.id), label: String(r.name), sub: s(r.city), href: `/clients/${r.id}` })),
    brands: brands.map((r) => ({ id: String(r.id), label: String(r.name), sub: null, href: `/marques/${r.id}` })),
    tasks: tasks.map((r) => ({ id: String(r.id), label: String(r.title), sub: s(r.status), href: `/taches/${r.id}` })),
    regulatory: regs.map((r) => ({ id: String(r.id), label: String(r.product ?? r.dossier), sub: r.expiry_date ? `expire le ${r.expiry_date}` : null, href: `/reglementaire/${r.id}` })),
    campaigns: campaigns.map((r) => ({ id: String(r.id), label: String(r.name), sub: [s(r.brand), s(r.status)].filter(Boolean).join(" · ") || null, href: `/marketing/campagnes/${r.id}` })),
    contents: contents.map((r) => ({ id: String(r.id), label: String(r.title), sub: [s(r.brand), s(r.date)].filter(Boolean).join(" · ") || null, href: `/marketing/planning?month=${String(r.date).slice(0, 7)}` })),
    users: users.map((r) => ({ id: String(r.id), label: String(r.name), sub: s(r.role), href: `/parametres/utilisateurs` })),
    deliveries: pieces.filter((r) => r.type === "BL").map(pieceHit),
    invoices: pieces.filter((r) => r.type !== "BL").map(pieceHit),
  };
}

function pieceHit(r: Record<string, string | number | null>): SearchHit {
  return { id: String(r.id), label: String(r.number), sub: `${r.client} · ${r.date} · ${r.ttc} MAD TTC`, href: `/gestion/pieces/${r.id}`, clientId: String(r.client_id) };
}
