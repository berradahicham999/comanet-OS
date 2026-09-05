import Link from "next/link";
import { CheckCircle2, Circle, AlertTriangle, Database, LayoutGrid, Users, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui";
import { getSetupStatus, hasSetupAccess, setupKey, type SetupStatus } from "@/lib/setup";
import { fmtNum } from "@/lib/format";
import { ActionButton, SetupKeyForm, WorkbookUploader } from "./setup-client";
import { applyMigrationsAction, seedBaseAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Installation" };

function Step({ n, title, done, warn, icon, children }: { n: number; title: string; done: boolean; warn?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${done ? "bg-green-soft text-green" : warn ? "bg-orange-soft text-orange" : "bg-accent-soft text-accent"}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label">Étape {n}</span>
            {done ? <Badge tone="green" dot>Fait</Badge> : warn ? <Badge tone="orange" dot>À vérifier</Badge> : <Badge tone="gray" dot>À faire</Badge>}
          </div>
          <h2 className="text-[15px] font-semibold tracking-tight mt-0.5">{title}</h2>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Row({ ok, label, value }: { ok: boolean | null; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] py-1">
      {ok === null ? <Circle size={15} className="text-faint" /> : ok ? <CheckCircle2 size={15} className="text-green" /> : <AlertTriangle size={15} className="text-orange" />}
      <span className="text-ink-2">{label}</span>
      {value !== undefined && <span className="ml-auto font-medium tabular-nums">{value}</span>}
    </div>
  );
}

export default async function InstallationPage() {
  const key = setupKey();
  const access = await hasSetupAccess();
  const status: SetupStatus | null = access ? await getSetupStatus() : null;

  return (
    <main className="flex-1 p-4 sm:p-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-accent text-white flex items-center justify-center font-bold text-lg">C</div>
          <div>
            <div className="font-semibold tracking-tight text-lg leading-tight">COMANET OS — Installation</div>
            <div className="text-xs text-muted">Base de données, schéma, socle et données initiales</div>
          </div>
          <Link href="/login" className="ml-auto text-[13px] text-muted hover:underline">Aller à la connexion →</Link>
        </div>

        {!access && (
          <div className="card card-pad max-w-md">
            {key ? (
              <>
                <h1 className="text-base font-semibold mb-1">Accès réservé</h1>
                <p className="text-sm text-muted mb-4">Entrez la clé d&apos;installation, ou connectez-vous avec un compte Admin.</p>
                <SetupKeyForm />
              </>
            ) : (
              <>
                <h1 className="text-base font-semibold mb-1">Clé d&apos;installation absente</h1>
                <p className="text-sm text-muted">Ajoutez la variable d&apos;environnement <code className="rounded bg-black/5 px-1">SETUP_KEY</code> (8 caractères minimum) chez votre hébergeur, redéployez, puis revenez ici. Un compte Admin déjà connecté a aussi accès à cette page.</p>
              </>
            )}
          </div>
        )}

        {access && status && (
          <div className="space-y-4">
            {!status.connected && (
              <div className="rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">
                <b>Connexion à la base impossible.</b> Vérifiez <code>DATABASE_URL</code> et <code>DATABASE_SSL</code> ({status.host ?? "hôte inconnu"}).<div className="mt-1 text-[12px] opacity-80">{status.error}</div>
              </div>
            )}

            <Step n={1} title="Connexion à la base de données" done={status.connected} warn={!status.connected} icon={<Database size={18} />}>
              <Row ok={status.connected} label="PostgreSQL joignable" value={status.host ?? "—"} />
              <p className="text-[12px] text-faint mt-1">Supabase : chaîne « Transaction pooler » (port 6543) pour l&apos;application, <code>DATABASE_SSL=true</code>.</p>
            </Step>

            <Step n={2} title="Schéma (tables et migrations)" done={status.connected && status.schemaReady && status.migrations.pending.length === 0} warn={status.connected && status.schemaReady && status.migrations.pending.length > 0} icon={<LayoutGrid size={18} />}>
              <Row ok={status.schemaReady} label="Tables présentes" />
              <Row ok={status.migrations.pending.length === 0 && status.schemaReady} label="Migrations appliquées" value={`${status.migrations.applied} / ${status.migrations.available}`} />
              {status.migrations.pending.length > 0 && <p className="text-[12px] text-muted mt-1">En attente : {status.migrations.pending.join(", ")}</p>}
              <div className="mt-3">
                {status.connected && <ActionButton action={applyMigrationsAction} label={!status.schemaReady ? "Créer le schéma" : status.migrations.pending.length > 0 ? "Appliquer les migrations" : "Re-vérifier les migrations"} pendingLabel="Application…" secondary={status.schemaReady && status.migrations.pending.length === 0} />}
              </div>
            </Step>

            <Step n={3} title="Socle : utilisateurs, marques, paramètres" done={status.users > 0 && status.brands > 0 && status.settings} icon={<Users size={18} />}>
              <Row ok={status.users > 0} label="Utilisateurs" value={fmtNum(status.users)} />
              <Row ok={status.brands > 0} label="Marques du portefeuille" value={fmtNum(status.brands)} />
              <Row ok={status.settings} label="Paramètres par défaut (seuils des règles)" />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {status.schemaReady && <ActionButton action={seedBaseAction} label={status.users > 0 ? "Re-vérifier le socle" : "Créer le socle"} pendingLabel="Création…" secondary={status.users > 0} />}
              </div>
              {status.users > 0 && <p className="text-[12px] text-faint mt-2">Comptes créés avec le mot de passe <code>comanet2026</code> — à changer dans Paramètres → Utilisateurs.</p>}
            </Step>

            <Step n={4} title="Données : classeur compilé (ventes, stock, objectifs, budgets)" done={status.sales > 0} icon={<FileSpreadsheet size={18} />}>
              <Row ok={status.sales > 0 ? true : null} label="Lignes de vente" value={fmtNum(status.sales)} />
              <Row ok={status.lastSale ? true : null} label="Dernière vente" value={status.lastSale ?? "—"} />
              <Row ok={status.products > 0 ? true : null} label="Produits / clients" value={`${fmtNum(status.products)} / ${fmtNum(status.clients)}`} />
              <div className="mt-3">
                {status.schemaReady && status.users > 0 ? <WorkbookUploader hasData={status.sales > 0} /> : <p className="text-[12px] text-muted">Terminez d&apos;abord les étapes 2 et 3.</p>}
              </div>
              <p className="text-[12px] text-faint mt-3">Ensuite, les exports mensuels Sage se chargent depuis <b>Imports</b> dans l&apos;application.</p>
            </Step>

            {status.sales > 0 && status.users > 0 && (
              <div className="card card-pad bg-accent-soft/40 border-accent/20">
                <div className="font-semibold">Installation terminée 🎉</div>
                <p className="text-[13px] text-muted mt-1">Connectez-vous avec <code>hicham@comanet.ma</code> / <code>comanet2026</code>, changez les mots de passe (Paramètres → Utilisateurs), puis retirez ou changez <code>SETUP_KEY</code> si vous ne comptez plus utiliser cette page.</p>
                <Link href="/login" className="btn-primary inline-flex mt-3">Ouvrir COMANET OS</Link>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
