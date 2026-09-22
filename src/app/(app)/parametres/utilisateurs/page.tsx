import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { listAdminUsers } from "@/lib/admin-users";
import { cityScopeAnimatricesAction } from "./actions";
import { MODULE_KEYS, MODULE_LABELS, MODULE_SHORT, SCOPE_SHORT, type ModuleKey } from "@/lib/access-shared";
import { PageHeader, Card, Badge, Tabs, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilisateurs & droits" };

export default async function UsersAdminPage(props: { searchParams: Promise<{ q?: string; module?: string; suspendus?: string; error?: string; ok?: string }> }) {
  const me = await requireAdmin();
  const sp = await props.searchParams;
  const moduleFilter = (MODULE_KEYS as readonly string[]).includes(sp.module ?? "") ? (sp.module as ModuleKey) : undefined;
  const rows = await listAdminUsers({ q: sp.q, module: moduleFilter, includeSuspended: sp.suspendus === "1" });
  const admins = rows.filter((r) => r.active && r.isAdmin).length;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs & droits"
        subtitle="Chaque compte porte sa propre matrice : modules × Voir / Créer / Modifier / Valider, une portée de données et des droits transverses. Aucune combinaison n'est interdite."
        actions={<>
          <Link href="/parametres/recapitulatif" className="btn-secondary btn-sm">Récapitulatif imprimable</Link>
          <Link href="/parametres/droits-journal" className="btn-secondary btn-sm">Journal des droits</Link>
          <Link href="/parametres/utilisateurs/nouveau" className="btn-primary btn-sm">+ Nouveau compte</Link>
        </>}
      >
        <Tabs current="/parametres/utilisateurs" tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres/activations", label: "Activations" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>

      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.ok && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{sp.ok}</div>}

      <form action={cityScopeAnimatricesAction} className="card mb-4 px-4 py-3 flex flex-wrap items-center gap-3 text-[13px]">
        <div className="flex-1 min-w-[260px]">
          <div className="font-medium">Animatrices : tous les clients de leur ville, toutes les marques</div>
          <div className="text-[12px] text-muted">Chaque animatrice reçoit la ville inscrite sur sa fiche (clients actuels et futurs) et toutes les marques. Cumulatif : les clients déjà cochés restent. Chaque changement est journalisé et modifiable ensuite sur la fiche.</div>
        </div>
        <button type="submit" className="btn-secondary btn-sm">Appliquer à toutes les animatrices</button>
      </form>

      <form action="/parametres/utilisateurs" method="get" className="flex flex-wrap gap-2 mb-4 text-[13px]">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Nom ou e-mail…" className="input h-9 w-56" />
        <select name="module" defaultValue={moduleFilter ?? ""} className="select h-9 w-auto">
          <option value="">Tous les modules</option>
          {MODULE_KEYS.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
        </select>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="suspendus" value="1" defaultChecked={sp.suspendus === "1"} /> Inclure les comptes suspendus</label>
        <button className="btn-secondary h-9" type="submit">Filtrer</button>
        <span className="ml-auto text-muted self-center">{rows.length} compte{rows.length > 1 ? "s" : ""} · {admins} administrateur{admins > 1 ? "s" : ""} actif{admins > 1 ? "s" : ""}</span>
      </form>

      {rows.length === 0 ? (
        <Empty title="Aucun compte ne correspond" hint="Élargissez la recherche ou créez un nouveau compte." action={<Link href="/parametres/utilisateurs/nouveau" className="btn-primary btn-sm">+ Nouveau compte</Link>} />
      ) : (
        <Card pad={false}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Compte</th><th>Modules actifs</th><th>Portée</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className={!u.active ? "opacity-60" : undefined}>
                    <td>
                      <Link href={`/parametres/utilisateurs/${u.id}`} className="font-medium hover:underline">{u.name}</Link>{u.id === me.id && <span className="text-[11px] text-faint ml-1">(vous)</span>}
                      <div className="text-[12px] text-muted">{u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}</div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 max-w-[420px]">
                        {u.modules.length === 0 && <span className="text-[12px] text-faint">Aucun module</span>}
                        {u.modules.map((m) => <Badge key={m} tone={m === "administration" ? "accent" : "gray"}>{MODULE_SHORT[m]}</Badge>)}
                      </div>
                    </td>
                    <td className="text-[12.5px]">
                      <div className="whitespace-nowrap">{SCOPE_SHORT[u.scope]}</div>
                      {u.scope !== "ALL" && (u.cities.length > 0 || u.allBrands) && (
                        <div className="text-[11.5px] text-muted">{[u.cities.join(", "), u.allBrands && "toutes marques"].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td>{u.active ? <Badge tone="green" dot>Actif</Badge> : <Badge tone="red" dot>Suspendu</Badge>}</td>
                    <td className="whitespace-nowrap text-[12.5px] text-muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "jamais"}</td>
                    <td className="text-right"><Link href={`/parametres/utilisateurs/${u.id}`} className="text-[12px] text-accent">Configurer</Link></td>
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
