import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { contentRefs } from "@/lib/content/refs";
import { safeTone } from "@/lib/content/shared";
import { savePlatform, saveFormat, saveObjective, saveStatus, deleteRef, saveTransition, deleteTransition, saveBrandValidators, checkConsistency } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres — Contenus" };

const TONES = ["gray", "blue", "purple", "yellow", "orange", "green", "accent", "red"] as const;
const ICONS = ["Instagram", "Facebook", "Music2", "Youtube", "MessageCircle", "Globe", "Mail", "Printer"];

export default async function ContenusSettingsPage() {
  await requireAccess("administration");
  const [refs, brands, users, validators, usage, consistency] = await Promise.all([
    contentRefs(), listBrands(), listUsers(),
    db.execute<{ brand_id: string; user_id: string }>(sql`select brand_id, user_id from brand_validators`),
    db.execute<{ kind: string; key: string; n: number }>(sql`
      select 'platform' as kind, platform as key, count(*)::int as n from content_items where platform is not null group by platform
      union all select 'format', format, count(*)::int from content_items where format is not null group by format
      union all select 'objective', objective, count(*)::int from content_items where objective is not null group by objective
      union all select 'status', status, count(*)::int from content_items group by status`),
    checkConsistency(),
  ]);
  const used = new Map(usage.rows.map((u) => [`${u.kind}:${u.key}`, u.n]));
  const valByBrand = new Map<string, Set<string>>();
  for (const v of validators.rows) (valByBrand.get(v.brand_id) ?? valByBrand.set(v.brand_id, new Set()).get(v.brand_id)!).add(v.user_id);
  /** Suppression depuis un formulaire autonome (plateformes : hors du formulaire d'édition). */
  const del = (kind: string, key: string) => (
    <form action={deleteRef}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={key} /><button className="text-faint hover:text-red text-[13px]" type="submit" title={used.get(`${kind}:${key}`) ? "Utilisé par des contenus : sera désactivé" : "Supprimer"}>×</button></form>
  );
  /** Suppression depuis le formulaire de la ligne : même données (`kind` + `key`), autre action — pas de <form> imbriqué. */
  const delInline = (kind: string, key: string) => (
    <><input type="hidden" name="kind" value={kind} /><button formAction={deleteRef} className="text-faint hover:text-red text-[13px]" type="submit" title={used.get(`${kind}:${key}`) ? "Utilisé par des contenus : sera désactivé" : "Supprimer"}>×</button></>
  );
  const usedBadge = (kind: string, key: string) => { const n = used.get(`${kind}:${key}`); return n ? <span className="text-[11px] text-muted whitespace-nowrap">{n} contenu{n > 1 ? "s" : ""}</span> : null; };

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paramètres" subtitle="Référentiels du planning éditorial : plateformes, formats, objectifs, statuts, transitions et validateurs par marque. Rien n'est codé en dur : ce que vous changez ici s'applique immédiatement au calendrier, aux fiches et à la file de validation.">
        <Tabs current="/parametres/contenus" tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>

      {(consistency.awaiting === 0 || consistency.published === 0 || consistency.archived === 0) && (
        <div className="mb-4 rounded-xl border border-orange/30 bg-orange-soft text-orange px-3 py-2 text-[13px]">
          Attention : il faut au moins un statut actif marqué {consistency.awaiting === 0 && "« en attente de validation »"} {consistency.published === 0 && "« publié »"} {consistency.archived === 0 && "« archivé »"}. Sans cela, la file de validation, les indicateurs ou l&apos;archivage ne fonctionnent plus.
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-4">
        {/* Statuts */}
        <Card title="Statuts et cycle de vie" className="xl:col-span-2">
          <p className="text-[12.5px] text-muted mb-3">L&apos;ordre définit l&apos;affichage. Les cases « sémantique » indiquent au code ce que signifie un statut : c&apos;est ainsi que les indicateurs comptent les publiés, que la file de validation trouve les contenus en attente et que l&apos;archivage garde tout sans supprimer.</p>
          <div className="table-wrap"><table className="tbl text-[12.5px]">
            <thead><tr><th>Ordre</th><th>Clé</th><th>Libellé</th><th>Couleur</th><th>En attente de validation</th><th>En production</th><th>Publié</th><th>Archivé</th><th>Actif</th><th></th><th></th></tr></thead>
            <tbody>
              {refs.statuses.map((s) => (
                <tr key={s.key}>
                  <td colSpan={10} className="!p-0">
                    <form action={saveStatus} className="grid grid-cols-[60px_130px_1fr_100px_repeat(5,90px)_60px_30px] items-center gap-1 px-2 py-1">
                      <input name="sort" defaultValue={s.sort} className="input h-8 text-[12px]" inputMode="numeric" />
                      <span className="font-mono text-[11px] text-muted truncate" title={s.key}>{s.key}<input type="hidden" name="key" value={s.key} /></span>
                      <input name="label" defaultValue={s.label} className="input h-8 text-[12px]" />
                      <select name="tone" defaultValue={s.tone} className="select h-8 text-[12px]">{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                      <label className="text-center"><input type="checkbox" name="awaitingValidation" defaultChecked={s.awaitingValidation} /></label>
                      <label className="text-center"><input type="checkbox" name="inProduction" defaultChecked={s.inProduction} /></label>
                      <label className="text-center"><input type="checkbox" name="isPublished" defaultChecked={s.isPublished} /></label>
                      <label className="text-center"><input type="checkbox" name="isArchived" defaultChecked={s.isArchived} /></label>
                      <label className="text-center"><input type="checkbox" name="active" defaultChecked={s.active} /></label>
                      <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                      <span className="flex items-center gap-1">{usedBadge("status", s.key)}{delInline("status", s.key)}</span>
                    </form>
                  </td>
                </tr>
              ))}
              <tr><td colSpan={10} className="!p-0">
                <form action={saveStatus} className="grid grid-cols-[60px_130px_1fr_100px_repeat(5,90px)_60px_30px] items-center gap-1 px-2 py-1 bg-surface-2/60">
                  <input name="sort" defaultValue={refs.statuses.length + 1} className="input h-8 text-[12px]" />
                  <span className="text-[11px] text-faint">clé auto</span>
                  <input name="label" placeholder="Nouveau statut" className="input h-8 text-[12px]" required />
                  <select name="tone" defaultValue="gray" className="select h-8 text-[12px]">{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <label className="text-center"><input type="checkbox" name="awaitingValidation" /></label>
                  <label className="text-center"><input type="checkbox" name="inProduction" /></label>
                  <label className="text-center"><input type="checkbox" name="isPublished" /></label>
                  <label className="text-center"><input type="checkbox" name="isArchived" /></label>
                  <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
                  <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button><span />
                </form>
              </td></tr>
            </tbody>
          </table></div>

          <h3 className="font-medium text-[13.5px] mt-5 mb-1">Transitions autorisées</h3>
          <p className="text-[12.5px] text-muted mb-2">Un bouton n&apos;apparaît sur une fiche que si la transition existe ici. « Validateur » réserve l&apos;étape à l&apos;Administration, au droit « Valider » sur Marketing et aux validateurs de la marque ; « Commentaire » le rend obligatoire (corrections).</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {refs.transitions.sort((a, b) => (refs.statuses.findIndex((s) => s.key === a.fromKey) - refs.statuses.findIndex((s) => s.key === b.fromKey)) || (refs.statuses.findIndex((s) => s.key === a.toKey) - refs.statuses.findIndex((s) => s.key === b.toKey))).map((t) => {
              const from = refs.statuses.find((s) => s.key === t.fromKey); const to = refs.statuses.find((s) => s.key === t.toKey);
              return (
                <span key={`${t.fromKey}>${t.toKey}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 h-8 text-[12px]">
                  <Badge tone={safeTone(from?.tone)}>{from?.label ?? t.fromKey}</Badge> → <Badge tone={safeTone(to?.tone)}>{to?.label ?? t.toKey}</Badge>
                  {t.label && <span className="text-muted">« {t.label} »</span>}{t.requiresValidator && <span title="Validateur requis">🔒</span>}{t.requiresComment && <span title="Commentaire obligatoire">💬</span>}
                  <form action={deleteTransition}><input type="hidden" name="fromKey" value={t.fromKey} /><input type="hidden" name="toKey" value={t.toKey} /><button className="text-faint hover:text-red ml-1" type="submit" title="Supprimer">×</button></form>
                </span>
              );
            })}
          </div>
          <form action={saveTransition} className="flex flex-wrap items-end gap-2 text-[12.5px]">
            <label className="block"><span className="label block mb-1">Depuis</span><select name="fromKey" className="select h-9 w-auto">{refs.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Vers</span><select name="toKey" className="select h-9 w-auto">{refs.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Libellé du bouton</span><input name="label" className="input h-9" placeholder="ex : Demander la validation" /></label>
            <label className="flex items-center gap-1.5 h-9"><input type="checkbox" name="requiresValidator" /> Validateur</label>
            <label className="flex items-center gap-1.5 h-9"><input type="checkbox" name="requiresComment" /> Commentaire</label>
            <button className="btn-primary btn-sm h-9" type="submit">Ajouter la transition</button>
          </form>
        </Card>

        {/* Plateformes */}
        <Card title="Plateformes">
          <div className="space-y-1.5">
            {refs.platforms.map((p) => (
              <details key={p.key} className="rounded-lg border border-line">
                <summary className="flex items-center gap-2 px-2.5 h-9 cursor-pointer text-[13px]"><PlatformIcon icon={p.icon} label={p.label} size={14} /><span className="font-medium">{p.label}</span>{!p.active && <Badge tone="gray">inactif</Badge>}<span className="ml-auto flex items-center gap-2">{usedBadge("platform", p.key)}{del("platform", p.key)}</span></summary>
                <form action={savePlatform} className="grid sm:grid-cols-2 gap-2 p-2.5 text-[12.5px] border-t border-line">
                  <input type="hidden" name="key" value={p.key} />
                  <label className="block"><span className="label block mb-1">Libellé</span><input name="label" defaultValue={p.label} className="input h-8" /></label>
                  <label className="block"><span className="label block mb-1">Pictogramme</span><select name="icon" defaultValue={p.icon ?? ""} className="select h-8"><option value="">Lettre</option>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
                  <label className="block"><span className="label block mb-1">Ordre</span><input name="sort" defaultValue={p.sort} className="input h-8" /></label>
                  <label className="flex items-center gap-1.5 self-end h-8"><input type="checkbox" name="active" defaultChecked={p.active} /> Active</label>
                  <label className="block sm:col-span-2"><span className="label block mb-1">Formats / ratios (séparés par ;)</span><input name="ratios" defaultValue={(p.specs.ratios ?? []).join(" ; ")} className="input h-8" /></label>
                  <label className="block"><span className="label block mb-1">Durée max (s)</span><input name="maxDurationSec" defaultValue={p.specs.maxDurationSec ?? ""} className="input h-8" /></label>
                  <label className="block sm:col-span-2"><span className="label block mb-1">Consignes affichées dans le brief</span><textarea name="notes" defaultValue={p.specs.notes ?? ""} className="textarea min-h-[50px]" /></label>
                  <div><button className="btn-secondary btn-sm" type="submit">Enregistrer</button></div>
                </form>
              </details>
            ))}
          </div>
          <form action={savePlatform} className="mt-3 flex flex-wrap items-end gap-2 text-[12.5px]">
            <label className="block flex-1 min-w-[160px]"><span className="label block mb-1">Nouvelle plateforme</span><input name="label" className="input h-9" placeholder="ex : Pinterest" required /></label>
            <label className="block"><span className="label block mb-1">Pictogramme</span><select name="icon" className="select h-9 w-auto"><option value="">Lettre</option>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
            <input type="hidden" name="sort" value={refs.platforms.length + 1} /><input type="hidden" name="active" value="on" />
            <button className="btn-primary btn-sm h-9" type="submit">Ajouter</button>
          </form>
        </Card>

        {/* Formats & objectifs */}
        <div className="space-y-4">
          <Card title="Formats">
            <div className="space-y-1">
              {refs.formats.map((f) => (
                <form key={f.key} action={saveFormat} className="grid grid-cols-[50px_1fr_1.4fr_50px_50px_30px] items-center gap-1 text-[12.5px]">
                  <input type="hidden" name="key" value={f.key} />
                  <input name="sort" defaultValue={f.sort} className="input h-8 text-[12px]" />
                  <input name="label" defaultValue={f.label} className="input h-8 text-[12px]" />
                  <input name="defaultDeliverable" defaultValue={f.defaultDeliverable ?? ""} className="input h-8 text-[12px]" placeholder="Livrable par défaut" />
                  <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={f.active} /></label>
                  <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                  <span className="flex items-center gap-1">{usedBadge("format", f.key)}{delInline("format", f.key)}</span>
                </form>
              ))}
              <form action={saveFormat} className="grid grid-cols-[50px_1fr_1.4fr_50px_80px] items-center gap-1 text-[12.5px] pt-1">
                <input name="sort" defaultValue={refs.formats.length + 1} className="input h-8 text-[12px]" />
                <input name="label" placeholder="Nouveau format" className="input h-8 text-[12px]" required />
                <input name="defaultDeliverable" className="input h-8 text-[12px]" placeholder="Livrable par défaut" />
                <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
                <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
              </form>
            </div>
          </Card>
          <Card title="Objectifs de contenu">
            <div className="space-y-1">
              {refs.objectives.map((o) => (
                <form key={o.key} action={saveObjective} className="grid grid-cols-[50px_1fr_50px_50px_30px] items-center gap-1 text-[12.5px]">
                  <input type="hidden" name="key" value={o.key} />
                  <input name="sort" defaultValue={o.sort} className="input h-8 text-[12px]" />
                  <input name="label" defaultValue={o.label} className="input h-8 text-[12px]" />
                  <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={o.active} /></label>
                  <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                  <span className="flex items-center gap-1">{usedBadge("objective", o.key)}{delInline("objective", o.key)}</span>
                </form>
              ))}
              <form action={saveObjective} className="grid grid-cols-[50px_1fr_50px_80px] items-center gap-1 text-[12.5px] pt-1">
                <input name="sort" defaultValue={refs.objectives.length + 1} className="input h-8 text-[12px]" />
                <input name="label" placeholder="Nouvel objectif" className="input h-8 text-[12px]" required />
                <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
                <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
              </form>
            </div>
          </Card>
        </div>

        {/* Validateurs par marque */}
        <Card title="Validateurs par marque" className="xl:col-span-2">
          <p className="text-[12.5px] text-muted mb-3">En plus de l&apos;Administration et du droit « Valider » sur Marketing, ces personnes peuvent passer un contenu de la marque en « Validé » ou demander des corrections. Elles reçoivent les demandes de validation.</p>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
            {brands.filter((b) => b.active).map((b) => {
              const cur = valByBrand.get(b.id) ?? new Set<string>();
              return (
                <form key={b.id} action={saveBrandValidators} className="rounded-lg border border-line p-2.5 text-[12.5px]">
                  <input type="hidden" name="brandId" value={b.id} />
                  <div className="flex items-center gap-2 mb-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.color }} /><span className="font-medium">{b.name}</span><span className="ml-auto text-muted">{cur.size} validateur{cur.size > 1 ? "s" : ""}</span></div>
                  <select name="userIds" multiple size={4} defaultValue={[...cur]} className="select py-1 text-[12px]">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <button className="btn-secondary btn-sm mt-1.5" type="submit">Enregistrer</button>
                </form>
              );
            })}
          </div>
        </Card>
      </div>
    </>
  );
}
