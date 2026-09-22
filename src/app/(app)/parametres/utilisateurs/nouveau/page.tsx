import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { assignmentOptions, emptyConfig, listTemplates } from "@/lib/admin-users";
import { PageHeader, Card } from "@/components/ui";
import { PermissionMatrix } from "@/components/permission-matrix";
import { createUserAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouveau compte" };

export default async function NewUserPage(props: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const [templates, options] = await Promise.all([listTemplates(), assignmentOptions()]);

  return (
    <>
      <PageHeader eyebrow={<Link href="/parametres/utilisateurs" className="hover:underline">Utilisateurs & droits</Link>} title="Nouveau compte" subtitle="Renseignez le profil, appliquez un ou plusieurs modèles, puis ajustez librement chaque case." />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <form action={createUserAction} className="space-y-4">
        <Card title="Profil">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-[13px]">
            <label className="block"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required /></label>
            <label className="block"><span className="label block mb-1">E-mail</span><input name="email" type="email" className="input h-9" required /></label>
            <label className="block"><span className="label block mb-1">Mot de passe initial</span><input name="password" type="password" className="input h-9" required minLength={8} /></label>
            <label className="block"><span className="label block mb-1">Fonction</span><input name="jobTitle" className="input h-9" placeholder="Animatrice, déléguée médicale…" /></label>
            <label className="block"><span className="label block mb-1">Ville</span><input name="city" className="input h-9" placeholder="Casablanca" /></label>
            <label className="block"><span className="label block mb-1">Téléphone</span><input name="phone" className="input h-9" /></label>
          </div>
        </Card>
        <Card title="Droits">
          <PermissionMatrix initial={emptyConfig()} templates={templates} brands={options.brands} clients={options.clients} cities={options.cities} />
        </Card>
        <div className="flex gap-2 justify-end">
          <Link href="/parametres/utilisateurs" className="btn-secondary">Annuler</Link>
          <button className="btn-primary" type="submit">Créer le compte</button>
        </div>
      </form>
    </>
  );
}
