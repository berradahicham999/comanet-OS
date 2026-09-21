import Link from "next/link";
import { requireAccess, clientFilter, hasFlag } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { fmtDateShort, today } from "@/lib/format";
import {
  AGING_META, CHANNEL_LABELS, CHANNEL_TONES, listCommercials, readingAuthors, stockClientsSummary,
  type Aging, type ClientStockChannel,
} from "@/lib/client-stock";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock chez les clients" };

type SP = { brand?: string; city?: string; author?: string; commercial?: string; channel?: string; aging?: string; q?: string };

const CHANNELS = Object.keys(CHANNEL_LABELS) as ClientStockChannel[];
const AGINGS = Object.keys(AGING_META) as Aging[];

/** Vue transversale : un point de vente par ligne, avec la fraîcheur de son dernier relevé. */
export default async function StockClientsPage(props: { searchParams: Promise<SP> }) {
  await requireAccess("clients");
  const sp = await props.searchParams;
  const t = today();
  const [settings, scope, brands, authors, commercials, cities, canExport] = await Promise.all([
    getSettings(), clientFilter(), listBrands(), readingAuthors(), listCommercials(),
    db.execute<{ city: string }>(sql`select distinct city from clients where active and city is not null and city <> '' order by city`),
    hasFlag("exportData"),
  ]);
  const channel = CHANNELS.includes(sp.channel as ClientStockChannel) ? (sp.channel as ClientStockChannel) : null;
  const aging = AGINGS.includes(sp.aging as Aging) ? (sp.aging as Aging) : null;
  const rows = await stockClientsSummary(
    { brandId: sp.brand || null, city: sp.city || null, authorId: sp.author || null, commercialId: sp.commercial || null, channel, aging, clientIds: scope },
    t, settings.clientStock,
  );
  const read = rows.filter((r) => r.lastReadAt);
  const counts = { total: rows.length, read: read.length, stockouts: rows.reduce((a, r) => a + r.stockouts, 0), stale: rows.filter((r) => r.aging === "stale").length, never: rows.filter((r) => r.aging === "never").length };
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/clients" className="hover:underline">Clients</Link>}
        title="Stock chez les clients"
        subtitle="Dernier relevé de stock par point de vente, relevé par les animatrices en animation ou par les commerciaux en tournée. Photo datée, jamais estimée."
        actions={canExport ? <a href={`/clients/stock/export${qs ? `?${qs}` : ""}`} className="btn-secondary btn-sm">Export Excel</a> : null}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Card><div className="label">Points de vente</div><div className="kpi mt-2">{counts.total}</div></Card>
        <Card><div className="label">Déjà relevés</div><div className="kpi mt-2">{counts.read}</div></Card>
        <Card><div className="label">Produits en rupture</div><div className={`kpi mt-2 ${counts.stockouts ? "text-red" : ""}`}>{counts.stockouts}</div><div className="text-[11px] text-muted mt-1">dernier relevé = 0</div></Card>
        <Card><div className="label">Relevé à refaire</div><div className={`kpi mt-2 ${counts.stale ? "text-red" : ""}`}>{counts.stale}</div><div className="text-[11px] text-muted mt-1">≥ {settings.clientStock.staleDays} j</div></Card>
        <Card><div className="label">Jamais relevés</div><div className="kpi mt-2">{counts.never}</div></Card>
      </div>

      <form method="get" className="card card-pad mb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2 text-[13px]">
        <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9" aria-label="Marque"><option value="">Toutes marques</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select name="city" defaultValue={sp.city ?? ""} className="select h-9" aria-label="Ville"><option value="">Toutes villes</option>{cities.rows.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}</select>
        <select name="author" defaultValue={sp.author ?? ""} className="select h-9" aria-label="Dernier auteur"><option value="">Tout auteur (animatrice / commercial)</option>{authors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select name="commercial" defaultValue={sp.commercial ?? ""} className="select h-9" aria-label="Commercial en charge"><option value="">Tout commercial</option>{commercials.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select name="channel" defaultValue={sp.channel ?? ""} className="select h-9" aria-label="Canal"><option value="">Tout canal</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}</select>
        <select name="aging" defaultValue={sp.aging ?? ""} className="select h-9" aria-label="Ancienneté"><option value="">Toute ancienneté</option>{AGINGS.map((a) => <option key={a} value={a}>{AGING_META[a].label}</option>)}</select>
        <button className="btn-secondary h-9" type="submit">Filtrer</button>
      </form>

      {rows.length === 0 ? (
        <Empty title="Aucun point de vente ne correspond" hint="Élargissez les filtres. Un relevé se fait depuis la saisie terrain (animatrice) ou depuis la fiche client, onglet « Stock en point de vente » (commercial)." />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Point de vente</th><th>Ville</th><th>Dernier relevé</th><th>Ancienneté</th><th className="num">Produits relevés</th><th className="num">En rupture</th><th>Dernier auteur</th><th>Canal</th><th>Commercial</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const a = AGING_META[r.aging];
                return (
                  <tr key={r.clientId}>
                    <td><Link href={`/clients/${r.clientId}?tab=stock`} className="font-medium hover:underline">{r.name}</Link><div className="text-[11px] text-muted">{r.type}</div></td>
                    <td className="text-muted">{r.city ?? "—"}</td>
                    <td>{r.lastReadAt ? fmtDateShort(r.lastReadAt) : "—"}</td>
                    <td><Badge tone={a.tone}>{a.label}{r.ageDays !== null ? ` · ${r.ageDays} j` : ""}</Badge></td>
                    <td className="num">{r.productsRead || "—"}</td>
                    <td className={`num ${r.stockouts ? "text-red font-semibold" : ""}`}>{r.lastReadAt ? r.stockouts : "—"}</td>
                    <td>{r.lastAuthor ?? "—"}</td>
                    <td>{r.lastChannel ? <Badge tone={CHANNEL_TONES[r.lastChannel]}>{CHANNEL_LABELS[r.lastChannel]}</Badge> : "—"}</td>
                    <td className="text-muted">{r.commercials.length ? r.commercials.join(", ") : "non affecté"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-faint mt-2">Commercial en charge = compte disposant de « Créer » sur Clients et ayant ce client dans son portefeuille (Utilisateurs &amp; droits → clients assignés). Grossistes exclus : leur stock n&apos;est pas relevé en point de vente.</p>
    </>
  );
}
