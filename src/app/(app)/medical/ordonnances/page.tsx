import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess, canDo } from "@/lib/access";
import { PageHeader, Card, Kpi, Tabs, Empty, Badge } from "@/components/ui";
import {
  prescriptionOverview, doctorQueue, productQueue, pharmacyQueue, autoMatches, splitDoctorName,
} from "@/lib/medical/prescription-resolution";
import { share } from "@/lib/medical/field-report-shared";
import { fmtDate } from "@/lib/format";
import {
  resolveDoctorAction, createDoctorAction, ignoreLabelAction, resolveProductAction, resolvePharmacyAction, undoAutoMatchAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ordonnances" };

const short = (id: string) => id.slice(0, 8);

/**
 * Ordonnances : taux de rapprochement, rapport du dernier import, et files de résolution (médecins,
 * produits, pharmacies, rapprochements automatiques à vérifier). Aucune donnée patient n'est stockée.
 */
export default async function OrdonnancesPage(props: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  await requireAccess("medical");
  if (!(await canDo("medical", "validate"))) redirect("/medical");
  const sp = await props.searchParams;
  const tab = ["medecins", "produits", "pharmacies", "auto"].includes(sp.tab ?? "") ? sp.tab! : "medecins";
  const ov = await prescriptionOverview();

  const [dq, pq, phq, am] = await Promise.all([
    tab === "medecins" ? doctorQueue() : Promise.resolve(null),
    tab === "produits" ? productQueue() : Promise.resolve(null),
    tab === "pharmacies" ? pharmacyQueue() : Promise.resolve(null),
    tab === "auto" ? autoMatches() : Promise.resolve(null),
  ]);
  const [docs, specialties, products, clients] = await Promise.all([
    tab === "medecins" ? db.execute<{ id: string; label: string }>(sql`select id, 'Dr ' || first_name || ' ' || last_name || coalesce(' — ' || city, '') as label from doctors order by last_name, first_name`) : null,
    tab === "medecins" ? db.execute<{ id: string; name: string }>(sql`select id, name from medical_specialties where active order by name`) : null,
    tab === "produits" ? db.execute<{ id: string; label: string }>(sql`select p.id, p.name || coalesce(' (' || b.name || ')', '') as label from products p left join brands b on b.id = p.brand_id where p.active order by p.name`) : null,
    tab === "pharmacies" ? db.execute<{ id: string; label: string }>(sql`select id, name || coalesce(' — ' || city, '') as label from clients order by name limit 5000`) : null,
  ]);

  const pct = (n: number) => (share(n, ov.total) === null ? "—" : `${share(n, ov.total)} %`);

  return (
    <>
      <PageHeader
        eyebrow="Médical"
        title="Ordonnances"
        subtitle="Ordonnances collectées, rapprochées des médecins, produits et pharmacies. Aucune donnée patient n'est importée ni conservée."
        actions={<Link href="/imports/nouveau?type=PRESCRIPTIONS" className="btn-primary">Importer un fichier</Link>}
      />
      {sp.ok && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green font-medium">{sp.ok}</div>}
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red font-medium">{sp.error}</div>}

      {ov.total === 0 ? (
        <Empty
          title="Aucune ordonnance importée"
          hint={<>Importez le fichier des ordonnances collectées depuis <Link className="underline" href="/imports">Imports</Link> (type « Ordonnances collectées »). Une ligne par produit prescrit : date, médecin, produit, quantité ; pharmacie, ville et spécialité si présentes. Les colonnes patient (nom, âge, téléphone, numéro…) ne sont jamais lues.</>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Kpi label="Lignes d'ordonnance" value={ov.total.toLocaleString("fr-FR")} sub={ov.firstDate ? `du ${fmtDate(ov.firstDate)} au ${fmtDate(ov.lastDate)}` : undefined} />
            <Kpi label="Rapprochées d'un médecin" value={pct(ov.doctorMatched)} sub={`${ov.doctorMatched.toLocaleString("fr-FR")} lignes · objectif 90 %`} tone={share(ov.doctorMatched, ov.total)! >= 90 ? "green" : "orange"} />
            <Kpi label="Rapprochées d'un produit" value={pct(ov.productMatched)} sub={`${ov.productMatched.toLocaleString("fr-FR")} lignes (le reste : concurrents ou libellés à associer)`} />
            <Kpi label="Pharmacie rapprochée" value={share(ov.pharmacyMatched, ov.withPharmacy) === null ? "—" : `${share(ov.pharmacyMatched, ov.withPharmacy)} %`} sub={`${ov.pharmacyMatched} / ${ov.withPharmacy} lignes avec pharmacie`} />
          </div>
          {ov.lastImport && (
            <Card className="mb-6" title={`Dernier import : ${ov.lastImport.fileName}`} action={<Link href={`/imports/${ov.lastImport.id}`} className="text-[13px] text-accent-2 hover:underline">Détail</Link>}>
              <ul className="text-[13px] text-ink-2 list-disc pl-5 space-y-0.5">
                {ov.lastImport.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                {ov.lastImport.errorRows > 0 && <li className="text-red">{ov.lastImport.errorRows} ligne(s) rejetée(s) : {summarizeErrors(ov.lastImport.errors)}</li>}
              </ul>
            </Card>
          )}
        </>
      )}

      <Tabs
        current={`/medical/ordonnances?tab=${tab}`}
        tabs={[
          { href: "/medical/ordonnances?tab=medecins", label: "Médecins à résoudre" },
          { href: "/medical/ordonnances?tab=produits", label: "Produits" },
          { href: "/medical/ordonnances?tab=pharmacies", label: "Pharmacies" },
          { href: "/medical/ordonnances?tab=auto", label: "Rapprochements automatiques" },
        ]}
      />

      {dq && (
        <div className="space-y-2 mt-4">
          <p className="text-[13px] text-muted">{dq.total} libellé(s) médecin non rapproché(s), du plus fréquent au moins fréquent. Associer crée un alias : le prochain import le reconnaîtra.</p>
          <datalist id="doctor-list">{docs!.rows.map((d) => <option key={d.id} value={`${d.label} [${short(d.id)}]`} />)}</datalist>
          {dq.items.length === 0 && <Empty title="File vide" hint="Tous les libellés médecin sont rapprochés ou écartés." />}
          {dq.items.map((g) => {
            const guess = splitDoctorName(g.rawName);
            return (
              <Card key={g.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">{g.rawName} <span className="text-muted font-normal text-[13px]">{[g.city, g.specialty].filter(Boolean).join(" · ")}</span></div>
                  <div className="text-[12px] text-muted">{g.lines} ligne(s) · dernière le {fmtDate(g.lastDate)}</div>
                </div>
                <form action={resolveDoctorAction} className="mt-2 flex flex-wrap items-end gap-2 text-[13px]">
                  <input type="hidden" name="key" value={g.key} />
                  {g.suggestions.length > 0 && (
                    <select name="doctorId" className="select h-9 min-w-[260px]" defaultValue="">
                      <option value="">Suggestions…</option>
                      {g.suggestions.map((s) => <option key={s.doctorId} value={`[${short(s.doctorId)}]`}>{s.label} ({Math.round(s.score * 100)} %)</option>)}
                    </select>
                  )}
                  <input name="pick" list="doctor-list" placeholder="…ou chercher un médecin" className="input h-9 min-w-[260px]" />
                  <button className="btn-primary h-9" type="submit">Associer</button>
                </form>
                <div className="mt-2 flex flex-wrap gap-2">
                  <details className="text-[13px]">
                    <summary className="cursor-pointer text-accent-2">Créer le médecin</summary>
                    <form action={createDoctorAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="key" value={g.key} />
                      <label><span className="label block mb-1">Prénom</span><input name="firstName" defaultValue={guess.firstName} className="input h-9" required /></label>
                      <label><span className="label block mb-1">Nom</span><input name="lastName" defaultValue={guess.lastName} className="input h-9" required /></label>
                      <label><span className="label block mb-1">Ville</span><input name="city" defaultValue={g.city ?? ""} className="input h-9" /></label>
                      <label><span className="label block mb-1">Spécialité</span>
                        <select name="specialtyId" className="select h-9" defaultValue={specialties!.rows.find((x) => g.specialty && x.name.toLowerCase().startsWith(g.specialty.toLowerCase().slice(0, 5)))?.id ?? ""}>
                          <option value="">—</option>{specialties!.rows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </label>
                      <button className="btn-ghost h-9" type="submit">Créer et associer</button>
                    </form>
                  </details>
                  <form action={ignoreLabelAction}>
                    <input type="hidden" name="kind" value="DOCTOR" /><input type="hidden" name="key" value={g.key} /><input type="hidden" name="label" value={g.rawName} />
                    <button className="text-[13px] text-muted hover:underline" type="submit">Ignorer</button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {pq && (
        <div className="space-y-2 mt-4">
          <p className="text-[13px] text-muted">{pq.total} libellé(s) produit non rapproché(s). Un produit concurrent s&apos;écarte : il reste compté dans l&apos;ordonnance, sans entrer dans nos analyses.</p>
          <datalist id="product-list">{products!.rows.map((p) => <option key={p.id} value={`${p.label} [${short(p.id)}]`} />)}</datalist>
          {pq.items.length === 0 && <Empty title="File vide" hint="Tous les libellés produit sont rapprochés ou écartés." />}
          {pq.items.map((g) => (
            <Card key={g.key}>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <div className="font-medium flex-1 min-w-[200px]">{g.raw} <span className="text-muted font-normal">· {g.lines} ligne(s)</span></div>
                <form action={resolveProductAction} className="flex gap-2">
                  <input type="hidden" name="key" value={g.key} />
                  <input name="pick" list="product-list" placeholder="Produit du catalogue…" className="input h-9 min-w-[260px]" required />
                  <button className="btn-primary h-9" type="submit">Associer</button>
                </form>
                <form action={ignoreLabelAction}>
                  <input type="hidden" name="kind" value="PRODUCT" /><input type="hidden" name="key" value={g.key} /><input type="hidden" name="label" value={g.raw} />
                  <button className="btn-ghost h-9" type="submit">Concurrent / écarter</button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {phq && (
        <div className="space-y-2 mt-4">
          <p className="text-[13px] text-muted">{phq.total} pharmacie(s) non rapprochée(s) d&apos;un client. L&apos;alias servira aussi aux imports de ventes.</p>
          <datalist id="client-list">{clients!.rows.map((c) => <option key={c.id} value={`${c.label} [${short(c.id)}]`} />)}</datalist>
          {phq.items.length === 0 && <Empty title="File vide" hint="Toutes les pharmacies sont rapprochées ou écartées." />}
          {phq.items.map((g) => (
            <Card key={g.key}>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <div className="font-medium flex-1 min-w-[200px]">{g.raw} <span className="text-muted font-normal">· {g.lines} ligne(s)</span></div>
                <form action={resolvePharmacyAction} className="flex gap-2">
                  <input type="hidden" name="key" value={g.key} />
                  <input name="pick" list="client-list" placeholder="Client…" className="input h-9 min-w-[260px]" required />
                  <button className="btn-primary h-9" type="submit">Associer</button>
                </form>
                <form action={ignoreLabelAction}>
                  <input type="hidden" name="kind" value="PHARMACY" /><input type="hidden" name="key" value={g.key} /><input type="hidden" name="label" value={g.raw} />
                  <button className="btn-ghost h-9" type="submit">Écarter</button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {am && (
        <div className="space-y-2 mt-4">
          <p className="text-[13px] text-muted">Noms rapprochés automatiquement par similarité (score au-dessus du seuil, nettement devant le second candidat). Les moins sûrs en premier.</p>
          {am.length === 0 && <Empty title="Aucun rapprochement automatique" />}
          {am.map((a) => (
            <Card key={a.alias}>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <div className="flex-1 min-w-[240px]">« {a.rawName} » → <Link href={`/medical/medecins/${a.doctorId}`} className="hover:underline font-medium">{a.doctorLabel}</Link> <span className="text-muted">· {a.lines} ligne(s)</span></div>
                {a.score !== null && <Badge tone={a.score >= 0.97 ? "green" : "orange"}>{Math.round(a.score * 100)} %</Badge>}
                <form action={undoAutoMatchAction}>
                  <input type="hidden" name="alias" value={a.alias} />
                  <button className="btn-ghost h-9" type="submit">Défaire</button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function summarizeErrors(errors: { message: string }[]): string {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
  return [...counts].map(([m, n]) => `${m} (${n})`).join(" · ");
}
