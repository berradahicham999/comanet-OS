import Link from "next/link";
import { can } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listPurchases } from "@/lib/gestion/purchases";
import { PURCHASE_STATUS_META, PURCHASE_TYPE_LABELS, isLateOrder, purchaseStatusLabel, type PurchaseType } from "@/lib/gestion/purchases-shared";
import { fmtMoney } from "@/lib/gestion/money";
import { fmtDate, iso, today } from "@/lib/format";
import { PageHeader, Badge, Empty, Tabs } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs, requireGestionView, visiblePurchaseTypes } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Achats" };

const EMPTY_HINT: Record<PurchaseType, string> = {
  COMMANDE: "Une commande fournisseur (CF) s'envoie au laboratoire en PDF ; son reste à recevoir alimente les « commandes en cours » du stock et de la commande conseillée.",
  RECEPTION: "Une réception (BR) fait entrer le stock, lot par lot, au coût de revient (prix × taux + frais d'approche) : c'est elle qui nourrit le CMUP. Elle se crée depuis une commande, ou seule.",
  FACTURE: "Une facture fournisseur s'enregistre depuis ses réceptions (« Facturer des réceptions ») : les écarts de prix et de quantité sont signalés. Une facture de services ou de frais se saisit directement.",
  RETOUR: "Un retour fournisseur (RF) se crée depuis une réception validée : la marchandise sort du stock, sur son lot.",
};

export default async function PurchasesPage(props: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const access = await requireGestionView();
  const sp = await props.searchParams;
  const types = visiblePurchaseTypes(access.perms);
  const type = (types.includes(sp.type as PurchaseType) ? sp.type : types[0]) as PurchaseType | undefined;
  if (!type) return <Empty title="Accès restreint" hint="Les achats demandent le droit « Voir » sur Achats (ou sur Stock pour les réceptions)." />;
  const [rows, settings] = await Promise.all([listPurchases({ type }), getSettings()]);
  const g = settings.gestion.purchases;
  const todayIso = iso(today());
  const canAchats = can(access.perms, "achats", "create");
  const canStock = can(access.perms, "stock", "create");
  const createHref = type === "COMMANDE" && canAchats ? { href: "/gestion/achats/nouveau?type=COMMANDE", label: "+ Commande" }
    : type === "RECEPTION" && (canAchats || canStock) ? { href: "/gestion/achats/nouveau?type=RECEPTION", label: "+ Réception sans commande" }
      : type === "FACTURE" && canAchats ? { href: "/gestion/achats/nouveau?type=FACTURE", label: "+ Facture de services" } : null;

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Achats"
        subtitle="Commandes aux laboratoires, réceptions (entrée en stock au coût de revient), factures fournisseurs rapprochées, retours. Devises au taux saisi sur chaque pièce."
        actions={<span className="flex gap-2 flex-wrap">
          {can(access.perms, "achats", "view") && <Link href="/gestion/achats/suivi" className="btn-secondary btn-sm">Suivi des achats</Link>}
          {createHref && <Link href={createHref.href} className="btn-primary btn-sm">{createHref.label}</Link>}
        </span>}
      >
        <GestionTabs current="/gestion/achats" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Tabs current={`/gestion/achats?type=${type}`} tabs={types.map((t) => ({ href: `/gestion/achats?type=${t}`, label: PURCHASE_TYPE_LABELS[t].many }))} />
        {type === "FACTURE" && canAchats && <Link href="/gestion/achats/facturer" className="btn-secondary btn-sm">Facturer des réceptions</Link>}
      </div>

      {rows.length === 0 ? (
        <Empty title={`Aucune pièce : ${PURCHASE_TYPE_LABELS[type].many.toLowerCase()}`} hint={EMPTY_HINT[type]} action={createHref ? <Link href={createHref.href} className="btn-primary btn-sm">{createHref.label.replace("+ ", "Créer : ")}</Link> : undefined} />
      ) : (
        <DataTable
          columns={[
            { key: "number", label: "Numéro" }, { key: "date", label: "Date" }, { key: "supplier", label: "Fournisseur" }, { key: "status", label: "Statut" },
            { key: "currency", label: "Montant devise", num: true, hideOnMobile: true }, { key: "mad", label: type === "RECEPTION" ? "Revient MAD" : "HT MAD", num: true },
            ...(type === "COMMANDE" ? [{ key: "expected", label: "Livraison attendue", hideOnMobile: true }] : []),
            ...(type === "FACTURE" ? [{ key: "due", label: "Échéance", hideOnMobile: true }] : []),
          ]}
          rows={rows.map((d) => {
            const late = type === "COMMANDE" && isLateOrder(d.expectedDate, d.status, todayIso, g.lateOrderGraceDays);
            const mad = type === "RECEPTION" ? (Number(d.netHtMad) + Number(d.landedMad)).toFixed(2) : d.netHtMad;
            return {
              id: d.id,
              href: `/gestion/achats/${d.id}`,
              muted: d.status === "ANNULE",
              cells: {
                number: <span className="flex items-center gap-2"><Link href={`/gestion/achats/${d.id}`} className="font-medium font-mono hover:underline">{d.number ?? "Brouillon"}</Link>{d.supplierRef && <span className="text-[11px] text-faint">réf. {d.supplierRef}</span>}</span>,
                date: fmtDate(d.date),
                supplier: <Link href={`/gestion/fournisseurs/${d.supplierId}`} className="hover:underline">{d.supplier}</Link>,
                status: <span className="flex gap-1 flex-wrap"><Badge tone={PURCHASE_STATUS_META[d.status].tone}>{purchaseStatusLabel(d.type, d.status)}</Badge>{late && <Badge tone="red">en retard</Badge>}</span>,
                currency: d.currency === "MAD" ? "—" : `${fmtMoney(d.netHtCurrency)} ${d.currency}`,
                mad: <span className="font-medium">{fmtMoney(mad)}</span>,
                expected: d.expectedDate ? fmtDate(d.expectedDate) : "—",
                due: d.dueDate ? fmtDate(d.dueDate) : "—",
              },
              sort: { number: d.number ?? "", date: d.date, supplier: d.supplier, status: d.status, mad: Number(mad), expected: d.expectedDate, due: d.dueDate },
              search: `${d.number ?? ""} ${d.supplier} ${d.supplierRef ?? ""}`,
              filters: { status: d.status, currency: d.currency, late: late ? "OUI" : "NON" },
            };
          })}
          filters={[
            { key: "status", label: "Statut", options: [...new Set(rows.map((r) => r.status))].map((v) => ({ value: v, label: purchaseStatusLabel(type, v) })) },
            { key: "currency", label: "Devise", options: [...new Set(rows.map((r) => r.currency))].map((v) => ({ value: v, label: v })) },
            ...(type === "COMMANDE" ? [{ key: "late", label: "Retard", options: [{ value: "OUI", label: "En retard" }] }] : []),
          ]}
          initialSort={{ key: "date", dir: "desc" }}
          searchPlaceholder="Numéro, fournisseur, référence…"
        />
      )}
    </>
  );
}
