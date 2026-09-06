import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAccess } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { hasMetaToken, META_API_VERSION } from "@/lib/meta/client";
import { PageHeader, Card, Section, Badge, Empty, Facts } from "@/components/ui";
import { fmtNum, fmtDate } from "@/lib/format";
import { discoverAdAccounts, setAdAccountSync, syncAdAccountNow, saveAdAccount, saveFxRates } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comptes publicitaires" };

type Account = {
  id: string; name: string; platform: string; external_id: string | null;
  currency: string; timezone: string | null; business_name: string | null;
  brand_id: string | null; brand: string | null;
  sync_enabled: boolean; sync_status: string; last_error: string | null;
  last_sync_at: string | null; rows: number; last_day: string | null;
};

export default async function ComptesPublicitairesPage(props: { searchParams: Promise<{ erreur?: string; decouverts?: string }> }) {
  await requireAccess("marketing");
  // La découverte des comptes rend compte par l'URL : elle s'exécute côté serveur et n'a pas
  // d'autre moyen de parler à cet écran.
  const sp = await props.searchParams;
  const erreur = sp.erreur?.trim() || null;
  const decouverts = sp.decouverts !== undefined ? Number(sp.decouverts) : null;
  const [accountsRes, brands, settings] = await Promise.all([
    db.execute(sql`
      select a.id, a.name, a.platform, a.external_id, a.currency, a.timezone, a.business_name,
             a.brand_id, b.name as brand, a.sync_enabled, a.sync_status, a.last_error,
             a.last_sync_at::text as last_sync_at,
             coalesce((select count(*) from ad_metrics m where m.account_id = a.id), 0)::int as rows,
             (select max(m.date)::text from ad_metrics m where m.account_id = a.id) as last_day
      from ad_accounts a left join brands b on b.id = a.brand_id
      order by a.sync_enabled desc, a.name`),
    listBrands(),
    getSettings(),
  ]);
  const accounts = accountsRes.rows as Account[];
  const tokenOk = hasMetaToken();

  // Une devise sans taux bloque la synchronisation du compte : on le dit avant qu'il échoue.
  const missingRates = [...new Set(accounts.filter((a) => a.sync_enabled).map((a) => a.currency.toUpperCase()))]
    .filter((c) => c !== "MAD" && !(settings.fxRates?.[c] > 0));

  return (
    <>
      <PageHeader
        eyebrow="Marketing Command Center"
        title="Comptes publicitaires"
        subtitle="Connexion en lecture seule à la régie Meta. COMANET OS lit les dépenses et les conversions ; il ne modifie jamais une campagne — mettre en pause ou rebudgéter reste un geste dans Ads Manager."
        actions={<Link href="/marketing/ads" className="btn-secondary btn-sm">Digital Ads</Link>}
      />

      {erreur && (
        <Card className="mb-4 border-red/50">
          <div className="text-[13px]">
            <b className="text-red">La découverte des comptes a échoué.</b>
            <p className="mt-1 text-ink-2">{erreur}</p>
          </div>
        </Card>
      )}

      {decouverts !== null && !Number.isNaN(decouverts) && (
        <Card className={`mb-4 ${decouverts === 0 ? "border-orange/50" : "border-green/50"}`}>
          <div className="text-[13px]">
            {decouverts === 0 ? (
              <>
                <b className="text-orange">Le jeton est valide, mais ne donne accès à aucun compte publicitaire.</b>
                <p className="mt-1 text-ink-2">
                  Dans le Business Manager, ouvrez la fiche de l&apos;utilisateur système qui a émis ce jeton, puis
                  <i> Ajouter des ressources → Comptes publicitaires</i> : cochez les comptes concernés avec le droit
                  « Afficher les performances ». Un jeton ne voit que les comptes qui lui ont été explicitement attribués.
                </p>
              </>
            ) : (
              <>
                <b className="text-green">{fmtNum(decouverts)} compte(s) découvert(s).</b>
                <p className="mt-1 text-ink-2">
                  Aucun n&apos;est activé : la synchronisation reste un choix explicite, chaque compte activé consomme
                  du quota d&apos;API et est relu chaque heure.
                </p>
              </>
            )}
          </div>
        </Card>
      )}

      {!tokenOk && (
        <Card className="mb-4 border-orange/50">
          <div className="text-[13px]">
            <b className="text-orange">Aucun jeton Meta configuré.</b>
            <p className="mt-1 text-ink-2">
              Ajoutez <code className="text-[12px]">META_ACCESS_TOKEN</code> aux variables d&apos;environnement (jeton
              d&apos;utilisateur système, permission <code className="text-[12px]">ads_read</code> uniquement), puis
              redéployez. Le jeton n&apos;est jamais stocké en base de données.
            </p>
            <p className="mt-1 text-faint text-[12px]">
              Un jeton ne couvre que les comptes du Business Manager qui l&apos;a émis. Vos comptes sont répartis sur
              plusieurs businesses : un compte hors périmètre remontera une erreur d&apos;autorisation, sans bloquer les autres.
            </p>
          </div>
        </Card>
      )}

      <Section
        title="Taux de conversion vers le MAD"
        description="Vos comptes Meta facturent en EUR et en USD. Les dépenses sont converties avec le taux saisi ici — jamais avec un taux deviné. Sans taux, la synchronisation du compte concerné est refusée plutôt que d'afficher un montant inventé."
      >
        <Card>
          <form action={saveFxRates} className="flex flex-wrap items-end gap-3 text-[13px]">
            <label className="block">
              <span className="label block mb-1">1 EUR = … MAD</span>
              <input name="fx_EUR" className="input h-9 w-36" placeholder="10.85" defaultValue={settings.fxRates?.EUR ?? ""} />
            </label>
            <label className="block">
              <span className="label block mb-1">1 USD = … MAD</span>
              <input name="fx_USD" className="input h-9 w-36" placeholder="9.90" defaultValue={settings.fxRates?.USD ?? ""} />
            </label>
            <button className="btn-primary btn-sm" type="submit">Enregistrer</button>
            <p className="text-[11.5px] text-faint basis-full">
              Le taux appliqué est conservé sur chaque ligne synchronisée, avec le montant d&apos;origine : un
              changement de taux ne réécrit pas l&apos;historique.
            </p>
          </form>
          {missingRates.length > 0 && (
            <div className="mt-3 rounded-xl border border-orange/40 bg-orange-soft/30 px-3 py-2 text-[12.5px]">
              <b>Synchronisation bloquée</b> — devise(s) sans taux : {missingRates.join(", ")}.
            </div>
          )}
        </Card>
      </Section>

      <Section
        title={`Comptes Meta (${accounts.length})`}
        description="Activez la synchronisation compte par compte : chaque compte activé consomme du quota d'API et est relu chaque nuit."
        action={
          <form action={discoverAdAccounts}>
            <button className="btn-secondary btn-sm" type="submit" disabled={!tokenOk}>Découvrir mes comptes</button>
          </form>
        }
      >
        {accounts.length === 0 ? (
          <Card>
            <Empty
              title="Aucun compte publicitaire déclaré"
              hint={
                <span className="block max-w-2xl">
                  Si le jeton est configuré, « Découvrir mes comptes » interroge Meta et enregistre tous les comptes
                  accessibles, sans en activer aucun. Vous pouvez aussi déclarer un compte à la main ci-dessous —
                  l&apos;identifiant est le numéro visible dans Ads Manager (partie après <code className="text-[12px]">act_</code>).
                </span>
              }
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[14.5px]">{a.name}</span>
                  <Badge tone={a.sync_status === "OK" ? "green" : a.sync_status === "ERROR" ? "red" : "gray"}>
                    {a.sync_status === "OK" ? "synchronisé" : a.sync_status === "ERROR" ? "erreur" : "manuel"}
                  </Badge>
                  {a.sync_enabled && <Badge tone="blue" dot>synchro active</Badge>}
                  {a.currency !== "MAD" && <Badge tone="orange">{a.currency}</Badge>}
                  <span className="ml-auto flex gap-1.5">
                    <form action={setAdAccountSync}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="enabled" value={a.sync_enabled ? "0" : "1"} />
                      <button className="btn-ghost btn-sm" type="submit" disabled={!a.external_id}>
                        {a.sync_enabled ? "Désactiver" : "Activer la synchro"}
                      </button>
                    </form>
                    <form action={syncAdAccountNow}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn-secondary btn-sm" type="submit" disabled={!tokenOk || !a.external_id}>Synchroniser</button>
                    </form>
                  </span>
                </div>

                <div className="mt-3">
                  <Facts
                    cols={4}
                    items={[
                      { label: "Identifiant", value: a.external_id ? `act_${a.external_id}` : "—" },
                      { label: "Business", value: a.business_name ?? "—" },
                      { label: "Fuseau du compte", value: a.timezone ?? "—" },
                      { label: "Marque par défaut", value: a.brand ?? "— (déduite du nom de campagne)" },
                      { label: "Lignes en base", value: fmtNum(a.rows) },
                      { label: "Dernier jour couvert", value: a.last_day ? fmtDate(a.last_day) : "—" },
                      { label: "Dernière synchro", value: a.last_sync_at ? fmtDate(a.last_sync_at.slice(0, 10)) : "—" },
                      { label: "Devise", value: a.currency },
                    ]}
                  />
                </div>

                {a.last_error && (
                  <div className="mt-3 rounded-xl border border-red/40 bg-red-soft/30 px-3 py-2 text-[12.5px]">{a.last_error}</div>
                )}

                <form action={saveAdAccount} className="mt-3 flex flex-wrap items-end gap-2 text-[13px] border-t border-line pt-3">
                  <input type="hidden" name="name" value={a.name} />
                  <input type="hidden" name="currency" value={a.currency} />
                  <label className="block">
                    <span className="label block mb-1">Identifiant du compte</span>
                    <input name="externalId" className="input h-9 w-52" defaultValue={a.external_id ?? ""} placeholder="1174521700705307" required />
                  </label>
                  <label className="block">
                    <span className="label block mb-1">Marque par défaut</span>
                    <select name="brandId" className="select h-9" defaultValue={a.brand_id ?? ""}>
                      <option value="">— déduite du nom de campagne —</option>
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 h-9">
                    <input type="checkbox" name="syncEnabled" defaultChecked={a.sync_enabled} />
                    <span>Synchroniser chaque nuit</span>
                  </label>
                  <button className="btn-ghost btn-sm" type="submit">Enregistrer</button>
                </form>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Déclarer un compte à la main" description="Utile si le jeton ne couvre pas encore le business propriétaire du compte.">
        <Card>
          <form action={saveAdAccount} className="flex flex-wrap items-end gap-2 text-[13px]">
            <label className="block">
              <span className="label block mb-1">Nom *</span>
              <input name="name" className="input h-9 w-56" placeholder="COMANET MOROCCO" required />
            </label>
            <label className="block">
              <span className="label block mb-1">Identifiant (act_…) *</span>
              <input name="externalId" className="input h-9 w-52" placeholder="1174521700705307" required />
            </label>
            <label className="block">
              <span className="label block mb-1">Devise</span>
              <select name="currency" className="select h-9" defaultValue="EUR">
                <option value="MAD">MAD</option><option value="EUR">EUR</option><option value="USD">USD</option>
              </select>
            </label>
            <label className="block">
              <span className="label block mb-1">Marque par défaut</span>
              <select name="brandId" className="select h-9">
                <option value="">— déduite du nom de campagne —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <button className="btn-primary btn-sm" type="submit">Ajouter</button>
          </form>
        </Card>
      </Section>

      <Section title="Comment la synchronisation fonctionne">
        <Card>
          <ul className="text-[12.5px] text-ink-2 space-y-1.5 list-disc pl-4">
            <li><b>Chaque nuit à 6 h</b>, les comptes activés sont relus sur une fenêtre glissante de {settings.metaSyncWindowDays} jours — Meta révise ses conversions plusieurs jours après coup, une lecture de la seule veille figerait des chiffres faux.</li>
            <li><b>La journée en cours n&apos;est jamais comptée</b> : incomplète, elle gonflerait artificiellement le coût par achat.</li>
            <li><b>Fenêtre d&apos;attribution</b> : {settings.metaAttributionWindow}. Deux périodes ne sont comparables qu&apos;à fenêtre égale.</li>
            <li><b>Le CA remonté par Meta est du CA mesuré</b> (valeur de conversion de la régie), pas une estimation. Il reste distinct du CA facturé qui vient de Sage.</li>
            <li><b>Les journées couvertes par l&apos;API remplacent</b> les lignes du même compte issues d&apos;un import de fichier : elles décriraient les mêmes jours en double.</li>
            <li><b>Lecture seule</b> — version d&apos;API {META_API_VERSION}, permission <code className="text-[12px]">ads_read</code>.</li>
          </ul>
        </Card>
      </Section>
    </>
  );
}
