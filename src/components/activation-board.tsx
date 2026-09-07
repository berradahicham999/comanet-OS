"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { BrandDot } from "@/components/ui";
import { ActivationTypeIcon } from "@/components/activation-type-icon";
import { toneClass, LATENESS_LABELS, type ActivationRefs } from "@/lib/activations/shared";
import type { ActivationCard } from "@/lib/activations/queries";
import { fmtMAD } from "@/lib/format";

/**
 * Vues Kanban / calendrier / par marque des activations. Même grille et mêmes gestes que le
 * calendrier éditorial (glisser-déposer pour déplacer une date), pour pouvoir plus tard afficher
 * les deux ensemble. Sur le Kanban, glisser une carte vers une colonne tente la transition :
 * le référentiel décide, l'erreur s'affiche si elle est refusée.
 */
export type BoardView = "kanban" | "calendrier" | "marques";
type Brand = { id: string; name: string; color: string };

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const d = (iso: string) => new Date(iso + "T12:00:00Z");
const shift = (iso: string, n: number) => { const x = d(iso); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const range = (start: string, n: number) => Array.from({ length: n }, (_, i) => shift(start, i));
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DRAG = "application/x-comanet-activation";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ActivationBoard(props: {
  view: BoardView; cards: ActivationCard[]; refs: ActivationRefs; brands: Brand[];
  /** Mois affiché (ISO du 1er) et bornes, pour calendrier et matrice. */
  monthStart: string; monthEnd: string; todayIso: string;
  canEdit: boolean;
  /** Préfixe d'URL auquel on concatène `YYYY-MM` pour changer de mois (une chaîne : composant client). */
  monthHrefBase: string;
  actions: { move: (input: { id: string; date: string }) => Promise<{ ok: boolean; error?: string }>; status: (fd: FormData) => Promise<{ ok: boolean; error?: string }> };
}) {
  const router = useRouter();
  const [cards, setCards] = useState(props.cards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, start] = useTransition();
  const statusOf = useMemo(() => new Map(props.refs.statuses.map((s) => [s.key, s])), [props.refs.statuses]);
  const typeOf = useMemo(() => new Map(props.refs.types.map((t) => [t.key, t])), [props.refs.types]);

  const isDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG);
  function startDrag(e: React.DragEvent, id: string) { setDragId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG, id); }
  function fail(text: string) { setCards(props.cards); setToast(text); setTimeout(() => setToast(null), 4000); }

  function dropDate(e: React.DragEvent, date: string) {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData(DRAG); setDragId(null);
    const cur = cards.find((c) => c.id === id);
    if (!id || !props.canEdit || !cur || cur.date === date) return;
    const delta = Math.round((d(date).getTime() - d(cur.date).getTime()) / 86400000);
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, date, endDate: c.endDate ? shift(c.endDate, delta) : null } : c)));
    start(async () => { const r = await props.actions.move({ id, date }); if (!r.ok) fail(r.error ?? "Déplacement refusé"); else router.refresh(); });
  }
  function dropStatus(e: React.DragEvent, status: string) {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData(DRAG); setDragId(null);
    const cur = cards.find((c) => c.id === id);
    if (!id || !props.canEdit || !cur || cur.status === status) return;
    const t = props.refs.transitions.find((x) => x.fromKey === cur.status && x.toKey === status);
    if (!t) { fail(`Passage « ${statusOf.get(cur.status)?.label} → ${statusOf.get(status)?.label} » non prévu : ouvrez la fiche.`); return; }
    if (t.requiresComment) { fail("Cette étape exige un commentaire : faites-la depuis la fiche."); return; }
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)));
    const fd = new FormData(); fd.set("id", id); fd.set("to", status);
    start(async () => { const r = await props.actions.status(fd); if (!r.ok) fail(r.error ?? "Transition refusée"); else router.refresh(); });
  }

  /* ------------------------------- Carte ------------------------------- */
  function card(c: ActivationCard, compact?: boolean) {
    const st = statusOf.get(c.status); const tp = typeOf.get(c.type);
    return (
      <div draggable={props.canEdit} onDragStart={(e) => startDrag(e, c.id)} onDragEnd={() => { setDragId(null); setOver(null); }}
        className={clsx("rounded-lg border bg-surface text-[12px] leading-tight", props.canEdit && "cursor-grab active:cursor-grabbing", dragId === c.id && "opacity-40", c.late.length ? "border-red/40" : "border-line")}
        style={{ borderLeftWidth: 3, borderLeftColor: c.color ?? "#999" }}
        title={`${c.brand ?? ""} · ${st?.label ?? c.status}${c.responsible ? ` · ${c.responsible}` : ""}${c.late.map((l) => ` · ${LATENESS_LABELS[l]}`).join("")}`}>
        <Link href={`/marketing/activations/${c.id}`} className={clsx("block", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <div className="flex items-center gap-1 min-w-0">
            <ActivationTypeIcon icon={tp?.icon} size={12} className="text-ink-2 shrink-0" />
            <span className="truncate font-medium">{c.name}</span>
            {c.late.length > 0 && <AlertTriangle size={11} className="text-red shrink-0 ml-auto" />}
          </div>
          {!compact && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-muted">
              <span className={clsx("badge text-[10px] py-0", toneClass(st?.tone))}>{st?.label ?? c.status}</span>
              <span>{fmtShort.format(d(c.date))}{c.endDate && c.endDate !== c.date ? ` → ${fmtShort.format(d(c.endDate))}` : ""}</span>
              {c.city && <span className="truncate">{c.city}</span>}
              {c.planned > 0 && <span className="ml-auto tabular-nums">{fmtMAD(c.planned, { compact: true, suffix: false })}</span>}
            </div>
          )}
        </Link>
      </div>
    );
  }

  /* ------------------------------- Kanban ------------------------------- */
  const kanban = () => {
    const cols = props.refs.statuses.filter((s) => s.active && !s.isArchived);
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {cols.map((s) => {
          const items = cards.filter((c) => c.status === s.key);
          const total = items.reduce((a, c) => a + c.planned, 0);
          return (
            <div key={s.key} onDragOver={(e) => { if (isDrag(e)) { e.preventDefault(); setOver(s.key); } }} onDragLeave={() => setOver((o) => (o === s.key ? null : o))} onDrop={(e) => dropStatus(e, s.key)}
              className={clsx("w-[240px] shrink-0 rounded-xl bg-surface-2/70 border border-line flex flex-col max-h-[72dvh]", over === s.key && "ring-2 ring-accent/50 bg-accent-soft")}>
              <div className="px-3 py-2 flex items-center gap-2 text-[12.5px]"><span className={clsx("badge", toneClass(s.tone))}>{s.label}</span><span className="text-muted">{items.length}</span>{total > 0 && <span className="ml-auto text-muted tabular-nums">{fmtMAD(total, { compact: true })}</span>}</div>
              <div className="px-2 pb-2 space-y-1.5 overflow-y-auto">{items.map((c) => <div key={c.id}>{card(c)}</div>)}{items.length === 0 && <div className="text-[11.5px] text-faint px-1 pb-2">—</div>}</div>
            </div>
          );
        })}
      </div>
    );
  };

  /* ------------------------------ Calendrier ------------------------------ */
  const monthDays = useMemo(() => {
    const first = d(props.monthStart); const offset = (first.getUTCDay() + 6) % 7;
    const n = Math.ceil((offset + Math.round((d(props.monthEnd).getTime() - first.getTime()) / 86400000)) / 7) * 7;
    return range(shift(props.monthStart, -offset), n);
  }, [props.monthStart, props.monthEnd]);
  /** Une activation apparaît en carte à sa date de début, puis en barre fine sur les jours suivants qu'elle couvre. */
  const covering = (date: string) => cards.filter((c) => c.date < date && (c.endDate ?? c.date) >= date);
  const monthNav = (
    <div className="flex items-center gap-2 mb-3 text-[13px]">
      <Link href={`${props.monthHrefBase}${shift(props.monthStart, -1).slice(0, 7)}`} className="btn-secondary btn-sm h-8 w-8 p-0" aria-label="Mois précédent"><ChevronLeft size={14} /></Link>
      <span className="font-medium min-w-[140px] text-center">{cap(fmtMonth.format(d(props.monthStart)))}</span>
      <Link href={`${props.monthHrefBase}${props.monthEnd.slice(0, 7)}`} className="btn-secondary btn-sm h-8 w-8 p-0" aria-label="Mois suivant"><ChevronRight size={14} /></Link>
      <Link href={`${props.monthHrefBase}${props.todayIso.slice(0, 7)}`} className="text-muted hover:underline ml-1">Aujourd&apos;hui</Link>
      {props.canEdit && <span className="text-[11.5px] text-faint ml-auto hidden sm:inline">Glissez une activation pour changer sa date de début.</span>}
    </div>
  );
  const calendar = () => (
    <>
      {monthNav}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 text-[11px] font-medium text-muted">{DAYS.map((x) => <div key={x} className="px-2 py-1.5 border-l border-line first:border-l-0">{x}</div>)}</div>
        <div className="grid grid-cols-7 border-b border-r border-line">
          {monthDays.map((date) => {
            const inMonth = date >= props.monthStart && date < props.monthEnd;
            const starting = cards.filter((c) => c.date === date);
            const cov = covering(date);
            return (
              <div key={date} onDragOver={(e) => { if (isDrag(e)) { e.preventDefault(); setOver(date); } }} onDragLeave={() => setOver((o) => (o === date ? null : o))} onDrop={(e) => dropDate(e, date)}
                className={clsx("relative flex flex-col gap-1 p-1.5 border-t border-l border-line min-w-0 min-h-[104px]", !inMonth && "bg-surface-2/60 text-faint", over === date && "bg-accent-soft ring-2 ring-inset ring-accent/50", date < props.todayIso && inMonth && "bg-black/[0.015]")}>
                <span className={clsx("inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full text-[11px] font-medium self-start", date === props.todayIso && "bg-ink text-white")}>{Number(date.slice(8, 10))}</span>
                {cov.map((c) => <Link key={c.id} href={`/marketing/activations/${c.id}`} title={c.name} draggable={false} className="block h-1.5 rounded-full opacity-70" style={{ background: c.color ?? "#999" }} />)}
                {starting.map((c) => <div key={c.id}>{card(c, true)}</div>)}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  /* ------------------------------ Par marque ------------------------------ */
  const byBrand = () => {
    const days = range(props.monthStart, Math.round((d(props.monthEnd).getTime() - d(props.monthStart).getTime()) / 86400000));
    const rows = props.brands.map((b) => ({ ...b, items: cards.filter((c) => c.brandId === b.id) }));
    return (
      <>
        {monthNav}
        <div className="card overflow-x-auto">
          <table className="text-[11px] border-collapse min-w-[900px] w-full">
            <thead><tr><th className="sticky left-0 bg-surface text-left px-2 py-1.5 font-medium text-muted w-[190px]">Marque</th>{days.map((x) => <th key={x} className={clsx("px-0 py-1.5 font-medium text-center border-l border-line", x === props.todayIso ? "text-ink" : "text-muted")}>{Number(x.slice(8, 10))}</th>)}<th className="px-2 text-right text-muted font-medium">Prévu</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const planned = r.items.reduce((a, c) => a + c.planned, 0);
                const fullCost = r.items.reduce((a, c) => a + c.fullCost, 0);
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className="sticky left-0 bg-surface px-2 py-1.5"><div className="flex items-center gap-1.5 font-medium"><BrandDot color={r.color} />{r.name}</div><div className="text-muted">{r.items.length} activation{r.items.length > 1 ? "s" : ""}{fullCost > 0 ? ` · ${fmtMAD(fullCost, { compact: true })} dépensés` : ""}</div></td>
                    {days.map((x) => {
                      const here = r.items.filter((c) => c.date <= x && (c.endDate ?? c.date) >= x);
                      return (
                        <td key={x} onDragOver={(e) => { if (isDrag(e)) { e.preventDefault(); setOver(`${r.id}|${x}`); } }} onDragLeave={() => setOver((o) => (o === `${r.id}|${x}` ? null : o))} onDrop={(e) => dropDate(e, x)}
                          className={clsx("border-l border-line align-top p-0.5 h-9", over === `${r.id}|${x}` && "bg-accent-soft", x === props.todayIso && "bg-accent-soft/40")}>
                          <div className="flex flex-col gap-0.5">
                            {here.map((c) => { const st = statusOf.get(c.status); const tp = typeOf.get(c.type); return (
                              <Link key={c.id} href={`/marketing/activations/${c.id}`} draggable={props.canEdit} onDragStart={(e) => startDrag(e, c.id)} onDragEnd={() => setDragId(null)} title={`${c.name} · ${st?.label ?? c.status}`}
                                className={clsx("h-4 rounded-sm flex items-center justify-center", toneClass(st?.tone), c.late.length && "ring-1 ring-red", c.date === x ? "rounded-l-sm" : "opacity-60")}>{c.date === x ? <ActivationTypeIcon icon={tp?.icon} size={10} /> : null}</Link>
                            ); })}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 text-right tabular-nums">{planned ? fmtMAD(planned, { compact: true, suffix: false }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-2">Une case colorée par jour couvert ; le pictogramme marque le début. Les marques sans activation ce mois-ci sont les trous à combler.</p>
      </>
    );
  };

  return (
    <div className="relative">
      {props.view === "kanban" ? kanban() : props.view === "calendrier" ? calendar() : byBrand()}
      {toast && <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-xl px-3 py-2 text-[13px] shadow-lg bg-red text-white">{toast}</div>}
    </div>
  );
}
