import { requireAccess } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { ProductForm } from "@/components/product-form";

export const metadata = { title: "Nouveau produit" };

export default async function NewProductPage() {
  await requireAccess("produits");
  const brands = await listBrands();
  return (
    <>
      <PageHeader eyebrow="Produits" title="Nouveau produit" />
      <Card className="max-w-2xl"><ProductForm brands={brands} /></Card>
    </>
  );
}
