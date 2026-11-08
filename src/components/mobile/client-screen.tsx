"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CloudOff, MapPinned, Phone, ShoppingCart } from "lucide-react";
import { fmtInt, fmtMad, fmtMadCompact } from "@/lib/mobile/format";
import { readRef } from "@/lib/mobile/outbox";
import { deliverablePack, type ClientSheet } from "@/lib/mobile/snapshot-shared";
import { Trend } from "./clients-screen";
import { loadClientSheet, useMobile } from "./mobile-app";
import { Skeleton } from "./mobile-shell";
import { StockEditor } from "./stock-editor";

const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="card p-3 min-w-0"><div className="text-[12px] text-muted">{label}</div><div className="text-[17px] font-semibold text-ink truncate">{children}</div></div>;
}

/** Un lien vers une page qui exige le réseau : sans réseau, il le dit au lieu de mener à une erreur. */
function NetLink({ href, online, children, primary }: { href: string; online: boolean; children: React.ReactNode; primary?: boolean }) {
  const cls = `${primary ? "btn-primary" : "btn-secondary"} flex-1 h-12 text-[14px]`;
  if (!online) return <span aria-disabled="true" className={`${cls} opacity-50`}>{children}</span>;
  return <Link href={href} prefetch={false} className={cls}>{children}</Link>;
}

