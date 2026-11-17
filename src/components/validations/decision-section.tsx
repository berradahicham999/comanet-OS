import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, Section } from "@/components/ui";
import { iso, today } from "@/lib/format";
import type { ValidationItem } from "@/lib/validations/shared";
import { DecisionQueue } from "./decision-queue";

/** Nombre de lignes de la zone « À décider » du Cockpit ; le reste se lit sur /a-decider. */
export const COCKPIT_DECISION_LIMIT = 10;

const countLabel = (n: number) => (n === 0 ? "rien à décider" : `${n} à décider`);

/** Compteur du sous-titre du Cockpit. Attend la même lecture que la section : la file n'est lue qu'une fois par page. */
export async function PendingCount({ pending }: { pending: Promise<ValidationItem[]> }) {
  const n = (await pending).length;
  return n === 0 ? <span>rien à décider</span> : <Link href="/a-decider" className="font-medium text-ink hover:underline">{countLabel(n)}</Link>;
}

/**
 * Zone « À décider » : tout ce qui attend l'accord de la direction, trié par échéance puis montant (`sortValidations()`).
 * `limit` borne l'affichage du Cockpit ; `showEmpty` garde la zone visible quand la file est vide (direction, page complète).
 */
export async function DecisionSection({ pending, readOnly, limit, showEmpty }: { pending: Promise<ValidationItem[]>; readOnly: boolean; limit?: number; showEmpty: boolean }) {
  const items = await pending;
  if (items.length === 0 && !showEmpty) return null;
  const shown = limit ? items.slice(0, limit) : items;
  const more = items.length - shown.length;
  return (
    <Section
      title={`À décider${items.length ? ` (${items.length})` : ""}`}
      description={readOnly ? "Prévisualisation : lecture seule, aucune décision n'est possible." : "Par échéance, puis par montant. Valider ou refuser repasse par les droits de chaque file ; un refus exige un motif."}
      action={limit && items.length > 0 ? <Link href="/a-decider" className="btn-secondary btn-sm">Tout voir ({items.length})</Link> : undefined}
    >
      {items.length === 0 ? (
        <Card><div className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 size={16} className="text-green" /> Rien n&apos;attend votre accord.</div></Card>
      ) : (
        <>
          <DecisionQueue items={shown} today={iso(today())} readOnly={readOnly} />
          {more > 0 && <p className="mt-2 text-[12.5px] text-muted">{more} autre{more > 1 ? "s" : ""} décision{more > 1 ? "s" : ""} à échéance plus lointaine ou sans échéance. <Link href="/a-decider" className="text-accent font-medium">Tout voir</Link></p>}
        </>
      )}
    </Section>
  );
}

/** Pendant la lecture de la file : la page s'affiche sans l'attendre. */
export function DecisionSectionFallback() {
  return (
    <Section title="À décider" description="Lecture des décisions en attente…">
      <div className="card px-4 py-3 space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-black/5 animate-pulse" />)}
      </div>
    </Section>
  );
}
