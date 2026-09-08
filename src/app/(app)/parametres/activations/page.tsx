import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";
import { ActivationTypeIcon } from "@/components/activation-type-icon";
import { activationRefs, listActivationTemplates } from "@/lib/activations/refs";
import { safeTone } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { saveType, saveStatus, saveTransition, deleteTransition, saveSimple, deleteRef, saveTemplate, deleteTemplate, saveActivationSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres — Activations" };

const TONES = ["gray", "blue", "purple", "yellow", "orange", "green", "accent", "red"] as const;
const ICONS = ["PartyPopper", "Handshake", "Landmark", "LayoutPanelTop", "FlaskConical", "Gift", "Store", "Newspaper", "UserRound", "Sparkles"];
const BUDGET_CATEGORIES = ["EVENEMENT", "SPONSORING", "CONGRES", "PLV", "TRADE", "ECHANTILLONS", "GOODIES", "ANIMATION", "PRESCRIPTEURS", "AGENCE", "DIGITAL", "CREATION", "SHOOTING", "INFLUENCE", "UGC", "META", "TIKTOK", "GOOGLE", "AUTRES"];
const FLAGS = [["awaitingValidation", "Attend validation"], ["isValidated", "Validée (budget engagé)"], ["isRunning", "En cours"], ["isDone", "Terminée"], ["isMeasured", "Mesurée"], ["isArchived", "Archivée"], ["isCancelled", "Annulée"]] as const;

export default async function ActivationsSettingsPage() {
  await requireAccess("administration");
  const [refs, templates, brands, settings, usage] = await Promise.all([
    activationRefs(), listActivationTemplates(), listBrands(), getSettings(),
    db.execute<{ kind: string; key: string; n: number }>(sql`
      select 'type' as kind, type as key, count(*)::int as n from activations group by type
      union all select 'status', status, count(*)::int from activations group by status
      union all select 'objective', objective_key, count(*)::int from activations where objective_key is not null group by objective_key
      union all select 'target', target_key, count(*)::int from activations where target_key is not null group by target_key
      union all select 'cost', cost_item_key, count(*)::int from activation_budget_lines group by cost_item_key
      union all select 'inventory', category_key, count(*)::int from inventory_items group by category_key`),
  ]);
  const used = new Map(usage.rows.map((u) => [`${u.kind}:${u.key}`, u.n]));
  const usedBadge = (kind: string, key: string) => { const n = used.get(`${kind}:${key}`); return n ? <span className="text-[11px] text-muted whitespace-nowrap">{n}</span> : null; };
  const delInline = (kind: string, key: string) => <><input type="hidden" name="kind" value={kind} /><button formAction={deleteRef} className="text-faint hover:text-red text-[13px]" type="submit" title={used.get(`${kind}:${key}`) ? "Utilisé : sera désactivé" : "Supprimer"}>×</button></>;
  const a = settings.activations;
  const ok = { awaiting: refs.statuses.some((s) => s.active && s.awaitingValidation), validated: refs.statuses.some((s) => s.active && s.isValidated), done: refs.statuses.some((s) => s.active && s.isDone), cancelled: refs.statuses.some((s) => s.active && s.isCancelled) };

  const simpleList = (kind: "objective" | "target" | "cost" | "inventory", items: { key: string; label: string; sort: number; active: boolean; budgetCategory?: string }[], placeholder: string, withCat = false) => (
    <div className="space-y-1">
      {items.map((o) => (
        <form key={o.key} action={saveSimple} className={`grid ${withCat ? "grid-cols-[50px_1fr_130px_40px_50px_30px]" : "grid-cols-[50px_1fr_40px_50px_30px]"} items-center gap-1 text-[12.5px]`}>
          <input type="hidden" name="kind" value={kind} /><input type="hidden" name="key" value={o.key} />
          <input name="sort" defaultValue={o.sort} className="input h-8 text-[12px]" />
          <input name="label" defaultValue={o.label} className="input h-8 text-[12px]" />
          {withCat && <select name="budgetCategory" defaultValue={o.budgetCategory} className="select h-8 text-[12px]">{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
          <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={o.active} /></label>
          <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
          <span className="flex items-center gap-1">{usedBadge(kind, o.key)}{delInline(kind, o.key)}</span>
        </form>
      ))}
      <form action={saveSimple} className={`grid ${withCat ? "grid-cols-[50px_1fr_130px_40px_80px]" : "grid-cols-[50px_1fr_40px_80px]"} items-center gap-1 text-[12.5px] pt-1`}>
        <input type="hidden" name="kind" value={kind} />
        <input name="sort" defaultValue={items.length + 1} className="input h-8 text-[12px]" />
        <input name="label" placeholder={placeholder} className="input h-8 text-[12px]" required />
        {withCat && <select name="budgetCategory" className="select h-8 text-[12px]">{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
        <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
      </form>
    </div>
  );

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paramètres" subtitle="Référentiels du module Activations : types et checklists, statuts et transitions, objectifs, cibles, postes budgétaires, catégories d'inventaire, modèles, fenêtres de mesure. Rien n'est codé en dur.">
        <Tabs current="/parametres/activations" tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres/activations", label: "Activations" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>

      {(!ok.awaiting || !ok.validated || !ok.done || !ok.cancelled) && (
        <div className="mb-4 rounded-xl border border-orange/30 bg-orange-soft text-orange px-3 py-2 text-[13px]">
          Attention : il faut au moins un statut actif marqué {!ok.awaiting && "« attend validation »"} {!ok.validated && "« validée »"} {!ok.done && "« terminée »"} {!ok.cancelled && "« annulée »"}. Sans cela, la file de validation, l&apos;engagement budgétaire ou les rappels de résultats ne fonctionnent plus.
        </div>
      )}

      <div className="grid xl:grid-cols-2 gap-4">
        <Card title="Fenêtres de mesure et rappels" className="xl:col-span-2">
          <form action={saveActivationSettings} className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12.5px]">
            <label className="block"><span className="label block mb-1">Jours de ventes AVANT</span><input name="windowBeforeDays" defaultValue={a.windowBeforeDays} inputMode="numeric" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Jours de ventes APRÈS</span><input name="windowAfterDays" defaultValue={a.windowAfterDays} inputMode="numeric" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Rappel résultats (j après la fin)</span><input name="resultsDelayDays" defaultValue={a.resultsDelayDays} inputMode="numeric" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Alerte checklist (j avant le début)</span><input name="checklistAlertDays" defaultValue={a.checklistAlertDays} inputMode="numeric" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Dépassement toléré (%)</span><input name="overrunAlertPct" defaultValue={a.overrunAlertPct} inputMode="decimal" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">« Refaire » si écart ≥ N × coût</span><input name="roiRepeatMin" defaultValue={a.roiRepeatMin} inputMode="decimal" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">« Refaire » si rythme ≥ +X %</span><input name="roiRepeatMinUpliftPct" defaultValue={a.roiRepeatMinUpliftPct} inputMode="decimal" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Article dormant après (j)</span><input name="inventoryDormantDays" defaultValue={a.inventoryDormantDays} inputMode="numeric" className="input h-9" /></label>
            <div className="col-span-2 sm:col-span-4"><button className="btn-primary btn-sm" type="submit">Enregistrer</button></div>
          </form>
        </Card>

        <Card title="Types d'activation et checklists" className="xl:col-span-2">
          <p className="text-[12.5px] text-muted mb-2">Le module pilote (Marketing ou Trade) sert au formulaire rapide ; la catégorie budget par défaut aux nouveaux postes ; la checklist par défaut pré-remplit les activations créées sans modèle (une étape par ligne).</p>
          <div className="space-y-1.5">
            {refs.types.map((t) => (
              <details key={t.key} className="rounded-lg border border-line">
                <summary className="flex items-center gap-2 px-2.5 h-9 cursor-pointer text-[13px]"><ActivationTypeIcon icon={t.icon} size={14} /><span className="font-medium">{t.label}</span><span className="text-muted text-[11.5px]">{t.defaultModule === "clients" ? "Trade" : "Marketing"} · {t.defaultBudgetCategory} · {t.defaultChecklist.length} étape{t.defaultChecklist.length > 1 ? "s" : ""}</span>{!t.active && <Badge tone="gray">inactif</Badge>}<span className="ml-auto flex items-center gap-2">{usedBadge("type", t.key)}<form action={deleteRef}><input type="hidden" name="kind" value="type" /><input type="hidden" name="key" value={t.key} /><button className="text-faint hover:text-red text-[13px]" type="submit" title="Supprimer ou désactiver">×</button></form></span></summary>
                <form action={saveType} className="grid sm:grid-cols-3 gap-2 p-2.5 text-[12.5px] border-t border-line">
                  <input type="hidden" name="key" value={t.key} />
                  <label className="block"><span className="label block mb-1">Libellé</span><input name="label" defaultValue={t.label} className="input h-8" /></label>
                  <label className="block"><span className="label block mb-1">Pictogramme</span><select name="icon" defaultValue={t.icon ?? ""} className="select h-8">{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
                  <label className="block"><span className="label block mb-1">Ordre</span><input name="sort" defaultValue={t.sort} className="input h-8" /></label>
                  <label className="block"><span className="label block mb-1">Module pilote</span><select name="defaultModule" defaultValue={t.defaultModule} className="select h-8"><option value="marketing">Marketing</option><option value="clients">Trade (clients)</option></select></label>
                  <label className="block"><span className="label block mb-1">Catégorie budget par défaut</span><select name="defaultBudgetCategory" defaultValue={t.defaultBudgetCategory} className="select h-8">{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
                  <label className="flex items-center gap-1.5 self-end h-8"><input type="checkbox" name="active" defaultChecked={t.active} /> Actif</label>
                  <label className="block sm:col-span-3"><span className="label block mb-1">Checklist par défaut (une étape par ligne)</span><textarea name="defaultChecklist" defaultValue={t.defaultChecklist.join("\n")} className="textarea min-h-[90px]" /></label>
                  <div><button className="btn-secondary btn-sm" type="submit">Enregistrer</button></div>
                </form>
              </details>
            ))}
          </div>
          <form action={saveType} className="mt-3 flex flex-wrap items-end gap-2 text-[12.5px]">
            <label className="block flex-1 min-w-[160px]"><span className="label block mb-1">Nouveau type</span><input name="label" className="input h-9" placeholder="ex : Formation pharmaciens" required /></label>
            <label className="block"><span className="label block mb-1">Module</span><select name="defaultModule" className="select h-9 w-auto"><option value="marketing">Marketing</option><option value="clients">Trade</option></select></label>
            <label className="block"><span className="label block mb-1">Catégorie budget</span><select name="defaultBudgetCategory" className="select h-9 w-auto">{BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <input type="hidden" name="sort" value={refs.types.length + 1} /><input type="hidden" name="active" value="on" /><input type="hidden" name="icon" value="Sparkles" />
            <button className="btn-primary btn-sm h-9" type="submit">Ajouter</button>
          </form>
        </Card>

        <Card title="Statuts et cycle de vie" className="xl:col-span-2">
          <p className="text-[12.5px] text-muted mb-3">Les cases « sémantique » disent au code ce que signifie un statut : « validée » engage le budget dans le Command Center, « terminée » déclenche le rappel de résultats, « attend validation » alimente la file du DG.</p>
          <div className="table-wrap"><table className="tbl text-[12.5px]">
            <thead><tr><th>Ordre</th><th>Clé</th><th>Libellé</th><th>Couleur</th>{FLAGS.map(([k, l]) => <th key={k} className="text-center">{l}</th>)}<th>Actif</th><th></th><th></th></tr></thead>
            <tbody>
              {refs.statuses.map((s) => (
                <tr key={s.key}><td colSpan={13} className="!p-0">
                  <form action={saveStatus} className="grid grid-cols-[60px_130px_1fr_100px_repeat(7,84px)_60px_30px] items-center gap-1 px-2 py-1">
                    <input name="sort" defaultValue={s.sort} className="input h-8 text-[12px]" inputMode="numeric" />
                    <span className="font-mono text-[11px] text-muted truncate" title={s.key}>{s.key}<input type="hidden" name="key" value={s.key} /></span>
                    <input name="label" defaultValue={s.label} className="input h-8 text-[12px]" />
                    <select name="tone" defaultValue={s.tone} className="select h-8 text-[12px]">{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    {FLAGS.map(([k]) => <label key={k} className="text-center"><input type="checkbox" name={k} defaultChecked={s[k]} /></label>)}
                    <label className="text-center"><input type="checkbox" name="active" defaultChecked={s.active} /></label>
                    <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                    <span className="flex items-center gap-1">{usedBadge("status", s.key)}{delInline("status", s.key)}</span>
                  </form>
                </td></tr>
              ))}
              <tr><td colSpan={13} className="!p-0">
                <form action={saveStatus} className="grid grid-cols-[60px_130px_1fr_100px_repeat(7,84px)_60px_30px] items-center gap-1 px-2 py-1 bg-surface-2/60">
                  <input name="sort" defaultValue={refs.statuses.length + 1} className="input h-8 text-[12px]" />
                  <span className="text-[11px] text-faint">clé auto</span>
                  <input name="label" placeholder="Nouveau statut" className="input h-8 text-[12px]" required />
                  <select name="tone" defaultValue="gray" className="select h-8 text-[12px]">{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  {FLAGS.map(([k]) => <label key={k} className="text-center"><input type="checkbox" name={k} /></label>)}
                  <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
                  <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button><span />
                </form>
              </td></tr>
            </tbody>
          </table></div>

          <h3 className="font-medium text-[13.5px] mt-5 mb-1">Transitions autorisées</h3>
          <p className="text-[12.5px] text-muted mb-2">Un bouton n&apos;apparaît sur une fiche que si la transition existe ici. « Validateur » réserve l&apos;étape à l&apos;Administration, à « Valider une dépense » et aux validateurs de la marque ; « Commentaire » le rend obligatoire (refus, annulation).</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {[...refs.transitions].sort((x, y) => (refs.statuses.findIndex((s) => s.key === x.fromKey) - refs.statuses.findIndex((s) => s.key === y.fromKey)) || (refs.statuses.findIndex((s) => s.key === x.toKey) - refs.statuses.findIndex((s) => s.key === y.toKey))).map((t) => {
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
            <label className="block"><span className="label block mb-1">Libellé du bouton</span><input name="label" className="input h-9" placeholder="ex : Proposer" /></label>
            <label className="flex items-center gap-1.5 h-9"><input type="checkbox" name="requiresValidator" /> Validateur</label>
            <label className="flex items-center gap-1.5 h-9"><input type="checkbox" name="requiresComment" /> Commentaire</label>
            <button className="btn-primary btn-sm h-9" type="submit">Ajouter la transition</button>
          </form>
        </Card>

        <Card title="Postes budgétaires">
          <p className="text-[12.5px] text-muted mb-2">Chaque poste alimente une catégorie du budget marketing (Command Center).</p>
          {simpleList("cost", refs.costItems, "Nouveau poste", true)}
        </Card>
        <Card title="Catégories d'inventaire">
          <p className="text-[12.5px] text-muted mb-2">Catégorie budgétaire imputée quand une activation consomme du matériel.</p>
          {simpleList("inventory", refs.inventoryCategories, "Nouvelle catégorie", true)}
        </Card>
        <Card title="Objectifs">{simpleList("objective", refs.objectives, "Nouvel objectif")}</Card>
        <Card title="Cibles">{simpleList("target", refs.targets, "Nouvelle cible")}</Card>

        <Card title="Modèles d'activation" className="xl:col-span-2">
          <p className="text-[12.5px] text-muted mb-2">Un modèle pré-remplit une activation en moins d&apos;une minute : type, objectif, cible, description, dates (préparation, durée), postes prévus et checklist. Postes : une ligne « POSTE | libellé | montant », par exemple « LIEU | Salle | 15000 ».</p>
          <div className="space-y-1.5">
            {templates.map((t) => (
              <details key={t.id} className="rounded-lg border border-line">
                <summary className="flex items-center gap-2 px-2.5 h-9 cursor-pointer text-[13px]"><span className="font-medium">{t.name}</span><span className="text-muted text-[11.5px]">{refs.types.find((x) => x.key === t.typeKey)?.label ?? "Tous types"}{t.brandId ? ` · ${brands.find((b) => b.id === t.brandId)?.name ?? ""}` : ""} · {(t.defaults.budgetLines ?? []).reduce((s, l) => s + (l.planned ?? 0), 0).toLocaleString("fr-FR")} MAD prévus · {(t.defaults.checklist ?? []).length} étapes</span>{!t.active && <Badge tone="gray">inactif</Badge>}<form action={deleteTemplate} className="ml-auto"><input type="hidden" name="id" value={t.id} /><button className="text-faint hover:text-red text-[13px]" type="submit" title="Supprimer">×</button></form></summary>
                <TemplateForm t={t} refs={refs} brands={brands} />
              </details>
            ))}
          </div>
          <details className="mt-3 rounded-lg border border-dashed border-line-2"><summary className="px-2.5 h-9 cursor-pointer text-[13px] flex items-center font-medium">Nouveau modèle</summary><TemplateForm t={null} refs={refs} brands={brands} /></details>
        </Card>
      </div>
    </>
  );
}

function TemplateForm({ t, refs, brands }: { t: Awaited<ReturnType<typeof listActivationTemplates>>[number] | null; refs: Awaited<ReturnType<typeof activationRefs>>; brands: Awaited<ReturnType<typeof listBrands>> }) {
  const d = t?.defaults ?? {};
  return (
    <form action={saveTemplate} className="grid sm:grid-cols-3 gap-2 p-2.5 text-[12.5px] border-t border-line">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={t?.name ?? ""} className="input h-8" required /></label>
      <label className="block"><span className="label block mb-1">Type</span><select name="typeKey" defaultValue={t?.typeKey ?? ""} className="select h-8"><option value="">Tous types</option>{refs.types.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
      <label className="block"><span className="label block mb-1">Marque (facultatif)</span><select name="brandId" defaultValue={t?.brandId ?? ""} className="select h-8"><option value="">Toutes</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="block"><span className="label block mb-1">Objectif</span><select name="objectiveKey" defaultValue={d.objectiveKey ?? ""} className="select h-8"><option value="">—</option>{refs.objectives.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
      <label className="block"><span className="label block mb-1">Cible</span><select name="targetKey" defaultValue={d.targetKey ?? ""} className="select h-8"><option value="">—</option>{refs.targets.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label className="block"><span className="label block mb-1">Préparation (j avant)</span><input name="prepOffsetDays" defaultValue={d.prepOffsetDays ?? ""} className="input h-8" /></label><label className="block"><span className="label block mb-1">Durée (j)</span><input name="durationDays" defaultValue={d.durationDays ?? 1} className="input h-8" /></label></div>
      <label className="block sm:col-span-3"><span className="label block mb-1">Description</span><input name="description" defaultValue={d.description ?? ""} className="input h-8" /></label>
      <label className="block sm:col-span-2"><span className="label block mb-1">Postes prévus (POSTE | libellé | montant, un par ligne)</span><textarea name="budgetLines" defaultValue={(d.budgetLines ?? []).map((l) => `${l.costItemKey} | ${l.label ?? ""} | ${l.planned ?? 0}`).join("\n")} className="textarea min-h-[90px] font-mono text-[11.5px]" placeholder={"LIEU | Salle | 15000\nTRAITEUR | Cocktail | 12000"} /></label>
      <label className="block"><span className="label block mb-1">Checklist (une étape par ligne)</span><textarea name="checklist" defaultValue={(d.checklist ?? []).join("\n")} className="textarea min-h-[90px]" /></label>
      <div className="sm:col-span-3 flex items-center gap-3"><label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={t?.active ?? true} /> Actif</label><button className="btn-primary btn-sm" type="submit">{t ? "Enregistrer" : "Créer le modèle"}</button><span className="text-[11px] text-muted">Postes connus : {refs.costItems.map((c) => c.key).join(", ")}</span></div>
    </form>
  );
}
