/**
 * Flux de ventes automatique (Pharmafirst → Auracos) : relit le fichier partagé du prestataire et rend les ventes
 * du site × marque exactement égales à son contenu, sur les années qu'il couvre et à partir de `settings.salesFeed.from`.
 *
 * Seule écriture des ventes du flux (`sales.line_hash` préfixé `FEED:`). Appelée par le cron horaire
 * `/api/cron/sales-feed` et par « Synchroniser maintenant » (page Imports).
 *
 *  · Remplacement, pas ajout : une ligne corrigée ou annulée chez le prestataire l'est aussi ici, et les lignes
 *    de l'import manuel sur la même fenêtre sont retirées (sinon elles compteraient deux fois).
 *  · Seules les différences s'écrivent : un fichier inchangé ne touche à rien et ne crée aucun import.
 *  · Garde-fou : un fichier qui ferait chuter le CA de la fenêtre au-delà de `maxDropPct` est refusé.
 *  · Le lien vit dans `SALES_FEED_URL` (variable d'environnement), jamais en base ni dans le code.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSettings, saveSettings, type SalesFeedSettings } from "@/lib/settings";
import { audit, type AuditActor } from "@/lib/audit";
import { refreshMarketingFacts } from "@/lib/analytics-marketing/refresh";
import { Resolver } from "./run";
import {
  feedActive, feedClientName, feedDownloadUrls, feedDropMessage, feedLineKeys, feedWindow, looksLikeXlsx, parseFeedWorkbook,
} from "./sales-feed-shared";

export const SALES_FEED_STATE_KEY = "sales-feed.state";

export type SalesFeedStatus = "DISABLED" | "NO_URL" | "UNCHANGED" | "UPDATED" | "REFUSED" | "ERROR" | "DRY_RUN";

export type SalesFeedResult = {
  ok: boolean;
  status: SalesFeedStatus;
  message: string;
  /** Heure de mise à jour écrite dans le fichier par le prestataire. */
  stamp?: string | null;
  window?: { from: string; to: string } | null;
  /** Lignes de vente retenues (échantillons exclus selon le réglage). */
  lines?: number;
  samples?: number;
  inserted?: number;
  deleted?: number;
  amountBefore?: number;
  amountAfter?: number;
  importId?: string | null;
  createdClients?: string[];
  errors?: { row: number; message: string }[];
};

export type SalesFeedState = {
  checkedAt: string;
  trigger: "CRON" | "MANUEL";
  status: SalesFeedStatus;
  message: string;
  stamp: string | null;
  lines: number | null;
  amount: number | null;
  /** Dernière synchro qui a modifié les ventes. */
  changedAt: string | null;
  importId: string | null;
};

export function salesFeedUrl(): string | null {
  return process.env.SALES_FEED_URL?.trim() || null;
}

export async function readSalesFeedState(): Promise<SalesFeedState | null> {
  const row = await db.query.settings.findFirst({ where: eq(s.settings.key, SALES_FEED_STATE_KEY) });
  return (row?.value as SalesFeedState | undefined) ?? null;
}

async function writeState(trigger: "CRON" | "MANUEL", r: SalesFeedResult) {
  const prev = await readSalesFeedState();
  const changed = r.status === "UPDATED";
  const value: SalesFeedState = {
    checkedAt: new Date().toISOString(), trigger, status: r.status, message: r.message, stamp: r.stamp ?? prev?.stamp ?? null,
    lines: r.lines ?? prev?.lines ?? null, amount: r.amountAfter ?? prev?.amount ?? null,
    changedAt: changed ? new Date().toISOString() : prev?.changedAt ?? null, importId: changed ? r.importId ?? null : prev?.importId ?? null,
  };
  await db.insert(s.settings).values({ key: SALES_FEED_STATE_KEY, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } });
}

/** Télécharge le fichier partagé ; une page de connexion Google (lien non partagé) est refusée avec une explication. */
export async function downloadFeed(link: string): Promise<Uint8Array> {
  let lastError = "";
  for (const url of feedDownloadUrls(link)) {
    try {
      const res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const data = new Uint8Array(await res.arrayBuffer());
      if (looksLikeXlsx(data)) return data;
      lastError = "la réponse n'est pas un fichier Excel";
    } catch (e) {
      lastError = String((e as Error).message ?? e);
    }
  }
  throw new Error(`Fichier inaccessible (${lastError}). Le partage doit être « Tous les utilisateurs disposant du lien — Lecteur ».`);
}

type ExistingRow = { id: string; line_hash: string; amount: string };

/**
 * Synchronise le flux. `dryRun` : calcule tout (lecture, rapprochement, différences, garde-fou) sans rien écrire ni
 * créer de client. `force` : passe outre le garde-fou de baisse (synchro manuelle seulement).
 */
