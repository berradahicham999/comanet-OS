import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtMAD, fmtNum } from "@/lib/format";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS, type ClientVisitKind, type ClientVisitStatus } from "./visits-shared";

/**
 * CRM commercial — chronologie d'un client. Lecture seule : elle assemble ce qui existe déjà (visites,
 * commandes et pièces COMANET OS, ventes importées, règlements, relevés de stock, animations, tâches)
 * sans rien recalculer ni écrire.
 */

export type TimelineKind = "VISITE" | "CONTACT" | "PIECE" | "VENTE" | "REGLEMENT" | "RELEVE" | "ANIMATION" | "TACHE";

export type TimelineItem = {
  date: string;
  /** Pour départager deux éléments du même jour. */
  at: string | null;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  who: string | null;
  href: string | null;
  tone: "green" | "orange" | "red" | "blue" | "gray" | "accent" | "purple";
};

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  VISITE: "Visites", CONTACT: "Appels et messages", PIECE: "Commandes et pièces", VENTE: "Ventes importées",
  REGLEMENT: "Règlements", RELEVE: "Relevés de stock", ANIMATION: "Animations", TACHE: "Tâches",
};

const DOC_LABEL: Record<string, string> = { COMMANDE: "Commande", BL: "Bon de livraison", FACTURE: "Facture", AVOIR: "Avoir" };

