import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canDo } from "@/lib/access";
import { AXES } from "@/lib/action-generator/catalog";
import { libraryTemplate } from "@/lib/action-generator/library";
import { TEMPLATE_SOURCES, previewName, templateToFields } from "@/lib/action-generator/library-shared";
import { PageHeader, Badge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { duplicateTemplateAction, resetTemplateAction, toggleTemplateAction } from "../actions";
import { TemplateForm } from "../template-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modèle d'action" };

export default async function TemplatePage(props: { params: Promise<{ key: string }>; searchParams: Promise<{ erreur?: string; ok?: string }> }) {
  await requireAccess("marketing");
  const { key } = await props.params;
  const sp = await props.searchParams;
  const entry = await libraryTemplate(decodeURIComponent(key));
  if (!entry) notFound();
  const [canEdit, canValidate] = await Promise.all([canDo("marketing", "edit"), canDo("marketing", "validate")]);
  const t = entry.template;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/bibliotheque" className="hover:underline">Bibliothèque d&apos;actions</Link>} title={t.family}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone="accent">{AXES[t.axis]?.label ?? t.axis}</Badge><Badge tone="gray">{TEMPLATE_SOURCES[entry.source]}</Badge>{entry.modified && <Badge tone="yellow">modifié par l&apos;équipe</Badge>}{!entry.active && <Badge tone="red">désactivé</Badge>}<span>{previewName(t.name)}</span>{entry.updatedAt && <span className="text-muted">· mis à jour le {fmtDate(entry.updatedAt)}</span>}</span>}
        actions={<>
          <Link href={`/marketing/priorites/generer?levier=${t.axis}`} className="btn-secondary btn-sm">Tester dans le générateur</Link>
          {canEdit && <form action={duplicateTemplateAction}><input type="hidden" name="key" value={t.key} /><button className="btn-secondary btn-sm">Dupliquer</button></form>}
          {canValidate && <form action={toggleTemplateAction}><input type="hidden" name="key" value={t.key} /><input type="hidden" name="active" value={entry.active ? "0" : "1"} /><button className="btn-secondary btn-sm">{entry.active ? "Désactiver" : "Réactiver"}</button></form>}
          {canValidate && (entry.modified || !entry.system) && <form action={resetTemplateAction}><input type="hidden" name="key" value={t.key} /><button className="btn-ghost btn-sm text-red">{entry.system ? "Revenir à la version livrée" : "Supprimer le modèle"}</button></form>}
        </>} />
      {sp.erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{sp.erreur}</div>}
      {sp.ok === "depuis" && <div className="mb-3 rounded-xl border border-green/30 bg-green-soft text-green px-3 py-2 text-[13px]">Modèle créé à partir du réel : budget par poste et calendrier repris, produit, marque et ville remplacés par des variables. Relisez le concept, les objectifs et la portée, puis enregistrez.</div>}
      {sp.ok === "reset" && <div className="mb-3 rounded-xl border border-green/30 bg-green-soft text-green px-3 py-2 text-[13px]">Version livrée rétablie : les modifications de l&apos;équipe sont annulées.</div>}
      {sp.ok === "1" && <div className="mb-3 rounded-xl border border-green/30 bg-green-soft text-green px-3 py-2 text-[13px]">Modèle enregistré : le générateur l&apos;utilise dès maintenant.</div>}
      {entry.invalid && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">Ce modèle est écarté du générateur tant qu&apos;il n&apos;est pas corrigé : {entry.invalid.join(" · ")}</div>}
      {(entry.originActionId || entry.originActivationId) && (
        <p className="mb-3 text-[13px] text-muted">Repris de {entry.originActionId ? <Link href={`/marketing/priorites/${entry.originActionId}`} className="text-accent hover:underline">l&apos;action réalisée</Link> : <Link href={`/marketing/activations/${entry.originActivationId}`} className="text-accent hover:underline">l&apos;activation réalisée</Link>}.</p>
      )}
      {entry.system && !entry.modified && canEdit && <p className="mb-3 text-[13px] text-muted">Modèle livré avec COMANET OS. Vos modifications le remplacent ; « Revenir à la version livrée » les annule.</p>}

      <TemplateForm fields={templateToFields(t, entry.active)} original={t.key} readOnly={!canEdit} keyLocked />
    </>
  );
}
