import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireActivationAccess, activationScope, canDoActivation, canValidateActivation } from "@/lib/activations/access";
import { activationRefs, listActivationTemplates } from "@/lib/activations/refs";
import { getActivation, pickerOptions, knownCities } from "@/lib/activations/queries";
import { activationBudget } from "@/lib/activations/budget";
import { nextTransitions, safeTone, toneClass, LATENESS_LABELS, durationDays, unitCost } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listBrands, listUsers } from "@/lib/users";
import { listAssets, isPreviewable, ASSET_KIND_LABELS } from "@/lib/content/assets";
import { PageHeader, Card, Badge, BrandDot, Facts, Progress } from "@/components/ui";
import { ContentWorkflow } from "@/components/content-workflow";
import { AssetUpload } from "@/components/asset-upload";
import { EntityPicker } from "@/components/entity-picker";
import { ActivationTypeIcon } from "@/components/activation-type-icon";
import { fmtDate, fmtAgo, fmtMAD, initials, iso, today } from "@/lib/format";
import {
  saveActivation, duplicateActivation, deleteActivationHard, changeActivationStatus, addActivationComment, saveResults,
  saveBudgetLine, deleteBudgetLine, addChecklistItem, toggleChecklistItem, deleteChecklistItem,
  beginActivationAsset, appendActivationChunk, finishActivationAsset, deleteActivationAsset,
} from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { title: "Activation" };
  const r = await db.execute<{ name: string }>(sql`select name from activations where id = ${id}::uuid`);
  return { title: r.rows[0]?.name ?? "Activation" };
}

const FILE_KINDS = ["PHOTO", "DEVIS", "FACTURE", "VISUEL", "COMPTE_RENDU", "REFERENCE"] as const;

