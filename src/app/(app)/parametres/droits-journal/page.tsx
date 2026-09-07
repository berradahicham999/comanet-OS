import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { listPermissionAudit } from "@/lib/admin-users";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { ChangeDetail } from "@/components/permission-change";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal des droits" };

const CHANGE_LABEL: Record<string, string> = {
  PERMISSIONS: "matrice", SCOPE: "portée", FLAGS: "droits transverses", ASSIGNMENTS: "assignations", SUSPEND: "suspension", REACTIVATE: "réactivation",
  TEMPLATE_APPLIED: "modèle appliqué", DUPLICATED: "duplication", CREATED: "création", TEMPLATE_EDITED: "modèle modifié", TEMPLATE_DELETED: "modèle supprimé",
};

export default async function PermissionAuditPage() {
  await requireAdmin();
  const rows = await listPermissionAudit({ limit: 300 });
  return (
    <>
      <PageHeader eyebrow={<Link href="/parametres/utilisateurs" className="hover:underline">Utilisateurs & droits</Link>} title="Journal des modifications de droits" subtitle="Qui a changé quoi, pour qui, quand. 300 dernières entrées." />
      {rows.length === 0 ? <Empty title="Aucune modification journalisée" hint="Le journal se remplit à chaque enregistrement depuis une fiche utilisateur ou un modèle." /> : (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Quand</th><th>Qui</th><th>Pour qui</th><th>Quoi</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-[12.5px] text-muted">{fmtDate(r.createdAt)}</td>
                    <td className="font-medium">{r.actor_name}</td>
                    <td>{r.target_user_id ? <Link href={`/parametres/utilisateurs/${r.target_user_id}`} className="hover:underline">{r.target_user_name}</Link> : r.target_user_name}</td>
                    <td><div className="flex flex-wrap gap-1">{r.change.split("+").map((c) => <Badge key={c} tone={c === "SUSPEND" ? "red" : c === "PERMISSIONS" ? "accent" : "gray"}>{CHANGE_LABEL[c] ?? c}</Badge>)}</div></td>
                    <td><details><summary className="cursor-pointer text-[12px] text-accent">Détail</summary><ChangeDetail before={r.before} after={r.after} /></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
