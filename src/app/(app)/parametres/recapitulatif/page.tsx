import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { allUserConfigs, assignmentOptions } from "@/lib/admin-users";
import { MODULE_KEYS, MODULE_LABELS, SCOPE_LABELS, FLAG_KEYS, FLAG_LABELS } from "@/lib/access-shared";
import { ACTIONS } from "@/lib/permissions-shared";
import { fmtDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Récapitulatif des droits" };

/** Page HTML paginée pour impression : une fiche par compte, revue périodique des droits. */
export default async function RecapPage() {
  await requireAdmin();
  const [configs, options] = await Promise.all([allUserConfigs(), assignmentOptions()]);
  const brandName = new Map(options.brands.map((b) => [b.id, b.name]));
  const clientName = new Map(options.clients.map((c) => [c.id, c.name]));
  const now = new Date();
  return (
    <div className="recap">
      <style>{`
        @media print {
          aside, header, nav, .no-print { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .recap-card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; }
          .recap-card + .recap-card { margin-top: 12px; }
          body { font-size: 11px; }
        }
        .recap-grid td, .recap-grid th { padding: 2px 6px; font-size: 11.5px; }
      `}</style>
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <Link href="/parametres/utilisateurs" className="btn-secondary btn-sm">← Utilisateurs & droits</Link>
        <PrintButton />
        <span className="text-[12.5px] text-muted">Une fiche par compte, comptes suspendus en fin de document.</span>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">COMANET OS — Récapitulatif des droits</h1>
      <p className="text-[12.5px] text-muted mb-4">Édité le {fmtDate(now)} · {configs.length} compte(s) · {configs.filter((c) => c.user.active).length} actif(s)</p>

      <div className="space-y-3">
        {configs.map((c) => {
          const mods = MODULE_KEYS.filter((m) => c.perms[m].view);
          return (
            <div key={c.user.id} className="recap-card card px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold text-[14px]">{c.user.name}</span>
                <span className="text-[12px] text-muted">{c.user.email}{c.user.jobTitle ? ` · ${c.user.jobTitle}` : ""}</span>
                <span className={`text-[11px] font-medium ${c.user.active ? "text-green" : "text-red"}`}>{c.user.active ? "ACTIF" : "SUSPENDU"}</span>
                <span className="text-[11px] text-muted ml-auto">dernière connexion : {c.user.lastLoginAt ? fmtDate(c.user.lastLoginAt) : "jamais"}</span>
              </div>
              <div className="grid md:grid-cols-[1fr_260px] gap-3 mt-2">
                <table className="recap-grid w-full">
                  <thead><tr className="text-left text-muted"><th>Module</th>{ACTIONS.map((a) => <th key={a} className="text-center">{a === "view" ? "Voir" : a === "create" ? "Créer" : a === "edit" ? "Modifier" : "Valider"}</th>)}</tr></thead>
                  <tbody>
                    {mods.length === 0 && <tr><td colSpan={5} className="text-muted">Aucun module</td></tr>}
                    {mods.map((m) => <tr key={m}><td>{MODULE_LABELS[m]}</td>{ACTIONS.map((a) => <td key={a} className="text-center">{c.perms[m][a] ? "●" : "·"}</td>)}</tr>)}
                  </tbody>
                </table>
                <div className="text-[11.5px] space-y-1">
                  <div><b>Portée :</b> {SCOPE_LABELS[c.scope]}</div>
                  {c.scope !== "ALL" && <div><b>Marques :</b> {c.allBrands ? "toutes" : c.brandIds.map((id) => brandName.get(id) ?? id).join(", ") || "aucune"}</div>}
                  {c.scope !== "ALL" && c.cities.length > 0 && <div><b>Villes :</b> {c.cities.join(", ")} (tous leurs clients)</div>}
                  {c.scope !== "ALL" && <div><b>Clients :</b> {c.clientIds.length > 8 ? `${c.clientIds.length} clients` : c.clientIds.map((id) => clientName.get(id) ?? id).join(", ") || "aucun"}</div>}
                  <div><b>Transverses :</b> {FLAG_KEYS.filter((f) => c.flags[f]).map((f) => FLAG_LABELS[f]).join(" · ") || "aucun"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
