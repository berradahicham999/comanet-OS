import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly } from "@/lib/access";
import { listBrands, listAnimatrices } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { AnimationForm } from "@/components/animation-form";
import { AnimationQuickForm } from "@/components/animation-quick-form";
import { saveAnimation } from "../actions";
import { iso, fmtDateShort } from "@/lib/format";
import { ANIMATION_ERRORS, ANIMATION_WARNINGS } from "@/lib/animations-shared";
import { animatedProductCatalog, lastClientForAnimatrice } from "@/lib/terrain/usual-products";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saisie terrain" };

export default async function SaisiePage(props: { searchParams: Promise<{ client?: string; done?: string; error?: string; warn?: string }> }) {
  const user = await requireAccess("terrain");
  const sp = await props.searchParams;
  const isAnimatrice = await isOwnOnly();
  const animatriceUsers = await listAnimatrices();

  const recentP = db.execute(sql`
    select a.id, a.date::text as date, c.name as client, coalesce(sum(al.quantity_sold),0)::int as sold
    from animations a join clients c on c.id = a.client_id left join animation_lines al on al.animation_id = a.id
    where a.animatrice_id = ${user.id}::uuid group by a.id, c.name order by a.date desc limit 5`);

  const banners = (
    <>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{ANIMATION_ERRORS[sp.error] ?? "Enregistrement impossible."}</div>}
      {sp.warn && <div className="mb-4 rounded-2xl bg-orange-soft border border-orange/30 px-4 py-3 text-[13px] text-orange font-medium">{ANIMATION_WARNINGS[sp.warn] ?? "Animation enregistrée avec des réserves."}</div>}
      {sp.done && !sp.warn && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Animation enregistrée. Merci !</div>}
    </>
  );

  if (isAnimatrice) {
    const [clients, catalog, lastClient, recent] = await Promise.all([
      db.execute(sql`select id, name, city from clients where active and type <> 'GROSSISTE' order by name`),
      animatedProductCatalog(),
      lastClientForAnimatrice(user.id),
      recentP,
    ]);
    return (
      <>
        <PageHeader eyebrow="Terrain" title="Saisie d'animation" subtitle="Ajoutez vos produits depuis la liste, puis saisissez les quantités." />
        {banners}
        <div className="grid lg:grid-cols-[minmax(0,480px)_1fr] gap-4">
          <Card>
            <AnimationQuickForm
              action={saveAnimation}
              clients={(clients.rows as { id: string; name: string; city: string | null }[])}
              catalog={catalog}
              defaultClientId={sp.client ?? lastClient?.id ?? null}
              today={iso(new Date())}
            />
          </Card>
          <div>
            <Card title="Mes dernières saisies">
              {recent.rows.length === 0 ? <div className="text-sm text-muted">Aucune saisie pour le moment.</div> : (
                <ul className="text-[13px] space-y-2">{(recent.rows as { id: string; date: string; client: string; sold: number }[]).map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/terrain/${r.id}`} className="hover:underline truncate">{fmtDateShort(r.date)} · {r.client}</Link><span className="font-medium shrink-0">{r.sold} u.</span></li>)}</ul>
              )}
            </Card>
          </div>
        </div>
      </>
    );
  }

  // Rôles non-animatrice : saisie de correction, référentiel complet (produits, marques, animatrices).
  const [clients, products, brands, recent] = await Promise.all([
    db.execute(sql`select id, name, city from clients where active and type <> 'GROSSISTE' order by name`),
    db.execute(sql`select id, name, brand_id from products where active order by name`),
    listBrands(),
    recentP,
  ]);
  return (
    <>
      <PageHeader eyebrow="Terrain" title="Saisie d'animation" subtitle="Point de vente, produits vendus, stock rayon, clientes conseillées." />
      {banners}
      <div className="grid lg:grid-cols-[minmax(0,560px)_1fr] gap-4">
        <Card>
          <AnimationForm
            action={saveAnimation}
            clients={(clients.rows as { id: string; name: string; city: string | null }[])}
            products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))}
            brands={brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
            animatrices={animatriceUsers.map((u) => ({ id: u.id, name: u.name }))}
            initial={{ clientId: sp.client ?? "" }}
            isAnimatrice={false}
            today={iso(new Date())}
          />
        </Card>
        <div>
          <Card title="Dernières saisies">
            {recent.rows.length === 0 ? <div className="text-sm text-muted">Aucune saisie pour le moment.</div> : (
              <ul className="text-[13px] space-y-2">{(recent.rows as { id: string; date: string; client: string; sold: number }[]).map((r) => <li key={r.id} className="flex justify-between gap-2"><Link href={`/terrain/${r.id}`} className="hover:underline truncate">{fmtDateShort(r.date)} · {r.client}</Link><span className="font-medium shrink-0">{r.sold} u.</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
