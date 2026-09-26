import { requireAdmin } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { PageHeader, Card } from "@/components/ui";
import { PnlTabs } from "@/components/gestion/gestion-nav";
import { saveRulesAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Règles — P&L" };

export default async function PnlRulesPage(props: { searchParams: Promise<{ error?: string; done?: string }> }) {
  await requireAdmin();
  const sp = await props.searchParams;
  const r = (await getSettings()).pnl;
  const slots = [...r.prestations, { site: "", label: "", ratePct: 0 }, { site: "", label: "", ratePct: 0 }];

  return (
    <>
      <PageHeader
        eyebrow="P&L"
        title="Règles de lecture des ventes"
        subtitle="Le fichier de ventes mélange trois natures de lignes selon le site. Chaque site n'a qu'une nature ; un site non classé est exclu du P&L et signalé."
      >
        <PnlTabs current="/gestion/pnl/regles" />
      </PageHeader>

      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Règles enregistrées.</div>}

      <form action={saveRulesAction} className="space-y-4 max-w-3xl text-[13px]">
        <Card title="Ventes directes COMANET">
          <p className="text-muted mb-2">CA HT de COMANET ; coût = (quantité + UG) × prix d’achat de l’article.</p>
          <input name="directSites" defaultValue={r.directSites.join(", ")} className="input h-9" />
        </Card>
        <Card title="Prestations commissionnées">
          <p className="text-muted mb-3">Le prestataire achète et revend ; COMANET touche un pourcentage de son CA HT remisé (Pharmafirst : 35 %). Aucun coût d’achat. Les remises exceptionnelles supportées par COMANET se saisissent en charge « Remises sur opérations spéciales ».</p>
          <div className="space-y-2">
            {slots.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_90px] gap-2">
                <input name={`p_site_${i}`} defaultValue={p.site} placeholder="Site (ex. PHARMAFIRST)" className="input h-9" />
                <input name={`p_label_${i}`} defaultValue={p.label} placeholder="Libellé (ex. Commission Pharmafirst)" className="input h-9" />
                <input name={`p_rate_${i}`} defaultValue={p.site ? p.ratePct : ""} placeholder="%" inputMode="decimal" className="input h-9" />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Revente des distributeurs (hors CA)">
          <p className="text-muted mb-2">Cospharma revend aux pharmacies le stock que COMANET lui a vendu en bloc : affiché pour information, jamais compté.</p>
          <input name="distributorSites" defaultValue={r.distributorSites.join(", ")} className="input h-9" />
        </Card>
        <button className="btn-primary btn-sm">Enregistrer les règles</button>
      </form>
    </>
  );
}
