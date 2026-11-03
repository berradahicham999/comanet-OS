"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { Badge, BrandDot } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { toneClass, type ContentRefs } from "@/lib/content/shared";
import type { ContentCard, PeriodIndicators } from "@/lib/content/queries";

/**
 * Calendrier éditorial : mois / semaine / liste, par date / par marque / par plateforme,
 * filtres combinables (dans l'URL), glisser-déposer, création rapide, duplication.
 *
 * Sans `view` explicite : liste sur mobile, mois sur grand écran (CSS, sans détection JS).
 * Les données viennent du serveur ; le composant ne calcule aucune notion métier
 * (retards, indicateurs : `src/lib/content/queries.ts`).
 */

export type CalendarView = "month" | "week" | "list";
export type CalendarMode = "date" | "brand" | "platform";
type Brand = { id: string; name: string; color: string; active: boolean };
type User = { id: string; name: string };
type Product = { id: string; name: string; brandId: string | null };
type Template = { id: string; name: string; brandId: string | null; platformKey: string | null; formatKey: string | null };

export type CalendarActions = {
  move: (input: { id: string; date: string }) => Promise<{ ok: boolean; error?: string }>;
  quickCreate: (fd: FormData) => Promise<{ id: string } | { error: string }>;
  duplicate: (input: { id: string; date?: string | null; platform?: string | null }) => Promise<{ id: string } | { error: string }>;
};

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Densité d'affichage, mémorisée par navigateur (confort par défaut : cartes lisibles). */
type Density = "comfort" | "compact";
const DENSITY_KEY = "comanet-planning-density";
function readDensity(): Density {
  try { return window.localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfort"; } catch { return "comfort"; }
}
function subscribeDensity(cb: () => void) {
  window.addEventListener("storage", cb); window.addEventListener(DENSITY_KEY, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(DENSITY_KEY, cb); };
}
/** En vue mois confort, au-delà de ce nombre la case affiche « + N autres ». */
const MONTH_VISIBLE = 3;
/** Teinte de fond d'une carte : la couleur de la marque, très éclaircie. */
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, white)`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const abbr = (label: string) => (label.length <= 5 ? label : label.slice(0, 4) + ".");
const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const d = (iso: string) => new Date(iso + "T12:00:00Z");
const shift = (iso: string, n: number) => { const x = d(iso); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const range = (start: string, n: number) => Array.from({ length: n }, (_, i) => shift(start, i));

export function ContentCalendar(props: {
  cards: ContentCard[]; refs: ContentRefs; brands: Brand[]; users: User[]; products: Product[]; templates: Template[];
  view: CalendarView | null; mode: CalendarMode; anchor: string; start: string; end: string; todayIso: string;
  indicators: PeriodIndicators; canCreate: boolean; canEdit: boolean; actions: CalendarActions;
}) {
  const { refs, todayIso } = props;
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [cards, setCards] = useState(props.cards);
  const [prevCards, setPrevCards] = useState(props.cards);
  if (props.cards !== prevCards) { setPrevCards(props.cards); setCards(props.cards); }
  // L'identifiant glissé voyage dans le `dataTransfer` (mécanique HTML5) ; l'état ne sert qu'à l'opacité.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [create, setCreate] = useState<{ date: string; brandId?: string; platform?: string } | null>(null);
  const [dup, setDup] = useState<ContentCard | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const density = useSyncExternalStore(subscribeDensity, readDensity, () => "comfort" as Density);
  const [full, setFull] = useState(false);
  function chooseDensity(v: Density) {
    try { window.localStorage.setItem(DENSITY_KEY, v); } catch { /* ignoré si bloqué */ }
    window.dispatchEvent(new Event(DENSITY_KEY));
  }
  // Échap quitte le plein écran (sauf si une fenêtre est ouverte : elle se ferme d'abord).
  const modalOpen = !!(create || dup || openDay);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !modalOpen) setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, modalOpen]);

  const statusOf = useMemo(() => new Map(refs.statuses.map((s) => [s.key, s])), [refs.statuses]);
  const platformOf = useMemo(() => new Map(refs.platforms.map((p) => [p.key, p])), [refs.platforms]);
  const formatOf = useMemo(() => new Map(refs.formats.map((f) => [f.key, f])), [refs.formats]);
  const objectiveOf = useMemo(() => new Map(refs.objectives.map((o) => [o.key, o])), [refs.objectives]);
  const byDate = useMemo(() => { const m = new Map<string, ContentCard[]>(); for (const c of cards) (m.get(c.date) ?? m.set(c.date, []).get(c.date)!).push(c); return m; }, [cards]);

  function go(patch: Record<string, string | null>) {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    router.push(`/marketing/planning?${q.toString()}`);
  }
  const effectiveView: CalendarView = props.view ?? "month";
  const step = effectiveView === "week" ? 7 : 0;
  const nav = (dir: -1 | 1) => {
    if (step) return go({ d: shift(props.anchor, dir * 7) });
    const x = d(props.anchor); x.setUTCMonth(x.getUTCMonth() + dir, 1); go({ d: x.toISOString().slice(0, 10) });
  };

  const DRAG_TYPE = "application/x-comanet-content";
  const isDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
  function onDrop(e: React.DragEvent, date: string) {
    e.preventDefault();
    setOverDate(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id || !props.canEdit) return;
    setDragId(null);
    const cur = cards.find((c) => c.id === id);
    if (!cur || cur.date === date) return;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, date } : c)));
    startTransition(async () => {
      const r = await props.actions.move({ id, date });
      if (!r.ok) { setCards(props.cards); setToast({ text: r.error ?? "Déplacement refusé", tone: "err" }); }
      else router.refresh();
    });
  }

  /* --------------------------- Rendu d'une carte --------------------------- */
  /**
   * Trois tailles de carte :
   * - `mini` : une ligne (vue mois compacte, matrices) ;
   * - `comfort` : titre sur deux lignes, statut, format, heure, responsable (vue mois confort) ;
   * - `detail` : tout le brief en un coup d'œil (vue semaine, liste, journée).
   * Fond = couleur de la marque, pastille = statut, bordure rouge = retard.
   */
  function cardView(c: ContentCard, size: "mini" | "comfort" | "detail" = "detail") {
    const st = statusOf.get(c.status); const pf = platformOf.get(c.platform ?? "");
    const fmt = c.format ? formatOf.get(c.format)?.label ?? c.format : null;
    const obj = c.objective ? objectiveOf.get(c.objective)?.label ?? c.objective : null;
    const time = c.publishTime?.slice(0, 5) ?? null;
    const lateLabel = c.late === "PUBLICATION" ? "Publication en retard" : c.late === "LIVRABLE" ? "Livrable en retard" : null;
    const mini = size === "mini";
    const edge = c.late ? "var(--color-red)" : tint(c.color, mini ? 18 : 30);
    return (
      <div
        draggable={props.canEdit}
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG_TYPE, c.id); }}
        onDragEnd={() => { setDragId(null); setOverDate(null); }}
        className={clsx("group relative border transition-shadow hover:shadow-[var(--shadow-card)]", mini ? "rounded-md text-[12px] leading-tight" : "rounded-lg text-[13px] leading-snug", props.canEdit && "cursor-grab active:cursor-grabbing", dragId === c.id && "opacity-40", c.late && "ring-1 ring-red")}
        style={{ background: mini ? undefined : tint(c.color, 9), borderTopColor: edge, borderRightColor: edge, borderBottomColor: edge, borderLeftWidth: 4, borderLeftColor: c.color }}
        title={`${c.title}\n${c.brand} · ${st?.label ?? c.status}${fmt ? ` · ${fmt}` : ""}${time ? ` · ${time}` : ""}${c.responsible ? ` · ${c.responsible}` : ""}${lateLabel ? ` · ${lateLabel}` : ""}`}
      >
        <Link href={`/marketing/planning/${c.id}`} className={clsx("block", mini ? "px-1.5 py-1" : size === "comfort" ? "px-2 py-1.5" : "px-2.5 py-2")}>
          {mini ? (
            <div className="flex items-center gap-1 min-w-0">
              {pf && <span className="text-ink-2 shrink-0"><PlatformIcon icon={pf.icon} label={pf.label} size={12} /></span>}
              <span className="truncate font-medium">{c.title}</span>
              {c.late && <AlertTriangle size={11} className="text-red shrink-0 ml-auto" />}
            </div>
          ) : (
            <>
              {size === "detail" && <div className="text-[11px] font-semibold uppercase tracking-wide mb-0.5 truncate" style={{ color: c.color }}>{c.brand}</div>}
              <div className="flex items-start gap-1.5 min-w-0">
                {c.late ? <AlertTriangle size={14} className="text-red shrink-0 mt-0.5" />
                  : pf && <span className="text-ink-2 shrink-0 mt-0.5"><PlatformIcon icon={pf.icon} label={pf.label} size={14} /></span>}
                <span className={clsx("font-semibold text-ink break-words", size === "comfort" ? "line-clamp-3" : "line-clamp-4")}>{c.title}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className={clsx("badge text-[11px] py-0 max-w-full min-w-0 truncate block", lateLabel ? "bg-red-soft text-red" : toneClass(st?.tone))}>{lateLabel ?? st?.label ?? c.status}</span>
                {lateLabel && size === "detail" && <span className={clsx("badge text-[11px] py-0 max-w-full min-w-0 truncate block", toneClass(st?.tone))}>{st?.label ?? c.status}</span>}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2 min-w-0">
                <span className="truncate">{[fmt, time].filter(Boolean).join(" · ") || (pf?.label ?? "")}</span>
                {c.responsible && (
                  <span className="ml-auto shrink-0 inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-white/80 border border-line text-[10px] font-semibold text-ink-2" title={`Responsable : ${c.responsible}`}>{initials(c.responsible)}</span>
                )}
              </div>
              {size === "detail" && (
                <div className="mt-1.5 pt-1.5 border-t border-black/5 space-y-0.5 text-[12px] text-ink-2">
                  {c.product && <div className="truncate"><span className="text-muted">Produit :</span> {c.product}{c.productCount > 1 ? ` +${c.productCount - 1}` : ""}</div>}
                  {obj && <div className="truncate"><span className="text-muted">Objectif :</span> {obj}</div>}
                  {c.deadline && <div><span className="text-muted">Livrable attendu le</span> {fmtShort.format(d(c.deadline))}</div>}
                  <div className="flex items-center gap-2.5 pt-0.5">
                    <span className={clsx("inline-flex items-center gap-1", c.hasDeliverable ? "text-green" : "text-faint")}>{c.hasDeliverable ? <Check size={12} /> : <X size={12} />}Livrable</span>
                    <span className={clsx("inline-flex items-center gap-1", c.hasCaption ? "text-green" : "text-faint")}>{c.hasCaption ? <Check size={12} /> : <X size={12} />}Légende</span>
                  </div>
                </div>
              )}
            </>
          )}
        </Link>
        {props.canCreate && (
          <button type="button" onClick={(e) => { e.preventDefault(); setDup(c); }} className="absolute right-1 top-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-md bg-surface border border-line text-ink-2 hover:text-ink" title="Dupliquer" aria-label="Dupliquer">
            <Copy size={12} />
          </button>
        )}
      </div>
    );
  }

  function dayCell(date: string, cardsOfDay: ContentCard[], tall?: boolean) {
    const inMonth = date >= props.start && date < props.end;
    const isToday = date === todayIso;
    const comfort = density === "comfort";
    // Vue mois confort : 3 cartes au plus, le reste derrière « + N autres » (la journée s'ouvre en grand).
    const limit = !tall && comfort && cardsOfDay.length > MONTH_VISIBLE ? MONTH_VISIBLE - 1 : cardsOfDay.length;
    const hidden = cardsOfDay.length - limit;
    return (
      <div
        onDragOver={(e) => { if (isDrag(e)) { e.preventDefault(); setOverDate(date); } }}
        onDragLeave={() => setOverDate((o) => (o === date ? null : o))}
        onDrop={(e) => onDrop(e, date)}
        className={clsx("group/cell relative flex flex-col border-t border-l border-line min-w-0", comfort ? "gap-1.5 p-2" : "gap-1 p-1.5",
          tall ? "min-h-[440px]" : comfort ? "min-h-[168px]" : "min-h-[104px]",
          !inMonth && "bg-surface-2/60 text-faint", overDate === date && "bg-accent-soft ring-2 ring-inset ring-accent/50", date < todayIso && inMonth && "bg-black/[0.015]")}
      >
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => cardsOfDay.length ? setOpenDay(date) : props.canCreate && setCreate({ date })}
            className={clsx("inline-flex items-center justify-center rounded-full font-semibold hover:bg-black/5", comfort ? "h-7 min-w-7 px-1.5 text-[14px]" : "h-5 min-w-5 px-1 text-[11px]", isToday && "bg-ink text-white hover:bg-ink")}
            title={cardsOfDay.length ? "Voir la journée" : undefined}>{Number(date.slice(8, 10))}</button>
          {props.canCreate && (
            <button type="button" onClick={() => setCreate({ date })} className={clsx("opacity-0 group-hover/cell:opacity-100 focus:opacity-100 rounded-md hover:bg-black/5 flex items-center justify-center text-ink-2", comfort ? "h-7 w-7" : "h-5 w-5")} title="Ajouter un contenu" aria-label="Ajouter un contenu">
              <Plus size={comfort ? 15 : 12} />
            </button>
          )}
        </div>
        {cardsOfDay.slice(0, limit).map((c) => <div key={c.id}>{cardView(c, tall ? "detail" : comfort ? "comfort" : "mini")}</div>)}
        {hidden > 0 && (
          <button type="button" onClick={() => setOpenDay(date)} className="text-left text-[12px] font-medium text-accent hover:underline px-1">+ {hidden} autre{hidden > 1 ? "s" : ""}</button>
        )}
      </div>
    );
  }

  /* ------------------------------- Vues ------------------------------- */
  const monthDays = useMemo(() => {
    const first = d(props.start); const offset = (first.getUTCDay() + 6) % 7;
    const gridStart = shift(props.start, -offset);
    const n = Math.ceil((offset + Math.round((d(props.end).getTime() - first.getTime()) / 86400000)) / 7) * 7;
    return range(gridStart, n);
  }, [props.start, props.end]);
  const weekDays = useMemo(() => range(props.start, 7), [props.start]);

  const grid = (days: string[], tall?: boolean) => (
    <div className="card overflow-hidden">
      <div className={clsx("grid grid-cols-7 font-semibold text-muted bg-surface-2", density === "comfort" || tall ? "text-[13px]" : "text-[11px]")}>
        {DAYS.map((x, i) => <div key={x} className={clsx("px-2 py-2 border-l border-line first:border-l-0", tall && days[i] === todayIso && "text-accent")}>{x}{tall && <span className="ml-1.5 text-ink">{fmtShort.format(d(days[i]))}</span>}</div>)}
      </div>
      <div className="grid grid-cols-7 border-b border-r border-line">
        {days.map((date) => <div key={date} className="contents">{dayCell(date, byDate.get(date) ?? [], tall)}</div>)}
      </div>
    </div>
  );

  /** Lignes = marques ou plateformes, colonnes = jours. Les trous et les jours surchargés sautent aux yeux. */
  const matrix = (days: string[]) => {
    const rows = props.mode === "brand"
      ? props.brands.filter((b) => b.active || cards.some((c) => c.brandId === b.id)).map((b) => ({ key: b.id, label: b.name, color: b.color, icon: null as string | null, match: (c: ContentCard) => c.brandId === b.id }))
      : [...refs.platforms.filter((p) => p.active || cards.some((c) => c.platform === p.key)).map((p) => ({ key: p.key, label: p.label, color: null as string | null, icon: p.icon, match: (c: ContentCard) => c.platform === p.key })),
        { key: "__none", label: "Sans plateforme", color: null, icon: null, match: (c: ContentCard) => !c.platform }];
    const wide = days.length > 7;
    const comfort = density === "comfort";
    return (
      <div className="card overflow-x-auto">
        <table className={clsx("border-collapse", comfort ? "text-[12px]" : "text-[11px]")} style={{ minWidth: wide ? days.length * (comfort ? 64 : 48) + 180 : "100%", width: "100%" }}>
          <thead><tr className="bg-surface-2">
            <th className="sticky left-0 z-10 bg-surface-2 text-left px-3 py-2 font-semibold text-muted w-[180px]">{props.mode === "brand" ? "Marque" : "Plateforme"}</th>
            {days.map((date) => <th key={date} className={clsx("px-1 py-2 font-semibold text-center border-l border-line", date === todayIso ? "text-accent" : "text-muted")}>{wide ? <><span className="block text-[10px] font-medium">{DAYS[(d(date).getUTCDay() + 6) % 7]}</span>{Number(date.slice(8, 10))}</> : `${DAYS[(d(date).getUTCDay() + 6) % 7]} ${Number(date.slice(8, 10))}`}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const rowCards = cards.filter(r.match);
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className={clsx("sticky left-0 z-10 bg-surface px-3 font-semibold whitespace-nowrap", comfort ? "py-2.5 text-[13px]" : "py-1.5")}>
                    <span className="inline-flex items-center gap-1.5">{r.color ? <BrandDot color={r.color} /> : <PlatformIcon icon={r.icon} label={r.label} size={14} />}{r.label}<span className="text-faint font-normal">· {rowCards.length}</span></span>
                  </td>
                  {days.map((date) => {
                    const cell = rowCards.filter((c) => c.date === date);
                    return (
                      <td key={date}
                        onDragOver={(e) => { if (isDrag(e)) { e.preventDefault(); setOverDate(date); } }}
                        onDrop={(e) => onDrop(e, date)}
                        onDoubleClick={() => props.canCreate && setCreate({ date, brandId: props.mode === "brand" ? r.key : undefined, platform: props.mode === "platform" && r.key !== "__none" ? r.key : undefined })}
                        className={clsx("border-l border-line align-top", comfort ? "p-1" : "p-0.5", overDate === date && "bg-accent-soft", cell.length >= 3 && "bg-orange-soft/60")}
                        title={cell.length ? cell.map((c) => c.title).join("\n") : props.canCreate ? "Double-clic : ajouter" : ""}>
                        <div className={clsx("flex", wide ? "flex-col gap-1" : "flex-col gap-1.5")}>
                          {cell.map((c) => {
                            if (!wide) return <div key={c.id} className="w-full">{cardView(c, comfort ? "comfort" : "mini")}</div>;
                            // Mois en matrice : une étiquette lisible par contenu (plateforme ou marque + format), couleur du statut.
                            const st = statusOf.get(c.status); const pf = platformOf.get(c.platform ?? "");
                            const fmt = c.format ? formatOf.get(c.format)?.label ?? c.format : null;
                            const label = fmt ? abbr(fmt) : props.mode === "platform" ? abbr(c.brand) : "";
                            return (
                              <Link key={c.id} href={`/marketing/planning/${c.id}`} draggable={props.canEdit} onDragStart={(e) => { setDragId(c.id); e.dataTransfer.setData(DRAG_TYPE, c.id); }} onDragEnd={() => setDragId(null)}
                                title={`${c.title}\n${c.brand} · ${st?.label ?? c.status}${fmt ? ` · ${fmt}` : ""}`}
                                className={clsx("w-full rounded flex items-center gap-1 px-1 font-semibold overflow-hidden whitespace-nowrap", comfort ? "h-6 text-[11px]" : "h-5 text-[10px]", props.mode === "brand" && toneClass(st?.tone), c.late && "ring-1 ring-red")}
                                style={props.mode === "platform" ? { background: tint(c.color, 18), color: "var(--color-ink)", borderLeft: `3px solid ${c.color}` } : undefined}>
                                {props.mode === "brand" && pf && <PlatformIcon icon={pf.icon} label={pf.label} size={comfort ? 11 : 10} />}
                                {props.mode === "platform" && <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", toneClass(st?.tone))} style={{ background: "currentColor" }} />}
                                <span className="truncate">{label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const listView = () => {
    const dates = [...byDate.keys()].sort();
    return (
      <div className="space-y-3">
        {dates.length === 0 && <div className="card card-pad text-sm text-muted">Aucun contenu sur cette période avec ces filtres.{props.canCreate && <> <button type="button" className="text-accent font-medium" onClick={() => setCreate({ date: props.start >= todayIso ? props.start : todayIso })}>Ajouter un contenu</button>.</>}</div>}
        {dates.map((date) => (
          <div key={date}>
            <div className={clsx("flex items-center gap-2 text-[14px] font-semibold mb-2", date === todayIso ? "text-accent" : "text-ink-2")}>
              <span className="capitalize">{fmtDay.format(d(date))}</span>{date === todayIso && <Badge tone="accent">Aujourd&apos;hui</Badge>}
              {props.canCreate && <button type="button" className="btn-ghost btn-sm h-7 px-1.5" onClick={() => setCreate({ date })} aria-label="Ajouter"><Plus size={14} /></button>}
            </div>
            <div className={clsx("grid gap-2.5", full ? "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3")}>{byDate.get(date)!.map((c) => <div key={c.id}>{cardView(c, density === "compact" ? "comfort" : "detail")}</div>)}</div>
          </div>
        ))}
      </div>
    );
  };

  const period = effectiveView === "week" ? `Semaine du ${fmtShort.format(d(props.start))}` : capitalize(new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d(props.start)));
  const sel = (name: string, label: string, options: { value: string; label: string }[]) => (
    <select key={name} aria-label={label} value={sp.get(name) ?? ""} onChange={(e) => go({ [name]: e.target.value || null })} className="select h-9 text-[13px] w-auto max-w-[200px]"><option value="">{label}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  );
  const anyFilter = ["brand", "platform", "format", "status", "responsible"].some((k) => sp.get(k));

  const seg = (active: boolean) => clsx("px-3 h-9 font-medium", active ? "bg-ink text-white" : "bg-surface hover:bg-surface-2 text-ink-2");
  const activeStatuses = refs.statuses.filter((s) => s.active && !s.isArchived);

  return (
    <div className={clsx(full ? "fixed inset-0 z-[45] bg-bg overflow-auto p-3 sm:p-5 space-y-3" : "space-y-3")}>
      {/* Barre d'outils, ligne 1 : période, vue, regroupement, affichage, création */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary btn-sm h-9 w-9 p-0" onClick={() => nav(-1)} aria-label="Période précédente"><ChevronLeft size={16} /></button>
          <button type="button" className="btn-secondary btn-sm h-9" onClick={() => go({ d: todayIso })}>Aujourd&apos;hui</button>
          <button type="button" className="btn-secondary btn-sm h-9 w-9 p-0" onClick={() => nav(1)} aria-label="Période suivante"><ChevronRight size={16} /></button>
          <span className="font-semibold text-[18px] px-2 whitespace-nowrap">{period}</span>
        </div>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[13px]">
          {(["month", "week", "list"] as const).map((v) => <button key={v} type="button" onClick={() => go({ view: v })} className={seg((props.view ?? "month") === v)}>{{ month: "Mois", week: "Semaine", list: "Liste" }[v]}</button>)}
        </div>
        {effectiveView !== "list" && (
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[13px]">
            {(["date", "brand", "platform"] as const).map((m) => <button key={m} type="button" onClick={() => go({ mode: m === "date" ? null : m })} className={seg(props.mode === m)}>{{ date: "Par date", brand: "Par marque", platform: "Par plateforme" }[m]}</button>)}
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <div className="hidden sm:inline-flex rounded-lg border border-line overflow-hidden text-[13px]" role="group" aria-label="Taille des cartes">
            {(["comfort", "compact"] as const).map((v) => <button key={v} type="button" onClick={() => chooseDensity(v)} className={seg(density === v)} aria-pressed={density === v}>{{ comfort: "Confort", compact: "Compact" }[v]}</button>)}
          </div>
          <button type="button" className="hidden lg:inline-flex btn-secondary btn-sm h-9 items-center gap-1.5" onClick={() => setFull((f) => !f)} title={full ? "Quitter le plein écran (Échap)" : "Afficher le planning sur tout l'écran"}>
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{full ? "Réduire" : "Plein écran"}
          </button>
          {props.canCreate && <button type="button" className="btn-primary btn-sm h-9" onClick={() => setCreate({ date: props.start >= todayIso ? props.start : todayIso, brandId: sp.get("brand") ?? undefined, platform: sp.get("platform") ?? undefined })}><Plus size={15} /> Contenu</button>}
        </div>
      </div>

      {/* Ligne 2 : filtres */}
      <div className="flex flex-wrap items-center gap-1.5">
        {sel("brand", "Toutes les marques", props.brands.filter((b) => b.active).map((b) => ({ value: b.id, label: b.name })))}
        {sel("platform", "Toutes les plateformes", refs.platforms.filter((p) => p.active).map((p) => ({ value: p.key, label: p.label })))}
        {sel("format", "Tous les formats", refs.formats.filter((f) => f.active).map((f) => ({ value: f.key, label: f.label })))}
        {sel("status", "Tous les statuts", refs.statuses.filter((s) => s.active).map((s) => ({ value: s.key, label: s.label })))}
        {sel("responsible", "Tous les responsables", props.users.map((u) => ({ value: u.id, label: u.name })))}
        {anyFilter && <button type="button" className="btn-ghost btn-sm h-9" onClick={() => go({ brand: null, platform: null, format: null, status: null, responsible: null })}>Effacer les filtres</button>}
      </div>

      {/* Indicateurs */}
      <Indicators ind={props.indicators} statuses={refs.statuses} onStatus={(k) => go({ status: k })} />

      {/* Corps */}
      <div className={clsx(pending && "opacity-70 transition-opacity")}>
        {props.view === null ? (
          <>
            <div className="lg:hidden">{listView()}</div>
            <div className="hidden lg:block">{props.mode === "date" ? grid(monthDays) : matrix(monthDays.filter((x) => x >= props.start && x < props.end))}</div>
          </>
        ) : props.view === "list" ? listView()
          : props.mode !== "date" ? matrix(props.view === "week" ? weekDays : monthDays.filter((x) => x >= props.start && x < props.end))
          : props.view === "week" ? grid(weekDays, true) : grid(monthDays)}
      </div>

      {/* Légende */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
        <span className="font-semibold text-ink-2">Légende</span>
        <span>Fond et bord gauche = couleur de la marque</span>
        <span className="hidden sm:inline text-faint">|</span>
        <span className="inline-flex flex-wrap items-center gap-1">Statut :{activeStatuses.map((s) => <span key={s.key} className={clsx("badge text-[11px] py-0", toneClass(s.tone))}>{s.label}</span>)}</span>
        <span className="hidden sm:inline text-faint">|</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle size={12} className="text-red" /> bordure rouge = en retard</span>
        <span className="hidden sm:inline text-faint">|</span>
        <span>Pastille ronde = initiales du responsable</span>
      </div>

      {openDay && (
        <Modal title={capitalize(fmtDay.format(d(openDay)))} onClose={() => setOpenDay(null)} wide>
          <div className="grid sm:grid-cols-2 gap-2.5">{(byDate.get(openDay) ?? []).map((c) => <div key={c.id}>{cardView(c, "detail")}</div>)}</div>
          {props.canCreate && <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => { const date = openDay; setOpenDay(null); setCreate({ date }); }}><Plus size={14} /> Ajouter un contenu ce jour</button>}
        </Modal>
      )}

      {create && <QuickCreate init={create} {...props} onClose={() => setCreate(null)} onDone={(r) => { setCreate(null); if ("id" in r) { setToast({ text: "Contenu ajouté au planning.", href: `/marketing/planning/${r.id}`, tone: "ok" }); router.refresh(); } else setToast({ text: r.error, tone: "err" }); }} />}
      {dup && <Duplicate card={dup} refs={refs} onClose={() => setDup(null)} onDone={(r) => { setDup(null); if ("id" in r) { setToast({ text: "Contenu dupliqué.", href: `/marketing/planning/${r.id}`, tone: "ok" }); router.refresh(); } else setToast({ text: r.error, tone: "err" }); }} action={props.actions.duplicate} />}
      {toast && (
        <div className={clsx("fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl px-4 py-2.5 text-[13px] shadow-[var(--shadow-pop)] flex items-center gap-3", toast.tone === "ok" ? "bg-ink text-white" : "bg-red text-white")} role="status">
          {toast.text}{toast.href && <Link href={toast.href} className="underline font-medium">Ouvrir le brief</Link>}
          <button type="button" onClick={() => setToast(null)} aria-label="Fermer"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Indicateurs ------------------------------ */

function Indicators({ ind, statuses, onStatus }: { ind: PeriodIndicators; statuses: ContentRefs["statuses"]; onStatus: (key: string | null) => void }) {
  const awaiting = statuses.find((s) => s.awaitingValidation);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="badge bg-black/5 text-ink-2">Planifiés · <b>{ind.planned}</b></span>
      <span className="badge bg-green-soft text-green">Publiés · <b>{ind.published}</b></span>
      <button type="button" onClick={() => awaiting && onStatus(awaiting.key)} className="badge bg-yellow-soft text-yellow hover:opacity-80">À valider · <b>{ind.awaiting}</b></button>
      <span className={clsx("badge", ind.late ? "bg-red-soft text-red" : "bg-black/5 text-ink-2")}>En retard · <b>{ind.late}</b></span>
      <span className="hidden sm:inline text-faint">|</span>
      <span className="hidden sm:flex items-center gap-1.5 flex-wrap">{ind.byBrand.map((b) => <span key={b.brandId} className="inline-flex items-center gap-1 text-muted"><BrandDot color={b.color} />{b.brand} <b className="text-ink">{b.n}</b></span>)}</span>
      {ind.silentBrands.length > 0 && (
        <span className="inline-flex items-center gap-1 text-orange ml-auto" title={ind.silentBrands.map((b) => b.name).join(", ")}>
          <AlertTriangle size={13} /> Rien de prévu sous 7 jours : {ind.silentBrands.slice(0, 3).map((b) => b.name).join(", ")}{ind.silentBrands.length > 3 ? ` +${ind.silentBrands.length - 3}` : ""}
        </span>
      )}
    </div>
  );
}

/* ---------------------------- Création rapide ---------------------------- */

function QuickCreate({ init, brands, users, products, templates, refs, actions, onClose, onDone }: {
  init: { date: string; brandId?: string; platform?: string }; brands: Brand[]; users: User[]; products: Product[]; templates: Template[]; refs: ContentRefs;
  actions: CalendarActions; onClose: () => void; onDone: (r: { id: string } | { error: string }) => void;
}) {
  const [brandId, setBrandId] = useState(init.brandId ?? brands.find((b) => b.active)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const brandProducts = useMemo(() => products.filter((p) => p.brandId === brandId), [products, brandId]);
  const tpls = templates.filter((t) => !t.brandId || t.brandId === brandId);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const r = await actions.quickCreate(new FormData(e.currentTarget)).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    setBusy(false); onDone(r);
  }
  return (
    <Modal title="Nouveau contenu" onClose={onClose}>
      <form onSubmit={submit} className="space-y-2.5 text-[13px]">
        <label className="block"><span className="label block mb-1">Titre</span><input name="title" className="input h-9" required autoFocus placeholder="ex : Pro Collagenium — résultats 8 semaines" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" value={brandId} onChange={(e) => setBrandId(e.target.value)} className="select h-9" required>{brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Modèle de brief</span><select name="templateId" className="select h-9"><option value="">Aucun</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Plateforme</span><select name="platform" defaultValue={init.platform ?? ""} className="select h-9"><option value="">—</option>{refs.platforms.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Format</span><select name="format" className="select h-9"><option value="">—</option>{refs.formats.filter((f) => f.active).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Date de publication</span><input type="date" name="date" defaultValue={init.date} className="input h-9" required /></label>
          <label className="block"><span className="label block mb-1">Heure</span><input type="time" name="publishTime" className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">Objectif</span><select name="objective" className="select h-9"><option value="">—</option>{refs.objectives.filter((o) => o.active).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
          <label className="block"><span className="label block mb-1">Responsable création</span><select name="responsibleId" className="select h-9"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        </div>
        <label className="block"><span className="label block mb-1">Produits ({brandProducts.length} dans la bibliothèque)</span>
          <select name="productIds" multiple className="select min-h-[88px] py-1" size={4}>{brandProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span className="text-[11px] text-muted">Maintenir ⌘ / Ctrl pour en choisir plusieurs. Le reste du brief se complète sur la fiche.</span>
        </label>
        <div className="flex gap-2 pt-1"><button className="btn-primary btn-sm flex-1" type="submit" disabled={busy}>{busy ? "Ajout…" : "Ajouter au planning"}</button><button className="btn-secondary btn-sm" type="button" onClick={onClose}>Annuler</button></div>
      </form>
    </Modal>
  );
}

function Duplicate({ card, refs, action, onClose, onDone }: { card: ContentCard; refs: ContentRefs; action: CalendarActions["duplicate"]; onClose: () => void; onDone: (r: { id: string } | { error: string }) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await action({ id: card.id, date: String(fd.get("date") || ""), platform: String(fd.get("platform") || "") || null }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    setBusy(false); onDone(r);
  }
  return (
    <Modal title={`Dupliquer « ${card.title} »`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2.5 text-[13px]">
        <p className="text-muted text-[12px]">Le brief et les produits sont copiés ; les livrables ne le sont pas. Le nouveau contenu repart au premier statut.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="label block mb-1">Nouvelle date</span><input type="date" name="date" defaultValue={card.date} className="input h-9" /></label>
          <label className="block"><span className="label block mb-1">Plateforme</span><select name="platform" defaultValue={card.platform ?? ""} className="select h-9"><option value="">Identique</option>{refs.platforms.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
        </div>
        <div className="flex gap-2 pt-1"><button className="btn-primary btn-sm flex-1" type="submit" disabled={busy}>{busy ? "Duplication…" : "Dupliquer"}</button><button className="btn-secondary btn-sm" type="button" onClick={onClose}>Annuler</button></div>
      </form>
    </Modal>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={clsx("relative w-full bg-surface rounded-t-2xl sm:rounded-2xl shadow-[var(--shadow-pop)] p-4 max-h-[92dvh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-[15px]">{title}</h2><button type="button" className="btn-ghost h-8 w-8 p-0 rounded-lg" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
