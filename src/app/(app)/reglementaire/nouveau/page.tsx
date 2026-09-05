import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { RegulatoryForm } from "@/components/regulatory-form";

export const metadata = { title: "Nouveau dossier" };

export default async function NewRegulatoryPage(props: { searchParams: Promise<{ product?: string }> }) {
  await requireAccess("reglementaire");
  const sp = await props.searchParams;
  const [products, brands, users] = await Promise.all([db.execute(sql`select id, name, brand_id from products where active order by name`), listBrands(), listUsers()]);
  return (
    <>
      <PageHeader eyebrow="Réglementaire" title="Nouveau dossier" />
      <Card className="max-w-2xl"><RegulatoryForm products={(products.rows as { id: string; name: string; brand_id: string | null }[]).map((p) => ({ id: p.id, name: p.name, brandId: p.brand_id }))} brands={brands} users={users} defaults={{ productId: sp.product }} /></Card>
    </>
  );
}
