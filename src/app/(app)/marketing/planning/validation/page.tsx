import Link from "next/link";
import { requireAccess, brandFilter } from "@/lib/access";
import { PageHeader, Empty } from "@/components/ui";
import { ValidationQueue } from "@/components/validation-queue";
import { contentRefs } from "@/lib/content/refs";
import { validationQueue } from "@/lib/content/queries";
import { canValidateBrand } from "@/lib/content/workflow";
import { changeStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "File de validation" };

export default async function ValidationPage(props: { searchParams: Promise<{ id?: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.searchParams;
  const [refs, scope] = await Promise.all([contentRefs(), brandFilter()]);
  const items = await validationQueue(scope);
  // Droit de valider : évalué par marque ; la file est active si la personne peut valider au moins une des marques présentes.
  const brandIds = [...new Set(items.map((i) => i.brandId))];
  const allowed = new Set((await Promise.all(brandIds.map(async (b) => ((await canValidateBrand(b)) ? b : null)))).filter((b): b is string => !!b));
  const visible = items.filter((i) => allowed.has(i.brandId));
  const readOnly = visible.length === 0 && items.length > 0;
  const shown = readOnly ? items : visible;
  // Transitions « valider » / « corriger » depuis le statut d'attente, lues dans le référentiel.
  const awaiting = refs.statuses.find((s) => s.awaitingValidation);
  const from = awaiting?.key ?? "";
  const outs = refs.transitions.filter((t) => t.fromKey === from && t.requiresValidator);
  const validateKey = outs.find((t) => !t.requiresComment && !refs.statuses.find((s) => s.key === t.toKey)?.inProduction)?.toKey ?? null;
  const correctKey = outs.find((t) => t.requiresComment)?.toKey ?? null;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/planning" className="hover:underline">Planning éditorial</Link>} title="File de validation"
        subtitle={shown.length ? `${shown.length} contenu${shown.length > 1 ? "s" : ""} en attente · visuel et légende côte à côte, Valider ou Corriger.` : "Rien n'attend votre validation."} />
      {shown.length === 0
        ? <Empty title="File vide" hint={<>Les contenus passent ici quand un créateur clique « Demander la validation » sur sa fiche. <Link href="/marketing/planning" className="text-accent">Retour au planning</Link>.</>} />
        : <ValidationQueue items={shown} refs={refs} initialId={id} validateKey={validateKey} correctKey={correctKey} action={changeStatus} canAct={!readOnly} nowIso={new Date().toISOString()} />}
    </>
  );
}
