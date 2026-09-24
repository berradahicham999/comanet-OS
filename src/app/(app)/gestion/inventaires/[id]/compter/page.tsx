import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, requireAccessContext } from "@/lib/access";
import { getCount, myEntries } from "@/lib/gestion/counts";
import { PageHeader } from "@/components/ui";
import { CountScanner, type ScanProduct } from "@/components/gestion/count-scanner";
import { addEntryAction, deleteEntryAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comptage" };

export default async function CountingPage(props: { params: Promise<{ id: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "stock", "create")) redirect(a.home);
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getCount(id);
  if (!c) notFound();
  if (c.status !== "EN_COURS") redirect(`/gestion/inventaires/${id}`);
  // À l'aveugle, le théorique ne quitte jamais le serveur.
  const byProduct = new Map<string, ScanProduct>();
  for (const l of c.lines) {
    const p = byProduct.get(l.productId) ?? { id: l.productId, name: l.product, ref: l.ref, ean: l.ean, brand: l.brand, trackLots: l.trackLots, lots: [], ...(c.blind ? {} : { theoretical: "0" }) };
    if (l.lotNumber) p.lots.push({ lot: l.lotNumber, expiry: l.expiryDate, ...(c.blind ? {} : { theoretical: l.theoreticalQty }) });
    if (!c.blind) p.theoretical = String(Number(p.theoretical ?? 0) + Number(l.theoreticalQty));
    byProduct.set(l.productId, p);
  }
  const entries = await myEntries(id, a.user.id);
  return (
    <>
      <PageHeader eyebrow={<Link href={`/gestion/inventaires/${id}`} className="hover:underline">{c.title}</Link>} title="Comptage"
        subtitle={`${c.warehouseKey}${c.blind ? " · à l'aveugle" : ""} · scannez ou cherchez l'article, choisissez le lot, tapez la quantité.`} />
      {c.notes && <div className="mb-4 rounded-2xl bg-surface-2 border border-line px-4 py-3 text-[13px]">{c.notes}</div>}
      <CountScanner countId={id} products={[...byProduct.values()]} entries={entries} blind={c.blind} add={addEntryAction} remove={deleteEntryAction} />
    </>
  );
}
