import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { gestionRefs } from "@/lib/gestion/refs";
import { listSeries } from "@/lib/gestion/numbering";
import { COMPANY_FIELDS } from "@/lib/gestion/readiness";
import { fmtMoney } from "@/lib/gestion/money";
import { iso, today, fmtDate } from "@/lib/format";
import { PageHeader, Card, Badge, Tabs } from "@/components/ui";
import {
  saveCompanyAction, uploadCompanyFileAction, savePoliciesAction, saveTaxRateAction, savePaymentModeAction, saveWarehouseAction, saveSeriesAction, setNextNumberAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres — Gestion commerciale" };

export default async function GestionSettingsPage(props: { searchParams: Promise<{ error?: string; done?: string; year?: string }> }) {
  await requireAccess("administration");
  const sp = await props.searchParams;
  const thisYear = Number(iso(today()).slice(0, 4));
  const year = Number(sp.year) >= 2020 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const [settings, refs, series, files, usage] = await Promise.all([
    getSettings(), gestionRefs(), listSeries(year),
    db.execute<{ slot: string; version: number; created_at: Date }>(sql`select distinct on (company_slot) company_slot as slot, version, created_at from content_assets where company_slot is not null order by company_slot, version desc`),
    db.execute<{ kind: string; key: string; n: number }>(sql`
      select 'tax' as kind, tax_rate_key as key, count(*)::int as n from products where tax_rate_key is not null group by tax_rate_key
      union all select 'mode', payment_mode_key, count(*)::int from clients where payment_mode_key is not null group by payment_mode_key
      union all select 'wh', warehouse_key, count(*)::int from stock_movements group by warehouse_key`),
  ]);
  const g = settings.gestion;
  const used = new Map(usage.rows.map((u) => [`${u.kind}:${u.key}`, u.n]));
  const file = new Map(files.rows.map((f) => [f.slot, f]));

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paramètres" subtitle="Gestion commerciale : identité de la société imprimée sur les pièces, TVA, modes de paiement, dépôts, numérotation, politiques et bascule depuis Sage. Rien n'est codé en dur.">
        <Tabs current="/parametres/gestion" tabs={[{ href: "/parametres?tab=regles", label: "Règles & seuils" }, { href: "/parametres?tab=objectifs", label: "Objectifs" }, { href: "/parametres/utilisateurs", label: "Utilisateurs & droits" }, { href: "/parametres/modeles", label: "Modèles de rôle" }, { href: "/parametres/contenus", label: "Contenus" }, { href: "/parametres/activations", label: "Activations" }, { href: "/parametres/gestion", label: "Gestion commerciale" }, { href: "/parametres?tab=demo", label: "Données de démo" }]} />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      {sp.done && <div className="mb-4 rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[13px] text-green">Enregistré.</div>}

      <div className="grid lg:grid-cols-[1fr_360px] gap-4 mb-4">
        <Card title="Société — mentions imprimées sur les pièces">
          <form id="societe" action={saveCompanyAction} className="grid sm:grid-cols-2 gap-2 text-[13px] scroll-mt-20">
            {COMPANY_FIELDS.map((f) => (
              <label key={f.key} className={f.key === "address" || f.key === "rib" ? "block sm:col-span-2" : "block"}>
                <span className="label block mb-1">{f.label}{f.required && " *"}</span>
                <input name={f.key} defaultValue={g.company[f.key]} className={`input h-9 ${f.key === "rib" || f.key === "ice" ? "font-mono" : ""}`} placeholder={f.key === "capital" ? "100.000,00 Dirhams" : f.key === "rib" ? "RIB complet (24 chiffres)" : undefined} />
              </label>
            ))}
            <div className="sm:col-span-2"><button className="btn-primary btn-sm" type="submit">Enregistrer l&apos;identité</button></div>
          </form>
          <p className="text-[11.5px] text-faint mt-2">Ces informations vivent en base, pas dans le code. Une pièce validée en garde une copie figée : les modifier plus tard ne change aucune facture émise.</p>
        </Card>
        <Card title="Logo et cachet">
          <div className="space-y-4 text-[13px]">
            {(["LOGO", "CACHET"] as const).map((slot) => {
              const f = file.get(slot);
              return (
                <form key={slot} action={uploadCompanyFileAction} className="space-y-2">
                  <input type="hidden" name="slot" value={slot} />
                  <div className="flex items-center justify-between"><b>{slot === "LOGO" ? "Logo" : "Cachet et signature"}</b>{f ? <Badge tone="green">v{f.version} · {fmtDate(f.created_at)}</Badge> : <Badge tone="orange">manquant</Badge>}</div>
                  {f && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/parametres/gestion/fichier/${slot}?v=${f.version}`} alt={slot === "LOGO" ? "Logo de la société" : "Cachet de la société"} className="max-h-28 rounded-lg border border-line bg-white p-2" />
                  )}
                  <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="block text-[12px]" required />
                  <button className="btn-secondary btn-sm" type="submit">{f ? "Remplacer" : "Téléverser"}</button>
                </form>
              );
            })}
            <p className="text-[11.5px] text-faint">Le cachet signé n&apos;est visible que des administrateurs et ne sera imprimé que sur les pièces validées (lot 2).</p>
          </div>
        </Card>
      </div>

      <Card title="Politiques et bascule" className="mb-4">
        <form id="politiques" action={savePoliciesAction} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[13px] scroll-mt-20">
          <label className="block"><span className="label block mb-1">TVA par défaut des articles</span>
            <select name="defaultTaxRateKey" defaultValue={g.defaultTaxRateKey} className="select h-9">{refs.taxRates.filter((r) => r.active).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
          </label>
          <label className="block"><span className="label block mb-1">Délai de paiement par défaut (j)</span><input name="defaultPaymentDays" defaultValue={g.defaultPaymentDays} className="input h-9" inputMode="numeric" /></label>
          <label className="block"><span className="label block mb-1">Plafond du délai de paiement (j)</span><input name="maxPaymentDays" defaultValue={g.maxPaymentDays} className="input h-9" inputMode="numeric" /><span className="text-[11px] text-faint">À faire confirmer par le comptable</span></label>
          <label className="block"><span className="label block mb-1">Stock insuffisant à la sortie</span>
            <select name="insufficientStock" defaultValue={g.insufficientStock} className="select h-9"><option value="BLOCK">Bloquer</option><option value="WARN">Alerter seulement</option></select>
          </label>
          <label className="block"><span className="label block mb-1">Alerte péremption (jours)</span><input name="expiryAlertDays" defaultValue={g.expiryAlertDays} className="input h-9" inputMode="numeric" /></label>
          <label className="block"><span className="label block mb-1">Fenêtre de préparation (jours)</span><input name="readinessWindowDays" defaultValue={g.readinessWindowDays} className="input h-9" inputMode="numeric" /><span className="text-[11px] text-faint">Clients et articles vendus à préparer</span></label>
          <label className="block"><span className="label block mb-1">Date de bascule prévue</span><input type="date" name="cutoverDate" defaultValue={g.cutover.date ?? ""} className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">Sites qui basculent</span><input name="cutoverSites" defaultValue={g.cutover.sites.join(", ")} className="input h-9" /><span className="text-[11px] text-faint">Les autres sites restent importés</span></label>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary btn-sm" type="submit">Enregistrer</button>
            <span className="text-[12px] text-muted">Mode actuel : <Badge tone="gray">Sage fait foi</Badge> — la période parallèle et la bascule s&apos;activeront avec les lots 2 et 5.</span>
          </div>
        </form>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title="Taux de TVA">
          <div id="tva" className="space-y-1 text-[12.5px] scroll-mt-20">
            {refs.taxRates.map((r) => (
              <form key={r.key} action={saveTaxRateAction} className="grid grid-cols-[50px_1fr_70px_40px_44px_auto] items-center gap-1">
                <input type="hidden" name="key" value={r.key} />
                <input name="sort" defaultValue={r.sort} className="input h-8 text-[12px]" />
                <input name="label" defaultValue={r.label} className="input h-8 text-[12px]" />
                <input name="rate" defaultValue={fmtMoney(r.rate)} className="input h-8 text-[12px] text-right" />
                <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={r.active} /></label>
                <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                <span className="text-[11px] text-muted whitespace-nowrap">{used.get(`tax:${r.key}`) ? `${used.get(`tax:${r.key}`)} art.` : ""}</span>
              </form>
            ))}
            <form action={saveTaxRateAction} className="grid grid-cols-[50px_1fr_70px_40px_auto] items-center gap-1 pt-1">
              <input name="sort" defaultValue={refs.taxRates.length * 10 + 10} className="input h-8 text-[12px]" />
              <input name="label" placeholder="Libellé (ex. TVA 10 %)" className="input h-8 text-[12px]" required />
              <input name="rate" placeholder="%" className="input h-8 text-[12px] text-right" required />
              <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
              <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
            </form>
            <p className="text-[11px] text-faint pt-1">Une pièce copie le taux sur chaque ligne : changer un taux ici ne modifie aucune pièce émise.</p>
          </div>
        </Card>
        <Card title="Modes de paiement">
          <div id="paiement" className="space-y-1 text-[12.5px] scroll-mt-20">
            {refs.paymentModes.map((m) => (
              <form key={m.key} action={savePaymentModeAction} className="grid grid-cols-[50px_1fr_auto_40px_44px_auto] items-center gap-1">
                <input type="hidden" name="key" value={m.key} />
                <input name="sort" defaultValue={m.sort} className="input h-8 text-[12px]" />
                <input name="label" defaultValue={m.label} className="input h-8 text-[12px]" />
                <label className="flex items-center gap-1 text-[11px]" title="Le règlement porte sa propre échéance"><input type="checkbox" name="requiresDueDate" defaultChecked={m.requiresDueDate} /> échéance</label>
                <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={m.active} /></label>
                <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
                <span className="text-[11px] text-muted">{used.get(`mode:${m.key}`) ? `${used.get(`mode:${m.key}`)} cl.` : ""}</span>
              </form>
            ))}
            <form action={savePaymentModeAction} className="grid grid-cols-[50px_1fr_auto_40px_auto] items-center gap-1 pt-1">
              <input name="sort" defaultValue={refs.paymentModes.length * 10 + 10} className="input h-8 text-[12px]" />
              <input name="label" placeholder="Libellé" className="input h-8 text-[12px]" required />
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" name="requiresDueDate" /> échéance</label>
              <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
              <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
            </form>
          </div>
        </Card>
      </div>

      <Card title="Dépôts" className="mb-4">
        <div id="depots" className="space-y-1 text-[12.5px] scroll-mt-20">
          <div className="hidden md:grid grid-cols-[50px_1fr_110px_90px_1.2fr_40px_44px_auto] gap-1 text-[10.5px] uppercase tracking-wide text-faint px-1"><span>Ordre</span><span>Libellé</span><span>Nature</span><span>Vendable</span><span>Note</span><span>Actif</span><span /><span /></div>
          {refs.warehouses.map((w) => (
            <form key={w.key} action={saveWarehouseAction} className="grid grid-cols-2 md:grid-cols-[50px_1fr_110px_90px_1.2fr_40px_44px_auto] items-center gap-1">
              <input type="hidden" name="key" value={w.key} />
              <input name="sort" defaultValue={w.sort} className="input h-8 text-[12px]" />
              <input name="label" defaultValue={w.label} className="input h-8 text-[12px]" />
              <select name="kind" defaultValue={w.kind} className="select h-8 text-[12px]"><option value="INTERNE">Interne (journal)</option><option value="EXTERNE">Externe (photo)</option></select>
              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" name="sellable" defaultChecked={w.sellable} /> vendable</label>
              <input name="notes" defaultValue={w.notes ?? ""} className="input h-8 text-[12px]" />
              <label className="text-center" title="Actif"><input type="checkbox" name="active" defaultChecked={w.active} /></label>
              <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
              <span className="text-[11px] text-muted whitespace-nowrap">{used.get(`wh:${w.key}`) ? `${used.get(`wh:${w.key}`)} mvt` : ""}</span>
            </form>
          ))}
          <form action={saveWarehouseAction} className="grid grid-cols-2 md:grid-cols-[50px_1fr_110px_90px_1.2fr_40px_auto] items-center gap-1 pt-1">
            <input name="sort" defaultValue={refs.warehouses.length * 10 + 10} className="input h-8 text-[12px]" />
            <input name="label" placeholder="Libellé du dépôt" className="input h-8 text-[12px]" required />
            <select name="kind" defaultValue="INTERNE" className="select h-8 text-[12px]"><option value="INTERNE">Interne (journal)</option><option value="EXTERNE">Externe (photo)</option></select>
            <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" name="sellable" defaultChecked /> vendable</label>
            <input name="notes" placeholder="Note" className="input h-8 text-[12px]" />
            <label className="text-center"><input type="checkbox" name="active" defaultChecked /></label>
            <button className="btn-primary btn-sm text-[11px]" type="submit">Ajouter</button>
          </form>
          <p className="text-[11px] text-faint pt-1">Interne : stock suivi mouvement par mouvement. Externe : stock confié à un distributeur (Cospharma, Pharmafirst), mis à jour par import de photo. Un dépôt qui a des mouvements ne change plus de nature.</p>
        </div>
      </Card>

      <Card title={`Numérotation des pièces — ${year}`} action={<span className="flex gap-2 text-[12px]">{[thisYear, thisYear + 1].map((y) => <a key={y} href={`/parametres/gestion?year=${y}#numerotation`} className={y === year ? "font-semibold" : "text-accent"}>{y}</a>)}</span>}>
        <div id="numerotation" className="space-y-2 text-[12.5px] scroll-mt-20">
          <p className="text-muted">Jetons : <code>{"{AAAA}"}</code> année, <code>{"{AA}"}</code> année sur 2 chiffres, <code>{"{MM}"}</code> mois, <code>{"{N:5}"}</code> compteur sur 5 chiffres. <code>FA{"{AAAA}{N:5}"}</code> donne FA{year}00001, le format actuel de Sage. Le compteur repart à 1 chaque année.</p>
          {series.map((s) => (
            <div key={s.key} className="grid md:grid-cols-[1fr_auto] gap-2 items-center border-b border-line pb-2 last:border-0">
              <form action={saveSeriesAction} className="grid grid-cols-[40px_1fr_170px_40px_44px] items-center gap-1">
                <input type="hidden" name="key" value={s.key} />
                <span className="font-mono text-[11px] text-muted">{s.key}</span>
                <input name="label" defaultValue={s.label} className="input h-8 text-[12px]" />
                <input name="pattern" defaultValue={s.pattern} className="input h-8 text-[12px] font-mono" />
                <label className="text-center" title="Active"><input type="checkbox" name="active" defaultChecked={s.active} /></label>
                <button className="btn-ghost btn-sm text-[11px]" type="submit">OK</button>
              </form>
              <form action={setNextNumberAction} className="flex items-center gap-1">
                <input type="hidden" name="key" value={s.key} /><input type="hidden" name="year" value={year} />
                <span className="text-muted whitespace-nowrap">prochain : <b className="font-mono text-ink">{s.next ?? "—"}</b></span>
                {s.issuedMax === 0 ? (
                  <>
                    <input name="next" defaultValue={s.lastValue + 1} className="input h-8 w-24 text-[12px] text-right" inputMode="numeric" />
                    <button className="btn-secondary btn-sm text-[11px]" type="submit">Régler</button>
                  </>
                ) : <Badge tone="gray">{s.issuedMax} émis — figé</Badge>}
              </form>
            </div>
          ))}
          <p className="text-[11px] text-faint">Reprise de Sage : réglez le prochain numéro de chaque série (ex. 262 si la dernière facture Sage est FA{year}00261) tant qu&apos;aucune pièce n&apos;a été numérotée dans l&apos;année. Ensuite, la série est continue et ne se règle plus.</p>
        </div>
      </Card>
    </>
  );
}
