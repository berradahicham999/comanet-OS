import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { listTemplates } from "@/lib/admin-users";
import { MODULE_SHORT, SCOPE_SHORT, FLAG_KEYS, FLAG_LABELS, type ModuleKey } from "@/lib/access-shared";
import { visibleModules } from "@/lib/permissions-shared";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Modèles de rôle" };

export default async function TemplatesPage(props: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const templates = await listTemplates();
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Modèles de rôle"
        subtitle="Raccourcis de pré-remplissage pour les fiches utilisateur. Modifier un modèle ne change pas les comptes déjà configurés : il faut le réappliquer explicitement."
        actions={<Link href="/parametres/modeles/nouveau" className="btn-primary btn-sm">+ Nouveau modèle</Link>}
      >
        <Tabs current="/parametres/modeles" tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres/activations", label: "Activations" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>
      {sp.ok && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Modèle enregistré.</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {templates.map((t) => {
          const mods = visibleModules(t.perms) as ModuleKey[];
          return (
            <Card key={t.id} title={t.name} href={`/parametres/modeles/${t.id}`}>
              {t.description && <p className="text-[12.5px] text-muted mb-2">{t.description}</p>}
              <div className="flex flex-wrap gap-1 mb-2">{mods.map((m) => <Badge key={m} tone={t.perms[m].validate ? "accent" : "gray"}>{MODULE_SHORT[m]}{t.perms[m].validate ? " ✓" : t.perms[m].edit ? " ✎" : t.perms[m].create ? " +" : ""}</Badge>)}{mods.length === 0 && <span className="text-[12px] text-faint">Aucun module</span>}</div>
              <div className="text-[12px] text-muted">Portée : {SCOPE_SHORT[t.scope]} · {FLAG_KEYS.filter((f) => t.flags[f]).length} droit(s) transverse(s)</div>
              <div className="text-[11px] text-faint mt-1 truncate">{FLAG_KEYS.filter((f) => t.flags[f]).map((f) => FLAG_LABELS[f]).join(" · ")}</div>
            </Card>
          );
        })}
      </div>
      <p className="text-[12px] text-faint mt-4">Légende : + créer · ✎ modifier · ✓ valider.</p>
    </>
  );
}
