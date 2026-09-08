import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActivationAccess, activationScope } from "@/lib/activations/access";
import { activationRefs } from "@/lib/activations/refs";
import { activationRoi } from "@/lib/activations/roi";
import { VERDICT_LABELS, VERDICT_TONES, safeTone, durationDays } from "@/lib/activations/shared";
import { getSettings } from "@/lib/settings";
import { listAssets } from "@/lib/content/assets";
import { PageHeader, Card, Badge, BrandDot, Facts } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { fmtDate, fmtMAD, fmtPct, iso, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Synthèse d'activation" };

/**
 * Fiche synthèse imprimable : ce qui a été fait, coût, résultats, impact ventes, verdict.
 * Donnée / Analyse / Hypothèse / Recommandation sont séparés et étiquetés comme tels.
 */
export default async function SynthesePage(props: { params: Promise<{ id: string }> }) {
  await requireActivationAccess();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [refs, settings, scope] = await Promise.all([activationRefs(), getSettings(), activationScope()]);
  const todayIso = iso(today());
  const r = await activationRoi(id, scope, settings.activations, todayIso);
  if (!r) notFound();
  const { activation: a, budget, impact, unit, verdict } = r;
  const st = refs.statuses.find((s) => s.key === a.status);
  const type = refs.types.find((t) => t.key === a.type);
  const photos = (await listAssets({ activationId: id })).filter((x) => x.kind === "PHOTO" && x.mime.startsWith("image/")).slice(0, 4);
  const t = budget.totals;
  const c = impact?.comparison ?? null;
  const val = (v: number | null | undefined) => (v == null ? "—" : fmtMAD(v));
  const per = (v: number | null) => (v == null ? "—" : `${fmtMAD(v)} / j`);

  return (
    <div className="max-w-4xl print:max-w-none">
      <div className="print:hidden">
        <PageHeader eyebrow={<Link href={`/marketing/activations/${a.id}`} className="hover:underline">← Fiche activation</Link>} title="Synthèse" subtitle="Ce qui a été fait, ce que ça a coûté, ce que ça a donné. Prête à imprimer ou à partager en PDF."
          actions={<PrintButton />} />
      </div>

      <div className="space-y-4 print:space-y-3 text-[13px]">
        <Card>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="label">Synthèse d&apos;activation · {fmtDate(todayIso)}</div>
              <h1 className="text-[22px] font-semibold tracking-tight leading-tight mt-1">{a.name}</h1>
              <div className="text-muted mt-1 flex items-center gap-2 flex-wrap">{a.brand && <span className="inline-flex items-center gap-1"><BrandDot color={a.color ?? "#999"} />{a.brand}{a.brandCount > 1 ? ` +${a.brandCount - 1}` : ""}</span>}<span>· {type?.label ?? a.type}</span><span>· {fmtDate(a.date)}{a.endDate && a.endDate !== a.date ? ` → ${fmtDate(a.endDate)} (${durationDays(a.date, a.endDate)} j)` : ""}</span>{a.city && <span>· {a.city}</span>}{a.place && <span>· {a.place}</span>}</div>
            </div>
            <div className="text-right"><Badge tone={safeTone(VERDICT_TONES[verdict.verdict])}>{VERDICT_LABELS[verdict.verdict]}</Badge><div className="text-[11.5px] text-muted mt-1">{st?.label ?? a.status}{a.responsible ? ` · pilote ${a.responsible}` : ""}</div></div>
          </div>
          {a.description && <p className="mt-3 whitespace-pre-wrap">{a.description}</p>}
          <div className="mt-3"><Facts cols={4} items={[
            { label: "Objectif", value: refs.objectives.find((o) => o.key === a.objectiveKey)?.label ?? "—" }, { label: "Cible", value: refs.targets.find((o) => o.key === a.targetKey)?.label ?? "—" },
            { label: "Points de vente", value: a.clientCount || (a.city ? `Ville : ${a.city}` : "—") }, { label: "Produits", value: a.productCount || "—" },
          ]} /></div>
          {photos.length > 0 && <div className="mt-3 grid grid-cols-4 gap-1.5">{photos.map((p) => <img key={p.id} src={`/marketing/activations/fichier/${p.id}`} alt={p.name} className="aspect-square w-full rounded-lg object-cover border border-line" />)}</div>}
        </Card>

        <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
          <Card title="Coût complet">
            <Facts cols={2} items={[
              { label: "Prévu", value: fmtMAD(t.planned) }, { label: "Engagé", value: fmtMAD(t.committed) },
              { label: "Dépensé (factures)", value: fmtMAD(t.spent) }, { label: "Matériel valorisé", value: fmtMAD(t.materials) },
            ]} />
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2 flex items-center justify-between"><span className="font-medium">Coût complet</span><span className="text-[16px] font-semibold tabular-nums">{fmtMAD(t.fullCost)}</span></div>
            {budget.lines.length > 0 && <ul className="mt-2 text-[12px] text-muted space-y-0.5">{budget.lines.map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.label} · {l.costItem}</span><span className="tabular-nums">{fmtMAD(l.spent || l.committed || l.planned)}</span></li>)}{budget.materials.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{m.item} × {m.quantity}</span><span className="tabular-nums">{fmtMAD(m.total)}</span></li>)}</ul>}
          </Card>
          <Card title="Résultats saisis">
            <Facts cols={2} items={[
              { label: "Participants / contacts", value: a.participants ?? "—" }, { label: "Échantillons distribués", value: a.samples ?? "—" },
              { label: "Pharmacies touchées", value: a.pharmaciesReached ?? "—" }, { label: "Commandes sur place", value: a.ordersOnSite != null ? `${a.ordersOnSite}${a.ordersAmount ? ` · ${fmtMAD(a.ordersAmount)}` : ""}` : "—" },
              { label: "Leads", value: a.leads ?? "—" }, { label: "Retombées presse", value: a.pressMentions ?? "—" },
              { label: "Coût / contact", value: val(unit.contact) }, { label: "Coût / échantillon", value: val(unit.sample) },
              { label: "Coût / pharmacie", value: val(unit.pharmacy) }, { label: "CA réellement mesuré", value: val(a.attributedRevenue) },
            ]} />
            {a.results && <p className="mt-3 whitespace-pre-wrap text-[12.5px]">{a.results}</p>}
          </Card>
        </div>

        <Card title="Impact ventes (sell-in HT, corrélation observée)">
          {!impact ? (
            <p className="text-muted">Non mesurable : aucun point de vente ni ville rattaché à l&apos;activation. Rien n&apos;est estimé.</p>
          ) : (
            <>
              <p className="text-[12px] text-muted mb-2">Périmètre : {impact.scopeLabel}. Fenêtres : {settings.activations.windowBeforeDays} j avant, l&apos;activation, {settings.activations.windowAfterDays} j après.</p>
              <div className="table-wrap"><table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-muted"><th className="py-1">Fenêtre</th><th className="py-1">Dates</th><th className="py-1 text-right">Jours</th><th className="py-1 text-right">Unités</th><th className="py-1 text-right">CA HT</th><th className="py-1 text-right">CA / jour</th></tr></thead>
                <tbody>
                  {([["Avant", impact.windows.before, impact.before, c?.beforePerDay], ["Pendant", impact.windows.during, impact.during, c?.duringPerDay], ["Après", impact.windows.after, impact.after, c?.afterPerDay]] as const).map(([l, w, s, rate]) => (
                    <tr key={l} className="border-t border-line"><td className="py-1 font-medium">{l}</td><td className="py-1 text-muted">{fmtDate(w.start)} → {fmtDate(w.end)}</td><td className="py-1 text-right tabular-nums">{s.days}</td><td className="py-1 text-right tabular-nums">{Math.round(s.qty)}</td><td className="py-1 text-right tabular-nums">{fmtMAD(s.amount)}</td><td className="py-1 text-right tabular-nums">{per(rate ?? null)}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-surface-2 px-3 py-2"><div className="label">Écart observé</div><div className="text-[15px] font-semibold tabular-nums">{c?.comparable && c.increment != null ? `${c.increment >= 0 ? "+" : "−"}${fmtMAD(Math.abs(c.increment))}` : "pas encore comparable"}</div></div>
                <div className="rounded-xl bg-surface-2 px-3 py-2"><div className="label">Rythme après vs avant</div><div className="text-[15px] font-semibold tabular-nums">{c?.upliftPct != null ? fmtPct(c.upliftPct, 0, true) : "—"}</div></div>
                <div className="rounded-xl bg-surface-2 px-3 py-2"><div className="label">Écart / coût complet</div><div className="text-[15px] font-semibold tabular-nums">{verdict.roi != null ? `× ${verdict.roi.toFixed(2)}` : "—"}</div></div>
              </div>
            </>
          )}
        </Card>

        <Card title={<span className="inline-flex items-center gap-2">Verdict <Badge tone={safeTone(VERDICT_TONES[verdict.verdict])}>{VERDICT_LABELS[verdict.verdict]}</Badge></span>}>
          <div className="grid md:grid-cols-2 gap-4 print:grid-cols-2">
            <div><div className="label mb-1">Donnée</div><ul className="list-disc pl-4 space-y-0.5">{verdict.data.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><div className="label mb-1">Analyse</div><ul className="list-disc pl-4 space-y-0.5">{verdict.analysis.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><div className="label mb-1">Hypothèses</div>{verdict.hypotheses.length ? <ul className="list-disc pl-4 space-y-0.5">{verdict.hypotheses.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-muted">—</span>}</div>
            <div><div className="label mb-1">Recommandation</div><p className="font-medium">{verdict.recommendation}</p></div>
          </div>
          <p className="text-[11px] text-muted mt-3">Chiffres issus des ventes Sage importées et des saisies de la fiche. Une donnée absente s&apos;affiche « — », jamais estimée. L&apos;écart avant / après est une corrélation observée, pas une causalité.</p>
        </Card>
      </div>
    </div>
  );
}
