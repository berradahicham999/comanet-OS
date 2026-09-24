import Link from "next/link";
import { can, clientFilter } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { listDocuments } from "@/lib/gestion/documents";
import { DOC_TYPES, DOC_TYPE_LABELS, STATUS_META, statusLabel, type DocType } from "@/lib/gestion/documents-shared";
import { fmtDate } from "@/lib/format";
import { fmtMoney } from "@/lib/gestion/money";
import { PageHeader, Badge, Empty, Tabs } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { GestionTabs, requireGestionView } from "@/components/gestion/gestion-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pièces de vente" };

const MODE_HINT = {
  OFF: "Sage fait foi : les pièces saisies ici sont des simulations (séries SIMBL / SIMFA / SIMAV), sans effet sur les ventes.",
  PARALLELE: "Période parallèle : les pièces saisies ici sont des simulations (séries SIMBL / SIMFA / SIMAV) à comparer avec Sage.",
  ACTIF: "COMANET OS émet les pièces officielles des sites basculés.",
} as const;

export default async function PiecesPage(props: { searchParams: Promise<{ type?: string; error?: string }> }) {
  const access = await requireGestionView();
  const sp = await props.searchParams;
  const visibleTypes = DOC_TYPES.filter((t) => can(access.perms, t === "BL" ? "livraisons" : "facturation", "view"));
  const type = (visibleTypes.includes(sp.type as DocType) ? sp.type : visibleTypes[0]) as DocType | undefined;
  if (!type) return <Empty title="Accès restreint" hint="Les pièces de vente demandent le droit « Voir » sur Livraisons ou Facturation." />;
  const permModule = type === "BL" ? "livraisons" : "facturation";
  const [docs, settings] = await Promise.all([listDocuments({ type, clientIds: await clientFilter() }), getSettings()]);
  const canCreate = can(access.perms, permModule, "create");
  const mode = settings.gestion.cutover.mode;

  return (
    <>
      <PageHeader
        eyebrow="Gestion commerciale"
        title="Pièces de vente"
        subtitle={MODE_HINT[mode]}
        actions={canCreate && type !== "AVOIR" ? (
          <Link href={`/gestion/pieces/nouveau?type=${type}`} className="btn-primary btn-sm">+ {type === "BL" ? "Bon de livraison" : "Facture de services"}</Link>
        ) : undefined}
      >
        <GestionTabs current="/gestion/pieces" />
      </PageHeader>
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}

      <div className="mb-4"><Tabs current={`/gestion/pieces?type=${type}`} tabs={visibleTypes.map((t) => ({ href: `/gestion/pieces?type=${t}`, label: DOC_TYPE_LABELS[t].many }))} /></div>

      {docs.length === 0 ? (
        <Empty
          title={`Aucun ${DOC_TYPE_LABELS[type].one.toLowerCase()}`}
          hint={type === "BL"
            ? "Un bon de livraison sort le stock du dépôt principal (lot au plus proche de la péremption). Il se facture ensuite, seul ou regroupé avec d'autres BL du même client."
            : type === "FACTURE"
              ? "Une facture d'articles se crée depuis les BL (onglet « Facturer des BL ») ; une facture directe ne porte que des services ou des frais."
              : "Un avoir se crée depuis une facture validée (bouton « Faire un avoir » sur la facture) : retour de marchandise, erreur de prix, remise après coup."}
          action={canCreate && type === "BL" ? <Link href="/gestion/pieces/nouveau?type=BL" className="btn-primary btn-sm">Créer le premier BL</Link> : undefined}
        />
      ) : (
        <DataTable
          columns={[
            { key: "number", label: "Numéro" }, { key: "date", label: "Date" }, { key: "client", label: "Client" }, { key: "status", label: "Statut" },
            { key: "netHt", label: "Net HT", num: true, hideOnMobile: true }, { key: "ttc", label: "TTC", num: true },
            ...(type === "FACTURE" ? [{ key: "due", label: "Échéance", hideOnMobile: true }] : []), { key: "rep", label: "Commercial", hideOnMobile: true },
          ]}
          rows={docs.map((d) => ({
            id: d.id,
            href: `/gestion/pieces/${d.id}`,
            muted: d.status === "ANNULE",
            cells: {
              number: <span className="flex items-center gap-2"><Link href={`/gestion/pieces/${d.id}`} className="font-medium font-mono hover:underline">{d.number ?? "Brouillon"}</Link>{d.isSimulation && d.number && <Badge tone="purple">simulation</Badge>}</span>,
              date: fmtDate(d.date),
              client: <span>{d.client}{d.city && <span className="text-faint"> · {d.city}</span>}</span>,
              status: <span className="flex items-center gap-1 flex-wrap"><Badge tone={STATUS_META[d.status].tone}>{statusLabel(d.type, d.status)}</Badge>{d.approvalRequested && <Badge tone="orange">déblocage demandé</Badge>}</span>,
              netHt: fmtMoney(d.netHt),
              ttc: <span className="font-medium">{fmtMoney(d.ttc)}</span>,
              due: d.dueDate ? fmtDate(d.dueDate) : "—",
              rep: <span className="text-muted">{d.salesRep ?? "—"}</span>,
            },
            sort: { number: d.number ?? "", date: d.date, client: d.client, status: d.status, netHt: Number(d.netHt), ttc: Number(d.ttc), due: d.dueDate },
            search: `${d.number ?? ""} ${d.client} ${d.city ?? ""} ${d.salesRep ?? ""}`,
            filters: { status: d.status, nature: d.isSimulation ? "SIM" : "REEL", site: d.site },
          }))}
          filters={[
            { key: "status", label: "Statut", options: Object.entries(STATUS_META).filter(([k]) => type === "BL" || ["BROUILLON", "VALIDE"].includes(k)).map(([value, m]) => ({ value, label: m.label })) },
            { key: "nature", label: "Nature", options: [{ value: "REEL", label: "Pièces réelles" }, { value: "SIM", label: "Simulations" }] },
          ]}
          initialSort={{ key: "date", dir: "desc" }}
          searchPlaceholder="Numéro, client, ville, commercial…"
        />
      )}
    </>
  );
}
