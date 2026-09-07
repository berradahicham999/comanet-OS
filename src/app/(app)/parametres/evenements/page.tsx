import { requireAnyModule, getAccess } from "@/lib/access";
import { redirect } from "next/navigation";
import { listEvents, countByStatus } from "@/lib/events/journal";
import { PageHeader, Card, Badge, Tabs, Empty } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";
import { replayOne, replayPending } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal des événements" };

const STATUS_META: Record<string, { label: string; tone: "gray" | "blue" | "green" | "red" | "orange" }> = {
  pending: { label: "En attente", tone: "blue" },
  processing: { label: "En cours", tone: "blue" },
  done: { label: "Traité", tone: "green" },
  failed: { label: "Échec", tone: "red" },
  obsolete: { label: "Caduc", tone: "gray" },
};

const TYPE_LABEL: Record<string, string> = {
  ANIMATION_COMPLETED: "Animation réalisée",
  ANIMATION_IMPORT_CONFLICT: "Conflit import / saisie",
};

const OUTCOME_LABEL: Record<string, string> = {
  no_risk: "aucun risque", already_at_risk: "déjà à risque", threshold_crossed: "franchissement de seuil",
  task_created: "tâche créée", task_existing: "tâche déjà ouverte", task_flagged: "tâche signalée",
};

export default async function EvenementsPage(props: { searchParams: Promise<{ status?: string; type?: string }> }) {
  await requireAnyModule();
  const access = (await getAccess())!;
  if (!access.flags.readActivityLog && !access.perms.administration.validate) redirect(access.home);
  const sp = await props.searchParams;
  const [events, counts] = await Promise.all([
    listEvents({ status: sp.status, type: sp.type }),
    countByStatus(),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rejouable = (counts.pending ?? 0) + (counts.failed ?? 0);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status: sp.status, type: sp.type, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/parametres/evenements${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Journal des événements"
        subtitle="Ce qui s'est passé, ce que ça a déclenché. Un handler qui échoue n'annule jamais la saisie qui l'a produit."
        actions={rejouable > 0 && (
          <form action={replayPending}>
            <input type="hidden" name="limit" value="50" />
            <button type="submit" className="btn-secondary btn-sm">Rejouer les {rejouable} en attente</button>
          </form>
        )}
      />

      <Tabs
        current={qs({ status: sp.status })}
        tabs={[
          { href: qs({ status: undefined }), label: "Tous", count: total },
          ...Object.entries(STATUS_META).map(([k, m]) => ({ href: qs({ status: k }), label: m.label, count: counts[k] ?? 0 })),
        ]}
      />

      <Card className="mt-3" pad={false}>
        {events.length === 0 ? (
          <Empty title="Aucun événement" hint="Une animation enregistrée avec le statut « Réalisée » émet un événement ANIMATION_COMPLETED. Aucun n'a encore été journalisé sur ce filtre." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th>Date</th><th>Type</th><th>Source</th><th>Statut</th><th>Conséquences</th><th>Tentatives</th><th></th>
              </tr></thead>
              <tbody>
                {events.map((e) => {
                  const meta = STATUS_META[e.status] ?? { label: e.status, tone: "gray" as const };
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">
                        <div className="text-[13px]">{fmtDate(e.occurredAt)}</div>
                        <div className="text-[11px] text-faint">saisi {fmtDate(e.createdAt)} {fmtTime(e.createdAt)}</div>
                      </td>
                      <td>
                        <div className="text-[13px] font-medium">{TYPE_LABEL[e.type] ?? e.type}</div>
                        <div className="text-[11px] text-faint">{e.entityType} · {e.entityId?.slice(0, 8) ?? "—"}{e.revision > 1 ? ` · révision ${e.revision}` : ""}</div>
                      </td>
                      <td className="text-[12px] text-muted whitespace-nowrap">{e.source}</td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {e.error && <div className="text-[11px] text-red mt-1 max-w-[260px] truncate" title={e.error}>{e.error}</div>}
                      </td>
                      <td>
                        {e.consequences.length === 0 ? (
                          <span className="text-[12px] text-faint">—</span>
                        ) : (
                          <ul className="text-[12px] space-y-0.5">
                            {e.consequences.map((c, i) => (
                              <li key={i}><span className="text-muted">{c.ruleId}</span> · {OUTCOME_LABEL[c.outcome] ?? c.outcome}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="num text-muted">{e.attempts}</td>
                      <td className="whitespace-nowrap">
                        {(e.status === "pending" || e.status === "failed") && (
                          <form action={replayOne}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="btn-ghost btn-sm">Rejouer</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
