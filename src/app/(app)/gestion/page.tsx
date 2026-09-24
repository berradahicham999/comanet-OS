import Link from "next/link";
import { can } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { buildReadiness } from "@/lib/gestion/readiness";
import { iso, today, fmtMAD, fmtDate, fmtNum } from "@/lib/format";
import { PageHeader, Card, Badge, Section } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs, requireGestionView } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gestion commerciale" };

const MODE_LABEL = { OFF: "Sage fait foi", PARALLELE: "Période parallèle (simulation)", ACTIF: "COMANET OS émet les pièces" } as const;

export default async function GestionPage() {
  const access = await requireGestionView();
  const settings = await getSettings();
  const g = settings.gestion;
  const r = await buildReadiness(g, iso(today()));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
  const canEditClients = can(access.perms, "clients", "edit");
  const canEditProducts = can(access.perms, "produits", "edit");
  const isAdmin = can(access.perms, "administration", "validate");

  const clientRows = r.clients.rows.map((c) => ({
    id: c.id,
    href: `/clients/${c.id}?tab=infos`,
    cells: {
      name: <Link href={`/clients/${c.id}?tab=infos`} className="font-medium hover:underline">{c.name}</Link>,
      city: <span className="text-muted">{c.city ?? "—"}</span>,
      revenue: fmtMAD(c.revenue, { compact: true, suffix: false }),
      missing: c.missing.length ? <span className="flex flex-wrap gap-1">{c.missing.map((m) => <Badge key={m} tone="red">{m}</Badge>)}</span> : <Badge tone="green">Prêt à facturer</Badge>,
      recommended: c.recommended.length ? <span className="text-[12px] text-muted">{c.recommended.join(", ")}</span> : "—",
    },
    sort: { name: c.name, city: c.city, revenue: c.revenue, missing: c.missing.length },
    search: `${c.name} ${c.city ?? ""}`,
    filters: { status: c.missing.length ? "INCOMPLET" : "PRET" },
  }));
  const productRows = r.products.rows.map((p) => ({
    id: p.id,
    href: `/produits/${p.id}#gestion`,
    cells: {
      name: <Link href={`/produits/${p.id}#gestion`} className="font-medium hover:underline">{p.name}</Link>,
      brand: <span className="text-muted">{p.brand ?? "—"}</span>,
      code: p.code ? <span className="font-mono text-[12px]">{p.code}</span> : "—",
      revenue: fmtMAD(p.revenue, { compact: true, suffix: false }),
      missing: p.missing.length ? <span className="flex flex-wrap gap-1">{p.missing.map((m) => <Badge key={m} tone="red">{m}</Badge>)}</span> : <Badge tone="green">Prêt</Badge>,
      recommended: p.recommended.length ? <span className="text-[12px] text-muted">{p.recommended.join(", ")}</span> : "—",
    },
    sort: { name: p.name, brand: p.brand, code: p.code, revenue: p.revenue, missing: p.missing.length },
    search: `${p.name} ${p.brand ?? ""} ${p.code ?? ""}`,
    filters: { status: p.missing.length ? "INCOMPLET" : "PRET", brand: p.brand ?? "—" },
  }));
  const brands = [...new Set(r.products.rows.map((p) => p.brand ?? "—"))].sort();
  const statusFilter = { key: "status", label: "Statut", options: [{ value: "INCOMPLET", label: "À compléter" }, { value: "PRET", label: "Prêt" }] };

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Préparation de la bascule"
        subtitle={<>Ce qui manque avant d&apos;émettre la première pièce depuis COMANET OS. Périmètre : les clients et articles vendus par {g.cutover.sites.join(" et ")} depuis le {fmtDate(r.sinceDate)}. Les autres sites (Cospharma, Pharmafirst) continuent d&apos;arriver par import.</>}
      >
        <GestionTabs current="/gestion" />
      </PageHeader>

      <div className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] flex flex-wrap items-center gap-2">
        <span className="label">Mode</span>
        <Badge tone={g.cutover.mode === "ACTIF" ? "green" : g.cutover.mode === "PARALLELE" ? "orange" : "gray"}>{MODE_LABEL[g.cutover.mode]}</Badge>
        <span className="text-muted">Bascule prévue : {g.cutover.date ? fmtDate(g.cutover.date) : "date à fixer"}. Les bons de livraison et factures arrivent avec le lot 2 ; d&apos;ici là, rien n&apos;est émis ni projeté dans les ventes.</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card href={isAdmin ? "/parametres/gestion" : undefined}>
          <div className="label">Société</div>
          <div className="kpi mt-2">{r.company.missing.length ? `${r.company.missing.length} manquant${r.company.missing.length > 1 ? "s" : ""}` : "Complète"}</div>
          <div className="mt-2 text-[12px] text-muted">
            Logo {r.company.hasLogo ? "✓" : "manquant"} · cachet {r.company.hasCachet ? "✓" : "manquant"}
          </div>
        </Card>
        <Card>
          <div className="label">Clients prêts à facturer</div>
          <div className="kpi mt-2">{r.clients.ready} / {r.clients.total}</div>
          <div className="mt-2 text-[12px] text-muted">{pct(r.clients.ready, r.clients.total)} % · raison sociale, ICE, adresse, ville</div>
        </Card>
        <Card>
          <div className="label">Articles prêts</div>
          <div className="kpi mt-2">{r.products.ready} / {r.products.total}</div>
          <div className="mt-2 text-[12px] text-muted">{pct(r.products.ready, r.products.total)} % · référence COMANET (ex. CYG01)</div>
        </Card>
        <Card href={can(access.perms, "stock", "view") ? "/gestion/stock" : undefined}>
          <div className="label">Journal de stock</div>
          <div className="kpi mt-2">{r.stock.movements ? `${fmtNum(r.stock.products)} article${r.stock.products > 1 ? "s" : ""}` : "Vide"}</div>
          <div className="mt-2 text-[12px] text-muted">{r.stock.lastInitial ? `stock initial au ${fmtDate(r.stock.lastInitial)}` : "stock initial à charger"}</div>
        </Card>
      </div>

      {r.company.missing.length > 0 && (
        <div className="mb-6 rounded-2xl border border-orange/30 bg-orange-soft px-4 py-3 text-[13px] text-orange">
          Identité de la société incomplète ({r.company.missing.join(", ")}) : ces mentions sont obligatoires sur chaque facture.{" "}
          {isAdmin ? <Link href="/parametres/gestion" className="font-medium underline">Compléter dans les paramètres</Link> : "Un administrateur doit les compléter."}
        </div>
      )}

      <Section
        title="Clients à préparer"
        description={<>{r.clients.total - r.clients.ready} fiche{r.clients.total - r.clients.ready > 1 ? "s" : ""} sans les mentions obligatoires d&apos;une facture. Triées par CA : commencez par le haut.{canEditClients ? "" : " Compléter demande le droit « Modifier » sur Clients."} Pour en compléter beaucoup d&apos;un coup : <Link href="/imports?type=CLIENTS" className="text-accent font-medium">importer une liste</Link> (code Sage, ICE, adresse, délai…).</>}
      >
        <DataTable
          columns={[
            { key: "name", label: "Client" }, { key: "city", label: "Ville" }, { key: "revenue", label: "CA HT (fenêtre)", num: true },
            { key: "missing", label: "Obligatoire" }, { key: "recommended", label: "Recommandé", hideOnMobile: true },
          ]}
          rows={clientRows}
          filters={[statusFilter]}
          initialSort={{ key: "revenue", dir: "desc" }}
          searchPlaceholder="Rechercher un client…"
          empty="Aucun client vendu par COMANET sur la période."
          pageSize={25}
        />
      </Section>

      <Section
        title="Articles à préparer"
        description={`La référence COMANET est celle imprimée sur les factures Sage (colonne REF). Le code actuel des fiches vient des fichiers distributeurs et n'est pas le même.${canEditProducts ? "" : " Compléter demande le droit « Modifier » sur Produits."}`}
      >
        <DataTable
          columns={[
            { key: "name", label: "Article" }, { key: "brand", label: "Marque" }, { key: "code", label: "Réf. COMANET" },
            { key: "revenue", label: "CA HT (fenêtre)", num: true }, { key: "missing", label: "Obligatoire" }, { key: "recommended", label: "Recommandé", hideOnMobile: true },
          ]}
          rows={productRows}
          filters={[statusFilter, { key: "brand", label: "Marque", options: brands.map((b) => ({ value: b, label: b })) }]}
          initialSort={{ key: "revenue", dir: "desc" }}
          searchPlaceholder="Rechercher un article…"
          empty="Aucun article vendu par COMANET sur la période."
          pageSize={25}
        />
      </Section>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card title="Stock">
          <ul className="space-y-2 text-[13px]">
            <li className="flex items-start justify-between gap-3">
              <span><b>Entrepôt COMANET</b> — suivi par le journal de mouvements.<br /><span className="text-muted">{r.stock.movements ? `${fmtNum(r.stock.movements)} mouvements sur ${fmtNum(r.stock.products)} articles.` : "Chargez le stock initial (article, lot, péremption, quantité, coût unitaire)."}</span></span>
              {can(access.perms, "stock", "create") && <Link href="/imports?type=STOCK_INITIAL" className="btn-secondary btn-sm shrink-0">Stock initial</Link>}
            </li>
            {r.stock.external.map((e) => (
              <li key={e.warehouseKey} className="flex items-start justify-between gap-3">
                <span><b>{e.label}</b> — stock confié, connu par photo importée.<br /><span className="text-muted">{e.date ? `Dernière photo au ${fmtDate(e.date)} (${e.products} article${e.products > 1 ? "s" : ""}).` : "Aucune photo : importez un fichier « Stock (photo) » en choisissant ce dépôt."}</span></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Numérotation ${iso(today()).slice(0, 4)}`} action={isAdmin ? <Link href="/parametres/gestion#numerotation" className="text-[12px] text-accent font-medium">Régler</Link> : undefined}>
          <div className="space-y-1 text-[13px]">
            {r.series.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2">
                <span>{s.label}</span>
                <span className="font-mono text-[12px] text-muted">{s.active ? `prochain : ${s.next ?? "format invalide"}` : "désactivée"}</span>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-faint mt-3">Pour reprendre la séquence Sage à la bascule, réglez le « prochain numéro » de chaque série tant qu&apos;aucune pièce n&apos;a été numérotée dans l&apos;année.</p>
        </Card>
      </div>
    </>
  );
}
