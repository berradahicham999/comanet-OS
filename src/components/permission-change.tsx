import { MODULE_LABELS, FLAG_LABELS, SCOPE_LABELS, type ModuleKey, type FlagKey, type ScopeKey } from "@/lib/access-shared";

type Snapshot = { modules?: Record<string, string>; scope?: ScopeKey; flags?: string[]; brandIds?: string[]; clientIds?: string[]; templates?: string[]; [k: string]: unknown };

/** Rendu lisible d'une entrée du journal des droits : avant / après, en français. */
export function ChangeDetail({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Snapshot, a = (after ?? {}) as Snapshot;
  const hasSnapshot = a.modules || b.modules;
  if (!hasSnapshot) {
    return <pre className="mt-1 text-[11.5px] text-muted whitespace-pre-wrap">{JSON.stringify({ avant: before, après: after }, null, 1)}</pre>;
  }
  const mods = new Set([...Object.keys(b.modules ?? {}), ...Object.keys(a.modules ?? {})]) as Set<ModuleKey>;
  return (
    <div className="mt-2 grid sm:grid-cols-2 gap-3 text-[12.5px]">
      {[["Avant", b], ["Après", a]].map(([label, s]) => {
        const snap = s as Snapshot;
        return (
          <div key={label as string} className="card px-3 py-2">
            <div className="label mb-1">{label as string}</div>
            <ul className="space-y-0.5">
              {[...mods].map((m) => <li key={m} className={snap.modules?.[m] ? "" : "text-faint"}>{MODULE_LABELS[m] ?? m} : {snap.modules?.[m] ?? "—"}</li>)}
            </ul>
            <div className="mt-1.5 text-muted">Portée : {snap.scope ? SCOPE_LABELS[snap.scope] : "—"}</div>
            <div className="text-muted">Transverses : {(snap.flags ?? []).map((f) => FLAG_LABELS[f as FlagKey] ?? f).join(", ") || "aucun"}</div>
            <div className="text-muted">Marques assignées : {snap.brandIds?.length ?? 0} · clients assignés : {snap.clientIds?.length ?? 0}</div>
            {snap.templates && snap.templates.length > 0 && <div className="text-muted">Modèles appliqués : {snap.templates.join(", ")}</div>}
          </div>
        );
      })}
    </div>
  );
}
