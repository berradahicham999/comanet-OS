import Link from "next/link";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { AXES, AXIS_KEYS, OBJECTIVES } from "@/lib/action-generator/catalog";
import { listLibrary, listPlaybooks } from "@/lib/action-generator/library";
import { TEMPLATE_SOURCES, previewName, type TemplateSource } from "@/lib/action-generator/library-shared";
import type { AxisKey, ObjectiveKey } from "@/lib/action-generator/types";
import { PageHeader, Card, Badge, Empty, Section, BrandDot } from "@/components/ui";
import { fmtMAD, fmtDate } from "@/lib/format";
import { importLibraryAction, savePlaybookAction, toggleTemplateAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bibliothèque d'actions" };

type SP = { levier?: string; source?: string; q?: string; statut?: string; erreur?: string; ok?: string; import?: string };

/** Fichier Excel (route, pas une page). */
const EXPORT_HREF = `/marketing/bibliotheque/export`;
const SOURCE_TONE: Record<TemplateSource, "gray" | "accent" | "blue" | "green" | "purple"> = { SYSTEME: "gray", EQUIPE: "accent", IMPORT: "blue", ACTION: "green", ACTIVATION: "purple" };

export default async function LibraryPage(props: { searchParams: Promise<SP> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const scope = await decisionScopeFor(null);
  const [entries, canEdit, canValidate, playbooks] = await Promise.all([listLibrary(), canDo("marketing", "edit"), canDo("marketing", "validate"), listPlaybooks(scope.allBrands.map((b) => b.id))]);

  const axis = AXIS_KEYS.includes(sp.levier as AxisKey) ? (sp.levier as AxisKey) : null;
  const source = sp.source && sp.source in TEMPLATE_SOURCES ? (sp.source as TemplateSource) : null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const statut = sp.statut === "inactifs" ? "inactifs" : sp.statut === "tous" ? "tous" : "actifs";
  const shown = entries.filter((e) => (!axis || e.template.axis === axis) && (!source || e.source === source || (source === "EQUIPE" && e.modified))
    && (statut === "tous" || (statut === "actifs" ? e.active : !e.active))
    && (!q || `${e.template.family} ${e.template.name} ${e.template.concept} ${e.template.key}`.toLowerCase().includes(q)));
  const counts = { total: entries.length, active: entries.filter((e) => e.active).length, team: entries.filter((e) => !e.system).length, modified: entries.filter((e) => e.modified).length };
  const byAxis = AXIS_KEYS.map((a) => ({ axis: a, items: shown.filter((e) => e.template.axis === a) })).filter((g) => g.items.length);
  const allTemplates = entries.filter((e) => e.active).map((e) => e.template).sort((a, b) => a.axis.localeCompare(b.axis) || a.family.localeCompare(b.family));
  const filterHref = (patch: Partial<SP>) => { const p = new URLSearchParams(); const m = { levier: axis ?? undefined, source: source ?? undefined, q: sp.q, statut: statut === "actifs" ? undefined : statut, ...patch }; for (const [k, v] of Object.entries(m)) if (v) p.set(k, v); const s = p.toString(); return `/marketing/bibliotheque${s ? `?${s}` : ""}`; };

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/priorites" className="hover:underline">Priorités & actions</Link>} title="Bibliothèque d'actions"
        subtitle="Les modèles d'action que le générateur adapte à chaque marque, produit, période et budget. Modifiez un modèle livré, créez les vôtres, importez-les depuis Excel, ou enregistrez une action réussie comme modèle. Ce qui marche par marque oriente le classement."
        actions={<>
          <a href={EXPORT_HREF} download className="btn-secondary btn-sm">Exporter (Excel)</a>
          {canEdit && <Link href="/marketing/bibliotheque/nouveau" className="btn-primary btn-sm">+ Nouveau modèle</Link>}
        </>} />
      {sp.erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{sp.erreur}</div>}
      {sp.import && <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[13px]">{sp.import}</div>}
      {sp.ok === "supprime" && <div className="mb-3 rounded-xl border border-green/30 bg-green-soft text-green px-3 py-2 text-[13px]">Modèle supprimé de la bibliothèque.</div>}
      {sp.ok === "marque" && <div className="mb-3 rounded-xl border border-green/30 bg-green-soft text-green px-3 py-2 text-[13px]">Ce qui marche pour la marque est enregistré : le générateur en tient compte dès maintenant.</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Card><div className="label">Modèles</div><div className="text-[22px] font-semibold">{counts.total}</div><div className="text-[12px] text-muted">{counts.active} actifs</div></Card>
        <Card><div className="label">Leviers</div><div className="text-[22px] font-semibold">{AXIS_KEYS.length}</div><div className="text-[12px] text-muted">{AXIS_KEYS.map((a) => AXES[a].label).join(", ")}</div></Card>
        <Card><div className="label">Créés par l&apos;équipe</div><div className="text-[22px] font-semibold">{counts.team}</div><div className="text-[12px] text-muted">import, action ou activation compris</div></Card>
        <Card><div className="label">Modèles livrés modifiés</div><div className="text-[22px] font-semibold">{counts.modified}</div><div className="text-[12px] text-muted">la version d&apos;origine reste récupérable</div></Card>
      </div>

      <Section title="Ce qui marche par marque" description="Votre conviction sur chaque marque : poids des leviers, modèles favoris, modèles à écarter. Le générateur l'ajoute au score (10 points sur 100) et l'affiche comme une hypothèse de la direction, jamais comme une mesure.">
        {scope.allBrands.length === 0 ? <Empty title="Aucune marque dans votre périmètre" /> : (
          <div className="grid lg:grid-cols-2 gap-3">
            {[...scope.allBrands].sort((x, y) => Number(playbooks.has(y.id)) - Number(playbooks.has(x.id))).map((b) => {
              const p = playbooks.get(b.id);
              const levers = p ? AXIS_KEYS.filter((a) => (p.levers[a] ?? 0) > 0).sort((x, y) => (p.levers[y] ?? 0) - (p.levers[x] ?? 0)) : [];
              return (
                <Card key={b.id} className="scroll-mt-20" title={<span id={`marque-${b.id}`} className="inline-flex items-center gap-2"><BrandDot color={b.color} />{b.name}</span>}
                  action={p ? <span className="text-[11.5px] text-muted">mis à jour le {fmtDate(p.updatedAt)}</span> : <Badge tone="gray">non renseigné</Badge>}>
                  {p ? (
                    <div className="text-[13px] space-y-1.5 mb-2">
                      {p.note && <p className="italic text-muted">« {p.note} »</p>}
                      <div className="flex flex-wrap gap-1">{levers.map((a) => <Badge key={a} tone={(p.levers[a] ?? 0) >= 0.8 ? "accent" : "gray"}>{AXES[a].label} {Math.round((p.levers[a] ?? 0) * 100)} %</Badge>)}</div>
                      {p.favorites.length > 0 && <div className="text-[12.5px]"><span className="label mr-1">Favoris</span>{p.favorites.map((k) => entries.find((e) => e.template.key === k)?.template.family ?? k).join(", ")}</div>}
                      {p.avoid.length > 0 && <div className="text-[12.5px]"><span className="label mr-1">Écartés</span>{p.avoid.map((k) => entries.find((e) => e.template.key === k)?.template.family ?? k).join(", ")}</div>}
                    </div>
                  ) : <p className="text-[13px] text-muted mb-2">Sans conviction saisie, le générateur classe les actions sur les seules données (ventes, budget, saison, historique).</p>}
                  {canValidate && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12.5px] text-accent">Modifier</summary>
                      <form action={savePlaybookAction} className="mt-2 space-y-3 text-[13px]">
                        <input type="hidden" name="brandId" value={b.id} />
                        <div>
                          <div className="label mb-1">Poids des leviers (0 à 100 %)</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {AXIS_KEYS.map((a) => <label key={a} className="block"><span className="text-[11.5px] text-muted">{AXES[a].label}</span><input name={`lever_${a}`} type="number" min={0} max={100} step={10} defaultValue={p?.levers[a] ? Math.round((p.levers[a] ?? 0) * 100) : ""} className="input h-8" /></label>)}
                          </div>
                        </div>
                        <TemplatePicker name="favorites" label="Modèles favoris (mis en avant)" templates={allTemplates} selected={p?.favorites ?? []} />
                        <TemplatePicker name="avoid" label="Modèles à écarter pour cette marque" templates={allTemplates} selected={p?.avoid ?? []} />
                        <label className="block"><span className="label block mb-1">Note (ce que vous savez de la marque)</span><textarea name="note" rows={2} defaultValue={p?.note ?? ""} className="input" /></label>
                        <button className="btn-primary btn-sm">Enregistrer</button>
                      </form>
                    </details>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Modèles" description="Le nom et le concept sont des textes à variables : {heros} (produit vedette), {produit}, {marque}, {ville}, {cible}, {benefice}, {actif}, {angle} (fiche marketing du produit), {saison}. {variable|texte} donne un texte de repli quand la donnée manque.">
        <Card className="mb-3">
          <form method="get" className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 text-[13px] items-end">
            <label className="block"><span className="label block mb-1">Levier</span>
              <select name="levier" defaultValue={axis ?? ""} className="select h-9"><option value="">Tous</option>{AXIS_KEYS.map((a) => <option key={a} value={a}>{AXES[a].label}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Origine</span>
              <select name="source" defaultValue={source ?? ""} className="select h-9"><option value="">Toutes</option>{Object.entries(TEMPLATE_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="block"><span className="label block mb-1">Statut</span>
              <select name="statut" defaultValue={statut} className="select h-9"><option value="actifs">Actifs</option><option value="inactifs">Désactivés</option><option value="tous">Tous</option></select></label>
            <label className="block"><span className="label block mb-1">Recherche</span><input name="q" defaultValue={sp.q ?? ""} placeholder="padel, médecins, Ramadan…" className="input h-9" /></label>
            <div className="flex gap-2"><button className="btn-secondary h-9">Filtrer</button>{(axis || source || q || statut !== "actifs") && <Link href="/marketing/bibliotheque" className="btn-ghost h-9">Effacer</Link>}</div>
          </form>
        </Card>

        {byAxis.length === 0 ? <Empty title="Aucun modèle ne correspond" hint={<Link href={filterHref({ levier: undefined, source: undefined, q: undefined, statut: "tous" })} className="text-accent hover:underline">Voir toute la bibliothèque</Link>} /> : byAxis.map((g) => (
          <div key={g.axis} className="mb-5">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-2">{AXES[g.axis].label} · {g.items.length}</h3>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((e) => {
                const t = e.template;
                const objectives = (Object.entries(t.objectives) as [ObjectiveKey, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <Card key={t.key} className={e.active ? "" : "opacity-60"}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Link href={`/marketing/bibliotheque/${t.key}`} className="font-medium hover:underline">{t.family}</Link>
                      <div className="flex flex-wrap gap-1 justify-end shrink-0">
                        <Badge tone={SOURCE_TONE[e.source]}>{TEMPLATE_SOURCES[e.source]}</Badge>
                        {e.modified && <Badge tone="yellow">modifié</Badge>}
                        {!e.active && <Badge tone="red">désactivé</Badge>}
                        {e.invalid && <Badge tone="red">à corriger</Badge>}
                      </div>
                    </div>
                    <div className="text-[13px] mb-1">{previewName(t.name)}</div>
                    <p className="text-[12.5px] text-muted line-clamp-3 mb-2">{previewName(t.concept)}</p>
                    <div className="flex flex-wrap gap-1 mb-2">{objectives.map(([k]) => <Badge key={k} tone="gray">{OBJECTIVES[k]}</Badge>)}{t.onlyWhen && <Badge tone="blue">{t.onlyWhen.label}</Badge>}</div>
                    <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
                      <span>{fmtMAD(t.budget.min, { compact: true })} → {fmtMAD(t.budget.max, { compact: true })} · {t.steps.length} étapes · J-{t.prepDays}</span>
                      {canValidate && (
                        <form action={toggleTemplateAction}><input type="hidden" name="key" value={t.key} /><input type="hidden" name="active" value={e.active ? "0" : "1"} />
                          <button className="text-[12px] text-accent hover:underline">{e.active ? "Désactiver" : "Réactiver"}</button></form>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </Section>

      {canEdit && (
        <Section title="Importer depuis Excel" description="Une ligne par modèle, avec les colonnes de l'export (le plus simple : exporter, compléter, réimporter). Une ligne avec la clé d'un modèle existant le remplace ; sans clé, un nouveau modèle est créé. Les lignes invalides sont refusées une par une, avec la raison.">
          <Card>
            <form action={importLibraryAction} className="flex flex-wrap items-end gap-3 text-[13px]">
              <label className="block"><span className="label block mb-1">Fichier (.xlsx, .xls, .csv)</span><input type="file" name="file" accept=".xlsx,.xls,.csv" required className="text-[13px]" /></label>
              <button className="btn-primary btn-sm">Importer</button>
              <a href={EXPORT_HREF} download className="text-accent hover:underline text-[12.5px]">Télécharger le modèle de fichier (export actuel)</a>
            </form>
          </Card>
        </Section>
      )}
    </>
  );
}

function TemplatePicker({ name, label, templates, selected }: { name: string; label: string; templates: { key: string; axis: AxisKey; family: string }[]; selected: string[] }) {
  return (
    <div>
      <div className="label mb-1">{label}{selected.length ? ` · ${selected.length}` : ""}</div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-line p-2 grid sm:grid-cols-2 gap-x-3 gap-y-1">
        {templates.map((t) => (
          <label key={t.key} className="flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" name={name} value={t.key} defaultChecked={selected.includes(t.key)} />
            <span className="truncate"><span className="text-muted">{AXES[t.axis].label} ·</span> {t.family}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
