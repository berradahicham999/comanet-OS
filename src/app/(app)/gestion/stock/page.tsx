import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, canDo, hasFlag, brandFilter } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { listWarehouses } from "@/lib/gestion/refs";
import { listMovements, stockState } from "@/lib/gestion/ledger";
import { MANUAL_TYPES, MOVEMENT_META, SOURCE_LABELS, expiryStatus, type SourceType } from "@/lib/gestion/ledger-shared";
import { SCALE, fmtMoney, fmtQty, formatScaled, fromDb } from "@/lib/gestion/money";
import { fmtDate, fmtDateShort, iso, today } from "@/lib/format";
import { PageHeader, Card, Badge, BrandDot, Empty, Tabs } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { manualMovementAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock réel" };

const EXPIRY_TONE = { PERIME: "red", PROCHE: "orange", OK: "green" } as const;
const EXPIRY_LABEL = { PERIME: "périmé", PROCHE: "proche", OK: "ok" } as const;

export default async function StockReelPage(props: { searchParams: Promise<{ view?: string; at?: string; brand?: string; error?: string; done?: string }> }) {
  await requireAccess("stock");
  const sp = await props.searchParams;
  const view = sp.view === "journal" ? "journal" : sp.view === "lots" ? "lots" : "etat";
  const now = iso(today());
  const at = sp.at && /^\d{4}-\d{2}-\d{2}$/.test(sp.at) ? sp.at : now;
  const [settings, brands, warehouses, seeMargins, canValidate, scopeBrands] = await Promise.all([
    getSettings(), listBrands(), listWarehouses(), hasFlag("seeMargins"), canDo("stock", "validate"), brandFilter(),
  ]);
  const alertDays = settings.gestion.expiryAlertDays;
  const [state, movements, products] = await Promise.all([
    stockState({ at, brandId: sp.brand || null, brandIds: scopeBrands }),
    view === "journal" ? listMovements({ limit: 300 }) : Promise.resolve([]),
    canValidate ? db.execute<{ id: string; name: string }>(sql`select id, name from products where active and kind = 'PRODUIT' order by name`) : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
  ]);
  const internal = warehouses.filter((w) => w.kind === "INTERNE");
  const external = warehouses.filter((w) => w.kind === "EXTERNE");
  const whLabel = new Map(warehouses.map((w) => [w.key, w.label]));
  const withStock = state.filter((r) => r.movements > 0 || r.external.length > 0);
  const totalValue = withStock.reduce((a, r) => a + (fromDb(r.value, SCALE.money) ?? 0n), 0n);
  const allLots = withStock.flatMap((r) => r.lots.map((l) => ({ ...l, product: r.name, productId: r.productId, status: expiryStatus(l.expiryDate, at, alertDays) })));
  const lotsNear = allLots.filter((l) => l.status === "PROCHE").length;
  const lotsExpired = allLots.filter((l) => l.status === "PERIME" && l.warehouseKey !== "NON_VENDABLE").length;
  const qs = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ view, at: at === now ? undefined : at, brand: sp.brand, ...extra })) if (v) p.set(k, v); return `/gestion/stock?${p.toString()}`; };

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Stock réel"
        subtitle={<>Entrepôt COMANET : somme des mouvements du journal, jamais un chiffre écrasé. Dépôts Cospharma et Pharmafirst : dernière photo importée. {at !== now && <b>État au {fmtDate(at)}.</b>} La couverture 🟢🟠🔴 de « Stock &amp; achats » passera sur ce journal à la bascule.</>}
        actions={<Link href="/imports?type=STOCK_INITIAL" className="btn-secondary btn-sm">Importer un stock initial</Link>}
      >
        <GestionTabs current="/gestion/stock" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Mouvement enregistré dans le journal.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card><div className="label">Articles suivis</div><div className="kpi mt-2">{withStock.length}</div><div className="mt-2 text-[12px] text-muted">au journal ou en dépôt externe</div></Card>
        <Card><div className="label">Valeur au CMUP (entrepôt)</div><div className="kpi mt-2">{seeMargins ? `${fmtMoney(formatScaled(totalValue, SCALE.money), 0)} MAD` : "—"}</div><div className="mt-2 text-[12px] text-muted">{seeMargins ? "hors dépôts externes" : "réservé au droit « prix d'achat et marges »"}</div></Card>
        <Card><div className="label">Lots proches de la péremption</div><div className={`kpi mt-2 ${lotsNear ? "text-orange" : ""}`}>{lotsNear}</div><div className="mt-2 text-[12px] text-muted">à moins de {alertDays} jours</div></Card>
        <Card><div className="label">Lots périmés en stock vendable</div><div className={`kpi mt-2 ${lotsExpired ? "text-red" : ""}`}>{lotsExpired}</div><div className="mt-2 text-[12px] text-muted">à passer en casse / périmé</div></Card>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <Tabs current={qs({})} tabs={[{ href: qs({ view: "etat" }), label: "État du stock" }, { href: qs({ view: "lots" }), label: "Lots", count: allLots.length }, { href: qs({ view: "journal" }), label: "Journal" }]} />
        <form method="get" className="flex flex-wrap items-end gap-2 text-[13px]">
          <input type="hidden" name="view" value={view} />
          <label><span className="label block mb-1">Marque</span><select name="brand" defaultValue={sp.brand ?? ""} className="select h-9 w-auto"><option value="">Toutes</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label><span className="label block mb-1">Stock au</span><input type="date" name="at" defaultValue={at} max={now} className="input h-9 w-auto" /></label>
          <button className="btn-secondary h-9" type="submit">Afficher</button>
        </form>
      </div>

      {view === "etat" && (withStock.length === 0 ? (
        <Empty
          title="Le journal de stock est vide"
          hint={<>Chargez le stock initial de l&apos;entrepôt COMANET : un fichier Excel avec, par ligne, la référence ou la désignation de l&apos;article, le n° de lot et sa péremption, la quantité et le coût unitaire HT. Pour Gamarde chez Cospharma et Auracos chez Pharmafirst, importez plutôt une « Stock (photo) » en choisissant le dépôt.</>}
          action={<Link href="/imports?type=STOCK_INITIAL" className="btn-primary btn-sm">Importer le stock initial</Link>}
        />
      ) : (
        <DataTable
          columns={[
            { key: "name", label: "Article" },
            ...internal.map((w) => ({ key: `wh:${w.key}`, label: w.key === "PRINCIPAL" ? "Entrepôt" : w.label, num: true })),
            ...external.map((w) => ({ key: `ext:${w.key}`, label: w.label.replace("Dépôt ", ""), num: true })),
            { key: "available", label: "Disponible", num: true },
            ...(seeMargins ? [{ key: "cmup", label: "CMUP", num: true }, { key: "value", label: "Valeur", num: true }] : []),
            { key: "lots", label: "Lots", hideOnMobile: true },
            { key: "last", label: "Dernier mvt", hideOnMobile: true },
          ]}
          rows={withStock.map((r) => {
            const near = r.lots.map((l) => expiryStatus(l.expiryDate, at, alertDays)).filter(Boolean);
            const worst = near.includes("PERIME") ? "PERIME" : near.includes("PROCHE") ? "PROCHE" : near.length ? "OK" : null;
            return {
              id: r.productId,
              href: `/produits/${r.productId}#stock`,
              cells: {
                name: <span className="flex items-center gap-2 min-w-0">{r.brandColor && <BrandDot color={r.brandColor} />}<Link href={`/produits/${r.productId}#stock`} className="font-medium hover:underline truncate">{r.name}</Link>{r.code && <span className="text-[11px] text-faint font-mono">{r.code}</span>}</span>,
                ...Object.fromEntries(internal.map((w) => [`wh:${w.key}`, r.byWarehouse[w.key] ? fmtQty(r.byWarehouse[w.key]) : "—"])),
                ...Object.fromEntries(external.map((w) => { const e = r.external.find((x) => x.warehouseKey === w.key); return [`ext:${w.key}`, e ? <span title={`Photo du ${fmtDate(e.date)}`}>{fmtQty(e.qty)} <span className="text-[10.5px] text-faint">{fmtDateShort(e.date)}</span></span> : "—"]; })),
                available: <b>{fmtQty(r.available)}</b>,
                cmup: fmtMoney(r.cmup),
                value: fmtMoney(r.value, 0),
                lots: r.lots.length ? <span className="flex items-center gap-1">{r.lots.length} {worst && <Badge tone={EXPIRY_TONE[worst]}>{EXPIRY_LABEL[worst]}</Badge>}</span> : r.trackLots ? <span className="text-faint">aucun</span> : "—",
                last: <span className="text-muted text-[12px]">{r.lastOut || r.lastIn ? fmtDateShort([r.lastIn, r.lastOut].filter(Boolean).sort().pop()!) : "—"}</span>,
              },
              sort: {
                name: r.name, available: Number(r.available), cmup: r.cmup === null ? null : Number(r.cmup), value: r.value === null ? null : Number(r.value),
                ...Object.fromEntries(internal.map((w) => [`wh:${w.key}`, r.byWarehouse[w.key] ? Number(r.byWarehouse[w.key]) : null])),
              },
              search: `${r.name} ${r.code ?? ""} ${r.brand ?? ""}`,
              filters: { brand: r.brand ?? "—", expiry: worst ?? "NONE" },
            };
          })}
          filters={[{ key: "expiry", label: "Péremption", options: [{ value: "PERIME", label: "Lot périmé" }, { value: "PROCHE", label: "Lot proche" }, { value: "OK", label: "Lots ok" }] }]}
          initialSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Article, référence, marque…"
        />
      ))}

      {view === "lots" && (
        <DataTable
          columns={[{ key: "product", label: "Article" }, { key: "lot", label: "Lot" }, { key: "expiry", label: "Péremption" }, { key: "status", label: "Statut" }, { key: "warehouse", label: "Dépôt" }, { key: "qty", label: "Quantité", num: true }]}
          rows={allLots.map((l) => ({
            id: `${l.lotId}|${l.warehouseKey}`,
            href: `/produits/${l.productId}#stock`,
            cells: {
              product: <Link href={`/produits/${l.productId}#stock`} className="font-medium hover:underline">{l.product}</Link>,
              lot: <span className="font-mono text-[12px]">{l.lotNumber}</span>,
              expiry: fmtDate(l.expiryDate),
              status: l.status ? <Badge tone={EXPIRY_TONE[l.status]}>{EXPIRY_LABEL[l.status]}</Badge> : <span className="text-faint">sans date</span>,
              warehouse: <span className="text-muted">{whLabel.get(l.warehouseKey) ?? l.warehouseKey}</span>,
              qty: fmtQty(l.qty),
            },
            sort: { product: l.product, lot: l.lotNumber, expiry: l.expiryDate, qty: Number(l.qty) },
            search: `${l.product} ${l.lotNumber}`,
            filters: { status: l.status ?? "NONE" },
          }))}
          filters={[{ key: "status", label: "Statut", options: [{ value: "PERIME", label: "Périmé" }, { value: "PROCHE", label: "Proche" }, { value: "OK", label: "Ok" }, { value: "NONE", label: "Sans date" }] }]}
          initialSort={{ key: "expiry", dir: "asc" }}
          empty="Aucun lot en stock. Les lots naissent avec le stock initial et les réceptions."
        />
      )}

      {view === "journal" && (
        <div className={canValidate ? "grid lg:grid-cols-[1fr_320px] gap-4" : ""}>
          <DataTable
            columns={[
              { key: "date", label: "Date" }, { key: "type", label: "Mouvement" }, { key: "product", label: "Article" }, { key: "warehouse", label: "Dépôt" },
              { key: "lot", label: "Lot", hideOnMobile: true }, { key: "qty", label: "Qté", num: true },
              ...(seeMargins ? [{ key: "cost", label: "Coût unit.", num: true, hideOnMobile: true }] : []),
              { key: "source", label: "Origine", hideOnMobile: true },
            ]}
            rows={movements.map((m) => ({
              id: m.id,
              muted: m.reversed || !!m.reversalOf,
              cells: {
                date: <span className="whitespace-nowrap">{fmtDateShort(m.date)}</span>,
                type: <span className="flex items-center gap-1 flex-wrap"><Badge tone={MOVEMENT_META[m.type].tone}>{MOVEMENT_META[m.type].label}</Badge>{m.reversalOf && <Badge tone="gray">contre-passation</Badge>}{m.reversed && <Badge tone="gray">annulé</Badge>}</span>,
                product: <Link href={`/produits/${m.productId}#stock`} className="hover:underline">{m.product}</Link>,
                warehouse: <span className="text-muted text-[12px]">{whLabel.get(m.warehouseKey) ?? m.warehouseKey}{m.counterpartWarehouseKey && ` ↔ ${whLabel.get(m.counterpartWarehouseKey) ?? m.counterpartWarehouseKey}`}</span>,
                lot: m.lotNumber ? <span className="font-mono text-[12px]">{m.lotNumber}</span> : "—",
                qty: <b className={Number(m.quantity) < 0 ? "text-red" : "text-green"}>{Number(m.quantity) > 0 ? "+" : ""}{fmtQty(m.quantity)}</b>,
                cost: fmtMoney(m.unitCost),
                source: <span className="text-[12px] text-muted" title={m.comment ?? undefined}>{SOURCE_LABELS[m.sourceType as SourceType] ?? m.sourceType}{m.importId && <> · <Link href={`/imports/${m.importId}`} className="underline">import</Link></>}{m.createdBy && ` · ${m.createdBy}`}</span>,
              },
              sort: { date: `${m.date}|${String(m.seq).padStart(12, "0")}`, type: m.type, product: m.product, qty: Number(m.quantity) },
              search: `${m.product} ${m.lotNumber ?? ""} ${m.comment ?? ""} ${MOVEMENT_META[m.type].label}`,
              filters: { type: m.type },
            }))}
            filters={[{ key: "type", label: "Type", options: Object.entries(MOVEMENT_META).map(([value, v]) => ({ value, label: v.label })) }]}
            initialSort={{ key: "date", dir: "desc" }}
            empty="Aucun mouvement. Le journal commence avec l'import du stock initial."
          />
          {canValidate && (
            <Card title="Casse, périmé ou transfert">
              <form action={manualMovementAction} className="space-y-2 text-[13px]">
                <label className="block"><span className="label block mb-1">Mouvement</span>
                  <select name="type" className="select h-9">{MANUAL_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_META[t].label}</option>)}</select>
                </label>
                <label className="block"><span className="label block mb-1">Article</span>
                  <select name="productId" className="select h-9" required><option value="">—</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="label block mb-1">Depuis</span><select name="warehouseKey" defaultValue="PRINCIPAL" className="select h-9">{internal.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
                  <label className="block"><span className="label block mb-1">Vers (transfert)</span><select name="counterpartWarehouseKey" defaultValue="NON_VENDABLE" className="select h-9">{warehouses.filter((w) => w.active).map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
                  <label className="block"><span className="label block mb-1">Quantité</span><input name="quantity" inputMode="decimal" className="input h-9" required /></label>
                  <label className="block"><span className="label block mb-1">Lot</span><input name="lotNumber" className="input h-9" placeholder="si suivi par lot" /></label>
                  <label className="block col-span-2"><span className="label block mb-1">Date</span><input type="date" name="date" defaultValue={now} max={now} className="input h-9" /></label>
                </div>
                <label className="block"><span className="label block mb-1">Motif *</span><input name="comment" className="input h-9" required placeholder="Carton abîmé à la réception, lot périmé…" /></label>
                <button className="btn-primary btn-sm w-full" type="submit">Enregistrer le mouvement</button>
                <p className="text-[11px] text-faint">Une casse sort du stock au CMUP. Un transfert vers Cospharma ou Pharmafirst ne fait que sortir de l&apos;entrepôt : leur stock se lit sur leurs photos.</p>
              </form>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
