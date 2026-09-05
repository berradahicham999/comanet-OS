import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listBrands } from "@/lib/users";
import { getRefDate } from "@/lib/ref-date";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/access-shared";
import { updateSettings, saveUser, saveObjectives } from "./actions";
import { seedDemoAction, purgeDemoAction } from "./demo-actions";
import { fmtMAD, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres" };

function Field({ name, label, value, hint, step }: { name: string; label: string; value: number | string; hint?: string; step?: string }) {
  return (
    <label className="block text-[13px]">
      <span className="label block mb-1">{label}</span>
      <input name={name} defaultValue={value} step={step} className="input h-9" />
      {hint && <span className="text-[11px] text-faint block mt-0.5">{hint}</span>}
    </label>
  );
}

export default async function ParametresPage(props: { searchParams: Promise<{ tab?: string; year?: string }> }) {
  await requireAccess("parametres");
  const sp = await props.searchParams;
  const tab = sp.tab ?? "regles";
  const { ref } = await getRefDate();
  const year = Number(sp.year) || ref.getUTCFullYear();
  const [s, users, brands, objRows, demoCount] = await Promise.all([
    getSettings(),
    db.select().from(usersTable).orderBy(usersTable.name),
    listBrands(),
    db.execute(sql`select brand_id, month, amount::float8 as amount from objectives where year = ${year} and product_id is null`),
    db.execute(sql`select (select count(*) from animations where comment like '[DÉMO]%')::int + (select count(*) from regulatory_files where notes like '[DÉMO]%')::int + (select count(*) from tasks where description like '[DÉMO]%')::int + (select count(*) from content_items where brief like '[DÉMO]%')::int + (select count(*) from marketing_expenses where notes like '[DÉMO]%')::int as n`),
  ]);
  const obj = new Map<string, number>();
  for (const r of objRows.rows as { brand_id: string | null; month: number | null; amount: number }[]) obj.set(`${r.brand_id ?? "all"}|${r.month ?? 0}`, r.amount);
  const activeBrands = brands.filter((b) => b.active);
  const demo = (demoCount.rows[0] as { n: number }).n;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paramètres" subtitle="Seuils des règles, objectifs, utilisateurs et rôles. Aucune règle métier n'est codée en dur : tout se règle ici.">
        <Tabs current={`/parametres?tab=${tab}`} tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres?tab=utilisateurs", label: "Utilisateurs" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>

      {tab === "regles" && (
        <form action={updateSettings} className="grid md:grid-cols-2 gap-4">
          <Card title="Stock & achats">
            <div className="grid grid-cols-3 gap-2">
              <Field name="cov_green" label="🟢 Confortable ≥ (mois)" value={s.coverage.green} />
              <Field name="cov_yellow" label="🟡 À surveiller ≥" value={s.coverage.yellow} />
              <Field name="cov_orange" label="🟠 Tendu ≥ (sinon 🔴)" value={s.coverage.orange} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field name="avgSalesMonths" label="Mois pour la vente moyenne" value={s.avgSalesMonths} hint="Fenêtre glissante de calcul de la rotation" />
              <Field name="stockCriticalRevenue" label="CA mensuel à risque « critique » (MAD)" value={s.stockCriticalRevenue} hint="En dessous, l'alerte est haute / moyenne" />
              <Field name="defaultMarginPct" label="Marge par défaut (%)" value={s.defaultMarginPct} hint="Si coût de revient inconnu" />
            </div>
          </Card>
          <Card title="Clients">
            <div className="grid grid-cols-2 gap-2">
              <Field name="clientInactiveDays" label="Inactif après (jours)" value={s.clientInactiveDays} />
              <Field name="reorderGraceDays" label="Tolérance relance (jours)" value={s.reorderGraceDays} hint="Après la commande théorique" />
              <Field name="clientRiskDropPct" label="À risque si baisse > (%)" value={s.clientRiskDropPct} hint="3 mois vs 3 mois précédents" />
              <Field name="clientGrowthPct" label="En croissance si hausse > (%)" value={s.clientGrowthPct} />
              <Field name="clientHighPotentialPercentile" label="Fort potentiel : percentile CA" value={s.clientHighPotentialPercentile} hint="80 = top 20 % des clients" />
            </div>
          </Card>
          <Card title="Réglementaire">
            <Field name="regulatoryAlertDays" label="Alertes (jours avant expiration)" value={s.regulatoryAlertDays.join(" / ")} hint="Séparés par / ou virgule" />
            <div className="mt-2"><Field name="regulatoryRenewalDays" label="Lancer le renouvellement à J- (tâche automatique)" value={s.regulatoryRenewalDays} /></div>
          </Card>
          <Card title="Commercial, terrain & marketing">
            <div className="grid grid-cols-2 gap-2">
              <Field name="brandDropPct" label="Marque en baisse si < (%) vs M-1" value={s.brandDropPct} />
              <Field name="sellOutDropPct" label="Sell-out terrain en baisse si < (%)" value={s.sellOutDropPct} />
              <Field name="budgetAlertPct" label="Alerte budget engagé à (%)" value={s.budgetAlertPct} />
            </div>
          </Card>
          <div className="md:col-span-2"><button className="btn-primary" type="submit">Enregistrer les seuils</button></div>
        </form>
      )}

      {tab === "objectifs" && (
        <Card title={`Objectifs de CA HT — ${year}`} action={<form action="/parametres" method="get" className="flex gap-1"><input type="hidden" name="tab" value="objectifs" /><input name="year" defaultValue={year} className="input h-8 w-20 text-[12px]" /><button className="btn-secondary btn-sm" type="submit">Année</button></form>}>
          <p className="text-[12.5px] text-muted mb-3">Objectif annuel par marque (importé de votre fichier ou saisi ici). Les mois vides utilisent annuel ÷ 12 ; renseignez un mois pour tenir compte de la saisonnalité. Total COMANET = somme des marques.</p>
          <form action={saveObjectives}>
            <input type="hidden" name="year" value={year} /><input type="hidden" name="brandIds" value={activeBrands.map((b) => b.id).join(",")} />
            <div className="overflow-x-auto">
              <table className="tbl text-[12px]">
                <thead><tr><th>Marque</th><th className="num">Annuel</th>{["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => <th key={i} className="num">{m}</th>)}</tr></thead>
                <tbody>
                  {activeBrands.map((b) => (
                    <tr key={b.id}>
                      <td className="font-medium whitespace-nowrap">{b.name}</td>
                      <td><input name={`annual_${b.id}`} defaultValue={obj.get(`${b.id}|0`) ?? ""} className="input h-8 w-28 text-right text-[12px]" /></td>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <td key={m}><input name={`m_${b.id}_${m}`} defaultValue={obj.get(`${b.id}|${m}`) ?? ""} placeholder={obj.get(`${b.id}|0`) ? fmtNum(obj.get(`${b.id}|0`)! / 12) : ""} className="input h-8 w-20 text-right text-[11px] px-1.5" /></td>)}
                    </tr>
                  ))}
                  <tr><td className="font-semibold">Total COMANET</td><td className="num font-semibold">{fmtMAD(obj.get("all|0") ?? 0, { compact: true })}</td><td colSpan={12} className="text-faint text-[11px]">calculé automatiquement</td></tr>
                </tbody>
              </table>
            </div>
            <button className="btn-primary mt-3" type="submit">Enregistrer les objectifs</button>
          </form>
        </Card>
      )}

      {tab === "utilisateurs" && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-2">
            {users.map((u) => (
              <details key={u.id} className="card px-4 py-3">
                <summary className="cursor-pointer flex flex-wrap items-center gap-2 list-none">
                  <span className="font-medium">{u.name}</span><span className="text-muted text-[12px]">{u.email}</span><Badge tone={u.role === "ADMIN" ? "accent" : "gray"}>{ROLE_LABELS[u.role]}</Badge>{!u.active && <Badge tone="red">inactif</Badge>}<span className="ml-auto text-[12px] text-accent">modifier</span>
                </summary>
                <form action={saveUser} className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  <input type="hidden" name="id" value={u.id} />
                  <label className="block"><span className="label block mb-1">Nom</span><input name="name" defaultValue={u.name} className="input h-9" required /></label>
                  <label className="block"><span className="label block mb-1">Email</span><input name="email" type="email" defaultValue={u.email} className="input h-9" required /></label>
                  <label className="block"><span className="label block mb-1">Rôle</span><select name="role" defaultValue={u.role} className="select h-9">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label className="block"><span className="label block mb-1">Nouveau mot de passe</span><input name="password" type="password" className="input h-9" placeholder="(inchangé)" /></label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={u.active} /> Compte actif</label>
                  <div className="text-right"><button className="btn-secondary btn-sm" type="submit">Enregistrer</button></div>
                </form>
              </details>
            ))}
          </div>
          <Card title="Nouvel utilisateur">
            <form action={saveUser} className="space-y-2 text-[13px]">
              <label className="block"><span className="label block mb-1">Nom</span><input name="name" className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Email</span><input name="email" type="email" className="input h-9" required /></label>
              <label className="block"><span className="label block mb-1">Rôle</span><select name="role" defaultValue="TRADE" className="select h-9">{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Mot de passe</span><input name="password" type="password" className="input h-9" required /></label>
              <button className="btn-primary btn-sm w-full" type="submit">Créer</button>
            </form>
            <div className="mt-4 text-[12px] text-muted space-y-1">
              <div><b>Admin / DG</b> : accès complet.</div><div><b>Marketing</b> : budgets, campagnes, planning, produits.</div><div><b>Réglementaire</b> : dossiers & documents.</div><div><b>Trade</b> : ventes, clients, stock, terrain, imports.</div><div><b>Animatrice</b> : saisie terrain, ses animations, ses tâches.</div>
            </div>
          </Card>
        </div>
      )}

      {tab === "demo" && (
        <Card title="Données de démonstration">
          <p className="text-[13px] text-ink-2 mb-3">Les modules Terrain, Réglementaire, Tâches, Planning éditorial et Campagnes n&apos;étaient pas couverts par votre fichier. Vous pouvez y injecter un jeu de données <b>fictif mais cohérent</b> (calé sur vos vraies marques, produits et clients) pour visualiser les écrans, puis le purger d&apos;un clic. Toutes les entrées de démo sont marquées « [DÉMO] ».</p>
          <div className="flex flex-wrap gap-2 items-center">
            <form action={seedDemoAction}><button className="btn-primary btn-sm" type="submit">Charger les données de démo</button></form>
            <form action={purgeDemoAction}><button className="btn-secondary btn-sm text-red" type="submit">Purger les données de démo</button></form>
            <Badge tone={demo ? "yellow" : "gray"}>{demo ? `${demo} entrées de démo présentes` : "Aucune donnée de démo"}</Badge>
          </div>
        </Card>
      )}
    </>
  );
}
