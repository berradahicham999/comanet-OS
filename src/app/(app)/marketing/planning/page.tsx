import Link from "next/link";
import clsx from "clsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot } from "@/components/ui";
import { saveContent, setContentStatus, deleteContent } from "../actions";
import { fmtMonth, iso, addMonths, startOfMonth, today, fmtDateShort } from "@/lib/format";
import type { ContentStatus } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning éditorial" };

export const CONTENT_STATUS: { key: ContentStatus; label: string; tone: "gray" | "blue" | "purple" | "yellow" | "accent" | "green" | "orange" }[] = [
  { key: "IDEE", label: "Idée", tone: "gray" }, { key: "BRIEF", label: "Brief", tone: "blue" }, { key: "CREATION", label: "Création", tone: "purple" }, { key: "VALIDATION", label: "Validation", tone: "yellow" },
  { key: "PROGRAMME", label: "Programmé", tone: "accent" }, { key: "PUBLIE", label: "Publié", tone: "green" }, { key: "ANALYSE", label: "Analysé", tone: "orange" },
];

export default async function PlanningPage(props: { searchParams: Promise<{ month?: string; brand?: string; product?: string; view?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const base = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? new Date(sp.month + "-01T12:00:00Z") : startOfMonth(today());
  const start = iso(startOfMonth(base)), end = iso(addMonths(startOfMonth(base), 1));
  const scopeBrands = await brandFilter();
  const [items, brands, users, products] = await Promise.all([
    db.execute(sql`select c.id, c.date::text as date, c.title, c.format, c.platform, c.objective, c.brief, c.status::text as status, c.link, c.product_id, p.name as product, c.brand_id, b.name as brand, b.color, u.name as responsible, c.responsible_id
      from content_items c join brands b on b.id = c.brand_id left join products p on p.id = c.product_id left join users u on u.id = c.responsible_id
      where c.date >= ${start}::date and c.date < ${end}::date ${sp.brand ? sql`and c.brand_id = ${sp.brand}::uuid` : sql``} ${scopeBrands ? sql`and c.brand_id = any(${scopeBrands}::uuid[])` : sql``} order by c.date, c.title`),
    listBrands(), listUsers(),
    db.execute(sql`select p.id, p.name, p.brand_id, p.marketing_angle, p.claims from products p where p.active order by p.name`),
  ]);
  type Item = { id: string; date: string; title: string; format: string | null; platform: string | null; objective: string | null; brief: string | null; status: ContentStatus; link: string | null; product_id: string | null; product: string | null; brand_id: string; brand: string; color: string; responsible: string | null; responsible_id: string | null };
  const list = items.rows as Item[];
  const first = new Date(start + "T12:00:00Z");
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i + 1, 12))))];
  const prev = iso(addMonths(first, -1)).slice(0, 7), next = iso(addMonths(first, 1)).slice(0, 7);
  const view = sp.view ?? "calendar";
  const counts = CONTENT_STATUS.map((s) => ({ ...s, n: list.filter((i) => i.status === s.key).length }));
  const selectedProduct = (products.rows as { id: string; name: string; brand_id: string | null; marketing_angle: string | null; claims: string | null }[]).find((p) => p.id === sp.product);

  return (
    <>
      <PageHeader eyebrow="Marketing" title="Planning éditorial" subtitle="Idée → Brief → Création → Validation → Programmé → Publié → Analysé"
        actions={<><Link href={`/marketing/planning?month=${prev}${sp.brand ? `&brand=${sp.brand}` : ""}`} className="btn-secondary btn-sm">←</Link><span className="font-semibold text-[15px] px-1">{fmtMonth(start)}</span><Link href={`/marketing/planning?month=${next}${sp.brand ? `&brand=${sp.brand}` : ""}`} className="btn-secondary btn-sm">→</Link><Link href={`/marketing/planning?month=${start.slice(0, 7)}&view=${view === "calendar" ? "list" : "calendar"}${sp.brand ? `&brand=${sp.brand}` : ""}`} className="btn-ghost btn-sm">{view === "calendar" ? "Vue liste" : "Vue calendrier"}</Link></>}>
        <div className="flex flex-wrap gap-1.5 items-center">
          {counts.map((c) => <Badge key={c.key} tone={c.tone}>{c.label} · {c.n}</Badge>)}
          <form action="/marketing/planning" method="get" className="ml-auto flex gap-1.5"><input type="hidden" name="month" value={start.slice(0, 7)} /><input type="hidden" name="view" value={view} /><select name="brand" defaultValue={sp.brand ?? ""} className="select h-8 text-[12px] w-auto"><option value="">Toutes les marques</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select><button className="btn-secondary btn-sm" type="submit">OK</button></form>
        </div>
      </PageHeader>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div>
          {view === "calendar" ? (
            <div className="card overflow-hidden">
              <div className="grid grid-cols-7 border-b border-line bg-surface-2">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="label px-2 py-1.5 text-center">{d}</div>)}</div>
              <div className="grid grid-cols-7">
                {cells.map((d, i) => (
                  <div key={i} className={clsx("min-h-[92px] border-b border-r border-line p-1.5", !d && "bg-surface-2", d === iso(today()) && "bg-accent-soft/40")}>
                    {d && <div className="text-[11px] text-muted mb-1">{Number(d.slice(8, 10))}</div>}
                    {d && list.filter((it) => it.date === d).map((it) => (
                      <a key={it.id} href={`#c-${it.id}`} className="block rounded-md px-1.5 py-1 mb-1 text-[11px] leading-tight bg-surface border border-line hover:border-line-2" title={`${it.brand} · ${it.title}`}>
                        <span className="flex items-center gap-1"><BrandDot color={it.color} /><span className="truncate font-medium">{it.title}</span></span>
                        <span className="text-faint">{[it.format, it.platform].filter(Boolean).join(" · ")}</span>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className={clsx("space-y-2", view === "calendar" && "mt-4")}>
            {list.map((it) => { const st = CONTENT_STATUS.find((s) => s.key === it.status)!; return (
              <div key={it.id} id={`c-${it.id}`} className="card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <BrandDot color={it.color} /><span className="font-medium">{it.title}</span><Badge tone={st.tone}>{st.label}</Badge>
                  <span className="text-[12px] text-muted">{fmtDateShort(it.date)} · {it.brand}{it.product ? ` · ${it.product}` : ""}{it.format ? ` · ${it.format}` : ""}{it.platform ? ` · ${it.platform}` : ""}{it.objective ? ` · ${it.objective}` : ""}{it.responsible ? ` · ${it.responsible}` : ""}</span>
                  <form action={setContentStatus} className="ml-auto flex items-center gap-1"><input type="hidden" name="id" value={it.id} /><select name="status" defaultValue={it.status} className="select h-7 text-[11px] w-auto py-0">{CONTENT_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button></form>
                  <form action={deleteContent}><input type="hidden" name="id" value={it.id} /><button className="text-faint hover:text-red text-[13px]" type="submit" title="Supprimer">×</button></form>
                </div>
                {it.brief && <p className="text-[12.5px] text-ink-2 mt-1.5">{it.brief}</p>}
                {it.link && <a href={it.link} target="_blank" rel="noreferrer" className="text-[12px] text-accent">Voir le contenu ↗</a>}
              </div>
            ); })}
            {list.length === 0 && <Card><div className="text-sm text-muted">Aucun contenu planifié ce mois-ci.</div></Card>}
          </div>
        </div>
        <Card title="Nouveau contenu">
          <form action={saveContent} className="space-y-2 text-[13px]">
            <label className="block"><span className="label block mb-1">Titre</span><input name="title" className="input h-9" required placeholder="ex: Pro Collagenium — résultats 8 semaines" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={start.slice(0, 7) === iso(today()).slice(0, 7) ? iso(today()) : start} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" defaultValue={sp.brand ?? selectedProduct?.brand_id ?? ""} className="select h-9" required><option value="">—</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="block col-span-2"><span className="label block mb-1">Produit</span><select name="productId" defaultValue={sp.product ?? ""} className="select h-9"><option value="">—</option>{(products.rows as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Format</span><select name="format" className="select h-9"><option value="">—</option>{["Reel", "Story", "Post", "Carrousel", "UGC", "Vidéo", "Live", "Newsletter"].map((f) => <option key={f}>{f}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Plateforme</span><select name="platform" className="select h-9"><option value="">—</option>{["Instagram", "TikTok", "Facebook", "YouTube", "Site", "WhatsApp"].map((f) => <option key={f}>{f}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Objectif</span><select name="objective" className="select h-9"><option value="">—</option>{["Notoriété", "Conversion", "Éducation", "Engagement", "Drive-to-store", "Lancement"].map((f) => <option key={f}>{f}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Responsable</span><select name="responsibleId" className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Statut</span><select name="status" className="select h-9">{CONTENT_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Lien</span><input name="link" className="input h-9" placeholder="https://" /></label>
            </div>
            <label className="block"><span className="label block mb-1">Brief</span><textarea name="brief" className="textarea min-h-[70px]" defaultValue={selectedProduct ? [selectedProduct.marketing_angle, selectedProduct.claims ? `Claims : ${selectedProduct.claims}` : null].filter(Boolean).join("\n") : ""} placeholder="Angle, message clé, claims autorisés (repris de la fiche produit)…" /></label>
            <button className="btn-primary btn-sm w-full" type="submit">Ajouter au planning</button>
          </form>
        </Card>
      </div>
    </>
  );
}
