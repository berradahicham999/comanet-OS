import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { AnimationForm } from "@/components/animation-form";
import { saveAnimation } from "../actions";
import { iso, fmtDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saisie terrain" };

export default async function SaisiePage(props: { searchParams: Promise<{ client?: string; done?: string }> }) {
  const user = await requireAccess("terrain");
  const sp = await props.searchParams;
  const [clients, products, brands, users, recent] = await Promise.all([
    db.execute(sql`select id, name, city from clients where active and type <> 'GROSSISTE' order by name`),
    db.execute(sql`select id, name, brand_id from products where active order by name`),
    listBrands(),
    listUsers(),
    db.execute(sql`select a.id, a.date::text as date, c.name as client, coalesce(sum(al.quantity_sold),0)::int as sold from animations a join clients c on c.id = a.client_id left join animation_lines al on al.animation_id = a.id where a.animatrice_id = ${user.id}::uuid group by a.id, c.name order by a.date desc limit 5`),
  ]);
  return (
    <>
      <PageHeader eyebrow="Terrain" title="Saisie d'animation" subtitle="Moins d'une minute : point de vente, produits vendus, stock rayon, clientes conseillées." />
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Animation enregistrée. Merci !</div>}
      <div className="grid lg:grid-cols-[minmax(0,560px)_1fr] gap-4">
        <Card>
          <AnimationForm
            action={saveAnimation}
            clients={(clients.rows as { id: string; name: string; city: string | null }[])}
            products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))}
            brands={brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
            animatrices={users.filter((u) => u.role === "ANIMATRICE").map((u) => ({ id: u.id, name: u.name }))}
            initial={{ clientId: sp.client ?? "", animatriceId: user.role === "ANIMATRICE" ? user.id : "" }}
            isAnimatrice={user.role === "ANIMATRICE"}
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
