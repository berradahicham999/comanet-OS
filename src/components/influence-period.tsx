import { Badge } from "@/components/ui";
import { fmtDateShort } from "@/lib/format";
import { collabDays, collabPhase, COLLAB_PHASE } from "@/lib/influence-shared";

/** Période d'une collaboration (début → fin) et où elle en est aujourd'hui. `today` : date métier ISO. */
export function CollabPeriod({ start, end, today }: { start: string; end: string | null; today: string }) {
  const phase = COLLAB_PHASE[collabPhase(start, end, today)];
  return (
    <div className="whitespace-nowrap">
      <div>{fmtDateShort(start)}{end && <> → {fmtDateShort(end)}</>}</div>
      <div className="flex items-center gap-1 mt-0.5">
        <Badge tone={phase.tone}>{phase.label}</Badge>
        {end && <span className="text-[11px] text-faint">{collabDays(start, end)} j</span>}
      </div>
    </div>
  );
}