export async function syncSalesFeed(opts: { trigger: "CRON" | "MANUEL"; userId?: string | null; dryRun?: boolean; force?: boolean; data?: Uint8Array }): Promise<SalesFeedResult> {
  const feed: SalesFeedSettings = (await getSettings()).salesFeed;
  const done = async (r: SalesFeedResult) => { if (!opts.dryRun) await writeState(opts.trigger, r); return r; };
  if (!feedActive(feed)) return { ok: true, status: "DISABLED", message: "Flux désactivé (Imports → Flux automatique)." };
  const link = salesFeedUrl();
  if (!opts.data && !link) return done({ ok: false, status: "NO_URL", message: "Variable d'environnement SALES_FEED_URL absente : ajoutez le lien de partage dans Vercel." });

  try {
    const parsed = parseFeedWorkbook(opts.data ?? await downloadFeed(link!));
    const window = feedWindow(parsed.years, feed.from!);
    if (!window) return done({ ok: true, status: "UNCHANGED", message: "Le fichier couvre une période antérieure au démarrage du flux.", stamp: parsed.stamp });
    const inWindow = parsed.lines.filter((l) => l.date >= window.from && l.date <= window.to);
    const kept = feed.excludeSamples ? inWindow.filter((l) => !l.isSample) : inWindow;
    const samples = inWindow.length - kept.length;
    if (!kept.length) return done({ ok: false, status: "REFUSED", message: "Fichier sans aucune ligne de vente sur la période : rien n'a été modifié.", stamp: parsed.stamp, window, errors: parsed.errors });

    const R = new Resolver(0.75, null);
    await R.load();
    // Produit : celui du titre de l'onglet (ou de la colonne Produit), rapproché sans création et vérifié sur la marque.
    const productIds = new Map<string, string>();
    for (const label of new Set(kept.map((l) => l.product))) {
      const id = await R.product(label, null, feed.brandId, false);
      const brandId = id ? R.products.find((p) => p.id === id)?.brandId : null;
      if (!id || brandId !== feed.brandId) {
        return done({ ok: false, status: "ERROR", message: `Produit « ${label} » introuvable dans la marque du flux : rattachez cette désignation au bon produit (fiche produit, alias) puis relancez.`, stamp: parsed.stamp, window });
      }
      productIds.set(label, id);
    }

    // Clients : rapprochés par nom (alias compris). Les inconnus ne sont créés (« à vérifier ») qu'au moment
    // d'écrire : ni en essai à blanc, ni quand le garde-fou refuse le fichier.
    const clientIds = new Map<string, string | null>();
    const cityOf = new Map<string, string | null>();
    for (const l of kept) {
      const name = feedClientName(l.client);
      if (clientIds.has(name)) continue;
      cityOf.set(name, l.city);
      clientIds.set(name, await R.client(null, name, null, l.city, false));
    }
    const unresolved = [...clientIds].filter(([, id]) => !id).map(([n]) => n);

    const keys = feedLineKeys(feed.site, kept);
    const desired = kept.map((l, i) => {
      return {
        lineHash: keys[i], date: l.date, clientName: feedClientName(l.client), productId: productIds.get(l.product)!, quantity: l.quantity.toFixed(2), amount: l.amount.toFixed(2),
        invoiceRef: null as string | null, lvcRef: l.piece, site: feed.site.toUpperCase(), salesRep: l.rep,
        unitPrice: l.quantity !== 0 ? (l.amount / l.quantity).toFixed(4) : null, rawClient: l.client, rawProduct: l.product, source: "SAGE",
      };
    });

    const existing = (await db.execute<ExistingRow>(sql`
      select s.id::text as id, s.line_hash, s.amount::text as amount
      from sales s join products p on p.id = s.product_id
      where upper(s.site) = ${feed.site.toUpperCase()} and p.brand_id = ${feed.brandId}::uuid
        and s.date between ${window.from}::date and ${window.to}::date and s.source <> 'COMANET_OS'`)).rows;
    const wanted = new Set(keys);
    const have = new Set(existing.map((e) => e.line_hash));
    const toDelete = existing.filter((e) => !wanted.has(e.line_hash));
    const toInsert = desired.filter((d) => !have.has(d.lineHash));
    const amountBefore = existing.reduce((a, e) => a + Number(e.amount), 0);
    const amountAfter = kept.reduce((a, l) => a + l.amount, 0);
    const base = { stamp: parsed.stamp, window, lines: kept.length, samples, amountBefore, amountAfter, createdClients: unresolved, errors: parsed.errors };

    if (!toDelete.length && !toInsert.length) {
      return done({ ok: true, status: "UNCHANGED", message: "Fichier identique aux ventes enregistrées.", ...base, inserted: 0, deleted: 0 });
    }
    const drop = feedDropMessage(amountBefore, amountAfter, feed.maxDropPct);
    if (drop && !opts.force) return done({ ok: false, status: "REFUSED", message: drop, ...base, inserted: 0, deleted: 0 });
    if (opts.dryRun) {
      return { ok: true, status: "DRY_RUN", message: `Essai à blanc : ${toInsert.length} ligne(s) à ajouter, ${toDelete.length} à retirer.${unresolved.length ? ` ${unresolved.length} client(s) seraient créés.` : ""}`, ...base, inserted: toInsert.length, deleted: toDelete.length };
    }
    for (const name of unresolved) clientIds.set(name, await R.client(null, name, null, cityOf.get(name) ?? null, true));
    const missingClient = toInsert.find((d) => !clientIds.get(d.clientName));
    if (missingClient) return done({ ok: false, status: "ERROR", message: `Client non résolu : ${missingClient.rawClient}`, ...base });
    const createdClients = unresolved;

    const warnings = [
      `Flux automatique ${feed.site} : ventes du ${window.from.split("-").reverse().join("/")} au ${window.to.split("-").reverse().join("/")} remplacées par le fichier (${toInsert.length} ligne(s) ajoutée(s), ${toDelete.length} retirée(s)).`,
      ...(samples ? [`${samples} ligne(s) d'échantillons gratuits non comptées.`] : []),
      ...(createdClients.length ? [`${createdClients.length} client(s) créé(s) à vérifier : ${createdClients.join(", ")}.`] : []),
      "Annuler cet import ne sert à rien tant que le flux est actif : la synchro suivante remet les lignes du fichier. Désactivez d'abord le flux.",
    ];
    const importId = await db.transaction(async (tx) => {
      const [imp] = await tx.insert(s.imports).values({
        type: "SALES", fileName: `Flux automatique ${feed.site}${parsed.stamp ? ` · fichier du ${parsed.stamp}` : ""}`, mapping: {},
        totalRows: kept.length, insertedRows: toInsert.length, updatedRows: 0, duplicateRows: 0, errorRows: parsed.errors.length,
        errors: parsed.errors.slice(0, 200), warnings, status: "DONE", userId: opts.userId ?? null,
      }).returning({ id: s.imports.id });
      for (let i = 0; i < toDelete.length; i += 500) {
        const ids = toDelete.slice(i, i + 500).map((d) => d.id);
        await tx.delete(s.sales).where(and(inArray(s.sales.id, ids), sql`${s.sales.source} <> 'COMANET_OS'`));
      }
      const rows = toInsert.map(({ clientName, ...d }) => ({ ...d, clientId: clientIds.get(clientName)!, importId: imp.id }));
      for (let i = 0; i < rows.length; i += 500) await tx.insert(s.sales).values(rows.slice(i, i + 500)).onConflictDoNothing({ target: s.sales.lineHash });
      return imp.id;
    });
    await R.flushAliases("SALES");
    await refreshMarketingFacts(undefined, "SYNC");
    return done({ ok: true, status: "UPDATED", message: `${toInsert.length} ligne(s) ajoutée(s), ${toDelete.length} retirée(s).`, ...base, createdClients, inserted: toInsert.length, deleted: toDelete.length, importId });
  } catch (e) {
    return done({ ok: false, status: "ERROR", message: String((e as Error).message ?? e) });
  }
}

