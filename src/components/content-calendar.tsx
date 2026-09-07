"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Plus, X } from "lucide-react";
import { Badge, BrandDot } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { safeTone, type ContentRefs } from "@/lib/content/shared";
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
  // L'identifiant glissé vit dans une ref (lu au drop, sans attendre un re-rendu) ; l'état ne sert qu'à l'opacité.
  const dragRef = useRef<string | null>(null);
  const [dragId, setDragIdState] = useState<string | null>(null);
  const setDragId = (id: string | null) => { dragRef.current = id; setDragIdState(id); };
  const [overDate, setOverDate] = useState<string | null>(null);
  const [create, setCreate] = useState<{ date: string; brandId?: string; platform?: string } | null>(null);
  const [dup, setDup] = useState<ContentCard | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string; tone: "ok" | "err" } | null>(null);

  const statusOf = useMemo(() => new Map(refs.statuses.map((s) => [s.key, s])), [refs.statuses]);
  const platformOf = useMemo(() => new Map(refs.platforms.map((p) => [p.key, p])), [refs.platforms]);
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

  function onDrop(date: string) {
    setOverDate(null);
    const id = dragRef.current;
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
  function CardView({ c, compact }: { c: ContentCard; compact?: boolean }) {
    const st = statusOf.get(c.status); const pf = platformOf.get(c.platform ?? "");
    return (
      <div
        draggable={props.canEdit}
        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }}
        onDragEnd={() => { setDragId(null); setOverDate(null); }}
        className={clsx("group relative rounded-lg border bg-surface text-[12px] leading-tight transition-shadow", props.canEdit && "cursor-grab active:cursor-grabbing", dragId === c.id && "opacity-40", c.late ? "border-red/40" : "border-line")}
        style={{ borderLeftWidth: 3, borderLeftColor: c.color }}
        title={`${c.brand} · ${st?.label ?? c.status}${c.responsible ? ` · ${c.responsible}` : ""}${c.late === "PUBLICATION" ? " · Publication en retard" : c.late === "LIVRABLE" ? " · Livrable en retard" : ""}`}
      >
        <Link href={`/marketing/planning/${c.id}`} className={clsx("block", compact ? "px-1.5 py-1" : "px-2 py-1.5")}>
          <div className="flex items-center gap-1 min-w-0">
            {pf && <span className="text-ink-2 shrink-0"><PlatformIcon icon={pf.icon} label={pf.label} size={12} /></span>}
            <span className="truncate font-medium">{c.title}</span>
            {c.late && <AlertTriangle size={11} className="text-red shrink-0 ml-auto" />}
          </div>
          {!compact && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className={clsx("badge text-[10px] py-0", toneClass(st?.tone))}>{st?.label ?? c.status}</span>
              {c.publishTime && <span className="text-muted">{c.publishTime.slice(0, 5)}</span>}
              {c.responsible && <span className="text-muted truncate">{c.responsible.split(" ")[0]}</span>}
            </div>
          )}
        </Link>
        {props.canCreate && (
          <button type="button" onClick={(e) => { e.preventDefault(); setDup(c); }} className="absolute right-1 top-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded bg-surface-2 text-ink-2 hover:text-ink" title="Dupliquer" aria-label="Dupliquer">
            <Copy size={11} />
          </button>
        )}
      </div>
    );
  }

  function DayCell({ date, cardsOfDay, tall, children }: { date: string; cardsOfDay: ContentCard[]; tall?: boolean; children?: React.ReactNode }) {
    const inMonth = date >= props.start && date < props.end;
    const isToday = date === todayIso;
    return (
      <div
        onDragOver={(e) => { if (dragRef.current) { e.preventDefault(); setOverDate(date); } }}
        onDragLeave={() => setOverDate((o) => (o === date ? null : o))}
        onDrop={(e) => { e.preventDefault(); onDrop(date); }}
        className={clsx("group/cell relative flex flex-col gap-1 p-1.5 border-t border-l border-line min-w-0", tall ? "min-h-[320px]" : "min-h-[104px]", !inMonth && "bg-surface-2/60 text-faint", overDate === date && "bg-accent-soft ring-2 ring-inset ring-accent/50", date < todayIso && inMonth && "bg-black/[0.015]")}
      >
        <div className="flex items-center justify-between text-[11px]">
          <span className={clsx("inline-flex h-5 min-w-5 px-1 items-center justify-center rounded-full font-medium", isToday && "bg-ink text-white")}>{Number(date.slice(8, 10))}</span>
          {props.canCreate && (
            <button type="button" onClick={() => setCreate({ date })} className="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 h-5 w-5 rounded hover:bg-black/5 flex items-center justify-center text-ink-2" title="Ajouter un contenu" aria-label="Ajouter un contenu">
              <Plus size={12} />
            </button>
          )}
        </div>
        {children ?? cardsOfDay.map((c) => <CardView key={c.id} c={c} compact={!tall} />)}
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

  const Grid = ({ days, tall }: { days: string[]; tall?: boolean }) => (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 text-[11px] font-medium text-muted">
        {DAYS.map((x, i) => <div key={x} className="px-2 py-1.5 border-l border-line first:border-l-0">{x}{tall && <span className="ml-1 text-ink">{fmtShort.format(d(days[i]))}</span>}</div>)}
      </div>
      <div className="grid grid-cols-7 border-b border-r border-line">
        {days.map((date) => <DayCell key={date} date={date} cardsOfDay={byDate.get(date) ?? []} tall={tall} />)}
      </div>
    </div>
  );

  /** Lignes = marques ou plateformes, colonnes = jours. Les trous et les jours surchargés sautent aux yeux. */
  const Matrix = ({ days }: { days: string[] }) => {
    const rows = props.mode === "brand"
      ? props.brands.filter((b) => b.active || cards.some((c) => c.brandId === b.id)).map((b) => ({ key: b.id, label: b.name, color: b.color, icon: null as string | null, match: (c: ContentCard) => c.brandId === b.id }))
      : [...refs.platforms.filter((p) => p.active || cards.some((c) => c.platform === p.key)).map((p) => ({ key: p.key, label: p.label, color: null as string | null, icon: p.icon, match: (c: ContentCard) => c.platform === p.key })),
        { key: "__none", label: "Sans plateforme", color: null, icon: null, match: (c: ContentCard) => !c.platform }];
    const wide = days.length > 7;
    return (
      <div className="card overflow-x-auto">
        <table className="text-[11px] border-collapse" style={{ minWidth: wide ? days.length * 44 + 160 : "100%" }}>
          <thead><tr>
            <th className="sticky left-0 z-10 bg-surface text-left px-3 py-2 font-medium text-muted w-[160px]">{props.mode === "brand" ? "Marque" : "Plateforme"}</th>
            {days.map((date) => <th key={date} className={clsx("px-1 py-2 font-medium text-center border-l border-line", date === todayIso && "text-accent")}>{wide ? Number(date.slice(8, 10)) : `${DAYS[(d(date).getUTCDay() + 6) % 7]} ${Number(date.slice(8, 10))}`}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const rowCards = cards.filter(r.match);
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">{r.color ? <BrandDot color={r.color} /> : <PlatformIcon icon={r.icon} label={r.label} size={12} />}{r.label}<span className="text-faint">· {rowCards.length}</span></span>
                  </td>
                  {days.map((date) => {
                    const cell = rowCards.filter((c) => c.date === date);
                    return (
                      <td key={date}
                        onDragOver={(e) => { if (dragRef.current) { e.preventDefault(); setOverDate(date); } }}
                        onDrop={(e) => { e.preventDefault(); onDrop(date); }}
                        onDoubleClick={() => props.canCreate && setCreate({ date, brandId: props.mode === "brand" ? r.key : undefined, platform: props.mode === "platform" && r.key !== "__none" ? r.key : undefined })}
                        className={clsx("border-l border-line align-top p-0.5", overDate === date && "bg-accent-soft", cell.length >= 3 && "bg-orange-soft/60")}
                        title={cell.length ? cell.map((c) => c.title).join("\n") : props.canCreate ? "Double-clic : ajouter" : ""}>
                        <div className={clsx("flex gap-0.5", wide ? "flex-col items-center" : "flex-wrap")}>
                          {cell.map((c) => {
                            const st = statusOf.get(c.status); const pf = platformOf.get(c.platform ?? "");
                            return wide
                              ? <Link key={c.id} href={`/marketing/planning/${c.id}`} draggable={props.canEdit} onDragStart={(e) => { setDragId(c.id); e.dataTransfer.setData("text/plain", c.id); }} onDragEnd={() => setDragId(null)} title={`${c.title} · ${st?.label ?? c.status}`} className={clsx("h-3.5 w-3.5 rounded-sm flex items-center justify-center", toneClass(st?.tone), c.late && "ring-1 ring-red")} style={props.mode === "platform" ? { background: c.color, color: "white" } : undefined}>{props.mode === "brand" && pf ? <PlatformIcon icon={pf.icon} label={pf.label} size={9} /> : null}</Link>
                              : <div key={c.id} className="w-full"><CardView c={c} compact /></div>;
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

  const ListView = () => {
    const dates = [...byDate.keys()].sort();
    return (
      <div className="space-y-3">
        {dates.length === 0 && <div className="card card-pad text-sm text-muted">Aucun contenu sur cette période avec ces filtres.{props.canCreate && <> <button type="button" className="text-accent font-medium" onClick={() => setCreate({ date: props.start >= todayIso ? props.start : todayIso })}>Ajouter un contenu</button>.</>}</div>}
        {dates.map((date) => (
          <div key={date}>
            <div className={clsx("flex items-center gap-2 text-[12px] font-medium mb-1.5", date === todayIso ? "text-accent" : "text-muted")}>
              <span className="capitalize">{fmtDay.format(d(date))}</span>{date === todayIso && <Badge tone="accent">Aujourd&apos;hui</Badge>}
              {props.canCreate && <button type="button" className="btn-ghost btn-sm h-6 px-1.5" onClick={() => setCreate({ date })} aria-label="Ajouter"><Plus size={12} /></button>}
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">{byDate.get(date)!.map((c) => <CardView key={c.id} c={c} />)}</div>
          </div>
        ))}
      </div>
    );
  };

  const period = effectiveView === "week" ? `Semaine du ${fmtShort.format(d(props.start))}` : capitalize(new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d(props.start)));
  const Sel = ({ name, value, children, label }: { name: string; value: string | null; children: React.ReactNode; label: string }) => (
    <select aria-label={label} value={value ?? ""} onChange={(e) => go({ [name]: e.target.value || null })} className="select h-8 text-[12px] w-auto max-w-[170px]"><option value="">{label}</option>{children}</select>
  );
  const anyFilter = ["brand", "platform", "format", "status", "responsible"].some((k) => sp.get(k));

  return (
    <div className="space-y-3">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => nav(-1)} aria-label="Période précédente"><ChevronLeft size={14} /></button>
          <button type="button" className="btn-secondary btn-sm h-8" onClick={() => go({ d: todayIso })}>Aujourd&apos;hui</button>
          <button type="button" className="btn-secondary btn-sm h-8 w-8 p-0" onClick={() => nav(1)} aria-label="Période suivante"><ChevronRight size={14} /></button>
          <span className="font-semibold text-[15px] px-2 whitespace-nowrap">{period}</span>
        </div>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
          {(["month", "week", "list"] as const).map((v) => <button key={v} type="button" onClick={() => go({ view: v })} className={clsx("px-2.5 h-8", (props.view ?? "month") === v ? "bg-ink text-white" : "bg-surface hover:bg-surface-2")}>{{ month: "Mois", week: "Semaine", list: "Liste" }[v]}</button>)}
        </div>
        {effectiveView !== "list" && (
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
            {(["date", "brand", "platform"] as const).map((m) => <button key={m} type="button" onClick={() => go({ mode: m === "date" ? null : m })} className={clsx("px-2.5 h-8", props.mode === m ? "bg-ink text-white" : "bg-surface hover:bg-surface-2")}>{{ date: "Par date", brand: "Par marque", platform: "Par plateforme" }[m]}</button>)}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 ml-auto">
          <Sel name="brand" value={sp.get("brand")} label="Toutes les marques">{props.brands.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Sel>
          <Sel name="platform" value={sp.get("platform")} label="Toutes les plateformes">{refs.platforms.filter((p) => p.active).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Sel>
          <Sel name="format" value={sp.get("format")} label="Tous les formats">{refs.formats.filter((f) => f.active).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Sel>
          <Sel name="status" value={sp.get("status")} label="Tous les statuts">{refs.statuses.filter((s) => s.active).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Sel>
          <Sel name="responsible" value={sp.get("responsible")} label="Tous les responsables">{props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Sel>
          {anyFilter && <button type="button" className="btn-ghost btn-sm h-8" onClick={() => go({ brand: null, platform: null, format: null, status: null, responsible: null })}>Effacer</button>}
          {props.canCreate && <button type="button" className="btn-primary btn-sm h-8" onClick={() => setCreate({ date: props.start >= todayIso ? props.start : todayIso, brandId: sp.get("brand") ?? undefined, platform: sp.get("platform") ?? undefined })}><Plus size={14} /> Contenu</button>}
        </div>
      </div>

      {/* Indicateurs */}
      <Indicators ind={props.indicators} statuses={refs.statuses} onStatus={(k) => go({ status: k })} />

      {/* Corps */}
      <div className={clsx(pending && "opacity-70 transition-opacity")}>
        {props.view === null ? (
          <>
            <div className="lg:hidden"><ListView /></div>
            <div className="hidden lg:block">{props.mode === "date" ? <Grid days={monthDays} /> : <Matrix days={monthDays.filter((x) => x >= props.start && x < props.end)} />}</div>
          </>
        ) : props.view === "list" ? <ListView />
          : props.mode !== "date" ? <Matrix days={props.view === "week" ? weekDays : monthDays.filter((x) => x >= props.start && x < props.end)} />
          : props.view === "week" ? <Grid days={weekDays} tall /> : <Grid days={monthDays} />}
      </div>

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

const TONE_CLASS: Record<string, string> = {
  red: "bg-red-soft text-red", orange: "bg-orange-soft text-orange", yellow: "bg-yellow-soft text-yellow", green: "bg-green-soft text-green",
  blue: "bg-blue-soft text-blue", purple: "bg-purple-soft text-purple", gray: "bg-black/5 text-ink-2", accent: "bg-accent-soft text-accent-2",
};
export function toneClass(t: string | null | undefined) { return TONE_CLASS[safeTone(t)]; }
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
