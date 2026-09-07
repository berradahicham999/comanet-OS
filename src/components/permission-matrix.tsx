"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  FLAG_KEYS, FLAG_LABELS, MODULE_GROUPS, MODULE_HINTS, MODULE_LABELS, SCOPE_HINTS, SCOPE_KEYS, SCOPE_LABELS, VALIDATE_HINTS,
  type FlagKey, type ModuleKey, type ScopeKey,
} from "@/lib/access-shared";
import {
  ACTIONS, ACTION_LABELS, mergeFlags, mergeMatrix, normalizeMatrix, widestScope,
  type AccessConfig, type FlagSet, type PermissionAction, type PermissionSet,
} from "@/lib/permissions-shared";

export type TemplateOption = { id: string; name: string; description: string | null; scope: ScopeKey; flags: FlagSet; perms: PermissionSet };

/**
 * Matrice de permissions : une ligne par module, quatre cases, plus la portée, les
 * interrupteurs transverses et les assignations. Les dépendances logiques sont gérées
 * ici (cocher Créer coche Voir ; décocher Voir décoche le reste). Les modèles de rôle
 * s'appliquent en cumul, jamais en écrasement.
 *
 * Le composant n'envoie rien : il rend des champs nommés (`p_<module>_<action>`,
 * `scope`, `f_<flag>`, `brand_<id>`, `client_<id>`, `templates`) lus par la server
 * action du formulaire qui l'entoure.
 */
