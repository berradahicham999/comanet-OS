import Link from "next/link";
import { requireActivationAccess, activationScope, canValidateActivation } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { activationValidationQueue } from "@/lib/activations/queries";
import { durationDays } from "@/lib/activations/shared";
import { PageHeader, Empty } from "@/components/ui";
import { ValidationQueue, type QueueItem } from "@/components/validation-queue";
import { fmtMAD, fmtDate } from "@/lib/format";
import { changeActivationStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activations à valider" };

/**
 * File de validation du DG : une activation à la fois, visuel (photo, visuel ou devis) et
 * proposition côte à côte, budget prévu poste par poste, Valider / Refuser (commentaire obligatoire).
 * Même composant et mêmes raccourcis clavier que la file du planning éditorial.
 */
export default async function ActivationValidationPage(props: { searchParams: Promise<{ id?: string }> }) {
  await requireActivationAccess();
  const { id } = await props.searchParams;
  const [refs, scope] = await Promise.all([activationRefs(), activationScope()]);
  const items = await activationValidationQueue(scope);
  const brandIds = [...new Set(items.map((i) => i.brandId))];
  const allowed = new Set((await Promise.all(brandIds.map(async (b) => ((await canValidateActivation(b)) ? b : null)))).filter((b): b is string | null => b !== undefined && b !== null));
  const canAll = await canValidateActivation(null);
  const visible = items.filter((i) => canAll || (i.brandId && allowed.has(i.brandId)));
  const readOnly = visible.length === 0 && items.length > 0;
  const shown = readOnly ? items : visible;

  // Transitions « valider » / « refuser » depuis le statut d'attente, lues dans le référentiel.
  const awaiting = refs.statuses.find((s) => s.awaitingValidation);
  const outs = refs.transitions.filter((t) => t.fromKey === (awaiting?.key ?? "") && t.requiresValidator);
  const validateKey = outs.find((t) => !t.requiresComment && refs.statuses.find((s) => s.key === t.toKey)?.isValidated)?.toKey ?? null;
  const correctKey = outs.find((t) => t.requiresComment && !refs.statuses.find((s) => s.key === t.toKey)?.isCancelled)?.toKey ?? null;
  const typeLabel = (k: string) => refs.types.find((t) => t.key === k)?.label ?? k;
  const refLabel = (list: { key: string; label: string }[], k: string | null) => list.find((x) => x.key === k)?.label ?? null;

  const queue: QueueItem[] = shown.map((a) => ({
    id: a.id, date: a.date, title: a.name, brand: a.brand ?? "Sans marque", color: a.color ?? "#999", brandId: a.brandId ?? "",
    platform: null, format: null, caption: a.description, hashtags: null, responsible: a.createdBy ?? a.responsible, since: a.since,
    assetId: a.assetId, assetMime: a.assetMime, assetName: a.assetName,
    meta: [typeLabel(a.type), `${fmtDate(a.date)}${a.endDate && a.endDate !== a.date ? ` → ${fmtDate(a.endDate)} (${durationDays(a.date, a.endDate)} j)` : ""}`, a.city ?? a.place, refLabel(refs.objectives, a.objectiveKey), refLabel(refs.targets, a.targetKey)].filter(Boolean).join(" · "),
    details: (
      <div className="text-[12.5px] space-y-2">
        <div className="rounded-xl border border-line overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 font-medium"><span>Budget prévu</span><span className="tabular-nums">{fmtMAD(a.planned)}</span></div>
          {a.lines.length ? <ul className="divide-y divide-line">{a.lines.map((l, i) => <li key={i} className="flex items-center justify-between px-3 py-1"><span className="truncate">{l.label}<span className="text-muted"> · {l.costItem}</span></span><span className="tabular-nums shrink-0">{fmtMAD(l.planned)}</span></li>)}</ul>
            : <div className="px-3 py-2 text-muted">Aucun poste chiffré : demander un budget avant de valider.</div>}
        </div>
        <div className="text-muted">{a.checklistTotal ? `Checklist ${a.checklistDone}/${a.checklistTotal}` : "Pas de checklist"}{a.clientCount ? ` · ${a.clientCount} point${a.clientCount > 1 ? "s" : ""} de vente` : ""}{a.productCount ? ` · ${a.productCount} produit${a.productCount > 1 ? "s" : ""}` : ""}{a.responsible ? ` · pilote ${a.responsible}` : ""}</div>
      </div>
    ),
  }));

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/activations" className="hover:underline">Activations</Link>} title="Activations à valider"
        subtitle={shown.length ? `${shown.length} activation${shown.length > 1 ? "s" : ""} proposée${shown.length > 1 ? "s" : ""} · valider engage le budget prévu, refuser exige un commentaire.` : "Rien n'attend votre validation."} />
      {shown.length === 0
        ? <Empty title="File vide" hint={<>Les activations arrivent ici quand leur pilote clique « Proposer » sur la fiche. <Link href="/marketing/activations" className="text-accent">Retour aux activations</Link>.</>} />
        : <ValidationQueue items={queue} refs={{ platforms: [], formats: [] }} initialId={id} validateKey={validateKey} correctKey={correctKey} action={changeActivationStatus} canAct={!readOnly} nowIso={new Date().toISOString()}
            hrefBase="/marketing/activations" fileHrefBase="/marketing/activations/fichier"
            emptyVisualText={<>Aucun visuel, photo ni devis déposé.<br />La proposition seule est soumise.</>} actorLabel="proposée par" correctLabel="Refuser" correctSubmitLabel="Refuser avec ce commentaire" correctPlaceholder="Pourquoi (obligatoire, envoyé au pilote) : budget, dates, cible…" />}
    </>
  );
}
