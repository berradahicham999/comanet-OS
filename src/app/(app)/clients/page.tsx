import { Fragment } from "react";
import Link from "next/link";
import { requireAccess, brandFilter, clientFilter, canDo } from "@/lib/access";
import { clientIntel, segmentCounts, SEGMENT_META, type Segment } from "@/lib/clients";
import { getRefDate } from "@/lib/ref-date";
import { PageHeader, Card, Badge, Delta, Tabs } from "@/components/ui";
import { fmtMAD, fmtDateShort, fmtDate } from "@/lib/format";
import { normKey } from "@/lib/import/normalize";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

const REC_TONE: Record<string, "red" | "orange" | "blue" | "green" | "accent" | "gray"> = { RELANCE: "blue", REACTIVATION: "red", ANALYSE: "orange", ANIMATION: "accent", DEVELOPPEMENT: "green", NONE: "gray" };

export default async function ClientsPage(props: { searchParams: Promise<{ seg?: string; q?: string; review?: string; potential?: string; sort?: string; group?: string }> }) {
  await requireAccess("clients");
  const sp = await props.searchParams;
  const { ref } = await getRefDate();
  // Portée « assignés » : clients cochés, sinon clients ayant acheté une marque assignée.
  const [scopeBrands, scopeClients, canCreate] = await Promise.all([brandFilter(), clientFilter(), canDo("clients", "create")]);
  const all = await clientIntel({ clientIds: scopeClients, brandIds: scopeBrands }, ref);
  const counts = segmentCounts(all);
  const q = sp.q ? normKey(sp.q) : "";
  let list = all;
  if (sp.seg) list = list.filter((c) => c.segment === sp.seg);
  if (sp.potential) list = list.filter((c) => c.highPotential);
  if (sp.review) list = list.filter((c) => c.needsReview);
  if (sp.group) list = list.filter((c) => (sp.group === "none" ? !c.groupId : c.groupId === sp.group));
  if (q) list = list.filter((c) => normKey(c.name).includes(q) || normKey(c.legalName ?? "").includes(q) || normKey(c.groupName ?? "").includes(q) || normKey(c.city ?? "").includes(q) || (c.code ?? "").toUpperCase().includes(q));
  if (sp.sort === "recent") list = [...list].sort((a, b) => (b.lastOrder ?? "").localeCompare(a.lastOrder ?? ""));
  if (sp.sort === "growth") list = [...list].sort((a, b) => (b.growthPct ?? -999) - (a.growthPct ?? -999));
  if (sp.sort === "next") list = [...list].sort((a, b) => (a.daysUntilNext ?? 9999) - (b.daysUntilNext ?? 9999));
  // Par groupe : groupes par ordre alphabétique, clients sans groupe à la fin, puis raison sociale.
  if (sp.sort === "group") list = [...list].sort((a, b) => Number(!a.groupName) - Number(!b.groupName) || (a.groupName ?? "").localeCompare(b.groupName ?? "") || (a.legalName ?? a.name).localeCompare(b.legalName ?? b.name));
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/clients${s ? "?" + s : ""}`;
  };
  const active12 = all.filter((c) => c.revenue12 > 0).length;
  const groups = [...new Map(all.filter((c) => c.groupId).map((c) => [c.groupId!, c.groupName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = list.slice(0, 400);
  // Vue « Par groupe » : nombre de raisons sociales et CA 12 mois cumulé de chaque groupe.
  const groupTotals = new Map<string, { n: number; revenue12: number }>();
  for (const c of list) {
    const t = groupTotals.get(c.groupId ?? "") ?? { n: 0, revenue12: 0 };
    t.n++;
    t.revenue12 += c.revenue12;
    groupTotals.set(c.groupId ?? "", t);
  }

  return (
    <>
      <PageHeader eyebrow="Customer intelligence" title="Clients" subtitle={`${all.length} clients · ${active12} actifs sur 12 mois · segments recalculés au ${fmtDate(ref)}`}
        actions={canCreate ? <Link href="/clients/nouveau" className="btn-primary btn-sm">+ Client</Link> : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          {(Object.keys(SEGMENT_META) as Segment[]).map((s) => (
            <Link key={s} href={qs({ seg: sp.seg === s ? "" : s, potential: "" })} className={`card px-3 py-2.5 hover:border-line-2 ${sp.seg === s ? "ring-2 ring-accent/40" : ""}`}>
              <div className="text-[11px] text-muted">{SEGMENT_META[s].emoji} {SEGMENT_META[s].label}</div>
              <div className="text-[20px] font-semibold tracking-tight">{counts[s]}</div>
            </Link>
          ))}
          <Link href={qs({ potential: sp.potential ? "" : "1", seg: "" })} className={`card px-3 py-2.5 hover:border-line-2 ${sp.potential ? "ring-2 ring-accent/40" : ""}`}>
            <div className="text-[11px] text-muted">⭐ Fort potentiel</div>
            <div className="text-[20px] font-semibold tracking-tight">{counts.FORT_POTENTIEL}</div>
          </Link>
        </div>
        <form action="/clients" method="get" className="flex flex-wrap gap-2 items-center">
          {sp.seg && <input type="hidden" name="seg" value={sp.seg} />}
          {sp.potential && <input type="hidden" name="potential" value="1" />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Raison sociale, groupe, ville, code…" className="input h-9 max-w-xs" />
          <select name="group" defaultValue={sp.group ?? ""} className="select h-9 w-auto">
            <option value="">Tous les groupes</option>
            {groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">Sans groupe</option>
          </select>
          <select name="sort" defaultValue={sp.sort ?? ""} className="select h-9 w-auto">
            <option value="">Tri : CA 12 mois</option>
            <option value="recent">Dernière commande</option>
            <option value="next">Prochaine commande théorique</option>
            <option value="growth">Évolution 3 mois</option>
            <option value="group">Regrouper par groupe</option>
          </select>
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="review" value="1" defaultChecked={!!sp.review} /> À qualifier</label>
          <button className="btn-secondary h-9" type="submit">Filtrer</button>
          {(sp.seg || sp.q || sp.review || sp.potential || sp.group) && <Link href="/clients" className="btn-ghost h-9">Réinitialiser</Link>}
        </form>
      </PageHeader>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Raison sociale</th><th>Point de vente</th><th>Groupe</th><th>Ville</th><th>Segment</th><th className="num">CA 12 mois</th><th className="num">Évol. 3 mois</th><th className="num">Cmd 12 m</th><th>Dernière cmd</th><th>Prochaine (théorique)</th><th>Action</th></tr>
          </thead>
          <tbody>
            {shown.map((c, i) => {
              const total = groupTotals.get(c.groupId ?? "");
              return (
                <Fragment key={c.id}>
                  {sp.sort === "group" && (i === 0 || shown[i - 1].groupId !== c.groupId) && total && (
                    <tr>
                      <td colSpan={5} className="font-semibold">
                        {c.groupId ? <Link href={qs({ group: c.groupId, sort: "" })} className="hover:underline">{c.groupName}</Link> : "Sans groupe"}
                        <span className="font-normal text-muted"> · {total.n} raison{total.n > 1 ? "s" : ""} sociale{total.n > 1 ? "s" : ""}</span>
                      </td>
                      <td className="num font-semibold">{fmtMAD(total.revenue12, { suffix: false })}</td>
                      <td colSpan={5} />
                    </tr>
                  )}
                  <tr>
                    <td>
                      <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                        {c.legalName ?? <span className="text-faint font-normal italic" title="Raison sociale non renseignée : complétez l'onglet Identité & conditions">à compléter</span>}
                      </Link>
                      {c.highPotential && <span title="Fort potentiel"> ⭐</span>}
                      {c.needsReview && <Badge tone="yellow" className="ml-2">à qualifier</Badge>}
                    </td>
                    <td className="text-muted"><Link href={`/clients/${c.id}`} className="hover:underline">{c.name}</Link></td>
                    <td>{c.groupId ? <Link href={qs({ group: c.groupId })} className="hover:underline">{c.groupName}</Link> : <span className="text-faint">—</span>}</td>
                    <td className="text-muted">{c.city ?? "—"}</td>
                    <td><Badge tone={SEGMENT_META[c.segment].tone}>{SEGMENT_META[c.segment].label}</Badge></td>
                    <td className="num font-medium">{fmtMAD(c.revenue12, { suffix: false })}</td>
                    <td className="num"><Delta value={c.growthPct} size="xs" /></td>
                    <td className="num">{c.orders12}</td>
                    <td className="whitespace-nowrap">{fmtDateShort(c.lastOrder)}{c.daysSinceLast !== null && <span className="text-faint"> · {c.daysSinceLast} j</span>}</td>
                    <td className="whitespace-nowrap">
                      {c.nextTheoretical ? (
                        <span className={c.overdue ? "text-red font-medium" : c.daysUntilNext !== null && c.daysUntilNext <= 5 ? "text-orange font-medium" : ""}>
                          {fmtDateShort(c.nextTheoretical)}{c.daysUntilNext !== null && <span className="text-faint font-normal"> · {c.daysUntilNext < 0 ? `retard ${-c.daysUntilNext} j` : `dans ${c.daysUntilNext} j`}</span>}
                        </span>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td>{c.recommendation.kind !== "NONE" && <Badge tone={REC_TONE[c.recommendation.kind]}>{c.recommendation.title}</Badge>}</td>
                  </tr>
                </Fragment>
              );
            })}
            {list.length === 0 && <tr><td colSpan={11} className="text-center text-muted py-8">Aucun client.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 400 && <p className="text-[12px] text-faint mt-2">400 premiers clients affichés — affinez la recherche.</p>}
    </>
  );
}
