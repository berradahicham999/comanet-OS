import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter, hasFlag } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Progress, Empty, Tabs } from "@/components/ui";
import { fmtMAD, fmtNum, fmtDateShort, iso, today } from "@/lib/format";
import { CAMPAIGN_TYPES, CAMPAIGN_STATUS, campaignTypeLabel } from "@/lib/marketing-shared";
import { saveCampaign } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campagnes" };

type Row = {
  id: string; name: string; type: string; status: string; channel: string;
  start_date: string | null; end_date: string | null; budget: number | null;
  brand_id: string; brand: string; brand_color: string;
  objective: string | null; kpi_target: string | null; responsible: string | null;
  spent: number; ad_spend: number; ad_revenue: number; ad_purchases: number;
  collab_cost: number; collab_revenue: number; contents: number; products: number;
};

const FILTERS = [
  { key: "", label: "Toutes" },
  { key: "ACTIVE", label: "Actives" },
  { key: "PLANNED", label: "Planifiées" },
  { key: "DRAFT", label: "Brouillons" },
  { key: "DONE", label: "Terminées" },
];

export default async function CampagnesPage(props: { searchParams: Promise<{ brand?: string; status?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const [scopeBrands, seeCosts] = await Promise.all([brandFilter(), hasFlag("seeInternalCosts")]);
  const brands = (await listBrands()).filter((b) => b.active && (scopeBrands === null || scopeBrands.includes(b.id)));
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  const status = FILTERS.some((f) => f.key === sp.status) ? (sp.status ?? "") : "";

  const [rowsRes, users] = await Promise.all([
    db.execute(sql`
      select c.id, c.name, c.type, c.status::text as status, c.channel::text as channel,
             c.start_date::text as start_date, c.end_date::text as end_date, c.budget::float8 as budget,
             c.brand_id, b.name as brand, b.color as brand_color, c.objective, c.kpi_target, u.name as responsible,
             coalesce((select sum(amount) from marketing_expenses e where e.campaign_id = c.id and e.status <> 'PLANNED'), 0)::float8 as spent,
             coalesce((select sum(spend) from ad_metrics m where m.campaign_id = c.id), 0)::float8 as ad_spend,
             coalesce((select sum(revenue) from ad_metrics m where m.campaign_id = c.id), 0)::float8 as ad_revenue,
             coalesce((select sum(purchases) from ad_metrics m where m.campaign_id = c.id), 0)::int as ad_purchases,
             coalesce((select sum(fee + product_value) from collaborations co where co.campaign_id = c.id), 0)::float8 as collab_cost,
             coalesce((select sum(attributed_revenue) from collaborations co where co.campaign_id = c.id), 0)::float8 as collab_revenue,
             coalesce((select count(*) from content_items ci where ci.campaign_id = c.id), 0)::int as contents,
             coalesce((select count(*) from campaign_products cp where cp.campaign_id = c.id), 0)::int as products
      from campaigns c join brands b on b.id = c.brand_id
      left join users u on u.id = c.responsible_id
      where true ${brandId ? sql`and c.brand_id = ${brandId}::uuid` : sql``} ${scopeBrands ? sql`and c.brand_id = any(${scopeBrands}::uuid[])` : sql``} ${status ? sql`and c.status = ${status}::campaign_status` : sql``}
      order by (c.status = 'ACTIVE') desc, coalesce(c.start_date, '1900-01-01'::date) desc, c.name`),
    listUsers(),
  ]);
  // Sans « voir les coûts internes », les cachets d'influence sortent du dépensé affiché.
  const rows = (rowsRes.rows as Row[]).map((r) => (seeCosts ? r : { ...r, collab_cost: 0 }));
  const now = iso(today());

  const totals = rows.reduce((a, r) => ({
    budget: a.budget + (r.budget ?? 0),
    spent: a.spent + r.spent + r.ad_spend + r.collab_cost,
    measured: a.measured + r.ad_revenue + r.collab_revenue,
  }), { budget: 0, spent: 0, measured: 0 });

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    if (brandId) p.set("brand", brandId);
    if (status) p.set("status", status);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/marketing/campagnes?${s}` : "/marketing/campagnes";
  };

  return (
    <>
      <PageHeader
        eyebrow="Marketing Command Center"
        title="Campagnes"
        subtitle="Chaque campagne relie un budget, des produits, des contenus, de la publicité et de l'influence. Le CA n'y est présenté comme attribué que lorsqu'il est mesuré."
        actions={<><Link href="/marketing" className="btn-secondary btn-sm">Vue d&apos;ensemble</Link><Link href="/marketing/budgets" className="btn-ghost btn-sm">Budgets</Link></>}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Card><div className="label">Campagnes</div><div className="kpi mt-2">{fmtNum(rows.length)}</div><div className="text-[12px] text-muted mt-1">{rows.filter((r) => r.status === "ACTIVE").length} active(s)</div></Card>
          <Card><div className="label">Budget alloué</div><div className="kpi mt-2">{fmtMAD(totals.budget, { compact: true })}</div></Card>
          <Card><div className="label">Dépensé (actions + régie + influence)</div><div className="kpi mt-2">{fmtMAD(totals.spent, { compact: true })}</div><Progress value={totals.budget ? (totals.spent / totals.budget) * 100 : 0} className="mt-2" tone={totals.budget && totals.spent > totals.budget ? "red" : "accent"} /></Card>
          <Card><div className="label">CA attribué mesuré</div><div className="kpi mt-2">{fmtMAD(totals.measured, { compact: true })}</div><div className="text-[12px] text-muted mt-1">régie + codes promo uniquement</div></Card>
        </div>
        <Tabs current={brandId ? `/marketing/campagnes?brand=${brandId}` : "/marketing/campagnes"} tabs={[{ href: "/marketing/campagnes", label: "Toutes les marques" }, ...brands.map((b) => ({ href: `/marketing/campagnes?brand=${b.id}`, label: b.name }))]} />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {FILTERS.map((f) => (
            <Link key={f.key || "all"} href={qs({ status: f.key })} className={`px-2.5 py-1 rounded-lg text-[12px] border ${status === f.key ? "border-accent text-accent bg-accent-soft/40" : "border-line text-muted hover:border-ink-3"}`}>{f.label}</Link>
          ))}
        </div>
      </PageHeader>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {rows.length === 0 ? (
            <Empty title="Aucune campagne" hint="Créez votre première campagne avec le formulaire à droite : elle deviendra le point d'entrée pour suivre budget, contenus, publicité, influence et ventes." />
          ) : rows.map((c) => {
            const meta = CAMPAIGN_STATUS[c.status] ?? { label: c.status, tone: "gray" as const };
            const spent = c.spent + c.ad_spend + c.collab_cost;
            const pct = c.budget ? (spent / c.budget) * 100 : null;
            const measured = c.ad_revenue + c.collab_revenue;
            const roas = c.ad_spend + c.collab_cost > 0 && measured > 0 ? measured / (c.ad_spend + c.collab_cost) : null;
            const running = c.start_date && c.start_date <= now && (!c.end_date || c.end_date >= now);
            return (
              <Link key={c.id} href={`/marketing/campagnes/${c.id}`} className="card p-4 block hover:border-accent transition-colors">
                <div className="flex flex-wrap items-center gap-2">
                  <BrandDot color={c.brand_color} />
                  <span className="font-semibold text-[15px]">{c.name}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <Badge tone="gray">{campaignTypeLabel(c.type)}</Badge>
                  {running && <Badge tone="green" dot>en cours</Badge>}
                  <span className="ml-auto text-[12px] text-muted">{c.start_date ? `${fmtDateShort(c.start_date)}${c.end_date ? ` → ${fmtDateShort(c.end_date)}` : ""}` : "sans dates"}</span>
                </div>
                {c.objective && <p className="text-[12.5px] text-ink-2 mt-1.5">{c.objective}</p>}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                  <div><div className="text-muted">Budget</div><div className="font-medium">{c.budget ? fmtMAD(c.budget, { compact: true }) : "—"}</div></div>
                  <div><div className="text-muted">Dépensé</div><div className={`font-medium ${pct !== null && pct > 100 ? "text-red" : ""}`}>{fmtMAD(spent, { compact: true })}</div></div>
                  <div><div className="text-muted">CA mesuré</div><div className="font-medium">{measured ? fmtMAD(measured, { compact: true }) : "—"}</div></div>
                  <div><div className="text-muted">ROAS mesuré</div><div className="font-medium">{roas !== null ? roas.toFixed(2) + "×" : "—"}</div></div>
                  <div><div className="text-muted">Rattaché</div><div className="font-medium">{c.products} prod. · {c.contents} contenu(s)</div></div>
                </div>
                {pct !== null && <Progress value={pct} tone={pct > 100 ? "red" : pct > 85 ? "orange" : "accent"} className="mt-2" />}
              </Link>
            );
          })}
        </div>

        <Card title="Nouvelle campagne" className="h-fit">
          <form action={saveCampaign} className="space-y-2 text-[13px]">
            <input type="hidden" name="redirectToDetail" value="1" />
            <label className="block"><span className="label block mb-1">Marque *</span>
              <select name="brandId" defaultValue={brandId ?? ""} className="select h-9" required>
                <option value="">— choisir —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label block mb-1">Nom *</span><input name="name" className="input h-9" placeholder="Ex : KLORANE — Rentrée cheveux" required /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label block mb-1">Type</span>
                <select name="type" className="select h-9">{Object.entries(CAMPAIGN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="block"><span className="label block mb-1">Canal principal</span>
                <select name="channel" className="select h-9"><option value="META">Meta</option><option value="TIKTOK">TikTok</option><option value="GOOGLE">Google</option><option value="INFLUENCE">Influence</option><option value="TRADE">Trade</option><option value="EVENEMENT">Événement</option><option value="AUTRE">Autre</option></select>
              </label>
              <label className="block"><span className="label block mb-1">Début</span><input type="date" name="startDate" className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Fin</span><input type="date" name="endDate" className="input h-9" /></label>
              <label className="block"><span className="label block mb-1">Budget (MAD)</span><input name="budget" className="input h-9" placeholder="0" /></label>
              <label className="block"><span className="label block mb-1">Statut</span>
                <select name="status" className="select h-9" defaultValue="PLANNED">{Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </label>
            </div>
            <label className="block"><span className="label block mb-1">Objectif</span><input name="objective" className="input h-9" placeholder="Ex : recruter 300 nouvelles clientes" /></label>
            <label className="block"><span className="label block mb-1">Cible</span><input name="audience" className="input h-9" placeholder="Ex : femmes 25-40, Casablanca / Rabat" /></label>
            <label className="block"><span className="label block mb-1">Responsable</span>
              <select name="responsibleId" className="select h-9"><option value="">— non assigné —</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
            <label className="block"><span className="label block mb-1">KPI cible</span><input name="kpiTarget" className="input h-9" placeholder="Ex : ROAS ≥ 3, CPA ≤ 120 MAD" /></label>
            <button className="btn-primary w-full" type="submit">Créer la campagne</button>
            <p className="text-[11.5px] text-faint">Vous pourrez ensuite y rattacher les produits poussés, les contenus, les collaborations et les dépenses.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
