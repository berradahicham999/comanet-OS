import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { SECTORS } from "@/lib/sectors";
import { PageHeader, Card } from "@/components/ui";
import { NewClientForm } from "@/components/gestion/new-client-form";
import { createClientAction, checkClientDuplicates } from "../gestion-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau client" };

export default async function NewClientPage(props: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("clients", "create");
  const sp = await props.searchParams;
  return (
    <>
      <PageHeader eyebrow={<Link href="/clients" className="hover:underline">Clients</Link>} title="Nouveau client" subtitle="Un client est un point de vente. Avant de créer, vérifiez qu'il n'existe pas déjà sous un autre nom : les ventes importées ont déjà créé des centaines de fiches." />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <Card className="max-w-3xl"><NewClientForm action={createClientAction} check={checkClientDuplicates} sectors={SECTORS} /></Card>
    </>
  );
}
