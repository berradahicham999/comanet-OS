import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { can } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { listCounts } from "@/lib/gestion/counts";
import { COUNT_STATUS_META, type CountStatus } from "@/lib/gestion/counts-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs, requireGestionView } from "@/components/gestion/gestion-nav";
import { createCountAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventaires" };

export default async function CountsPage(props: { searchParams: Promise<{ error?: string }> }) {
  const access = await requireGestionView();
  const sp = await props.searchParams;
  const canCreate = can(access.perms, "stock", "create");
  const [counts, brands, warehouses] = await Promise.all([
    listCounts(), listBrands(),
    db.execute<{ key: string; label: string }>(sql`select key, label from warehouses where active and kind = 'INTERNE' order by sort, key`),
  ]);

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Inventaires"
        subtitle="Un inventaire fige le stock théorique au démarrage, se compte à plusieurs sur téléphone (scan du code-barres), à l'aveugle si voulu, puis ses écarts deviennent des ajustements du journal — avec un motif chacun.">
        <GestionTabs current="/gestion/inventaires" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div>
          {counts.length === 0 ? (
            <Empty title="Aucun inventaire" hint="Commencez par un inventaire tournant sur une marque, ou préparez l'inventaire annuel du 31/12 : il servira de point de départ à la bascule." />
          ) : (
            <DataTable
              columns={[
                { key: "title", label: "Inventaire" }, { key: "date", label: "Date" }, { key: "status", label: "Statut" },
                { key: "lines", label: "Lignes", num: true, hideOnMobile: true }, { key: "accuracy", label: "Fiabilité", num: true }, { key: "gap", label: "Écart net", num: true, hideOnMobile: true },
              ]}
              rows={counts.map((c) => {
                const st = c.stats as { accuracyLines?: number | null; gapValueNet?: string } | null;
                return {
                  id: c.id, href: `/gestion/inventaires/${c.id}`, muted: c.status === "ANNULE",
                  cells: {
                    title: <span className="flex items-center gap-2 flex-wrap"><Link href={`/gestion/inventaires/${c.id}`} className="font-medium hover:underline">{c.title}</Link>{c.number && <span className="font-mono text-[11px] text-faint">{c.number}</span>}{c.blind && <Badge tone="gray">à l&apos;aveugle</Badge>}</span>,
                    date: fmtDate(c.count_date),
                    status: <Badge tone={COUNT_STATUS_META[c.status as CountStatus].tone}>{COUNT_STATUS_META[c.status as CountStatus].label}</Badge>,
                    lines: `${c.lines}${c.entries ? ` · ${c.entries} saisies` : ""}`,
                    accuracy: st?.accuracyLines != null ? `${st.accuracyLines.toLocaleString("fr-FR")} %` : "—",
                    gap: st?.gapValueNet ? `${fmtMoney(st.gapValueNet)} MAD` : "—",
                  },
                  sort: { title: c.title, date: c.count_date, status: c.status, lines: c.lines, accuracy: st?.accuracyLines ?? null },
                  search: `${c.title} ${c.number ?? ""}`,
                  filters: { status: c.status },
                };
              })}
              filters={[{ key: "status", label: "Statut", options: Object.entries(COUNT_STATUS_META).map(([value, m]) => ({ value, label: m.label })) }]}
              initialSort={{ key: "date", dir: "desc" }}
            />
          )}
        </div>
        {canCreate && (
          <Card title="Préparer un inventaire">
            <form action={createCountAction} className="space-y-3 text-[13px]">
              <label className="block"><span className="label block mb-1">Nom *</span><input name="title" className="input h-9" placeholder="Inventaire annuel 2026, tournant Gamarde…" required /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Date du comptage</span><input type="date" name="countDate" defaultValue={iso(today())} className="input h-9" required /></label>
                <label className="block"><span className="label block mb-1">Dépôt</span>
                  <select name="warehouseKey" className="select h-9">{warehouses.rows.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
              </div>
              <div><span className="label block mb-1">Marques (aucune cochée = tout le stock)</span>
                <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-40 overflow-auto">{brands.map((b) => <label key={b.id} className="flex items-center gap-1"><input type="checkbox" name="brandIds" value={b.id} /> {b.name}</label>)}</div>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" name="blind" defaultChecked /> À l&apos;aveugle : les compteurs ne voient pas le stock théorique</label>
              <label className="block"><span className="label block mb-1">Consignes</span><textarea name="notes" className="input min-h-14 py-2" placeholder="Zone, ordre de passage, qui compte quoi…" /></label>
              <button className="btn-primary btn-sm" type="submit">Préparer</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