/**
 * Réglage du flux (administration : il change la source des ventes d'un site × marque). Seule écriture de
 * `settings.salesFeed`, tracée dans le journal d'audit. Activer ne synchronise pas : la synchro suivante (cron
 * ou « Synchroniser maintenant ») remplace les ventes.
 */
export async function setSalesFeedSettings(input: SalesFeedSettings, actor: AuditActor): Promise<void> {
  if (input.from && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) throw new Error("Date de départ invalide.");
  if (!input.site.trim()) throw new Error("Site obligatoire.");
  if (!Number.isFinite(input.maxDropPct) || input.maxDropPct < 0 || input.maxDropPct > 100) throw new Error("Seuil de baisse entre 0 et 100 %.");
  if (input.enabled && (!input.brandId || !input.from)) throw new Error("Pour activer le flux, choisissez la marque et la date de départ.");
  if (input.brandId && !(await db.query.brands.findFirst({ where: eq(s.brands.id, input.brandId) }))) throw new Error("Marque inconnue.");
  const cur = await getSettings();
  const salesFeed: SalesFeedSettings = { ...input, site: input.site.trim().toUpperCase() };
  await saveSettings({ ...cur, salesFeed });
  await audit({
    actor, action: "SETTINGS", module: "ventes", entity: "settings",
    label: salesFeed.enabled ? `Flux automatique ${salesFeed.site} activé à partir du ${salesFeed.from}` : `Flux automatique ${salesFeed.site} désactivé`,
    before: cur.salesFeed, after: salesFeed,
  });
}
