import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { getTemplate, listTemplates } from "@/lib/admin-users";
import { PageHeader, Card } from "@/components/ui";
import { PermissionMatrix } from "@/components/permission-matrix";
import { saveTemplateAction, deleteTemplateAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplateEditPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const [t, all] = await Promise.all([getTemplate(id), listTemplates()]);
  if (!t) notFound();
  const others = all.filter((x) => x.id !== id);
  return (
    <>
      <PageHeader eyebrow={<Link href="/parametres/modeles" className="hover:underline">Modèles de rôle</Link>} title={t.name} subtitle="Modifier ce modèle ne change pas les comptes déjà configurés." />
      {sp.ok && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Modèle enregistré.</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <form action={saveTemplateAction} className="space-y-4">
        <input type="hidden" name="id" value={t.id} />
        <Card title="Modèle">
          <div className="grid sm:grid-cols-3 gap-3 text-[13px]">
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={t.name} className="input h-9" required /></label>
            <label className="block sm:col-span-2"><span className="label block mb-1">Description</span><input name="description" defaultValue={t.description ?? ""} className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Page d&apos;accueil proposée</span><input name="homePath" defaultValue={t.homePath} className="input h-9" placeholder="/" /></label>
          </div>
        </Card>
        <Card title="Droits du modèle">
          <PermissionMatrix initial={{ perms: t.perms, scope: t.scope, flags: t.flags, brandIds: [], clientIds: [] }} templates={others} showAssignments={false} />
        </Card>
        <div className="flex gap-2 justify-end">
          <Link href="/parametres/modeles" className="btn-secondary">Retour</Link>
          <button className="btn-primary" type="submit">Enregistrer le modèle</button>
        </div>
      </form>
      <form action={deleteTemplateAction} className="mt-6 text-right">
        <input type="hidden" name="id" value={t.id} />
        <button className="btn-ghost btn-sm text-red" type="submit">Supprimer ce modèle</button>
      </form>
    </>
  );
}
