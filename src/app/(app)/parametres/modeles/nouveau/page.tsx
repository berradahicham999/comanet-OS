import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { emptyConfig, listTemplates } from "@/lib/admin-users";
import { PageHeader, Card } from "@/components/ui";
import { PermissionMatrix } from "@/components/permission-matrix";
import { saveTemplateAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau modèle de rôle" };

export default async function NewTemplatePage(props: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const templates = await listTemplates();
  return (
    <>
      <PageHeader eyebrow={<Link href="/parametres/modeles" className="hover:underline">Modèles de rôle</Link>} title="Nouveau modèle" subtitle="Partez d'un modèle existant ou d'une matrice vide." />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <form action={saveTemplateAction} className="space-y-4">
        <Card title="Modèle">
          <div className="grid sm:grid-cols-3 gap-3 text-[13px]">
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required /></label>
            <label className="block sm:col-span-2"><span className="label block mb-1">Description</span><input name="description" className="input h-9" /></label>
            <label className="block"><span className="label block mb-1">Page d&apos;accueil proposée</span><input name="homePath" defaultValue="/" className="input h-9" /></label>
          </div>
        </Card>
        <Card title="Droits du modèle">
          <PermissionMatrix initial={emptyConfig()} templates={templates} showAssignments={false} />
        </Card>
        <div className="flex gap-2 justify-end">
          <Link href="/parametres/modeles" className="btn-secondary">Annuler</Link>
          <button className="btn-primary" type="submit">Créer le modèle</button>
        </div>
      </form>
    </>
  );
}
