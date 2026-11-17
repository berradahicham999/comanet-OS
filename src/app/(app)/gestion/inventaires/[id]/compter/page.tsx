import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, requireAccessContext } from "@/lib/access";
import { getCount, myCountedByLine, myEntries } from "@/lib/gestion/counts";
import { countLineKey } from "@/lib/gestion/counts-shared";
import { PageHeader } from "@/components/ui";
import { CountScanner, type ScanProduct } from "@/components/gestion/count-scanner";
import { CountSheet, type SheetLine } from "@/components/gestion/count-sheet";
import { addEntryAction, deleteEntryAction, setMyCountAction } from "../../actions";

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
  const [entries, mine] = await Promise.all([myEntries(id, a.user.id), myCountedByLine(id, a.user.id)]);

  // Feuille : une ligne par article × lot. À l'aveugle, le théorique ne quitte jamais le serveur.
  const sheet: SheetLine[] = c.lines.map((l) => {
    const key = countLineKey((l.productId ?? l.itemId)!, l.lotNumber);
    return {
      key, kind: l.kind, productId: l.productId, itemId: l.itemId, name: l.product, ref: l.ref, ean: l.ean,
      group: l.kind === "MATERIEL" ? (l.category ?? "Sans catégorie") : (l.brand ?? "Sans marque"), unit: l.unit,
      lot: l.lotNumber, expiry: l.expiryDate, mine: mine[key] ?? null, ...(c.blind ? {} : { theoretical: l.theoreticalQty }),
    };
  });

  // Scanner : pour un lot ou un article trouvé en rayon hors de la liste.
  const byArticle = new Map<string, ScanProduct>();
  for (const l of c.lines) {
    const aid = (l.productId ?? l.itemId)!;
    const p = byArticle.get(aid) ?? { id: aid, kind: l.kind, name: l.product, ref: l.ref, ean: l.ean, brand: l.brand, trackLots: l.trackLots, lots: [], ...(c.blind ? {} : { theoretical: "0" }) };
    if (l.lotNumber) p.lots.push({ lot: l.lotNumber, expiry: l.expiryDate, ...(c.blind ? {} : { theoretical: l.theoreticalQty }) });
    if (!c.blind) p.theoretical = String(Number(p.theoretical ?? 0) + Number(l.theoreticalQty));
    byArticle.set(aid, p);
  }
  const materials = c.lines.filter((l) => l.kind === "MATERIEL").length;

  return (
    <>
      <PageHeader eyebrow={<Link href={`/gestion/inventaires/${id}`} className="hover:underline">{c.title}</Link>} title="Comptage"
        subtitle={`${c.warehouseKey}${c.blind ? " · à l'aveugle" : ""} · ${c.lines.length - materials} ligne(s) produit${materials ? ` + ${materials} article(s) de matériel` : ""} · tapez la quantité comptée à côté de chaque article (laisser vide = pas encore compté, 0 = rayon vide).`} />
      {c.notes && <div className="mb-4 rounded-2xl bg-surface-2 border border-line px-4 py-3 text-[13px]">{c.notes}</div>}
      <CountSheet countId={id} lines={sheet} blind={c.blind} save={setMyCountAction} />
      <details className="mt-6 card p-4">
        <summary className="cursor-pointer font-semibold text-[13px]">Lot ou article absent de la liste ? Scanner / ajouter</summary>
        <p className="text-[12px] text-muted mt-2 mb-3">Un lot trouvé en rayon qui n&apos;est pas listé (« Autre lot ») ou un article ajouté au comptage : la saisie crée sa ligne. Une saisie ici s&apos;ajoute à votre quantité de la feuille.</p>
        <CountScanner countId={id} products={[...byArticle.values()]} entries={entries} blind={c.blind} add={addEntryAction} remove={deleteEntryAction} />
      </details>
    </>
  );
}