function Pack({ sheet, outOfStockIds }: { sheet: ClientSheet; outOfStockIds: string[] }) {
  const { items, removed } = deliverablePack(sheet.pack.items, outOfStockIds);
  return (
    <section className="card p-4">
      <h2 className="font-semibold text-ink text-[15px]">Pack conseillé</h2>
      {items.length === 0 ? (
        <p className="text-[13.5px] text-muted mt-1">{sheet.pack.measurable ? (removed > 0 ? "Rien à proposer pour l'instant." : "Rien à proposer pour l'instant : ce client a déjà l'essentiel de ce que prennent les clients comparables.") : "Pas assez de clients comparables pour proposer un pack : non mesurable."}</p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {items.map((i) => (
              <li key={i.productId} className="text-[14px] flex justify-between gap-3">
                <span className="min-w-0">{i.name}{i.brand ? <span className="text-muted"> · {i.brand}</span> : null}</span>
                <span className="text-[12.5px] text-muted shrink-0">{i.buyers} sur {sheet.pack.peers}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-muted mt-2">Produits absents chez ce client, achetés par des clients comparables ({sheet.pack.basis}). Corrélation observée : une piste, pas une garantie.</p>
        </>
      )}
      {removed > 0 && <p className="text-[12px] text-muted mt-1">{removed} produit{removed > 1 ? "s" : ""} écarté{removed > 1 ? "s" : ""} : pas de stock à l&apos;entrepôt.</p>}
    </section>
  );
}

function ClientBody({ id }: { id: string }) {
  const { phase, snapshot, online } = useMobile();
  const c = snapshot?.commercial ?? null;
  const uid = snapshot?.user.id ?? null;
  const [sheet, setSheet] = useState<ClientSheet | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid || !id) return;
    let stale = false;
    // La copie locale s'affiche tout de suite ; le réseau la remplace dès qu'il répond.
    void readRef<ClientSheet>(uid, `client:${id}`).catch(() => null).then((local) => { if (!stale && local) setSheet(local); });
    void loadClientSheet(uid, id).then((s) => {
      if (stale) return;
      if (s) setSheet(s);
      setLoaded(true);
    });
    return () => { stale = true; };
  }, [uid, id]);

  if (phase === "LOADING") return <Skeleton />;
  if (!c) return null;
  const line = c.clients.find((x) => x.id === id) ?? null;
  const name = sheet?.name ?? line?.name;

  const back = <Link href="/m" prefetch={false} className="min-h-11 inline-flex items-center gap-1 text-[13.5px] text-muted"><ArrowLeft size={16} /> Mes clients</Link>;

  if (!loaded && !line) return <div className="space-y-3">{back}<Skeleton /></div>;
  if (!name) {
    return (
      <div className="space-y-3">
        {back}
        <div className="card p-5 text-center text-[14px] text-muted">{online ? "Ce client n'est pas dans votre portée." : "Cette fiche n'est pas encore sur ce téléphone : ouvrez-la une première fois avec du réseau."}</div>
      </div>
    );
  }

  const revenue = sheet?.revenue12 ?? line?.revenue12 ?? 0;
  const growth = sheet?.growthPct ?? line?.growthPct ?? null;
  const segment = sheet?.segmentLabel ?? line?.segmentLabel ?? "—";
  const last = { ...(c.lastStock[id] ?? {}), ...(sheet?.lastStock ?? {}) };
  const r = sheet?.receivables;

  return (
    <div className="space-y-3">
      {back}
      <header>
        <h1 className="text-[20px] font-semibold text-ink leading-snug">{name}</h1>
        <p className="text-[13.5px] text-muted">{sheet?.city ?? line?.city ?? "Ville inconnue"}{sheet?.contactName ? ` · ${sheet.contactName}` : ""}</p>
      </header>

      <div className="flex gap-2">
        <NetLink href={`/gestion/pieces/nouveau?type=COMMANDE&client=${id}`} online={online} primary><ShoppingCart size={16} /> Commande</NetLink>
        <NetLink href={`/clients/tournee?client=${id}`} online={online}><MapPinned size={16} /> Visite</NetLink>
        {sheet?.phone && <a href={`tel:${sheet.phone}`} className="btn-secondary h-12 w-12 p-0 shrink-0" aria-label={`Appeler ${name}`}><Phone size={17} /></a>}
      </div>

      {line?.advice && <p className="rounded-xl bg-accent-soft text-accent text-[13.5px] px-3 py-2">{line.advice}</p>}

      <section className="grid grid-cols-3 gap-2">
        <Figure label="CA 12 mois HT">{fmtMadCompact(revenue)}</Figure>
        <Figure label="Tendance"><Trend pct={growth} /></Figure>
        <Figure label="Segment"><span className="text-[14px]">{segment}</span></Figure>
      </section>

      {sheet ? (
        <>
          {r && (
            <section className="card p-4">
              <h2 className="font-semibold text-ink text-[15px]">Impayés</h2>
              {r.outstanding === 0 ? <p className="text-[14px] text-muted mt-1">Aucune facture ouverte.</p> : (
                <div className="mt-1 text-[14px] text-ink-2">
                  <div>Encours : <b className="text-ink">{fmtMad(r.outstanding)}</b> sur {fmtInt(r.invoices)} facture{r.invoices > 1 ? "s" : ""}</div>
                  <div>Échu : <b className={r.overdue > 0 ? "text-red" : "text-ink"}>{fmtMad(r.overdue)}</b>{r.oldestDaysLate ? ` · plus ancien : ${r.oldestDaysLate} j` : ""}</div>
                </div>
              )}
            </section>
          )}
          <Pack sheet={sheet} outOfStockIds={c.outOfStockIds} />
          {sheet.lastVisit && (
            <section className="card p-4 text-[14px]">
              <h2 className="font-semibold text-ink text-[15px]">Dernière visite</h2>
              <p className="text-ink-2 mt-1">Le {frDate(sheet.lastVisit.date)}{sheet.lastVisit.nextAction ? ` · À faire : ${sheet.lastVisit.nextAction}` : ""}</p>
            </section>
          )}
          {sheet.openTasks.length > 0 && (
            <section className="card p-4">
              <h2 className="font-semibold text-ink text-[15px]">Tâches ouvertes</h2>
              <ul className="mt-1 space-y-1 text-[14px] text-ink-2">{sheet.openTasks.map((t) => <li key={t.id}>{t.title}{t.dueDate ? <span className="text-muted"> · {frDate(t.dueDate)}</span> : null}</li>)}</ul>
            </section>
          )}
          <p className="text-[12px] text-muted">{!online && <><CloudOff size={12} className="inline align-text-bottom" /> Copie du {frDate(sheet.fetchedAt.slice(0, 10))}. </>}{sheet.salesUpTo ? `Ventes connues jusqu'au ${frDate(sheet.salesUpTo)}.` : ""}</p>
        </>
      ) : !online && loaded && (
        <p className="card p-4 text-[13.5px] text-muted">Impayés et pack conseillé : ouvrez cette fiche une première fois avec du réseau.</p>
      )}

      <section>
        <h2 className="font-semibold text-ink text-[15px] mb-2">Stock chez le client</h2>
        <StockEditor key={id} client={{ id, name }} products={c.products} favoriteIds={[]} last={last} />
      </section>

      {online && <Link href={`/clients/${id}`} prefetch={false} className="min-h-11 flex items-center justify-center text-[13.5px] text-muted">Fiche complète</Link>}
    </div>
  );
}

function ClientFromUrl() {
  const id = useSearchParams().get("id") ?? "";
  return <ClientBody id={id} />;
}

export function ClientScreen() {
  return <Suspense fallback={<Skeleton />}><ClientFromUrl /></Suspense>;
}
