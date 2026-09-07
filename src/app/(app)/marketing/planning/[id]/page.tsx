import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, brandFilter, canDo } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card, Badge, BrandDot, Facts } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { ContentWorkflow } from "@/components/content-workflow";
import { ContentUpload } from "@/components/content-upload";
import { REG_STATUS } from "@/components/regulatory-form";
import { contentRefs, listBriefTemplates } from "@/lib/content/refs";
import { nextTransitions, safeTone, lateness, toneClass } from "@/lib/content/shared";
import { canValidateBrand } from "@/lib/content/workflow";
import { listAssets, isPreviewable } from "@/lib/content/assets";
import { fmtDate, fmtAgo, initials, iso, today } from "@/lib/format";
import { saveBrief, changeStatus, addContentComment, savePostPublication, deleteContentHard, beginAssetUpload, appendAssetChunk, finishAssetUpload, deleteAssetAction, applyTemplateToContent } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Contenu" };
  const r = await db.execute<{ title: string }>(sql`select title from content_items where id = ${id}::uuid`);
  return { title: r.rows[0]?.title ? `Brief — ${r.rows[0].title}` : "Contenu" };
}

type Row = {
  id: string; date: string; publish_time: string | null; deadline: string | null; title: string; status: string;
  brand_id: string; brand: string; color: string; platform: string | null; format: string | null; objective: string | null;
  brief: string | null; key_message: string | null; angle: string | null; hook: string | null; caption: string | null; hashtags: string | null; cta: string | null;
  constraints: string | null; mandatory_mentions: string | null; forbidden_claims: string | null; references: { url: string; label?: string }[]; deliverables: string | null;
  responsible_id: string | null; responsible: string | null; validator_id: string | null; validator: string | null; created_by: string | null; campaign_id: string | null;
  link: string | null; reach: number | null; engagement: number | null; perf_notes: string | null; created_at: string; updated_at: string; template_id: string | null;
};
type Prod = { id: string; name: string; benefits: string | null; claims: string | null; actives: string | null; target: string | null; marketing_angle: string | null; image_url: string | null; reg_status: string | null; reg_id: string | null; reg_expiry: string | null };

