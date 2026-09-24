import { redirect } from "next/navigation";
import { can, hasFlag, requireAccessContext } from "@/lib/access";
import { selectablePieces } from "@/lib/gestion/exports";
import { iso, today } from "@/lib/format";
import { PageHeader, Card, Empty } from "@/components/ui";
import { GestionTabs } from "@/components/gestion/gestion-nav";
import { PieceExporter } from "@/components/gestion/piece-exporter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Envoi au comptable" };

const TYPES = [["BL", "Bons de livraison"], ["FACTURE", "Factures"], ["AVOIR", "Avoirs"]] as const;

/**
 * Envoi au comptable et export groupé : on choisit une période et des types de pièces, on coche, et
 * l'on télécharge d'un coup les PDF (les mêmes que ceux des clients, sans UG) avec un récapitulatif.
 */
export default async function ExportsPage(props: { searchParams: Promise<{ from?: string; to?: string; types?: string | string[]; sim?: string }> }) {
  const a = await requireAccessContext();
  if (!can(a.perms, "facturation", "view") && !can(a.perms, "livraisons", "view")) redirect(a.home);
  const allowed = (await hasFlag("exportData")) || can(a.perms, "administration", "validate");
  const sp = await props.searchParams;
  const t = iso(today());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${t.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : t;
  const asked = [sp.types ?? []].flat();
  const types = (asked.length ? asked : ["FACTURE", "AVOIR"]).filter((x) => (x === "BL" ? can(a.perms, "livraisons", "view") : can(a.perms, "facturation", "view")) && ["BL", "FACTURE", "AVOIR"].includes(x));
  const sim = sp.sim === "1";
  const rows = allowed ? await selectablePieces({ from, to, types, simulation: sim }) : [];
  const month = from.slice(0, 7);

  return (
    <>
      <PageHeader eyebrow="Gestion commerciale" title="Envoi au comptable"
        subtitle="Choisissez la période et les pièces, cochez, téléchargez : un ZIP avec le PDF de chaque pièce (identique à celui du client, sans UG) et un récapitulatif. Le récapitulatif comptable complet du mois (TVA, achats, règlements, balance âgée) est en Excel.">
        <GestionTabs current="/gestion/exports" />
      </PageHeader>
      <Card className="mb-4">
        <form className="flex flex-wrap gap-3 items-end text-[13px]">
          <label className="block"><span className="label block mb-1">Du</span><input type="date" name="from" defaultValue={from} className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">Au</span><input type="date" name="to" defaultValue={to} className="input h-9" /></label>
          <div className="flex gap-3 h-9 items-center">{TYPES.map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="types" value={k} defaultChecked={types.includes(k)} /> {l}</label>)}</div>
          <label className="flex items-center gap-2 h-9"><input type="checkbox" name="sim" value="1" defaultChecked={sim} /> Pièces de simulation</label>
          <button className="btn-secondary btn-sm" type="submit">Afficher</button>
          {allowed && can(a.perms, "facturation", "view") && <a href={`/gestion/exports/recap?month=${month}${sim ? "&sim=1" : ""}`} className="btn-ghost btn-sm ml-auto">Récapitulatif comptable de {month.split("-").reverse().join("/")} (Excel)</a>}
        </form>
      </Card>
      {!allowed ? (
        <Empty title="Export réservé" hint="L'export demande l'interrupteur « Exporter des données » (Utilisateurs & droits) ou le rôle administrateur." />
      ) : rows.length === 0 ? (
        <Empty title="Aucune pièce sur la période" hint={sim ? "Aucune pièce de simulation validée sur la période." : "Aucune pièce validée émise par COMANET OS sur la période. Avant la bascule, les pièces légales sont celles de Sage : cochez « Pièces de simulation » pour vos tests."} />
      ) : (
        <PieceExporter rows={rows.map((r) => ({ id: r.id, type: r.type, number: r.number, date: r.date, client: r.client, ice: r.ice, netHt: r.netHt, vatTotal: r.vatTotal, ttc: r.ttc }))} fileLabel={`${from}_${to}${sim ? "-simulation" : ""}`} />
      )}
    </>
  );
}