export function PermissionMatrix({ initial, templates, brands, clients, showAssignments = true, showScope = true, showFlags = true, lockAdministration }: {
  initial: AccessConfig;
  templates: TemplateOption[];
  brands?: { id: string; name: string; active: boolean }[];
  clients?: { id: string; name: string; city: string | null }[];
  showAssignments?: boolean;
  showScope?: boolean;
  showFlags?: boolean;
  /** Fiche du dernier administrateur : la case « Valider » d'Administration ne peut pas être décochée. */
  lockAdministration?: boolean;
}) {
  const [perms, setPerms] = useState<PermissionSet>(() => normalizeMatrix(initial.perms));
  const [scope, setScope] = useState<ScopeKey>(initial.scope);
  const [flags, setFlags] = useState<FlagSet>(initial.flags);
  const [brandIds, setBrandIds] = useState<Set<string>>(() => new Set(initial.brandIds));
  const [clientIds, setClientIds] = useState<Set<string>>(() => new Set(initial.clientIds));
  const [applied, setApplied] = useState<string[]>([]);
  const [clientQuery, setClientQuery] = useState("");

  function toggle(module: ModuleKey, action: PermissionAction) {
    setPerms((prev) => {
      const p = { ...prev[module] };
      const next = !p[action];
      if (action === "view") {
        // Décocher Voir retire tout ; cocher Voir ne coche rien d'autre.
        if (!next) return { ...prev, [module]: { view: false, create: false, edit: false, validate: false } };
        return { ...prev, [module]: { ...p, view: true } };
      }
      p[action] = next;
      if (next) p.view = true; // Créer / Modifier / Valider impliquent Voir.
      return { ...prev, [module]: p };
    });
  }

  function applyTemplate(t: TemplateOption) {
    setPerms((prev) => mergeMatrix(prev, t.perms));
    setFlags((prev) => mergeFlags(prev, t.flags));
    setScope((prev) => widestScope(prev, t.scope));
    setApplied((prev) => (prev.includes(t.name) ? prev : [...prev, t.name]));
  }

  function clearAll() {
    setPerms(normalizeMatrix({} as PermissionSet));
    setFlags(Object.fromEntries(FLAG_KEYS.map((k) => [k, false])) as FlagSet);
    setApplied([]);
  }

  const activeCount = useMemo(() => Object.values(perms).filter((p) => p.view).length, [perms]);
  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    const list = clients ?? [];
    const picked = list.filter((c) => clientIds.has(c.id));
    if (!q) return picked.length ? picked : list.slice(0, 30);
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.city ?? "").toLowerCase().includes(q)).slice(0, 40);
  }, [clientQuery, clients, clientIds]);

  const adminLocked = lockAdministration && perms.administration.validate;

  return (
    <div className="space-y-5">
      {/* Modèles de pré-remplissage */}
      {templates.length > 0 && (
        <div>
          <div className="label mb-1.5">Pré-remplir avec un modèle <span className="text-faint font-normal normal-case tracking-normal">— cumulatif : appliquer deux modèles additionne leurs droits</span></div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => applyTemplate(t)} title={t.description ?? undefined} className={clsx("btn-secondary btn-sm", applied.includes(t.name) && "border-accent text-accent")}>
                {applied.includes(t.name) ? "✓ " : "+ "}{t.name}
              </button>
            ))}
            <button type="button" onClick={clearAll} className="btn-ghost btn-sm text-muted">Tout décocher</button>
          </div>
          <input type="hidden" name="templates" value={applied.join("|")} />
        </div>
      )}

      {/* Matrice */}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Module <span className="text-faint font-normal">({activeCount} actif{activeCount > 1 ? "s" : ""})</span></th>
              {ACTIONS.map((a) => <th key={a} className="text-center w-20">{ACTION_LABELS[a]}</th>)}
            </tr>
          </thead>
          <tbody>
            {MODULE_GROUPS.map((g) => (
              <GroupRows key={g.title} title={g.title} modules={g.modules} perms={perms} toggle={toggle} adminLocked={!!adminLocked} />
            ))}
          </tbody>
        </table>
      </div>
      {/* Champs envoyés au serveur : une case par droit accordé. */}
      {(Object.keys(perms) as ModuleKey[]).flatMap((m) => ACTIONS.filter((a) => perms[m][a]).map((a) => <input key={`${m}_${a}`} type="hidden" name={`p_${m}_${a}`} value="1" />))}

      {/* Portée */}
      {showScope && (
        <div>
          <div className="label mb-1.5">Portée des données</div>
          <div className="grid sm:grid-cols-3 gap-2">
            {SCOPE_KEYS.map((k) => (
              <label key={k} className={clsx("card px-3 py-2.5 cursor-pointer flex gap-2 items-start", scope === k && "border-accent ring-1 ring-accent/30")}>
                <input type="radio" name="scope" value={k} checked={scope === k} onChange={() => setScope(k)} className="mt-0.5" />
                <span>
                  <span className="block text-[13px] font-medium">{SCOPE_LABELS[k]}</span>
                  <span className="block text-[11.5px] text-muted leading-snug">{SCOPE_HINTS[k]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Assignations */}
      {showAssignments && scope !== "ALL" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <div className="label mb-1.5">Marques assignées <span className="text-faint font-normal normal-case tracking-normal">({brandIds.size})</span></div>
            <div className="card px-3 py-2 max-h-56 overflow-auto space-y-1">
              {(brands ?? []).map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name={`brand_${b.id}`} checked={brandIds.has(b.id)} onChange={() => setBrandIds((prev) => { const n = new Set(prev); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} />
                  <span className={clsx(!b.active && "text-muted")}>{b.name}{!b.active && " (inactive)"}</span>
                </label>
              ))}
              {(brands ?? []).length === 0 && <div className="text-[12px] text-faint">Aucune marque.</div>}
            </div>
          </div>
          <div>
            <div className="label mb-1.5">Clients assignés <span className="text-faint font-normal normal-case tracking-normal">({clientIds.size})</span></div>
            <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Rechercher un client ou une ville…" className="input h-9 mb-2" />
            <div className="card px-3 py-2 max-h-56 overflow-auto space-y-1">
              {filteredClients.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={clientIds.has(c.id)} onChange={() => setClientIds((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                  <span className="truncate">{c.name}</span>
                  {c.city && <span className="text-[11px] text-muted ml-auto shrink-0">{c.city}</span>}
                </label>
              ))}
              {filteredClients.length === 0 && <div className="text-[12px] text-faint">Aucun client ne correspond.</div>}
            </div>
            {/* Les clients cochés hors de la liste filtrée restent envoyés. */}
            {[...clientIds].map((id) => <input key={id} type="hidden" name={`client_${id}`} value="1" />)}
          </div>
        </div>
      )}
      {showAssignments && scope === "ALL" && [...brandIds].map((id) => <input key={id} type="hidden" name={`brand_${id}`} value="1" />)}
      {showAssignments && scope === "ALL" && [...clientIds].map((id) => <input key={id} type="hidden" name={`client_${id}`} value="1" />)}

      {/* Interrupteurs transverses */}
      {showFlags && (
        <div>
          <div className="label mb-1.5">Droits transverses <span className="text-faint font-normal normal-case tracking-normal">— indépendants des modules</span></div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {FLAG_KEYS.map((k: FlagKey) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name={`f_${k}`} checked={flags[k]} onChange={() => setFlags((prev) => ({ ...prev, [k]: !prev[k] }))} />
                {FLAG_LABELS[k]}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({ title, modules, perms, toggle, adminLocked }: {
  title: string;
  modules: ModuleKey[];
  perms: PermissionSet;
  toggle: (m: ModuleKey, a: PermissionAction) => void;
  adminLocked: boolean;
}) {
  return (
    <>
      <tr className="bg-sunk/60"><td colSpan={ACTIONS.length + 1} className="text-[11px] uppercase tracking-wider text-muted font-semibold py-1.5">{title}</td></tr>
      {modules.map((m) => (
        <tr key={m} className={clsx(!perms[m].view && "text-muted")}>
          <td>
            <div className="font-medium text-ink">{MODULE_LABELS[m]}</div>
            <div className="text-[11.5px] text-muted leading-snug">{MODULE_HINTS[m]}</div>
            {perms[m].validate && <div className="text-[11px] text-accent-2 leading-snug mt-0.5">Valider : {VALIDATE_HINTS[m]}</div>}
          </td>
          {ACTIONS.map((a) => {
            const locked = adminLocked && m === "administration" && (a === "validate" || a === "view");
            return (
              <td key={a} className="text-center">
                <input
                  type="checkbox"
                  aria-label={`${MODULE_LABELS[m]} — ${ACTION_LABELS[a]}`}
                  checked={perms[m][a]}
                  disabled={locked}
                  title={locked ? "Dernier administrateur : ce droit ne peut pas être retiré." : a === "validate" ? VALIDATE_HINTS[m] : undefined}
                  onChange={() => toggle(m, a)}
                  className="h-4 w-4"
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