export default async function ContentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string }> }) {
  await requireAccess("marketing");
  const { id } = await props.params;
  const { erreur } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const r = await db.execute<Row>(sql`
    select c.id, c.date::text as date, c.publish_time::text as publish_time, c.deadline::text as deadline, c.title, c.status,
      c.brand_id, b.name as brand, b.color, c.platform, c.format, c.objective,
      c.brief, c.key_message, c.angle, c.hook, c.caption, c.hashtags, c.cta, c.constraints, c.mandatory_mentions, c.forbidden_claims, c.references, c.deliverables,
      c.responsible_id, ru.name as responsible, c.validator_id, vu.name as validator, cu.name as created_by, c.campaign_id,
      c.link, c.reach, c.engagement, c.perf_notes, c.created_at::text as created_at, c.updated_at::text as updated_at, c.template_id
    from content_items c join brands b on b.id = c.brand_id
    left join users ru on ru.id = c.responsible_id left join users vu on vu.id = c.validator_id left join users cu on cu.id = c.created_by_id
    where c.id = ${id}::uuid`);
  const c = r.rows[0];
  if (!c) notFound();
  const scope = await brandFilter();
  if (scope && !scope.includes(c.brand_id)) notFound();

  const [refs, brands, users, templates, canEdit, canValidatePerm, isValidator, assets, prods, brandProducts, comments, history, campaigns] = await Promise.all([
    contentRefs(), listBrands(), listUsers(), listBriefTemplates(), canDo("marketing", "edit"), canDo("marketing", "validate"), canValidateBrand(c.brand_id), listAssets(id),
    db.execute<Prod>(sql`
      select p.id, p.name, p.benefits, p.claims, p.actives, p.target, p.marketing_angle, p.image_url, rf.status::text as reg_status, rf.id as reg_id, rf.expiry_date::text as reg_expiry
      from content_products cp join products p on p.id = cp.product_id
      left join lateral (select id, status, expiry_date from regulatory_files f where f.product_id = p.id order by (f.status = 'VALIDE') desc, f.expiry_date desc nulls last limit 1) rf on true
      where cp.content_id = ${id}::uuid order by p.name`),
    db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${c.brand_id}::uuid order by name`),
    db.execute<{ id: string; body: string; created_at: string; user: string | null }>(sql`select cc.id, cc.body, cc.created_at::text as created_at, u.name as "user" from content_comments cc left join users u on u.id = cc.user_id where cc.content_id = ${id}::uuid order by cc.created_at`),
    db.execute<{ from_status: string | null; to_status: string; comment: string | null; created_at: string; user: string | null }>(sql`select h.from_status, h.to_status, h.comment, h.created_at::text as created_at, u.name as "user" from content_status_history h left join users u on u.id = h.user_id where h.content_id = ${id}::uuid order by h.created_at desc`),
    db.execute<{ id: string; name: string }>(sql`select id, name from campaigns where brand_id = ${c.brand_id}::uuid and status not in ('DONE','ANALYZED') order by start_date desc nulls last, name`),
  ]);
  const st = refs.statuses.find((s) => s.key === c.status);
  const pf = refs.platforms.find((p) => p.key === c.platform);
  const fm = refs.formats.find((f) => f.key === c.format);
  const transitions = nextTransitions(refs, c.status, isValidator).map((t) => ({ toKey: t.toKey, label: t.label, requiresComment: t.requiresComment, requiresValidator: t.requiresValidator, allowed: t.allowed && canEdit, target: { label: t.target.label, tone: t.target.tone } }));
  const deliverables = assets.filter((a) => a.kind === "LIVRABLE"); const references = assets.filter((a) => a.kind === "REFERENCE");
  const late = lateness({ date: c.date, deadline: c.deadline, status: c.status, hasDeliverable: deliverables.length > 0 }, refs.statuses, iso(today()));
  const latest = deliverables[0];
  const selected = new Set(prods.rows.map((p) => p.id));
  const uploadActions = { begin: beginAssetUpload, append: appendAssetChunk, finish: finishAssetUpload };
  const ro = !canEdit;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/planning" className="hover:underline">Planning éditorial</Link>} title={c.title}
        subtitle={<span className="inline-flex items-center gap-2 flex-wrap"><BrandDot color={c.color} />{c.brand}{pf && <span className="inline-flex items-center gap-1"><PlatformIcon icon={pf.icon} label={pf.label} size={12} />{pf.label}</span>}{fm && <span>· {fm.label}</span>}<span>· publication le {fmtDate(c.date)}{c.publish_time ? ` à ${c.publish_time.slice(0, 5)}` : ""}</span>{c.deadline && <span>· livrable pour le {fmtDate(c.deadline)}</span>}</span>}
        actions={<>
          <Badge tone={safeTone(st?.tone)}>{st?.label ?? c.status}</Badge>
          {late && <Badge tone="red">{late === "PUBLICATION" ? "Publication en retard" : "Livrable en retard"}</Badge>}
          {st?.awaitingValidation && isValidator && <Link href={`/marketing/planning/validation?id=${c.id}`} className="btn-primary btn-sm">Ouvrir dans la file</Link>}
        </>} />
      {erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{erreur}</div>}

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* ------------------------------ Colonne brief ------------------------------ */}
        <div className="space-y-4">
          <Card title="Brief" action={templates.length > 0 && canEdit ? (
            <form action={applyTemplateToContent} className="flex items-center gap-1"><input type="hidden" name="id" value={c.id} /><select name="templateId" className="select h-7 text-[11px] w-auto py-0" defaultValue={c.template_id ?? ""}><option value="">Appliquer un modèle…</option>{templates.filter((t) => t.active && (!t.brandId || t.brandId === c.brand_id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button></form>
          ) : undefined}>
            <form action={saveBrief} className="space-y-3 text-[13px]">
              <input type="hidden" name="id" value={c.id} />
              <fieldset disabled={ro} className="contents">
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block sm:col-span-2"><span className="label block mb-1">Titre</span><input name="title" defaultValue={c.title} className="input h-9" required /></label>
                <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" defaultValue={c.brand_id} className="select h-9">{brands.filter((b) => b.active || b.id === c.brand_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Objectif</span><select name="objective" defaultValue={c.objective ?? ""} className="select h-9"><option value="">—</option>{refs.objectives.filter((o) => o.active || o.key === c.objective).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Plateforme</span><select name="platform" defaultValue={c.platform ?? ""} className="select h-9"><option value="">—</option>{refs.platforms.filter((p) => p.active || p.key === c.platform).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Format</span><select name="format" defaultValue={c.format ?? ""} className="select h-9"><option value="">—</option>{refs.formats.filter((f) => f.active || f.key === c.format).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Date de publication</span><input type="date" name="date" defaultValue={c.date} className="input h-9" required /></label>
                <label className="block"><span className="label block mb-1">Heure</span><input type="time" name="publishTime" defaultValue={c.publish_time?.slice(0, 5) ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Deadline du livrable</span><input type="date" name="deadline" defaultValue={c.deadline ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Campagne liée</span><select name="campaignId" defaultValue={c.campaign_id ?? ""} className="select h-9"><option value="">—</option>{campaigns.rows.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Responsable création</span><select name="responsibleId" defaultValue={c.responsible_id ?? ""} className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Validateur</span><select name="validatorId" defaultValue={c.validator_id ?? ""} className="select h-9"><option value="">Validateurs de la marque / Direction</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              </div>

              <label className="block"><span className="label block mb-1">Produits concernés ({brandProducts.rows.length} dans la bibliothèque {c.brand})</span>
                <select name="productIds" multiple size={Math.min(6, Math.max(3, brandProducts.rows.length))} defaultValue={[...selected]} className="select py-1 min-h-[80px]">{brandProducts.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <span className="text-[11px] text-muted">⌘ / Ctrl pour en choisir plusieurs. Bénéfices, allégations et fiche réglementaire s&apos;affichent à droite.</span>
              </label>

              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block sm:col-span-2"><span className="label block mb-1">Message clé</span><input name="keyMessage" defaultValue={c.key_message ?? ""} className="input h-9" placeholder="Une idée, une preuve, un geste." /></label>
                <label className="block"><span className="label block mb-1">Angle</span><input name="angle" defaultValue={c.angle ?? ""} className="input h-9" placeholder="ex : le pharmacien recommande" /></label>
                <label className="block"><span className="label block mb-1">Accroche proposée</span><input name="hook" defaultValue={c.hook ?? ""} className="input h-9" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Légende (caption)</span><textarea name="caption" defaultValue={c.caption ?? ""} className="textarea min-h-[110px]" placeholder="Texte prêt à publier…" /></label>
                <label className="block"><span className="label block mb-1">Hashtags</span><input name="hashtags" defaultValue={c.hashtags ?? ""} className="input h-9" placeholder="#gamarde #peausensible" /></label>
                <label className="block"><span className="label block mb-1">Appel à l&apos;action (CTA)</span><input name="cta" defaultValue={c.cta ?? ""} className="input h-9" placeholder="Disponible en pharmacie." /></label>
              </div>

              <details className="rounded-xl border border-line p-3" open={!!(c.constraints || c.mandatory_mentions || c.forbidden_claims)}>
                <summary className="cursor-pointer font-medium">Contraintes, mentions obligatoires, allégations interdites</summary>
                <div className="mt-2 space-y-2">
                  {pf && (pf.specs.ratios?.length || pf.specs.notes) && (
                    <div className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
                      <b>{pf.label}</b>{pf.specs.ratios?.length ? <> · formats : {pf.specs.ratios.join(", ")}</> : null}{pf.specs.maxDurationSec ? <> · durée max {pf.specs.maxDurationSec} s</> : null}{pf.specs.notes ? <div>{pf.specs.notes}</div> : null}
                    </div>
                  )}
                  <label className="block"><span className="label block mb-1">Contraintes (charte, technique)</span><textarea name="constraints" defaultValue={c.constraints ?? ""} className="textarea min-h-[60px]" /></label>
                  <label className="block"><span className="label block mb-1">Mentions obligatoires</span><textarea name="mandatoryMentions" defaultValue={c.mandatory_mentions ?? ""} className="textarea min-h-[50px]" /></label>
                  <label className="block"><span className="label block mb-1">Allégations interdites</span><textarea name="forbiddenClaims" defaultValue={c.forbidden_claims ?? ""} className="textarea min-h-[50px]" /></label>
                </div>
              </details>

              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Livrables attendus</span><textarea name="deliverables" defaultValue={c.deliverables ?? ""} className="textarea min-h-[60px]" placeholder="1 visuel 1080×1350, 3 stories…" /></label>
                <label className="block"><span className="label block mb-1">Références / inspirations (un lien par ligne)</span><textarea name="references" defaultValue={c.references.map((x) => [x.url, x.label].filter(Boolean).join(" ")).join("\n")} className="textarea min-h-[60px]" placeholder="https://… légende facultative" /></label>
              </div>
              <label className="block"><span className="label block mb-1">Notes de brief</span><textarea name="brief" defaultValue={c.brief ?? ""} className="textarea min-h-[60px]" /></label>
              </fieldset>
              {canEdit && <div className="flex items-center gap-2"><button className="btn-primary btn-sm" type="submit">Enregistrer le brief</button><span className="text-[11px] text-muted">Modifié {fmtAgo(c.updated_at)}{c.created_by ? ` · créé par ${c.created_by}` : ""}</span></div>}
            </form>
          </Card>

          {c.references.length > 0 && (
            <Card title="Références">
              <ul className="text-[13px] space-y-1">{c.references.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">{x.label ?? x.url}</a></li>)}</ul>
            </Card>
          )}

          <Card title={`Commentaires (${comments.rows.length})`}>
            <div className="space-y-3 mb-3">
              {comments.rows.map((k) => (
                <div key={k.id} className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-accent-soft text-accent-2 text-[11px] font-semibold flex items-center justify-center shrink-0">{initials(k.user ?? "?")}</div>
                  <div className="min-w-0"><div className="text-[12px] text-muted">{k.user ?? "—"} · {fmtAgo(k.created_at)}</div><div className="text-[14px] whitespace-pre-wrap">{k.body}</div></div>
                </div>
              ))}
              {comments.rows.length === 0 && <div className="text-sm text-muted">Aucun commentaire.</div>}
            </div>
            <form action={addContentComment} className="flex gap-2"><input type="hidden" name="contentId" value={c.id} /><input name="body" placeholder="Écrire un commentaire…" className="input h-10" required /><button className="btn-primary btn-sm h-10" type="submit">Envoyer</button></form>
          </Card>
        </div>

        {/* ------------------------------ Colonne droite ------------------------------ */}
        <div className="space-y-4">
          <Card title="Étape suivante">
            <ContentWorkflow id={c.id} transitions={transitions} action={changeStatus} />
            <Facts cols={2} items={[
              { label: "Responsable", value: c.responsible ?? "—" }, { label: "Validateur", value: c.validator ?? "Marque / Direction" },
              { label: "Livrable pour le", value: c.deadline ? fmtDate(c.deadline) : "—" }, { label: "Publication", value: fmtDate(c.date) },
            ]} />
          </Card>

          <Card title={`Livrables${deliverables.length ? ` (${deliverables.length} version${deliverables.length > 1 ? "s" : ""})` : ""}`} action={canEdit ? <ContentUpload contentId={c.id} kind="LIVRABLE" label={deliverables.length ? "Nouvelle version" : "Déposer le livrable"} actions={uploadActions} /> : undefined}>
            {latest && isPreviewable(latest.mime) && (
              <a href={`/marketing/planning/fichier/${latest.id}`} target="_blank" rel="noreferrer" className="block mb-3 rounded-xl overflow-hidden border border-line bg-black/5">
                {latest.mime.startsWith("image/") ? <img src={`/marketing/planning/fichier/${latest.id}`} alt={latest.name} className="max-h-[360px] w-full object-contain" />
                  : latest.mime.startsWith("video/") ? <video src={`/marketing/planning/fichier/${latest.id}`} controls className="max-h-[360px] w-full" />
                  : <div className="p-4 text-[13px] text-center">PDF — ouvrir</div>}
              </a>
            )}
            {deliverables.length === 0 && <p className="text-[13px] text-muted">Aucun livrable déposé.{c.deliverables ? <> Attendu : {c.deliverables}.</> : null}</p>}
            <ul className="space-y-1.5 text-[12.5px]">
              {deliverables.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <Badge tone={a.id === latest?.id ? "green" : "gray"}>v{a.version}</Badge>
                  <a href={`/marketing/planning/fichier/${a.id}`} target="_blank" rel="noreferrer" className="truncate hover:underline">{a.name}</a>
                  <span className="text-muted ml-auto whitespace-nowrap">{Math.max(1, Math.round(a.size / 1024))} Ko · {a.uploadedBy ?? "—"} · {fmtAgo(a.createdAt)}</span>
                  {canValidatePerm && <form action={deleteAssetAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="contentId" value={c.id} /><button className="text-faint hover:text-red" title="Supprimer cette version" type="submit">×</button></form>}
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-line">
              <div className="flex items-center justify-between"><span className="label">Images de référence</span>{canEdit && <ContentUpload contentId={c.id} kind="REFERENCE" label="Ajouter" actions={uploadActions} />}</div>
              {references.length > 0 && <div className="mt-2 grid grid-cols-3 gap-1.5">{references.map((a) => <a key={a.id} href={`/marketing/planning/fichier/${a.id}`} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-line bg-black/5" title={a.name}>{a.mime.startsWith("image/") ? <img src={`/marketing/planning/fichier/${a.id}`} alt={a.name} className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-[11px] p-1 text-center">{a.name}</div>}</a>)}</div>}
            </div>
          </Card>

          <Card title={`Produits (${prods.rows.length})`}>
            {prods.rows.length === 0 && <p className="text-[13px] text-muted">Aucun produit rattaché. Choisissez-les dans le brief : bénéfices et allégations autorisées viendront de la fiche produit.</p>}
            <div className="space-y-3">
              {prods.rows.map((p) => (
                <div key={p.id} className="text-[12.5px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.image_url && <img src={p.image_url} alt="" className="h-9 w-9 rounded-lg object-cover border border-line" />}
                    <Link href={`/produits/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    {p.reg_status ? <Link href={`/reglementaire/${p.reg_id}`} className="inline-flex"><Badge tone={REG_STATUS[p.reg_status]?.tone ?? "gray"}>{REG_STATUS[p.reg_status]?.label ?? p.reg_status}{p.reg_expiry ? ` · ${fmtDate(p.reg_expiry)}` : ""}</Badge></Link> : <Badge tone="gray">Sans dossier réglementaire</Badge>}
                  </div>
                  {p.benefits && <div className="mt-1"><span className="label">Bénéfices</span> {p.benefits}</div>}
                  {p.claims && <div className="mt-0.5"><span className="label">Allégations autorisées</span> {p.claims}</div>}
                  {p.actives && <div className="mt-0.5"><span className="label">Actifs</span> {p.actives}</div>}
                  {p.marketing_angle && <div className="mt-0.5"><span className="label">Angle</span> {p.marketing_angle}</div>}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Après publication">
            <form action={savePostPublication} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={c.id} />
              <fieldset disabled={ro} className="contents">
              <label className="block"><span className="label block mb-1">Lien du post publié</span><input name="link" defaultValue={c.link ?? ""} className="input h-9" placeholder="https://" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="label block mb-1">Portée (facultatif)</span><input name="reach" defaultValue={c.reach ?? ""} inputMode="numeric" className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Engagement (facultatif)</span><input name="engagement" defaultValue={c.engagement ?? ""} inputMode="numeric" className="input h-9" /></label>
              </div>
              <label className="block"><span className="label block mb-1">Remarques</span><input name="perfNotes" defaultValue={c.perf_notes ?? ""} className="input h-9" /></label>
              </fieldset>
              {canEdit && <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>}
              {c.link && <a href={c.link} target="_blank" rel="noreferrer" className="ml-2 text-[12px] text-accent">Voir le post ↗</a>}
              <p className="text-[11px] text-muted">Saisie manuelle en attendant les connecteurs : une donnée absente s&apos;affiche « — », jamais estimée.</p>
            </form>
          </Card>

          <Card title="Historique">
            <ol className="space-y-2 text-[12.5px]">
              {history.rows.map((h, i) => {
                const to = refs.statuses.find((s) => s.key === h.to_status);
                return (
                  <li key={i} className="flex gap-2">
                    <span className={`badge shrink-0 ${toneClass(to?.tone)}`}>{to?.label ?? h.to_status}</span>
                    <div className="min-w-0"><div className="text-muted">{h.user ?? "—"} · {fmtDate(h.created_at)}</div>{h.comment && <div className="whitespace-pre-wrap">{h.comment}</div>}</div>
                  </li>
                );
              })}
            </ol>
            {canValidatePerm && (
              <form action={deleteContentHard} className="mt-4 pt-3 border-t border-line"><input type="hidden" name="id" value={c.id} /><button className="text-[12px] text-faint hover:text-red" type="submit">Supprimer définitivement (préférer « Archiver »)</button></form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
