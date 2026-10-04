import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/lib/access";
import { AXES, AXIS_KEYS } from "@/lib/action-generator/catalog";
import { fallbackTemplate, slugKey, templateToFields } from "@/lib/action-generator/library-shared";
import type { AxisKey } from "@/lib/action-generator/types";
import { PageHeader } from "@/components/ui";
import { TemplateForm } from "../template-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau modèle d'action" };

export default async function NewTemplatePage(props: { searchParams: Promise<{ levier?: string; erreur?: string }> }) {
  await requirePermission("marketing", "edit");
  const sp = await props.searchParams;
  const axis: AxisKey = AXIS_KEYS.includes(sp.levier as AxisKey) ? (sp.levier as AxisKey) : "TRADE";
  const base = { ...fallbackTemplate(axis, "Nouvelle action"), key: slugKey("EQ", "MODELE", randomUUID()) };

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/bibliotheque" className="hover:underline">Bibliothèque d&apos;actions</Link>} title="Nouveau modèle d'action"
        subtitle="Partez d'un modèle générique du levier choisi. Le plus rapide reste souvent de dupliquer un modèle proche, ou d'enregistrer comme modèle une action ou une activation qui a bien marché." />
      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
        <span className="label self-center mr-1">Levier</span>
        {AXIS_KEYS.map((a) => <Link key={a} href={`/marketing/bibliotheque/nouveau?levier=${a}`} className={a === axis ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{AXES[a].label}</Link>)}
      </div>
      {sp.erreur && <div className="mb-3 rounded-xl border border-red/30 bg-red-soft text-red px-3 py-2 text-[13px]">{sp.erreur}</div>}
      <TemplateForm key={axis} fields={templateToFields(base, true)} original={null} readOnly={false} keyLocked={false} />
    </>
  );
}
