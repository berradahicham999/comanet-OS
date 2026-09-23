import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, isOwnOnly, canDo } from "@/lib/access";
import { resolvePeriod, PERIOD_OPTIONS, type PeriodParam } from "@/lib/periods";
import { listAnimatrices, listBrands } from "@/lib/users";
import { listAnimationReports, deletedReports, REPORTS_LIMIT } from "@/lib/terrain/reports";
import { fmtAnimationPeriod } from "@/lib/animations-shared";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { AnimationHistory } from "@/components/animation-history";
import { fmtMAD, fmtNum, fmtDateShort, today } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapports d'animation" };

type SP = {
  period?: PeriodParam; start?: string; end?: string; animatrice?: string; city?: string; brand?: string;
  q?: string; source?: string; issues?: string; deleted?: string;
};

const STATUS: Record<string, { label: string; tone: "blue" | "gray" }> = {
  PLANNED: { label: "Prévue", tone: "blue" },
  CANCELLED: { label: "Annulée", tone: "gray" },
};

export default async function RapportsPage(props: { searchParams: Promise<SP> }) {
  const user = await requireAccess("terrain");
  const [ownOnly, canDelete] = await Promise.all([isOwnOnly(), canDo("terrain", "validate")]);
  const sp = await props.searchParams;
  // Les animations sont saisies au jour le jour : la période se cale sur aujourd'hui, pas sur la
  // dernière vente Sage importée (getRefDate), sinon tout ce qui a été saisi depuis disparaît.
  const ref = today();
  const period = resolvePeriod(sp.period, ref, { start: sp.start, end: sp.end });
  const source = sp.source === "saisie" || sp.source === "import" ? sp.source : undefined;

  const [{ rows, total }, animatrices, brands, cities, deleted] = await Promise.all([
    listAnimationReports({
      start: period.start, end: period.end,
      animatriceId: ownOnly ? user.id : sp.animatrice || undefined,
      city: sp.city || undefined, brandId: sp.brand || undefined, q: sp.q?.trim() || undefined,
      source, issues: sp.issues === "1",
    }),
    ownOnly ? Promise.resolve([]) : listAnimatrices(),
    listBrands(),
    db.execute(sql`select distinct city from animations where city is not null order by city`),
    canDelete ? deletedReports(period.start, period.end) : Promise.resolve([]),
  ]);

  const qs = (extra: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged: SP = { period: sp.period, start: sp.start, end: sp.end, animatrice: sp.animatrice, city: sp.city, brand: sp.brand, q: sp.q, source: sp.source, issues: sp.issues, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/terrain/rapports${s ? `?${s}` : ""}`;
  };
  // Retour vers cette liste, filtres compris, après une suppression depuis la fiche.
  const back = qs({});
  const filtered = Boolean(sp.animatrice || sp.city || sp.brand || sp.q || source || sp.issues);
  const toCheck = rows.filter((r) => r.missingPrice || r.overlap).length;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/terrain" className="hover:underline">Animations</Link>}
        title="Rapports d'animation"
        subtitle={`${period.label} · un rapport par animation, rattaché à son dernier jour. Ouvrez-en un pour le modifier${canDelete ? " ou le supprimer" : ""} : chaque correction est tracée.`}
        actions={<Link href="/terrain/saisie" className="btn-secondary btn-sm">+ Saisir</Link>}
      >
        <form action="/terrain/rapports" method="get" className="flex flex-wrap gap-2 mb-1 text-[13px]">
          <select name="period" defaultValue={sp.period ?? "month"} className="select h-9 w-auto">
            {PERIOD_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input type="date" name="start" defaultValue={sp.start ?? ""} className="input h-9 w-auto" title="Début (période personnalisée)" />
          <input type="date" name="end" defaultValue={sp.end ?? ""} className="input h-9 w-auto" title="Fin (période personnalisée)" />
          {!ownOnly && (
            <select name="animatrice" defaultValue={sp.animatrice ?? ""} className="select h-9 w-auto">
              <option value="">Toutes les animatrices</option>
              {animatrices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <select name="city" defaultValue={sp.city ?? ""} className="select h-9 w-auto">
            <option value="">Toutes les villes</option>
            {(cities.rows as { city: string }[]).map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
          </select>
          <select name="brand" defaultValue={sp.brand ?? ""} className="select h-9 w-auto">
            <option value="">Toutes les marques</option>
            {brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select name="source" defaultValue={source ?? ""} className="select h-9 w-auto">
            <option value="">Saisies et imports</option>
            <option value="saisie">Saisies</option>
            <option value="import">Imports</option>
          </select>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Point de vente…" className="input h-9 w-44" />
          <label className="flex items-center gap-1.5 h-9 px-1"><input type="checkbox" name="issues" value="1" defaultChecked={sp.issues === "1"} /> À vérifier</label>
          <button className="btn-secondary h-9" type="submit">Appliquer</button>
          {filtered && <Link href={qs({ animatrice: undefined, city: undefined, brand: undefined, q: undefined, source: undefined, issues: undefined })} className="btn-ghost btn-sm h-9">Réinitialiser</Link>}
        </form>
      </PageHeader>

      {sp.deleted && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">Rapport supprimé. Son contenu reste lisible dans « Rapports supprimés » en bas de page.</div>}

      {rows.length === 0 ? (
        <Empty
          title={filtered ? "Aucun rapport ne correspond à ces filtres" : "Aucun rapport sur la période"}
          hint={filtered ? "Élargissez la période ou retirez un filtre." : <>Les rapports apparaissent ici dès qu&apos;une animatrice saisit son animation depuis <Link href="/terrain/saisie" className="text-accent font-medium">Terrain → Saisir</Link>, ou après l&apos;import du fichier quotidien.</>}
        />
      ) : (
        <Card
          title={`${fmtNum(total)} rapport${total > 1 ? "s" : ""}${total > REPORTS_LIMIT ? ` · ${REPORTS_LIMIT} plus récents affichés, affinez les filtres` : ""}`}
          action={toCheck > 0 && sp.issues !== "1" ? <Link href={qs({ issues: "1" })} className="text-[12px] text-orange font-medium hover:underline">{toCheck} à vérifier</Link> : undefined}
          pad={false}
        >
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>
                <th>Période</th>
                {!ownOnly && <th>Animatrice</th>}
                <th>Point de vente</th>
                <th>Marque</th>
                <th className="num">Unités</th>
                <th className="num">Sell-out TTC</th>
                <th>Origine</th>
                <th></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/terrain/${r.id}?back=${encodeURIComponent(back)}`} className="font-medium hover:underline">{fmtAnimationPeriod(r.startDate, r.date, r.days)}</Link>
                      {STATUS[r.status] && <Badge tone={STATUS[r.status].tone} className="ml-1">{STATUS[r.status].label}</Badge>}
                    </td>
                    {!ownOnly && <td className="whitespace-nowrap">{r.animatrice ?? <span className="text-muted">—</span>}</td>}
                    <td><Link href={`/clients/${r.clientId}`} className="hover:underline">{r.client}</Link>{r.city && <span className="text-muted"> · {r.city}</span>}</td>
                    <td className="text-muted">{r.brand ?? "Multi-marques"}</td>
                    <td className="num">{fmtNum(r.units)}</td>
                    <td className="num">{r.missingPrice ? <span title="Des unités vendues n'ont pas de prix public : sell-out incomplet">{fmtMAD(r.sellout, { compact: true })}*</span> : fmtMAD(r.sellout, { compact: true })}</td>
                    <td className="text-[12px] text-muted whitespace-nowrap">
                      {r.source === "import" ? "Import" : "Saisie"}
                      {r.lastRevision?.action === "MODIFICATION" && <> · modifié par {r.lastRevision.actorName} le {fmtDateShort(r.lastRevision.at)}</>}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.overlap && <Badge tone="orange" className="mr-1">Chevauchement</Badge>}
                      {r.missingPrice && <Badge tone="orange" className="mr-1">Prix manquant</Badge>}
                      <Link href={`/terrain/${r.id}?back=${encodeURIComponent(back)}`} className="btn-ghost btn-sm">Ouvrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-[11px] text-faint border-t border-line">
            Chevauchement : la même animatrice a une autre animation sur les mêmes jours (doublon ou erreur de date ?). Prix manquant (*) : des unités vendues sans prix public, le sell-out est incomplet.
          </div>
        </Card>
      )}

      {deleted.length > 0 && (
        <Card title={`Rapports supprimés sur la période (${deleted.length})`} className="mt-4">
          <AnimationHistory rows={deleted} showSummary />
        </Card>
      )}
    </>
  );
}
