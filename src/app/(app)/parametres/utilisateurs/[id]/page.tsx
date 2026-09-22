import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { assignmentOptions, getUserConfig, listAdminUsers, listPermissionAudit, listTemplates } from "@/lib/admin-users";
import { MODULE_LABELS, SCOPE_LABELS, FLAG_LABELS, FLAG_KEYS, type ModuleKey } from "@/lib/access-shared";
import { describeMatrix } from "@/lib/permissions-shared";
import { PageHeader, Card, Badge } from "@/components/ui";
import { PermissionMatrix } from "@/components/permission-matrix";
import { fmtDate } from "@/lib/format";
import { saveConfigAction, updateProfileAction, setActiveAction, duplicateUserAction, previewAsAction } from "../actions";
import { ChangeDetail } from "@/components/permission-change";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  cree: "Compte créé. Ses droits s'appliquent dès sa prochaine action.",
  droits: "Droits enregistrés. Ils s'appliquent dès la prochaine action de la personne, sans reconnexion.",
  profil: "Profil mis à jour.",
  suspendu: "Compte suspendu : il ne peut plus se connecter, ses données et sa configuration sont conservées.",
  reactive: "Compte réactivé.",
  duplique: "Compte créé à partir de la configuration source.",
};

export default async function UserAdminPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const me = await requireAdmin();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const cfg = await getUserConfig(id);
  if (!cfg) notFound();
  const [templates, options, history, all] = await Promise.all([listTemplates(), assignmentOptions(), listPermissionAudit({ targetId: id, limit: 30 }), listAdminUsers({ includeSuspended: false })]);
  const isSelf = me.id === id;
  const otherAdmins = all.filter((u) => u.isAdmin && u.id !== id).length;
  const lastAdmin = cfg.perms.administration.validate && otherAdmins === 0;
  const summary = describeMatrix(cfg.perms);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/parametres/utilisateurs" className="hover:underline">Utilisateurs & droits</Link>}
        title={cfg.user.name}
        subtitle={<>{cfg.user.email}{cfg.user.jobTitle ? ` · ${cfg.user.jobTitle}` : ""} · créé le {fmtDate(cfg.user.createdAt)} · dernière connexion : {cfg.user.lastLoginAt ? fmtDate(cfg.user.lastLoginAt) : "jamais"}</>}
        actions={<>
          {cfg.user.active ? <Badge tone="green" dot>Actif</Badge> : <Badge tone="red" dot>Suspendu</Badge>}
          {!isSelf && cfg.user.active && (
            <form action={previewAsAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary btn-sm" type="submit">Prévisualiser en tant que {cfg.user.name.split(" ")[0]}</button></form>
          )}
        </>}
      />

      {sp.ok && OK[sp.ok] && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{OK[sp.ok]}</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {isSelf && <div className="mb-4 rounded-2xl bg-yellow-soft border border-yellow/30 px-4 py-3 text-[13px]">Vous consultez votre propre compte : vos droits sont affichés en lecture seule. Personne ne modifie ses propres droits, même administrateur.</div>}
      {lastAdmin && !isSelf && <div className="mb-4 rounded-2xl bg-yellow-soft border border-yellow/30 px-4 py-3 text-[13px]">Dernier compte actif disposant du module Administration : il ne peut être ni rétrogradé ni suspendu tant qu&apos;un autre compte n&apos;a pas ce droit.</div>}

      <div className="grid xl:grid-cols-[1fr_340px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Droits">
            {isSelf ? (
              <ReadOnlySummary summary={summary} scope={cfg.scope} flags={cfg.flags} />
            ) : (
              <form action={saveConfigAction} className="space-y-4">
                <input type="hidden" name="id" value={id} />
                <PermissionMatrix initial={cfg} templates={templates} brands={options.brands} clients={options.clients} cities={options.cities} userCity={cfg.user.city} lockAdministration={lastAdmin} />
                <div className="flex flex-wrap gap-2 justify-end items-center">
                  <span className="text-[12px] text-muted mr-auto">Application immédiate : la personne verra ses nouveaux droits à sa prochaine action.</span>
                  <button className="btn-primary" type="submit">Enregistrer les droits</button>
                </div>
              </form>
            )}
          </Card>

          <Card title="Historique des droits de ce compte">
            {history.length === 0 ? <p className="text-[13px] text-muted">Aucune modification journalisée.</p> : (
              <div className="space-y-2">
                {history.map((h) => (
                  <details key={h.id} className="text-[13px]">
                    <summary className="cursor-pointer"><span className="text-muted">{fmtDate(h.createdAt)}</span> · <b>{h.actor_name}</b> · {h.change.split("+").map((c) => <Badge key={c} tone="gray" className="mr-1">{c}</Badge>)}</summary>
                    <ChangeDetail before={h.before} after={h.after} />
                  </details>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Profil">
            <form action={updateProfileAction} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={id} />
              <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={cfg.user.name} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">E-mail</span><input name="email" type="email" defaultValue={cfg.user.email} className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Fonction</span><input name="jobTitle" defaultValue={cfg.user.jobTitle ?? ""} className="input h-9" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Ville</span><input name="city" defaultValue={cfg.user.city ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Téléphone</span><input name="phone" defaultValue={cfg.user.phone ?? ""} className="input h-9" /></label>
              </div>
              <label className="block"><span className="label block mb-1">Nouveau mot de passe</span><input name="password" type="password" className="input h-9" placeholder="(inchangé)" minLength={8} /></label>
              <div className="text-right"><button className="btn-secondary btn-sm" type="submit">Enregistrer le profil</button></div>
            </form>
          </Card>

          {!isSelf && (
            <Card title={cfg.user.active ? "Suspendre" : "Réactiver"}>
              <p className="text-[12.5px] text-muted mb-2">{cfg.user.active ? "Le compte ne pourra plus se connecter. Ses saisies, ses droits et ses assignations restent intacts." : "Le compte retrouvera exactement sa configuration précédente."}</p>
              <form action={setActiveAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="active" value={cfg.user.active ? "0" : "1"} />
                <button className={cfg.user.active ? "btn-secondary btn-sm text-red w-full" : "btn-primary btn-sm w-full"} type="submit" disabled={lastAdmin && cfg.user.active}>{cfg.user.active ? "Suspendre ce compte" : "Réactiver ce compte"}</button>
              </form>
            </Card>
          )}

          <Card title="Dupliquer">
            <p className="text-[12.5px] text-muted mb-2">Crée un nouveau compte avec exactement la même matrice, la même portée et les mêmes assignations.</p>
            <form action={duplicateUserAction} className="space-y-2 text-[13px]">
              <input type="hidden" name="source" value={id} />
              <input name="name" placeholder="Nom" className="input h-9" required />
              <input name="email" type="email" placeholder="E-mail" className="input h-9" required />
              <input name="password" type="password" placeholder="Mot de passe initial" className="input h-9" required minLength={8} />
              <button className="btn-secondary btn-sm w-full" type="submit">Dupliquer vers un nouveau compte</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function ReadOnlySummary({ summary, scope, flags }: { summary: Record<string, string>; scope: keyof typeof SCOPE_LABELS; flags: Record<string, boolean> }) {
  const mods = Object.keys(summary) as ModuleKey[];
  return (
    <div className="text-[13px] space-y-3">
      <div>
        <div className="label mb-1">Modules</div>
        {mods.length === 0 ? <span className="text-muted">Aucun module.</span> : (
          <ul className="space-y-0.5">{mods.map((m) => <li key={m}><b>{MODULE_LABELS[m]}</b> <span className="text-muted">— {summary[m]}</span></li>)}</ul>
        )}
      </div>
      <div><div className="label mb-1">Portée</div>{SCOPE_LABELS[scope]}</div>
      <div><div className="label mb-1">Droits transverses</div>{FLAG_KEYS.filter((f) => flags[f]).map((f) => FLAG_LABELS[f]).join(" · ") || <span className="text-muted">Aucun.</span>}</div>
    </div>
  );
}
