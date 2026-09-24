import Link from "next/link";
import { requireAccess, canDo } from "@/lib/access";
import { listSuppliers, SUPPLIER_NATURES } from "@/lib/gestion/suppliers";
import { PageHeader, Badge, BrandDot, Empty } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fournisseurs" };

export default async function SuppliersPage() {
  await requireAccess("achats");
  const [suppliers, canCreate] = await Promise.all([listSuppliers({ includeArchived: true }), canDo("achats", "create")]);
  const brandNames = [...new Set(suppliers.flatMap((s) => s.brands.map((b) => b.name)))].sort();

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Fournisseurs"
        subtitle="Laboratoires et marques (leurs réceptions alimenteront le stock) et prestataires hors stock : PLV, goodies, impression, transport. Un fournisseur qui a servi s'archive, il ne se supprime pas."
        actions={canCreate ? <Link href="/gestion/fournisseurs/nouveau" className="btn-primary btn-sm">+ Fournisseur</Link> : undefined}
      >
        <GestionTabs current="/gestion/fournisseurs" />
      </PageHeader>

      {suppliers.length === 0 ? (
        <Empty
          title="Aucun fournisseur"
          hint="Créez d'abord les laboratoires dont COMANET distribue les marques (Gamarde, Alphascience, CygneLab…), puis les prestataires de PLV et de goodies. Les commandes et réceptions arrivent avec le lot 3."
          action={canCreate ? <Link href="/gestion/fournisseurs/nouveau" className="btn-primary btn-sm">Créer le premier fournisseur</Link> : undefined}
        />
      ) : (
        <DataTable
          columns={[
            { key: "name", label: "Fournisseur" }, { key: "nature", label: "Nature" }, { key: "brands", label: "Marques" },
            { key: "country", label: "Pays / devise" }, { key: "contact", label: "Contact", hideOnMobile: true }, { key: "terms", label: "Délai", num: true },
          ]}
          rows={suppliers.map((s) => ({
            id: s.id,
            href: `/gestion/fournisseurs/${s.id}`,
            muted: !s.active,
            cells: {
              name: <span className="flex items-center gap-2"><Link href={`/gestion/fournisseurs/${s.id}`} className="font-medium hover:underline">{s.legalName}</Link>{s.code && <span className="text-[11px] text-faint font-mono">{s.code}</span>}{!s.active && <Badge tone="gray">archivé</Badge>}</span>,
              nature: <Badge tone={s.nature === "MARCHANDISES" ? "blue" : "purple"}>{s.nature === "MARCHANDISES" ? "Marchandises" : "Hors stock"}</Badge>,
              brands: s.brands.length ? <span className="flex flex-wrap gap-2">{s.brands.map((b) => <span key={b.id} className="inline-flex items-center gap-1 text-[12px]"><BrandDot color={b.color} />{b.name}</span>)}</span> : "—",
              country: <span className="text-muted">{s.country} · {s.currency}</span>,
              contact: <span className="text-muted">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</span>,
              terms: s.paymentDays !== null ? `${s.paymentDays} j` : "—",
            },
            sort: { name: s.legalName, nature: s.nature, country: s.country, terms: s.paymentDays },
            search: `${s.legalName} ${s.code ?? ""} ${s.ice ?? ""} ${s.brands.map((b) => b.name).join(" ")} ${s.city ?? ""}`,
            filters: { nature: s.nature, status: s.active ? "ACTIF" : "ARCHIVE", brand: s.brands.map((b) => b.name) },
          }))}
          filters={[
            { key: "nature", label: "Nature", options: Object.entries(SUPPLIER_NATURES).map(([value, label]) => ({ value, label })) },
            { key: "status", label: "Statut", options: [{ value: "ACTIF", label: "Actifs" }, { value: "ARCHIVE", label: "Archivés" }] },
            ...(brandNames.length ? [{ key: "brand", label: "Marque", options: brandNames.map((b) => ({ value: b, label: b })) }] : []),
          ]}
          initialSort={{ key: "name", dir: "asc" }}
          searchPlaceholder="Nom, ICE, marque…"
        />
      )}
    </>
  );
}
