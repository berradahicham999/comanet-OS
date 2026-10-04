import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, canDo } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { AXES, AXIS_KEYS, OBJECTIVES, OBJECTIVE_KEYS, TARGETS, TARGET_KEYS } from "@/lib/action-generator/catalog";
import { parseGeneratorParams, type GeneratorParams } from "@/lib/action-generator/params";
import { defaultMonth, runGenerator } from "@/lib/action-generator/server";
import { PageHeader, Card, Badge, Empty, Section } from "@/components/ui";
import { ProposalCard } from "@/components/action-proposal";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { fmtMAD, fmtMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Générer une action" };

const SOURCE_LABEL = { SAISI: "budget saisi", AXE: "allocation du levier", MARQUE: "enveloppe de la marque", AUCUN: "aucun budget défini" } as const;

export default async function GenerateActionPage(props: { searchParams: Promise<GeneratorParams> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const scope = await decisionScopeFor(sp.brand ?? null);
  const month0 = defaultMonth(scope.ctx.now);
  const input = parseGeneratorParams(sp, { month: month0 });
  const brand = input ? scope.allBrands.find((b) => b.id === input.brandId) ?? null : null;
  const [products, canAdd] = await Promise.all([
    brand ? db.execute<{ id: string; name: string }>(sql`select id, name from products where active and brand_id = ${brand.id}::uuid order by name`) : Promise.resolve({ rows: [] as { id: string; name: string }[] }),
    canDo("marketing", "create"),
  ]);
  const run = input && brand ? await runGenerator(scope.ctx, input, brand.name, { maxOptions: 5 }) : null;
  const r = run?.result ?? null;
  const ab = r?.axisBudget ?? null;

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/priorites" className="hover:underline">Priorités & actions</Link>} title="Générer une action"
        subtitle="Marque, objectif, levier et budget : COMANET propose 3 à 5 actions concrètes, chiffrées et planifiées, à partir de la bibliothèque d'actions et des données de la marque. Vous choisissez, vous ajoutez au plan." />

      <Card className="mb-5">
        <form method="get" className="grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2 text-[13px] items-end">
          <label className="block"><span className="label block mb-1">Marque</span>
            <AutoSubmitSelect name="brand" defaultValue={brand?.id ?? ""} className="select h-9" required><option value="">— choisir —</option>{scope.allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</AutoSubmitSelect>
          </label>
          <label className="block"><span className="label block mb-1">Objectif</span>
            <select name="objectif" defaultValue={input?.objective ?? "SELL_OUT"} className="select h-9">{OBJECTIVE_KEYS.map((k) => <option key={k} value={k}>{OBJECTIVES[k]}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Levier</span>
            <select name="levier" defaultValue={input?.axis ?? ""} className="select h-9"><option value="">Tous les leviers</option>{AXIS_KEYS.map((k) => <option key={k} value={k}>{AXES[k].label}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Budget disponible (MAD)</span>
            <input name="budget" defaultValue={input?.budget ?? ""} placeholder={ab?.available != null ? `${Math.round(ab.available).toLocaleString("fr-FR")} (calculé)` : "calculé"} className="input h-9" />
          </label>
          <label className="block"><span className="label block mb-1">Période</span>
            <input type="month" name="mois" defaultValue={(input?.month ?? month0).slice(0, 7)} className="input h-9" />
          </label>
          <label className="block"><span className="label block mb-1">Cible</span>
            <select name="cible" defaultValue={input?.target ?? "FEMMES_25_45"} className="select h-9">{TARGET_KEYS.map((k) => <option key={k} value={k}>{TARGETS[k]}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Produit</span>
            <select name="produit" defaultValue={input?.productId ?? ""} className="select h-9" disabled={!brand}><option value="">{brand ? "Toute la marque" : "— choisir la marque —"}</option>{products.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <div className="sm:col-span-2 lg:col-span-4 xl:col-span-7 flex justify-end"><button className="btn-primary" type="submit">Générer les actions</button></div>
        </form>
      </Card>

      {!input || !brand ? (
        <Empty title="Choisir une marque" hint="Puis l'objectif, le levier et, si vous le souhaitez, le budget : sans budget saisi, COMANET part du budget réellement disponible (allocation du levier − engagé − actions déjà prévues)." />
      ) : r && (
        <>
          <div className="rounded-2xl border border-line bg-surface p-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="label">{input.axis ? `Budget ${AXES[input.axis].label.toLowerCase()} disponible` : "Budget disponible de la marque"}</div>
              <div className={`text-[24px] font-semibold tracking-tight ${r.available !== null && r.available <= 0 ? "text-red" : ""}`}>{r.available === null ? "non défini" : fmtMAD(r.available)}</div>
            </div>
            {ab && ab.source === "AXE" && <div className="text-[12.5px] text-muted">alloué {fmtMAD(ab.allocated, { compact: true })} − engagé {fmtMAD(ab.committed, { compact: true })} − déjà prévu {fmtMAD(ab.reserved, { compact: true })}</div>}
            {ab && ab.source === "MARQUE" && <div className="text-[12.5px] text-muted">aucune allocation sur ce levier : enveloppe de la marque − consommé − actions prévues</div>}
            {run?.data.monthRemaining !== null && run?.data.monthRemaining !== undefined && <div className="text-[12.5px]"><span className="text-muted">Budget du mois au plan ({fmtMonth(input.month)}) : </span><b>{fmtMAD(run.data.monthRemaining)}</b> <span className="text-muted">restants</span></div>}
            <div className="text-[12.5px]"><span className="text-muted">Base des propositions : </span><b>{r.budgetUsed === null ? "—" : fmtMAD(r.budgetUsed)}</b> <span className="text-muted">({SOURCE_LABEL[r.budgetSource]})</span></div>
            <span className="flex-1" />
            <Link href={`/marketing/plan`} className="btn-ghost btn-sm">Plan marketing</Link>
          </div>
          {r.notes.length > 0 && <ul className="text-[12.5px] text-amber-800 mb-3 space-y-0.5">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

          {r.blocked ? (
            <Card><div className="flex items-start gap-3"><Badge tone="red">Aucune action</Badge><p className="text-[13.5px]">{r.blocked}</p></div></Card>
          ) : r.options.length === 0 ? (
            <Empty title="Aucune action finançable" hint="Augmenter le budget, choisir un autre levier ou un autre objectif. Les modèles écartés et leur raison sont listés ci-dessous." />
          ) : (
            <Section title={`Les ${r.options.length} meilleures actions finançables pour ${brand.name}${run?.data.product ? ` — ${run.data.product.name}` : ""}`} description={`Classées par pertinence (objectif, budget, potentiel commercial, historique, saison, stock, cible, faisabilité, non-répétition). Période : ${fmtMonth(input.month)}.`}>
              <div className="grid lg:grid-cols-2 gap-3">{r.options.map((p, i) => <ProposalCard key={p.key} p={p} rank={i + 1} input={{ ...input, axis: input.axis ?? p.axis, budget: input.budget ?? p.budget }} canAdd={canAdd} />)}</div>
            </Section>
          )}

          {r.excluded.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12.5px] text-muted">Modèles écartés ({r.excluded.length}) : déjà au plan, hors budget, non adaptés au produit</summary>
              <ul className="mt-2 text-[12.5px] space-y-0.5">{r.excluded.map((e) => <li key={e.templateKey}><b>{e.name}</b> <span className="text-muted">— {e.reason}</span></li>)}</ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
