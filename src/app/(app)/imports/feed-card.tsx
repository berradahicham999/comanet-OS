import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { Card, Badge, type Tone } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { readSalesFeedState, salesFeedUrl, type SalesFeedStatus } from "@/lib/import/sales-feed";
import { feedActive } from "@/lib/import/sales-feed-shared";
import { fmtAgo, fmtDate, fmtMAD, fmtNum, fmtTime } from "@/lib/format";
import { saveSalesFeedAction, syncSalesFeedAction } from "./actions";

const STATUS: Record<SalesFeedStatus, { label: string; tone: Tone }> = {
  UPDATED: { label: "Ventes mises à jour", tone: "green" },
  UNCHANGED: { label: "À jour", tone: "green" },
  DRY_RUN: { label: "Essai à blanc", tone: "blue" },
  REFUSED: { label: "Fichier refusé", tone: "orange" },
  ERROR: { label: "Erreur", tone: "red" },
  NO_URL: { label: "Lien manquant", tone: "red" },
  DISABLED: { label: "Désactivé", tone: "gray" },
};

/**
 * Flux automatique (Pharmafirst → Auracos) : état de la dernière relecture, synchro manuelle, réglage.
 * Le lien de partage n'est jamais affiché : il vit dans `SALES_FEED_URL` (Vercel).
 */
export async function SalesFeedCard({ canSync, isAdmin }: { canSync: boolean; isAdmin: boolean }) {
  const [settings, state, brandList] = await Promise.all([
    getSettings(),
    readSalesFeedState(),
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name)),
  ]);
  const feed = settings.salesFeed;
  const active = feedActive(feed);
  const hasUrl = !!salesFeedUrl();
  const brandName = brandList.find((b) => b.id === feed.brandId)?.name ?? "—";
  const status = state ? STATUS[state.status] : null;
  return (
    <Card title="Flux automatique" action={<Badge tone={active ? "green" : "gray"} dot>{active ? "Actif" : "Inactif"}</Badge>}>
      <p className="text-[12px] text-muted">
        Fichier partagé par un prestataire, relu chaque heure (à la demie). À partir de la date de départ, les ventes du site
        <b className="text-ink-2"> {feed.site}</b> pour <b className="text-ink-2">{brandName}</b> sont exactement celles du fichier :
        une ligne corrigée ou annulée chez lui l&apos;est aussi ici, et l&apos;import manuel ignore ces lignes.
      </p>
      {!hasUrl && (
        <p className="mt-3 rounded-xl bg-orange-soft border border-orange/30 px-3 py-2 text-[12px] text-orange">
          Lien de partage absent : ajoutez la variable <code>SALES_FEED_URL</code> dans Vercel (Settings → Environment Variables), puis redéployez.
          Le fichier doit être partagé en « Tous les utilisateurs disposant du lien — Lecteur ».
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <dt className="text-muted">Dernière relecture</dt>
        <dd>{state ? <>{fmtAgo(state.checkedAt)} <span className="text-muted">({state.trigger === "CRON" ? "auto" : "manuelle"})</span></> : "jamais"}</dd>
        <dt className="text-muted">Résultat</dt>
        <dd>{status ? <Badge tone={status.tone}>{status.label}</Badge> : "—"}</dd>
        <dt className="text-muted">Fichier du prestataire</dt>
        <dd>{state?.stamp ?? "—"}</dd>
        <dt className="text-muted">Ventes du fichier</dt>
        <dd>{state?.lines != null ? <>{fmtNum(state.lines)} ligne(s) · {fmtMAD(state.amount)} HT</> : "—"}</dd>
        <dt className="text-muted">Dernière modification</dt>
        <dd>{state?.changedAt ? (state.importId ? <Link className="hover:underline" href={`/imports/${state.importId}`}>{fmtDate(state.changedAt)} à {fmtTime(state.changedAt)}</Link> : `${fmtDate(state.changedAt)} à ${fmtTime(state.changedAt)}`) : "—"}</dd>
      </dl>
      {state && state.status !== "UNCHANGED" && state.status !== "UPDATED" && <p className="mt-2 text-[12px] text-ink-2">{state.message}</p>}

      {canSync && active && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={syncSalesFeedAction}><input type="hidden" name="mode" value="sync" /><button className="btn-primary btn-sm" type="submit">Synchroniser maintenant</button></form>
          <form action={syncSalesFeedAction}><input type="hidden" name="mode" value="dry" /><button className="btn-ghost btn-sm" type="submit">Essai à blanc</button></form>
          {isAdmin && state?.status === "REFUSED" && (
            <form action={syncSalesFeedAction}><input type="hidden" name="mode" value="force" /><button className="btn-secondary btn-sm" type="submit">Forcer malgré le garde-fou</button></form>
          )}
        </div>
      )}

      {isAdmin && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] font-medium text-ink-2">Réglage du flux</summary>
          <form action={saveSalesFeedAction} className="mt-3 space-y-2.5 text-[12px]">
            <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={feed.enabled} /> Flux actif</label>
            <label className="block">Marque
              <select name="brandId" className="input h-9 mt-1 w-full" defaultValue={feed.brandId ?? ""}>
                <option value="">—</option>
                {brandList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Site<input name="site" className="input h-9 mt-1 w-full" defaultValue={feed.site} /></label>
              <label className="block">À partir du<input type="date" name="from" className="input h-9 mt-1 w-full" defaultValue={feed.from ?? ""} /></label>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" name="excludeSamples" defaultChecked={feed.excludeSamples} /> Exclure les échantillons gratuits (0 DH)</label>
            <label className="block">Garde-fou : refuser un fichier qui fait baisser le CA de plus de
              <span className="flex items-center gap-1 mt-1"><input type="number" name="maxDropPct" min={0} max={100} className="input h-9 w-20" defaultValue={feed.maxDropPct} /> %</span>
            </label>
            <p className="text-muted">À l&apos;activation, rien ne change tant que la synchro suivante n&apos;a pas tourné : faites d&apos;abord un essai à blanc.</p>
            <button className="btn-secondary btn-sm" type="submit">Enregistrer</button>
          </form>
        </details>
      )}
    </Card>
  );
}
