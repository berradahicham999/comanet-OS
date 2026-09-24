import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { listPaymentModes } from "@/lib/gestion/refs";
import { PageHeader, Card } from "@/components/ui";
import { SupplierForm } from "@/components/gestion/supplier-form";
import { createSupplierAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau fournisseur" };

export default async function NewSupplierPage(props: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("achats", "create");
  const sp = await props.searchParams;
  const [brands, modes] = await Promise.all([listBrands(), listPaymentModes()]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/gestion/fournisseurs" className="hover:underline">Fournisseurs</Link>} title="Nouveau fournisseur" />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <Card className="max-w-3xl"><SupplierForm action={createSupplierAction} brands={brands} paymentModes={modes} withDuplicateCheck /></Card>
    </>
  );
}
