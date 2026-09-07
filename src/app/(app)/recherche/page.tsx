import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAnyModule, getUserPermissions, can } from "@/lib/access";
import { type ModuleKey } from "@/lib/access-shared";
import { PageHeader, Card, Badge, BrandDot } from "@/components/ui";
import { normKey } from "@/lib/import/normalize";
import { fmtMAD, fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recherche" };

export default async function RecherchePage(props: { searchParams: Promise<{ q?: string }> }) {
  await requireAnyModule();
  const perms = await getUserPermissions();
  const { q = "" } = await props.searchParams;
  const key = normKey(q);
  if (!key) return <PageHeader eyebrow="Recherche universelle" title="Rechercher" subtitle="Produit, client, marque, dossier réglementaire, tâche, campagne, contenu…" />;
  const like = `%${key}%`;
  const [products, clients, brands, tasks, regs, campaigns, contents] = await Promise.all([
    db.execute(sql`select p.id, p.name, p.sku, b.name as brand, b.color, (select coalesce(sum(amount),0)::float8 from sales s where s.product_id = p.id and s.date >= current_date - 400) as revenue from products p left join brands b on b.id = p.brand_id where p.name_key like ${like} or p.sku like ${like} or exists (select 1 from product_aliases a where a.product_id = p.id and a.alias like ${like}) order by revenue desc limit 15`).catch(() => ({ rows: [] })),
    db.execute(sql`select c.id, c.name, c.city, c.code, (select max(date)::text from sales s where s.client_id = c.id) as last_order, (select coalesce(sum(amount),0)::float8 from sales s where s.client_id = c.id and s.date >= current_date - 365) as revenue from clients c where c.name_key like ${like} or upper(coalesce(c.city,'')) like ${like} or upper(coalesce(c.code,'')) like ${like} or exists (select 1 from client_aliases a where a.client_id = c.id and a.alias like ${like}) order by revenue desc limit 15`),
    db.execute(sql`select id, name, color from brands where upper(name) like ${like} or exists (select 1 from jsonb_array_elements_text(aliases) a where upper(a) like ${like})`),
    db.execute(sql`select t.id, t.title, t.status::text as status, t.due_date::text as due_date, u.name as assignee from tasks t left join users u on u.id = t.assignee_id where upper(t.title) like ${like} order by t.created_at desc limit 10`),
    db.execute(sql`select rf.id, rf.dossier, rf.expiry_date::text as expiry_date, rf.status::text as status, p.name as product from regulatory_files rf left join products p on p.id = rf.product_id where upper(rf.dossier) like ${like} or upper(coalesce(rf.authorization_number,'')) like ${like} or upper(coalesce(p.name,'')) like ${like} limit 10`),
    db.execute(sql`select c.id, c.name, c.status::text as status, b.name as brand, b.id as brand_id from campaigns c join brands b on b.id = c.brand_id where upper(c.name) like ${like} limit 10`),
    db.execute(sql`select c.id, c.title, c.date::text as date, c.status::text as status, b.name as brand from content_items c join brands b on b.id = c.brand_id where upper(c.title) like ${like} order by c.date desc limit 10`),
  ]);
  type R = Record<string, string | number | null>;
  type Section = { title: string; module: ModuleKey; rows: R[]; render: (r: R) => React.ReactNode };
  const sections: Section[] = ([
    { title: "Produits", module: "produits", rows: products.rows as R[], render: (r) => <Link href={`/produits/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><BrandDot color={String(r.color ?? "#999")} /><span className="font-medium flex-1 truncate">{r.name}</span><span className="text-[12px] text-muted">{r.brand}</span><span className="text-[12px] font-medium">{fmtMAD(r.revenue, { compact: true })} / 12 m</span></Link> },
    { title: "Clients", module: "clients", rows: clients.rows as R[], render: (r) => <Link href={`/clients/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><span className="font-medium flex-1 truncate">{r.name}</span><span className="text-[12px] text-muted">{r.city}</span><span className="text-[12px] text-muted">dernière cmd {fmtDateShort(r.last_order as string)}</span><span className="text-[12px] font-medium">{fmtMAD(r.revenue, { compact: true })}</span></Link> },
    { title: "Marques", module: "produits", rows: brands.rows as R[], render: (r) => <Link href={`/marques/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><BrandDot color={String(r.color)} /><span className="font-medium">{r.name}</span></Link> },
    { title: "Dossiers réglementaires", module: "reglementaire", rows: regs.rows as R[], render: (r) => <Link href={`/reglementaire/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><span className="font-medium flex-1 truncate">{r.product ?? r.dossier}</span><span className="text-[12px] text-muted">{r.dossier}</span><Badge tone="gray">{r.status}</Badge><span className="text-[12px]">exp. {fmtDateShort(r.expiry_date as string)}</span></Link> },
    { title: "Tâches", module: "taches", rows: tasks.rows as R[], render: (r) => <Link href={`/taches/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><span className="font-medium flex-1 truncate">{r.title}</span><span className="text-[12px] text-muted">{r.assignee}</span><Badge tone="gray">{r.status}</Badge></Link> },
    { title: "Campagnes", module: "marketing", rows: campaigns.rows as R[], render: (r) => <Link href={`/marketing/campagnes/${r.id}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><span className="font-medium flex-1 truncate">{r.name}</span><span className="text-[12px] text-muted">{r.brand}</span><Badge tone="gray">{r.status}</Badge></Link> },
    { title: "Contenus", module: "marketing", rows: contents.rows as R[], render: (r) => <Link href={`/marketing/planning?month=${String(r.date).slice(0, 7)}`} className="card px-4 py-3 flex items-center gap-3 hover:border-line-2"><span className="font-medium flex-1 truncate">{r.title}</span><span className="text-[12px] text-muted">{r.brand} · {fmtDateShort(r.date as string)}</span><Badge tone="gray">{r.status}</Badge></Link> },
  ] as Section[]).filter((s) => can(perms, s.module, "view"));
  const total = sections.reduce((a, s) => a + s.rows.length, 0);
  return (
    <>
      <PageHeader eyebrow="Recherche universelle" title={`« ${q} »`} subtitle={`${total} résultat${total > 1 ? "s" : ""}`} />
      {total === 0 && <Card><div className="text-sm text-muted">Aucun résultat. Essayez un autre mot-clé (nom de produit, client, ville, code article…).</div></Card>}
      <div className="grid lg:grid-cols-2 gap-4">
        {sections.filter((s) => s.rows.length).map((s) => (
          <section key={s.title}><h2 className="label mb-2">{s.title} · {s.rows.length}</h2><div className="space-y-2">{s.rows.map((r, i) => <div key={i}>{s.render(r)}</div>)}</div></section>
        ))}
      </div>
    </>
  );
}
