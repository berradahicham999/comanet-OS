import Link from "next/link";
import { requireAccess, canDo } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { contentRefs, listBriefTemplates } from "@/lib/content/refs";
import { BRIEF_FIELDS, type BriefField } from "@/lib/content/shared";
import type { BriefTemplate } from "@/db/schema";
import { saveTemplate, deleteTemplate } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modèles de briefs" };

const FIELD_LABELS: Record<BriefField, string> = {
  keyMessage: "Message clé", angle: "Angle", hook: "Accroche", caption: "Légende", hashtags: "Hashtags", cta: "Appel à l'action",
  constraints: "Contraintes", mandatoryMentions: "Mentions obligatoires", forbiddenClaims: "Allégations interdites", deliverables: "Livrables attendus",
};

export default async function TemplatesPage() {
  await requireAccess("marketing");
  const [templates, refs, brands, canEdit, canDelete] = await Promise.all([listBriefTemplates(), contentRefs(), listBrands(), canDo("marketing", "edit"), canDo("marketing", "validate")]);

  const templateForm = (t?: BriefTemplate) => {
    const d = t?.defaults ?? {};
    return (
      <form action={saveTemplate} className="space-y-2 text-[13px]">
        {t && <input type="hidden" name="id" value={t.id} />}
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block sm:col-span-2"><span className="label block mb-1">Nom du modèle</span><input name="name" defaultValue={t?.name ?? ""} className="input h-9" required placeholder="ex : Post produit standard" /></label>
          <label className="block"><span className="label block mb-1">Marque (facultatif)</span><select name="brandId" defaultValue={t?.brandId ?? ""} className="select h-9"><option value="">Toutes les marques</option>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Objectif</span><select name="objective" defaultValue={t?.objectiveKey ?? ""} className="select h-9"><option value="">—</option>{refs.objectives.filter((o) => o.active).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Plateforme</span><select name="platform" defaultValue={t?.platformKey ?? ""} className="select h-9"><option value="">—</option>{refs.platforms.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Format</span><select name="format" defaultValue={t?.formatKey ?? ""} className="select h-9"><option value="">—</option>{refs.formats.filter((f) => f.active).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Deadline : jours avant publication</span><input name="deadlineOffsetDays" defaultValue={d.deadlineOffsetDays ?? 3} inputMode="numeric" className="input h-9" /></label>
          <label className="flex items-center gap-2 self-end h-9"><input type="checkbox" name="active" value="on" defaultChecked={t?.active ?? true} /> Modèle actif</label>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {BRIEF_FIELDS.map((f) => (
            <label key={f} className={f === "caption" || f === "constraints" ? "block sm:col-span-2" : "block"}><span className="label block mb-1">{FIELD_LABELS[f]}</span>
              {f === "caption" || f === "constraints" || f === "forbiddenClaims" || f === "mandatoryMentions" ? <textarea name={f} defaultValue={d[f] ?? ""} className="textarea min-h-[56px]" /> : <input name={f} defaultValue={d[f] ?? ""} className="input h-9" />}
            </label>
          ))}
        </div>
        <div className="flex gap-2 items-center pt-1">
          <button className="btn-primary btn-sm" type="submit">{t ? "Enregistrer" : "Créer le modèle"}</button>
          {t && !t.active && <Badge tone="gray">Inactif</Badge>}
        </div>
      </form>
    );
  };

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/planning" className="hover:underline">Planning éditorial</Link>} title="Modèles de briefs"
        subtitle="Un modèle pré-remplit le brief à la création (message, accroche, contraintes, livrables, deadline). Il ne remplace jamais ce qui est déjà saisi." />
      {templates.length === 0 && <Empty title="Aucun modèle" hint="Créez votre premier modèle ci-dessous : il apparaîtra dans la création rapide du calendrier." />}
      <div className="grid xl:grid-cols-2 gap-4">
        {templates.map((t) => (
          <Card key={t.id} title={t.name} action={<div className="flex items-center gap-2">{t.brandId && <Badge tone="blue">{brands.find((b) => b.id === t.brandId)?.name ?? "Marque"}</Badge>}{canDelete && <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><button className="text-faint hover:text-red text-[13px]" type="submit" title="Supprimer">×</button></form>}</div>}>
            {canEdit ? templateForm(t) : <dl className="text-[13px] space-y-1">{BRIEF_FIELDS.filter((f) => t.defaults[f]).map((f) => <div key={f}><dt className="label">{FIELD_LABELS[f]}</dt><dd>{t.defaults[f]}</dd></div>)}</dl>}
          </Card>
        ))}
        {canEdit && <Card title="Nouveau modèle">{templateForm()}</Card>}
      </div>
    </>
  );
}
