import Link from "next/link";
import { requireAccess, canDo, clientFilter } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { fmtMAD } from "@/lib/format";
import { PageHeader, Card, Section, Empty, Badge } from "@/components/ui";
import { assignableUsers, managerProposals, portfolioAdminList } from "@/lib/crm/portfolio";
import { SelectAll } from "@/components/crm/select-all";
import { bulkPortfolioAction, applyProposalsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portefeuilles commerciaux" };

const TYPE_LABELS: Record<string, string> = { PHARMACIE: "Pharmacie", PARAPHARMACIE: "Parapharmacie", GROSSISTE: "Grossiste", AUTRE: "Autre" };

/**
 * Affectation des clients aux commerciales (commercial attitré) et fréquence de visite mensuelle, en masse.
 * Confier ou retirer = « Valider » sur Clients ; fréquence = « Modifier ». Chaque changement est tracé.
 */
export default async function PortfoliosPage(props: { searchParams: Promise<{ q?: string; city?: string; manager?: string; type?: string; frequency?: string; done?: string; error?: string; reprise?: string }> }) {
  await requireAccess("clients");
  const sp = await props.searchParams;
  const [canAssign, canEdit, scope, settings] = await Promise.all([canDo("clients", "validate"), canDo("clients", "edit"), clientFilter(), getSettings()]);
  if (!canAssign && !canEdit) return <Empty title="Réservé à la direction et aux managers" hint="Affecter des clients demande « Valider » sur Clients ; fixer une fréquence demande « Modifier »." />;
  const [users, rows, proposals] = await Promise.all([
    assignableUsers(),
    portfolioAdminList({ q: sp.q || null, city: sp.city || null, managerId: (sp.manager as string) || null, type: sp.type || null, frequency: sp.frequency === "none" || sp.frequency === "set" ? sp.frequency : null, scopeClientIds: scope }),
    canAssign ? managerProposals() : Promise.resolve([]),
  ]);
  const single = proposals.filter((p) => p.candidates.length === 1);
  const ambiguous = proposals.filter((p) => p.candidates.length > 1);
  const cities = [...new Set(rows.map((r) => r.city).filter(Boolean) as string[])].sort();
  const filters = new URLSearchParams(Object.entries({ q: sp.q, city: sp.city, manager: sp.manager, type: sp.type, frequency: sp.frequency }).filter(([, v]) => v) as [string, string][]).toString();
  const back = filters ? `/clients/portefeuilles?${filters}` : "/clients/portefeuilles";
  const d = settings.crm.defaultFrequencyByType;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/clients/visites" className="hover:underline">Suivi des visites</Link>}
        title="Portefeuilles commerciaux"
        subtitle="Qui suit quel client, et combien de visites par mois. Un client a un seul commercial attitré ; la portée des droits (villes, clients assignés) reste inchangée."
      />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done !== undefined && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">{sp.done} fiche(s) mise(s) à jour{sp.reprise ? " depuis les affectations des droits" : ""}. Chaque changement est tracé dans le journal d&apos;audit du client.</div>}

      {canAssign && proposals.length > 0 && (
        <Section title="Reprise : commercial proposé d'après les droits" description="Pour les clients sans commercial attitré : la commerciale qui a ce client assigné nommément, sinon sa ville. Rien n'est appliqué sans votre clic.">
          <Card>
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span><b>{single.length}</b> client(s) avec une seule commerciale possible</span>
              <span className="text-muted">· {ambiguous.length} avec plusieurs (à trancher ci-dessous, filtre « Sans commercial »)</span>
              {single.length > 0 && <form action={applyProposalsAction}><button className="btn-primary btn-sm">Appliquer les {single.length} propositions uniques</button></form>}
            </div>
            <details className="mt-3">
              <summary className="text-[12px] text-accent cursor-pointer">Voir le détail des propositions</summary>
              <div className="table-wrap mt-2">
                <table className="tbl">
                  <thead><tr><th>Client</th><th>Ville</th><th>Proposition</th></tr></thead>
                  <tbody>
                    {proposals.slice(0, 300).map((p) => (
                      <tr key={p.clientId}><td>{p.clientName}</td><td className="text-muted">{p.city ?? "—"}</td><td>{p.candidates.map((c) => `${c.name} (${c.via === "client" ? "client assigné" : "ville"})`).join(" ou ")}{p.candidates.length > 1 && <Badge tone="orange" className="ml-1">à trancher</Badge>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        </Section>
      )}

      <form className="mb-3 flex flex-wrap items-end gap-2 text-[13px]">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Nom du client…" className="input h-9 w-52" />
        <select name="city" defaultValue={sp.city ?? ""} className="select h-9 w-44"><option value="">Toutes les villes</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select name="manager" defaultValue={sp.manager ?? ""} className="select h-9 w-48"><option value="">Tous les commerciaux</option><option value="none">Sans commercial</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="select h-9 w-40"><option value="">Tous les types</option>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="frequency" defaultValue={sp.frequency ?? ""} className="select h-9 w-44"><option value="">Toutes les fréquences</option><option value="none">Fréquence non définie</option><option value="set">Fréquence définie</option></select>
        <button className="btn-secondary btn-sm h-9">Filtrer</button>
        <Link href="/clients/portefeuilles" className="text-[12px] text-muted underline">Réinitialiser</Link>
      </form>

      <form id="pf-form" action={bulkPortfolioAction}>
        <input type="hidden" name="back" value={back} />
        <Card className="mb-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Sur les clients cochés :</span>
            {canAssign && (
              <>
                <select name="userId" defaultValue="" className="select h-9 w-48"><option value="">Commerciale…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.city ? ` (${u.city})` : ""}</option>)}</select>
                <button name="op" value="assign" className="btn-primary btn-sm h-9">Confier</button>
                <button name="op" value="unassign" className="btn-ghost btn-sm h-9">Retirer le commercial</button>
                <span className="w-px h-6 bg-line mx-1" />
              </>
            )}
            {canEdit && (
              <>
                <input name="frequency" type="number" min={0} max={31} placeholder="Visites / mois" className="input h-9 w-32" />
                <button name="op" value="frequency" className="btn-secondary btn-sm h-9">Fixer la fréquence</button>
                <button name="op" value="clearFrequency" className="btn-ghost btn-sm h-9">Non définie</button>
                <button name="op" value="defaultFrequency" className="btn-ghost btn-sm h-9" title={`Pharmacie ${d.PHARMACIE}, parapharmacie ${d.PARAPHARMACIE}, grossiste ${d.GROSSISTE}, autre ${d.AUTRE} — seulement si la fréquence est vide`}>Fréquence par défaut du type</button>
              </>
            )}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Fréquence par défaut (Paramètres → CRM commercial) : pharmacie {d.PHARMACIE}, parapharmacie {d.PARAPHARMACIE}, grossiste {d.GROSSISTE}, autre {d.AUTRE} visite(s) par mois — appliquée seulement aux fiches sans fréquence. 0 = ne pas visiter (client servi autrement).</p>
        </Card>

        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th className="w-8"><SelectAll name="ids" form="pf-form" /></th><th>Client</th><th>Ville</th><th>Type</th><th>Commercial attitré</th><th className="num">Fréquence / mois</th><th className="num">CA 12 mois HT</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" name="ids" value={r.id} aria-label={`Sélectionner ${r.name}`} /></td>
                  <td><Link href={`/clients/${r.id}?tab=crm`} className="font-medium hover:underline">{r.name}</Link></td>
                  <td className="text-muted">{r.city ?? "—"}</td>
                  <td className="text-muted">{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>{r.manager ?? <span className="text-faint">—</span>}</td>
                  <td className="num">{r.frequency ?? <span className="text-faint">non définie</span>}</td>
                  <td className="num">{fmtMAD(r.revenue12, { compact: true })}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="text-center text-muted py-6">Aucun client pour ces filtres.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length >= 1500 && <p className="mt-2 text-[12px] text-muted">Liste limitée à 1 500 clients : affinez les filtres.</p>}
      </form>
    </>
  );
}