export default async function ActivationPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string; photo?: string }> }) {
  await requireActivationAccess();
  const { id } = await props.params;
  const { erreur, photo } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [refs, settings, scope] = await Promise.all([activationRefs(), getSettings(), activationScope()]);
  const todayIso = iso(today());
  const a = await getActivation(id, scope, refs, settings.activations, todayIso);
  if (!a) notFound();

  const [budget, assets, options, cities, brands, users, templates, canEdit, canValidatePerm, isValidator, comments, history] = await Promise.all([
    activationBudget(id), listAssets({ activationId: id }), pickerOptions(), knownCities(), listBrands(), listUsers(), listActivationTemplates(),
    canDoActivation("edit"), canDoActivation("validate"), canValidateActivation(a.brandId),
    db.execute<{ id: string; body: string; created_at: string; user: string | null }>(sql`select c.id, c.body, c.created_at::text as created_at, u.name as "user" from activation_comments c left join users u on u.id = c.user_id where c.activation_id = ${id}::uuid order by c.created_at`),
    db.execute<{ from_status: string | null; to_status: string; comment: string | null; created_at: string; user: string | null }>(sql`select h.from_status, h.to_status, h.comment, h.created_at::text as created_at, u.name as "user" from activation_status_history h left join users u on u.id = h.user_id where h.activation_id = ${id}::uuid order by h.created_at desc`),
  ]);
  const checklist = (await db.execute<{ id: string; label: string; done: boolean; done_by: string | null; done_at: string | null; due_date: string | null; assignee: string | null }>(sql`
    select i.id, i.label, i.done, du.name as done_by, i.done_at::text as done_at, i.due_date::text as due_date, au.name as assignee
    from activation_checklist_items i left join users du on du.id = i.done_by_id left join users au on au.id = i.assignee_id
    where i.activation_id = ${id}::uuid order by i.sort, i.label`)).rows;

  const st = refs.statuses.find((s) => s.key === a.status);
  const type = refs.types.find((t) => t.key === a.type);
  const transitions = nextTransitions(refs, a.status, isValidator).map((t) => ({ toKey: t.toKey, label: t.label, requiresComment: t.requiresComment, requiresValidator: t.requiresValidator, allowed: t.allowed && canEdit, target: { label: t.target.label, tone: t.target.tone } }));
  const ro = !canEdit;
  const uploadActions = { begin: beginActivationAsset, append: appendActivationChunk, finish: finishActivationAsset };
  const photos = assets.filter((x) => x.kind === "PHOTO");
  const otherFiles = assets.filter((x) => x.kind !== "PHOTO");
  const visibleBrands = brands.filter((b) => b.active || a.brandIds.includes(b.id));
  const visibleClients = options.clients.filter((c) => !scope.clientIds || scope.clientIds.includes(c.id) || a.clientIds.includes(c.id));
  const t = budget.totals;
  const done = checklist.filter((c) => c.done).length;
  const fileHref = (assetId: string) => `/marketing/activations/fichier/${assetId}`;
  const linkedProducts = options.products.filter((p) => a.productIds.includes(p.id));
  const linkedClients = options.clients.filter((c) => a.clientIds.includes(c.id));

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/activations" className="hover:underline">Activations</Link>}
        title={<span className="inline-flex items-center gap-2"><ActivationTypeIcon icon={type?.icon} size={20} className="text-muted" />{a.name}</span>}
        subtitle={<span className="inline-flex items-center gap-2 flex-wrap">{a.brand && <span className="inline-flex items-center gap-1"><BrandDot color={a.color ?? "#999"} />{a.brand}{a.brandCount > 1 ? ` +${a.brandCount - 1}` : ""}</span>}<span>· {type?.label ?? a.type}</span><span>· {fmtDate(a.date)}{a.endDate && a.endDate !== a.date ? ` → ${fmtDate(a.endDate)} (${durationDays(a.date, a.endDate)} j)` : ""}</span>{a.city && <span>· {a.city}</span>}{a.campaign && <span>· <Link href={`/marketing/campagnes/${a.campaignId}`} className="hover:underline">{a.campaign}</Link></span>}</span>}
        actions={<>
          <Badge tone={safeTone(st?.tone)}>{st?.label ?? a.status}</Badge>
          {a.late.map((l) => <Badge key={l} tone="red">{LATENESS_LABELS[l]}</Badge>)}
          {st?.awaitingValidation && isValidator && <Link href={`/marketing/activations/validation?id=${a.id}`} className="btn-primary btn-sm">Ouvrir dans la file</Link>}
        </>} />
      {erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{erreur}</div>}

      {photo && canEdit && (
        <Card className="mb-4 border-accent/40">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div><div className="font-medium">Activation créée. Ajoutez la photo maintenant.</div><div className="text-[12.5px] text-muted">Elle sert de preuve d&apos;installation et alimente le compte rendu.</div></div>
            <AssetUpload ownerId={a.id} kind="PHOTO" label="Prendre une photo" camera actions={uploadActions} />
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* ------------------------------ Colonne principale ------------------------------ */}
        <div className="space-y-4">
          <Card title="Identité, lieu et équipe">
            <form action={saveActivation} className="space-y-3 text-[13px]">
              <input type="hidden" name="id" value={a.id} />
              <fieldset disabled={ro} className="contents">
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block sm:col-span-2"><span className="label block mb-1">Nom</span><input name="name" defaultValue={a.name} className="input h-9" required /></label>
                <label className="block"><span className="label block mb-1">Type</span><select name="type" defaultValue={a.type} className="select h-9">{refs.types.filter((x) => x.active || x.key === a.type).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Objectif</span><select name="objectiveKey" defaultValue={a.objectiveKey ?? ""} className="select h-9"><option value="">—</option>{refs.objectives.filter((o) => o.active || o.key === a.objectiveKey).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Cible</span><select name="targetKey" defaultValue={a.targetKey ?? ""} className="select h-9"><option value="">—</option>{refs.targets.filter((o) => o.active || o.key === a.targetKey).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Campagne parente</span><select name="campaignId" defaultValue={a.campaignId ?? ""} className="select h-9"><option value="">—</option>{options.campaigns.filter((k) => !a.brandId || k.brandId === a.brandId || k.id === a.campaignId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Préparation dès le</span><input type="date" name="prepDate" defaultValue={a.prepDate ?? ""} className="input h-9" /></label>
                <label className="block"><span className="label block mb-1">Début</span><input type="date" name="date" defaultValue={a.date} className="input h-9" required /></label>
                <label className="block"><span className="label block mb-1">Fin</span><input type="date" name="endDate" defaultValue={a.endDate ?? ""} className="input h-9" /></label>
                <div className="block sm:col-span-2"><span className="label block mb-1">Marque(s)</span><EntityPicker name="brandIds" options={visibleBrands.map((b) => ({ id: b.id, label: b.name }))} initial={a.brandIds} placeholder="Ajouter une marque…" /></div>
                <div className="block sm:col-span-2"><span className="label block mb-1">Produits concernés</span><EntityPicker name="productIds" options={options.products.map((p) => ({ id: p.id, label: p.name, hint: brands.find((b) => b.id === p.brandId)?.name ?? null }))} initial={a.productIds} placeholder="Rechercher un produit…" /></div>
                <div className="block sm:col-span-2"><span className="label block mb-1">Points de vente / clients</span><EntityPicker name="clientIds" options={visibleClients.map((c) => ({ id: c.id, label: c.name, hint: c.city }))} initial={a.clientIds} placeholder="Rechercher une pharmacie, une ville…" /></div>
                <label className="block"><span className="label block mb-1">Ville</span><input name="city" defaultValue={a.city ?? ""} list="villes" className="input h-9" /><datalist id="villes">{cities.map((c) => <option key={c} value={c} />)}</datalist></label>
                <label className="block"><span className="label block mb-1">Lieu libre</span><input name="place" defaultValue={a.place ?? ""} className="input h-9" placeholder="Hôtel, salle, stand…" /></label>
                <label className="block"><span className="label block mb-1">Pilote</span><select name="responsibleId" defaultValue={a.responsibleId ?? ""} className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Validateur</span><select name="validatorId" defaultValue={a.validatorId ?? ""} className="select h-9"><option value="">Validateurs de la marque / Direction</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <div className="block sm:col-span-2"><span className="label block mb-1">Contributeurs</span><EntityPicker name="contributorIds" options={users.map((u) => ({ id: u.id, label: u.name }))} initial={a.contributorIds} placeholder="Ajouter une personne…" /></div>
                <label className="block"><span className="label block mb-1">Animation Terrain liée</span><select name="linkedAnimationId" defaultValue={a.linkedAnimationId ?? ""} className="select h-9"><option value="">—</option>{options.animations.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Description</span><textarea name="description" defaultValue={a.description ?? ""} className="textarea min-h-[70px]" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Notes</span><textarea name="notes" defaultValue={a.notes ?? ""} className="textarea min-h-[50px]" /></label>
              </div>
              </fieldset>
              {canEdit && <div className="flex items-center gap-2 flex-wrap"><button className="btn-primary btn-sm" type="submit">Enregistrer</button><span className="text-[11px] text-muted">Modifiée {fmtAgo(a.updatedAt)}{a.createdBy ? ` · créée par ${a.createdBy}` : ""}{a.templateId ? ` · modèle « ${templates.find((x) => x.id === a.templateId)?.name ?? "…"} »` : ""}</span></div>}
            </form>
          </Card>

          {/* ------------------------------ Budget ------------------------------ */}
          <Card title="Budget" action={<span className="text-[12px] text-muted">{t.planned > 0 ? `${Math.round(((t.committed + t.materials) / t.planned) * 100)} % engagé` : "Aucun prévu"}</span>}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[["Prévu", t.planned], ["Engagé", t.committed], ["Dépensé", t.spent], ["Matériel", t.materials], ["Reste", t.remaining]].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl bg-surface-2 px-3 py-2"><div className="label">{l}</div><div className={`text-[15px] font-semibold tabular-nums ${l === "Reste" && Number(v) < 0 ? "text-red" : ""}`}>{fmtMAD(v, { compact: true })}</div></div>
              ))}
            </div>
            {t.planned > 0 && <Progress value={Math.min(100, ((t.committed + t.materials) / t.planned) * 100)} tone={t.overrunPct > 0 ? "red" : "accent"} className="mb-3" />}
            {!st?.isValidated && <p className="text-[12px] text-muted mb-2">Le prévu ne pèse dans le Command Center qu&apos;après validation. Une facture saisie (dépensé) compte toujours.</p>}
            <div className="space-y-2">
              {budget.lines.map((l) => (
                <form key={l.id} action={saveBudgetLine} className="grid grid-cols-2 sm:grid-cols-12 gap-1.5 items-end rounded-xl border border-line p-2 text-[12.5px]">
                  <input type="hidden" name="activationId" value={a.id} /><input type="hidden" name="lineId" value={l.id} />
                  <fieldset disabled={ro} className="contents">
                  <label className="sm:col-span-3 block"><span className="label block">Poste</span><select name="costItemKey" defaultValue={l.costItemKey} className="select h-8 text-[12px]">{refs.costItems.filter((c) => c.active || c.key === l.costItemKey).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                  <label className="sm:col-span-3 block"><span className="label block">Libellé</span><input name="label" defaultValue={l.label} className="input h-8 text-[12px]" /></label>
                  <label className="block"><span className="label block">Prévu</span><input name="planned" defaultValue={l.planned || ""} inputMode="decimal" className="input h-8 text-[12px] text-right" /></label>
                  <label className="block"><span className="label block">Engagé</span><input name="committed" defaultValue={l.committed || ""} inputMode="decimal" className="input h-8 text-[12px] text-right" placeholder="devis" /></label>
                  <label className="block"><span className="label block">Dépensé</span><input name="spent" defaultValue={l.spent || ""} inputMode="decimal" className="input h-8 text-[12px] text-right" placeholder="facture" /></label>
                  <label className="sm:col-span-2 block"><span className="label block">Fournisseur / réf.</span><input name="supplier" defaultValue={l.supplier ?? ""} className="input h-8 text-[12px]" placeholder="Fournisseur" /></label>
                  <input type="hidden" name="brandId" value={l.brandId ?? ""} /><input type="hidden" name="quoteRef" value={l.quoteRef ?? ""} /><input type="hidden" name="invoiceRef" value={l.invoiceRef ?? ""} /><input type="hidden" name="date" value={l.date ?? ""} />
                  </fieldset>
                  {canEdit && <div className="flex gap-1 sm:col-span-1"><button className="btn-secondary btn-sm h-8 text-[12px]" type="submit">OK</button><button className="btn-ghost btn-sm h-8 text-[12px] text-faint hover:text-red" formAction={deleteBudgetLine} title="Supprimer" type="submit">×</button></div>}
                  <div className="col-span-2 sm:col-span-12 text-[11px] text-muted">{l.costItem} → catégorie budget {l.budgetCategory}{l.brand ? ` · ${l.brand}` : ""}</div>
                </form>
              ))}
              {budget.lines.length === 0 && <p className="text-[13px] text-muted">Aucun poste. Ajoutez le prévu poste par poste : c&apos;est ce que le validateur engage.</p>}
              {canEdit && (
                <form action={saveBudgetLine} className="grid grid-cols-2 sm:grid-cols-12 gap-1.5 items-end rounded-xl border border-dashed border-line-2 p-2 text-[12.5px]">
                  <input type="hidden" name="activationId" value={a.id} />
                  <label className="sm:col-span-3 block"><span className="label block">Nouveau poste</span><select name="costItemKey" className="select h-8 text-[12px]">{refs.costItems.filter((c) => c.active).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
                  <label className="sm:col-span-3 block"><span className="label block">Libellé</span><input name="label" className="input h-8 text-[12px]" placeholder="ex : Salle Hyatt" /></label>
                  <label className="block"><span className="label block">Prévu</span><input name="planned" inputMode="decimal" className="input h-8 text-[12px] text-right" /></label>
                  <label className="block"><span className="label block">Engagé</span><input name="committed" inputMode="decimal" className="input h-8 text-[12px] text-right" /></label>
                  <label className="block"><span className="label block">Dépensé</span><input name="spent" inputMode="decimal" className="input h-8 text-[12px] text-right" /></label>
                  <label className="sm:col-span-2 block"><span className="label block">Fournisseur</span><input name="supplier" className="input h-8 text-[12px]" /></label>
                  <button className="btn-primary btn-sm h-8 text-[12px]" type="submit">Ajouter</button>
                </form>
              )}
            </div>
            {budget.materials.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="label mb-1">Matériel consommé (valorisé)</div>
                <ul className="text-[12.5px] space-y-0.5">{budget.materials.map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{m.item} <span className="text-muted">× {m.quantity} {m.unit}</span></span><span className="tabular-nums">{fmtMAD(m.total)}</span></li>)}</ul>
              </div>
            )}
          </Card>

          {/* ------------------------------ Checklist ------------------------------ */}
          <Card title={`Checklist de préparation${checklist.length ? ` · ${done}/${checklist.length}` : ""}`}>
            {checklist.length > 0 && <Progress value={(done / checklist.length) * 100} tone={done === checklist.length ? "green" : "accent"} className="mb-3" />}
            <ul className="space-y-1.5 text-[13px]">
              {checklist.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <form action={toggleChecklistItem} className="contents"><input type="hidden" name="activationId" value={a.id} /><input type="hidden" name="itemId" value={c.id} />
                    <button type="submit" disabled={ro} className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 ${c.done ? "bg-green text-white border-green" : "border-line-2"}`} aria-label={c.done ? "Décocher" : "Cocher"}>{c.done ? "✓" : ""}</button>
                  </form>
                  <span className={c.done ? "line-through text-muted" : ""}>{c.label}</span>
                  <span className="text-[11px] text-muted ml-auto whitespace-nowrap">{c.done ? `${c.done_by ?? ""} ${fmtAgo(c.done_at)}` : [c.assignee, c.due_date ? fmtDate(c.due_date) : null].filter(Boolean).join(" · ")}</span>
                  {canEdit && <form action={deleteChecklistItem}><input type="hidden" name="activationId" value={a.id} /><input type="hidden" name="itemId" value={c.id} /><button className="text-faint hover:text-red" type="submit" title="Retirer">×</button></form>}
                </li>
              ))}
            </ul>
            {checklist.length === 0 && <p className="text-[13px] text-muted">Aucune étape. Le type « {type?.label} » n&apos;a pas de checklist par défaut, ou elle a été vidée.</p>}
            {canEdit && (
              <form action={addChecklistItem} className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
                <input type="hidden" name="activationId" value={a.id} />
                <input name="label" className="input h-8 flex-1 min-w-[160px]" placeholder="Nouvelle étape…" required />
                <select name="assigneeId" className="select h-8 w-auto" defaultValue=""><option value="">Qui ?</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <input type="date" name="dueDate" className="input h-8 w-auto" />
                <button className="btn-secondary btn-sm h-8" type="submit">Ajouter</button>
              </form>
            )}
          </Card>

          {/* ------------------------------ Résultats ------------------------------ */}
          <Card title="Résultats" action={a.resultsAt ? <span className="text-[12px] text-muted">Saisis {fmtAgo(a.resultsAt)}</span> : <span className="text-[12px] text-muted">Rien d&apos;obligatoire</span>}>
            <form action={saveResults} className="space-y-2 text-[13px]">
              <input type="hidden" name="id" value={a.id} />
              <fieldset disabled={ro} className="contents">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([["participants", "Participants / contacts", a.participants], ["samples", "Échantillons distribués", a.samples], ["pharmaciesReached", "Pharmacies touchées", a.pharmaciesReached], ["leads", "Leads", a.leads], ["ordersOnSite", "Commandes sur place", a.ordersOnSite], ["newClients", "Nouveaux clients", a.newClients], ["pressMentions", "Retombées presse", a.pressMentions]] as const).map(([k, l, v]) => (
                  <label key={k} className="block"><span className="label block mb-1">{l}</span><input name={k} defaultValue={v ?? ""} inputMode="numeric" className="input h-9" /></label>
                ))}
                <label className="block"><span className="label block mb-1">Montant commandes (MAD)</span><input name="ordersAmount" defaultValue={a.ordersAmount ?? ""} inputMode="decimal" className="input h-9" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">CA réellement mesuré (MAD)</span><input name="attributedRevenue" defaultValue={a.attributedRevenue ?? ""} inputMode="decimal" className="input h-9" placeholder="code promo, commandes nominatives…" /></label>
                <label className="block sm:col-span-2"><span className="label block mb-1">Lien (post, article, album)</span><input name="publishedLink" defaultValue={a.publishedLink ?? ""} className="input h-9" placeholder="https://" /></label>
              </div>
              <label className="block"><span className="label block mb-1">Note qualitative</span><textarea name="results" defaultValue={a.results ?? ""} className="textarea min-h-[60px]" placeholder="Ce qui a marché, ce qui a coincé, ce qu'on referait autrement." /></label>
              </fieldset>
              <div className="flex items-center gap-3 flex-wrap">
                {canEdit && <button className="btn-secondary btn-sm" type="submit">Enregistrer les résultats</button>}
                {t.fullCost > 0 && (
                  <span className="text-[12px] text-muted">
                    Coût par contact {unitCost(t.fullCost, a.participants) != null ? fmtMAD(unitCost(t.fullCost, a.participants)) : "—"} · par échantillon {unitCost(t.fullCost, a.samples) != null ? fmtMAD(unitCost(t.fullCost, a.samples)) : "—"} · par pharmacie {unitCost(t.fullCost, a.pharmaciesReached) != null ? fmtMAD(unitCost(t.fullCost, a.pharmaciesReached)) : "—"}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted">L&apos;impact ventes avant / pendant / après (corrélation observée, jamais causalité) arrive avec la fiche synthèse. Une donnée absente s&apos;affiche « — », jamais estimée.</p>
            </form>
          </Card>

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
            <form action={addActivationComment} className="flex gap-2"><input type="hidden" name="activationId" value={a.id} /><input name="body" placeholder="Écrire un commentaire…" className="input h-10" required /><button className="btn-primary btn-sm h-10" type="submit">Envoyer</button></form>
          </Card>
        </div>

        {/* ------------------------------ Colonne droite (en premier sur mobile : étape suivante, photo) ------------------------------ */}
        <div className="space-y-4 order-first lg:order-none">
          <Card title="Étape suivante">
            <ContentWorkflow id={a.id} transitions={transitions} action={changeActivationStatus} />
            <div className="mt-3"><Facts cols={2} items={[
              { label: "Pilote", value: a.responsible ?? "—" }, { label: "Validateur", value: a.validator ?? "Marque / Direction" },
              { label: "Préparation", value: a.prepDate ? fmtDate(a.prepDate) : "—" }, { label: "Validée le", value: a.validatedAt ? fmtDate(a.validatedAt) : "—" },
            ]} /></div>
          </Card>

          <Card title={`Photos${photos.length ? ` (${photos.length})` : ""}`} action={canEdit ? <AssetUpload ownerId={a.id} kind="PHOTO" label="Photo" camera actions={uploadActions} /> : undefined}>
            {photos.length === 0 && <p className="text-[13px] text-muted">Aucune photo. Sur téléphone, « Photo » ouvre l&apos;appareil.</p>}
            {photos.length > 0 && <div className="grid grid-cols-3 gap-1.5">{photos.map((p) => <a key={p.id} href={fileHref(p.id)} target="_blank" rel="noreferrer" className="relative block aspect-square rounded-lg overflow-hidden border border-line bg-black/5" title={p.name}>{p.mime.startsWith("image/") ? <img src={fileHref(p.id)} alt={p.name} className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-[11px] p-1 text-center">{p.name}</div>}</a>)}</div>}
          </Card>

          <Card title={`Devis, factures, visuels${otherFiles.length ? ` (${otherFiles.length})` : ""}`}>
            {canEdit && <div className="flex flex-wrap gap-1.5 mb-2">{FILE_KINDS.filter((k) => k !== "PHOTO").map((k) => <AssetUpload key={k} ownerId={a.id} kind={k} label={ASSET_KIND_LABELS[k]} actions={uploadActions} />)}</div>}
            {otherFiles.length === 0 && <p className="text-[13px] text-muted">Aucun fichier. Déposez le devis à l&apos;engagement, la facture à la dépense, le compte rendu à la fin.</p>}
            <ul className="space-y-1.5 text-[12.5px]">
              {otherFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <Badge tone="gray">{ASSET_KIND_LABELS[f.kind as keyof typeof ASSET_KIND_LABELS] ?? f.kind}{f.version > 1 ? ` v${f.version}` : ""}</Badge>
                  <a href={fileHref(f.id)} target="_blank" rel="noreferrer" className="truncate hover:underline">{f.name}</a>
                  <span className="text-muted ml-auto whitespace-nowrap">{Math.max(1, Math.round(f.size / 1024))} Ko · {fmtAgo(f.createdAt)}</span>
                  {canEdit && <form action={deleteActivationAsset}><input type="hidden" name="id" value={f.id} /><button className="text-faint hover:text-red" title="Supprimer" type="submit">×</button></form>}
                </li>
              ))}
            </ul>
            {photos.length > 0 && canEdit && <details className="mt-2 text-[11.5px] text-muted"><summary className="cursor-pointer">Gérer les photos</summary><ul className="mt-1 space-y-1">{photos.map((p) => <li key={p.id} className="flex items-center gap-2"><a href={fileHref(p.id)} target="_blank" rel="noreferrer" className="truncate hover:underline">{p.name}</a><form action={deleteActivationAsset} className="ml-auto"><input type="hidden" name="id" value={p.id} /><button className="text-faint hover:text-red" type="submit">×</button></form></li>)}</ul></details>}
            {otherFiles.some((f) => isPreviewable(f.mime)) ? null : null}
          </Card>

          <Card title="Produits et points de vente">
            <div className="text-[12.5px] space-y-2">
              <div><div className="label mb-0.5">Produits ({linkedProducts.length})</div>{linkedProducts.length ? <ul className="space-y-0.5">{linkedProducts.map((p) => <li key={p.id}><Link href={`/produits/${p.id}`} className="hover:underline">{p.name}</Link></li>)}</ul> : <span className="text-muted">—</span>}</div>
              <div><div className="label mb-0.5">Points de vente ({linkedClients.length})</div>{linkedClients.length ? <ul className="space-y-0.5">{linkedClients.map((c) => <li key={c.id}><Link href={`/clients/${c.id}`} className="hover:underline">{c.name}</Link>{c.city ? <span className="text-muted"> · {c.city}</span> : null}</li>)}</ul> : <span className="text-muted">{a.place ?? "—"}</span>}</div>
              {a.linkedAnimationId && <div><div className="label mb-0.5">Animation Terrain</div><Link href={`/terrain?animation=${a.linkedAnimationId}`} className="hover:underline">Voir l&apos;animation liée</Link></div>}
            </div>
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
            {canEdit && (
              <details className="mt-4 pt-3 border-t border-line text-[12.5px]">
                <summary className="cursor-pointer text-muted">Dupliquer (autre ville / date)</summary>
                <form action={duplicateActivation} className="mt-2 flex flex-wrap gap-1.5">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="date" name="date" defaultValue={a.date} className="input h-8 w-auto" />
                  <input name="city" list="villes" defaultValue={a.city ?? ""} className="input h-8 w-[140px]" placeholder="Ville" />
                  <button className="btn-secondary btn-sm h-8" type="submit">Dupliquer</button>
                </form>
              </details>
            )}
            {canValidatePerm && (
              <form action={deleteActivationHard} className="mt-3 pt-3 border-t border-line"><input type="hidden" name="id" value={a.id} /><button className="text-[12px] text-faint hover:text-red" type="submit">Supprimer définitivement (préférer « Annuler » ou « Archiver »)</button></form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