export async function clientTimeline(clientId: string, opts: { limit?: number; kinds?: TimelineKind[] | null; showVerification?: boolean } = {}): Promise<TimelineItem[]> {
  const limit = Math.min(300, opts.limit ?? 120);
  const want = (k: TimelineKind) => !opts.kinds?.length || opts.kinds.includes(k);
  const [visits, docs, sales, payments, readings, animations, tasks] = await Promise.all([
    want("VISITE") || want("CONTACT")
      ? db.execute<{ id: string; date: string; started_at: string | null; status: ClientVisitStatus; kind: ClientVisitKind; who: string | null; result: string | null; comment: string | null; next_action: string | null; not_done_reason: string | null; duration_minutes: number | null; verification_status: string; objective: string | null }>(sql`
          select v.id, v.date::text as date, v.started_at, v.status, v.kind, u.name as who, v.result, v.comment, v.next_action, v.not_done_reason, v.duration_minutes, v.verification_status, v.objective
          from client_visits v left join users u on u.id = v.user_id
          where v.client_id = ${clientId}::uuid and v.status <> 'ANNULEE' order by v.date desc, v.started_at desc nulls last limit ${limit}`)
      : null,
    want("PIECE")
      ? db.execute<{ id: string; type: string; number: string | null; status: string; date: string; created_at: string; net_ht: number; who: string | null; is_simulation: boolean }>(sql`
          select d.id, d.type, d.number, d.status, d.date::text as date, d.created_at, d.net_ht::float8 as net_ht, u.name as who, d.is_simulation
          from sales_documents d left join users u on u.id = coalesce(d.sales_rep_id, d.created_by_id)
          where d.client_id = ${clientId}::uuid and d.status <> 'BROUILLON' order by d.date desc, d.created_at desc limit ${limit}`)
      : null,
    want("VENTE")
      ? db.execute<{ date: string; ref: string; site: string | null; amount: number; qty: number }>(sql`
          select s.date::text as date, coalesce(s.invoice_ref, s.lvc_ref, '—') as ref, s.site, sum(s.amount)::float8 as amount, sum(s.quantity)::float8 as qty
          from sales s where s.client_id = ${clientId}::uuid and s.source <> 'COMANET_OS'
          group by s.date, coalesce(s.invoice_ref, s.lvc_ref, '—'), s.site order by s.date desc limit ${limit}`)
      : null,
    want("REGLEMENT")
      ? db.execute<{ id: string; number: string; date: string; amount: number; mode: string; status: string; is_simulation: boolean }>(sql`
          select p.id, p.number, p.date::text as date, p.amount::float8 as amount, coalesce(m.label, p.mode_key) as mode, p.status, p.is_simulation
          from payments p left join payment_modes m on m.key = p.mode_key
          where p.client_id = ${clientId}::uuid order by p.date desc limit ${limit}`).catch(() => null)
      : null,
    want("RELEVE")
      ? db.execute<{ date: string; who: string | null; channel: string; n: number; units: number }>(sql`
          select r.read_at::text as date, u.name as who, r.channel::text as channel, count(*)::int as n, sum(r.quantity)::int as units
          from client_stock_readings r left join users u on u.id = r.user_id
          where r.client_id = ${clientId}::uuid group by r.read_at, u.name, r.channel order by r.read_at desc limit ${limit}`)
      : null,
    want("ANIMATION")
      ? db.execute<{ id: string; date: string; status: string; who: string | null; brand: string | null; sold: number }>(sql`
          select a.id, a.date::text as date, a.status::text as status, u.name as who, b.name as brand, coalesce(sum(al.quantity_sold), 0)::int as sold
          from animations a left join users u on u.id = a.animatrice_id left join brands b on b.id = a.brand_id left join animation_lines al on al.animation_id = a.id
          where a.client_id = ${clientId}::uuid group by a.id, u.name, b.name order by a.date desc limit ${limit}`)
      : null,
    want("TACHE")
      ? db.execute<{ id: string; title: string; status: string; created_at: string; completed_at: string | null; who: string | null }>(sql`
          select t.id, t.title, t.status::text as status, t.created_at, t.completed_at, u.name as who
          from tasks t left join users u on u.id = t.assignee_id
          where t.entity_id = ${clientId}::uuid order by t.created_at desc limit ${limit}`)
      : null,
  ]);

  const items: TimelineItem[] = [];
  for (const v of visits?.rows ?? []) {
    const isVisit = v.kind === "VISITE";
    if (isVisit ? !want("VISITE") : !want("CONTACT")) continue;
    const parts = [
      v.status === "NON_EFFECTUEE" ? `Non effectuée : ${v.not_done_reason ?? "sans motif"}` : null,
      v.status === "PLANIFIEE" && v.objective ? `Objectif : ${v.objective}` : null,
      v.result, v.comment, v.next_action ? `Prochaine action : ${v.next_action}` : null,
      v.duration_minutes !== null ? `${v.duration_minutes} min` : null,
      opts.showVerification && isVisit && v.status === "EFFECTUEE" && v.verification_status !== "HORS_CONTROLE" ? `Contrôle : ${v.verification_status === "VERIFIEE" ? "vérifiée" : v.verification_status === "A_VERIFIER" ? "à vérifier" : "non vérifiée"}` : null,
    ].filter(Boolean);
    items.push({
      date: v.date, at: v.started_at, kind: isVisit ? "VISITE" : "CONTACT",
      title: `${VISIT_KIND_LABELS[v.kind]} · ${VISIT_STATUS_LABELS[v.status]}`, detail: parts.join(" · ") || null, who: v.who,
      href: `/clients/visites/${v.id}`,
      tone: v.status === "EFFECTUEE" ? "green" : v.status === "NON_EFFECTUEE" ? "orange" : v.status === "PLANIFIEE" ? "blue" : "gray",
    });
  }
  for (const d of docs?.rows ?? []) {
    items.push({
      date: d.date, at: d.created_at, kind: "PIECE",
      title: `${DOC_LABEL[d.type] ?? d.type} ${d.number ?? "(sans numéro)"}${d.is_simulation ? " · simulation" : ""}`,
      detail: `${fmtMAD(d.net_ht)} HT · ${d.status.toLowerCase().replace(/_/g, " ")}`, who: d.who, href: `/gestion/pieces/${d.id}`,
      tone: d.status === "ANNULE" ? "gray" : d.type === "AVOIR" ? "purple" : "accent",
    });
  }
  for (const s of sales?.rows ?? []) {
    items.push({ date: s.date, at: null, kind: "VENTE", title: `Vente ${s.ref}`, detail: `${fmtMAD(s.amount)} HT · ${fmtNum(s.qty)} u.${s.site ? ` · ${s.site}` : ""}`, who: null, href: null, tone: "blue" });
  }
  for (const p of payments?.rows ?? []) {
    items.push({ date: p.date, at: null, kind: "REGLEMENT", title: `Règlement ${p.number}${p.is_simulation ? " · simulation" : ""}`, detail: `${fmtMAD(p.amount)} · ${p.mode} · ${p.status.toLowerCase().replace(/_/g, " ")}`, who: null, href: `/gestion/reglements/${p.id}`, tone: p.status === "IMPAYE" ? "red" : "green" });
  }
  for (const r of readings?.rows ?? []) {
    items.push({ date: r.date, at: null, kind: "RELEVE", title: `Relevé de stock en rayon`, detail: `${r.n} produit(s), ${fmtNum(r.units)} u. · ${r.channel === "ANIMATION" ? "animation" : r.channel === "TOURNEE_COMMERCIALE" ? "tournée" : "import"}`, who: r.who, href: null, tone: "gray" });
  }
  for (const a of animations?.rows ?? []) {
    items.push({ date: a.date, at: null, kind: "ANIMATION", title: `Animation${a.brand ? ` ${a.brand}` : ""}${a.status === "PLANNED" ? " (prévue)" : ""}`, detail: `${fmtNum(a.sold)} u. vendues`, who: a.who, href: `/terrain/${a.id}`, tone: "purple" });
  }
  for (const t of tasks?.rows ?? []) {
    const d = new Date(t.completed_at ?? t.created_at).toISOString().slice(0, 10);
    items.push({ date: d, at: t.completed_at ?? t.created_at, kind: "TACHE", title: t.title, detail: t.completed_at ? "terminée" : t.status.toLowerCase().replace(/_/g, " "), who: t.who, href: `/taches/${t.id}`, tone: t.completed_at ? "green" : "gray" });
  }
  return items
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.at ?? "").localeCompare(String(a.at ?? "")))
    .slice(0, limit);
}
