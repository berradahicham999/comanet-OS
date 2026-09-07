import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { animations as animationsTable } from "@/db/schema";
import { requireAccess, isOwnOnly, canDo, hasFlag } from "@/lib/access";
import { animationImpact } from "@/lib/terrain";
import { listBrands, listAnimatrices } from "@/lib/users";
import { PageHeader, Card, Badge, Delta } from "@/components/ui";
import { AnimationForm } from "@/components/animation-form";
import { saveAnimation, deleteAnimation } from "../actions";
import { fmtMAD, fmtNum, fmtDate, iso, delta } from "@/lib/format";
import { ANIMATION_ERRORS, ANIMATION_WARNINGS } from "@/lib/animations-shared";

export const dynamic = "force-dynamic";

export default async function AnimationPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; warn?: string }> }) {
  const user = await requireAccess("terrain");
  const [ownOnly, canValidate, animatriceUsers, seeCosts] = await Promise.all([isOwnOnly(), canDo("terrain", "validate"), listAnimatrices(), hasFlag("seeInternalCosts")]);
  const { id } = await props.params;
  const sp = await props.searchParams;
  const anim = await db.query.animations.findFirst({ where: eq(animationsTable.id, id), with: { client: true, animatrice: true, brand: true, lines: { with: { product: true } } } });
  if (!anim) notFound();
  if (ownOnly && anim.animatriceId !== user.id) notFound();
  const [impact, clients, products, brands] = await Promise.all([
    animationImpact(id),
    db.execute(sql`select id, name, city from clients where active and type <> 'GROSSISTE' order by name`),
    db.execute(sql`select id, name, brand_id from products where active order by name`),
    listBrands(),
  ]);
  const sold = anim.lines.reduce((a, l) => a + l.quantitySold, 0);
  const cost = Number(anim.cost);
  const roi = cost ? impact.during_revenue / cost : null;
  const incremental = impact.after_qty - impact.before_qty;

  return (
    <>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{ANIMATION_ERRORS[sp.error] ?? "Enregistrement impossible."}</div>}
      {sp.warn && <div className="mb-4 rounded-2xl bg-orange-soft border border-orange/30 px-4 py-3 text-[13px] text-orange font-medium">{ANIMATION_WARNINGS[sp.warn] ?? "Animation enregistrée avec des réserves."}</div>}
      <PageHeader eyebrow={<Link href="/terrain" className="hover:underline">Animations</Link>} title={`${anim.client.name} — ${fmtDate(anim.date)}`} subtitle={[anim.animatrice?.name, anim.brand?.name ?? "Multi-marques", anim.client.city].filter(Boolean).join(" · ")}
        actions={<>{anim.status === "PLANNED" && <Badge tone="blue">Prévue</Badge>}{canValidate && <form action={deleteAnimation}><input type="hidden" name="id" value={id} /><button className="btn-ghost btn-sm text-red" type="submit">Supprimer</button></form>}</>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="label">Vendu pendant l&apos;animation</div><div className="kpi mt-2">{sold} <span className="text-[14px] text-muted font-medium">u.</span></div><div className="mt-2 text-[12px] text-muted">{fmtMAD(impact.during_revenue, { compact: true })} PPH · {fmtMAD(impact.during_retail, { compact: true })} PPV</div></Card>
        <Card><div className="label">Sell-in client · marque</div><div className="kpi mt-2">{fmtNum(impact.before_qty)} → {fmtNum(impact.after_qty)}</div><div className="mt-2 text-[12px] text-muted flex items-center gap-1">30 j avant → 30 j après <Delta value={delta(impact.after_qty, impact.before_qty)} /></div></Card>
        <Card><div className="label">Ventes incrémentales estimées</div><div className={`kpi mt-2 ${incremental > 0 ? "text-green" : incremental < 0 ? "text-red" : ""}`}>{incremental > 0 ? "+" : ""}{fmtNum(incremental)} u.</div><div className="mt-2 text-[12px] text-muted">{fmtMAD(impact.after_amount - impact.before_amount, { compact: true })} de sell-in en plus sur 30 j</div></Card>
        <Card><div className="label">ROI animation</div><div className="kpi mt-2">{!seeCosts ? "—" : roi !== null ? `${roi.toFixed(1)}×` : "—"}</div><div className="mt-2 text-[12px] text-muted">{seeCosts ? `coût ${fmtMAD(cost)} · ` : ""}{anim.customersAdvised} clientes conseillées · {anim.samples} échantillons</div></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card title="Produits">
            <table className="tbl"><thead><tr><th>Produit</th><th className="num">Vendu</th><th className="num">Stock rayon</th></tr></thead><tbody>
              {anim.lines.map((l) => <tr key={l.id}><td><Link href={`/produits/${l.productId}`} className="hover:underline">{l.product.name}</Link></td><td className="num font-medium">{l.quantitySold}</td><td className="num">{l.stockObserved ?? "—"}</td></tr>)}
              {anim.lines.length === 0 && <tr><td colSpan={3} className="text-muted text-center py-4">Aucune ligne produit.</td></tr>}
            </tbody></table>
          </Card>
          {anim.comment && <Card title="Commentaire"><p className="text-[14px]">{anim.comment}</p></Card>}
          {anim.photoUrl && <Card title="Photo"><a href={anim.photoUrl} target="_blank" rel="noreferrer" className="text-accent text-[13px] break-all">{anim.photoUrl}</a></Card>}
          <Card title="Lecture de l'impact"><p className="text-[13px] text-ink-2">Le sell-in « avant / après » compare les commandes du point de vente sur la marque animée 30 jours avant et 30 jours après. Un écart positif signifie que l&apos;animation a fait tourner le rayon et déclenché un réassort ; un écart nul avec un bon sell-out indique que le stock rayon était suffisant.</p></Card>
        </div>
        <Card title="Modifier">
          <AnimationForm
            action={saveAnimation}
            clients={(clients.rows as { id: string; name: string; city: string | null }[])}
            products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))}
            brands={brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
            animatrices={animatriceUsers.map((u) => ({ id: u.id, name: u.name }))}
            initial={{ id: anim.id, clientId: anim.clientId, date: anim.date, brandId: anim.brandId, animatriceId: anim.animatriceId, status: anim.status, cost: String(anim.cost), durationHours: anim.durationHours, customersAdvised: anim.customersAdvised, samples: anim.samples, comment: anim.comment, photoUrl: anim.photoUrl, lines: anim.lines.map((l) => ({ productId: l.productId, qty: String(l.quantitySold), stock: l.stockObserved === null ? "" : String(l.stockObserved) })) }}
            isAnimatrice={ownOnly || !seeCosts}
            today={iso(new Date())}
            submitLabel="Enregistrer les modifications"
          />
        </Card>
      </div>
    </>
  );
}
