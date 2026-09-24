import Link from "next/link";
import { requireAnyModule, getUserPermissions } from "@/lib/access";
import { getRecommendations, RULES, CATEGORY_META, CATEGORY_MODULES, type RecCategory } from "@/lib/rules";
import { listUsers } from "@/lib/users";
import { PageHeader, Tabs, Card, Empty, Badge } from "@/components/ui";
import { RecommendationCard } from "@/components/recommendation-card";
import { requireAccessContext } from "@/lib/permissions";
import { copilotAllowed } from "@/lib/ai/service";
import { listPlans } from "@/lib/ai/plans";
import { getRefDate } from "@/lib/ref-date";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Action Center" };

export default async function ActionCenterPage(props: { searchParams: Promise<{ cat?: string; all?: string; priority?: string }> }) {
  await requireAnyModule();
  const perms = await getUserPermissions();
  const sp = await props.searchParams;
  const [recs, users, refDate, access] = await Promise.all([getRecommendations(), listUsers(), getRefDate(), requireAccessContext()]);
  const copilot = copilotAllowed(access);
  const plans = copilot ? await listPlans(recs.map((r) => r.key)) : new Map();
  const showAll = sp.all === "1";
  const cat = (sp.cat ?? "") as RecCategory | "";
  const base = recs.filter((r) => showAll || !r.existingTask);
  // Chaque catégorie de recommandation suit le module qu'elle concerne : on n'affiche que celles que la personne peut voir.
  const catModules = CATEGORY_MODULES;
  const scoped = base.filter((r) => (catModules[r.category] ?? []).some((m) => perms[m].view));
  const list = scoped.filter((r) => !cat || r.category === cat).filter((r) => !sp.priority || r.priority === sp.priority);
  const counts = (Object.keys(CATEGORY_META) as RecCategory[]).map((c) => ({ c, n: scoped.filter((r) => r.category === c).length })).filter((x) => x.n > 0);
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(cat ? { cat } : {}), ...(showAll ? { all: "1" } : {}), ...(sp.priority ? { priority: sp.priority } : {}), ...extra });
    for (const [k, v] of Object.entries(extra)) if (!v) p.delete(k);
    const s = p.toString();
    return `/actions${s ? `?${s}` : ""}`;
  };
  const byPriority = { CRITICAL: scoped.filter((r) => r.priority === "CRITICAL").length, HIGH: scoped.filter((r) => r.priority === "HIGH").length, MEDIUM: scoped.filter((r) => r.priority === "MEDIUM").length, LOW: scoped.filter((r) => r.priority === "LOW").length };

  return (
    <>
      <PageHeader
        eyebrow="Action Center"
        title="Ce qu'il faut faire"
        subtitle={<>Recommandations générées automatiquement à partir des données au {fmtDate(refDate.ref)}. Chaque carte explique <b>pourquoi</b>, <b>quoi faire</b> et devient une tâche assignée en un clic.</>}
        actions={<Link href={q({ all: showAll ? "" : "1" })} className="btn-secondary btn-sm">{showAll ? "Masquer les actions déjà en tâche" : "Afficher aussi les actions en tâche"}</Link>}
      >
        <div className="flex flex-wrap gap-2 mb-3">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => {
            const label = { CRITICAL: "Critique", HIGH: "Haute", MEDIUM: "Moyenne", LOW: "Basse" }[p];
            const tone = { CRITICAL: "red", HIGH: "orange", MEDIUM: "yellow", LOW: "gray" }[p] as "red" | "orange" | "yellow" | "gray";
            const active = sp.priority === p;
            return (
              <Link key={p} href={q({ priority: active ? "" : p })} className={active ? "ring-2 ring-accent/40 rounded-full" : ""}>
                <Badge tone={tone} className="h-7 px-3 text-[12px]">{label} · {byPriority[p]}</Badge>
              </Link>
            );
          })}
        </div>
        <Tabs current={q({ cat })} tabs={[{ href: q({ cat: "" }), label: "Toutes", count: scoped.length }, ...counts.map((x) => ({ href: q({ cat: x.c }), label: CATEGORY_META[x.c].label, count: x.n }))]} />
      </PageHeader>

      <div className="grid lg:grid-cols-[1fr_280px] gap-4">
        <div className="space-y-3">
          {list.length === 0 ? (
            <Empty title="Aucune action dans cette vue" hint="Tout est sous contrôle, ou les actions ont déjà été transformées en tâches." />
          ) : (
            list.map((r) => <RecommendationCard key={r.key} rec={r} users={users} redirectTo={q({})} copilot={copilot} plan={plans.get(r.key) ?? null} />)
          )}
        </div>
        <aside className="space-y-3">
          <Card title="Règles actives">
            <ul className="space-y-2.5 text-[12.5px]">
              {RULES.map((r) => (
                <li key={r.id}>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-muted leading-snug">{r.description}</div>
                </li>
              ))}
            </ul>
            {perms.administration.validate && <Link href="/parametres" className="btn-secondary btn-sm mt-4 w-full">Régler les seuils</Link>}
          </Card>
        </aside>
      </div>
    </>
  );
}
