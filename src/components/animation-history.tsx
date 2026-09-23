import { Badge } from "@/components/ui";
import { fmtDateShort, fmtTime } from "@/lib/format";
import type { RevisionRow } from "@/lib/terrain/reports";

const ACTION: Record<string, { label: string; tone: "green" | "blue" | "red" }> = {
  CREATION: { label: "Saisi", tone: "green" },
  MODIFICATION: { label: "Modifié", tone: "blue" },
  SUPPRESSION: { label: "Supprimé", tone: "red" },
};

/** Historique d'un rapport d'animation : qui, quand, et chaque champ avant → après. */
export function AnimationHistory({ rows, showSummary = false }: { rows: RevisionRow[]; showSummary?: boolean }) {
  return (
    <ul className="space-y-3 text-[13px]">
      {rows.map((r) => {
        const a = ACTION[r.action] ?? { label: r.action, tone: "blue" as const };
        return (
          <li key={r.id}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={a.tone}>{a.label}</Badge>
              <span className="font-medium">{r.actorName}</span>
              <span className="text-muted">le {fmtDateShort(r.createdAt)} à {fmtTime(r.createdAt)}</span>
            </div>
            {showSummary && <div className="mt-1 text-ink-2">{r.summary}</div>}
            {r.changes.length > 0 && (
              <ul className="mt-1 ml-1 space-y-0.5 text-[12px]">
                {r.changes.map((c, i) => (
                  <li key={i}>
                    <span className="text-muted">{c.label} : </span>
                    {r.action === "SUPPRESSION"
                      ? <span>{c.before ?? "—"}</span>
                      : <><span className="line-through text-muted">{c.before ?? "vide"}</span> → <span className="font-medium">{c.after ?? "vide"}</span></>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
