"use client";

/**
 * ADS COMMAND CENTER — une seule page, compacte, décisionnelle. Tout le détail vit dans des
 * drawers ; aucune logique métier ici : la charge utile vient de `buildCommandCenter()`.
 */
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Card, type Tone } from "@/components/ui";
import { fmtMAD, fmtNum, fmtPct, fmtAgo, fmtDate } from "@/lib/format";
import type { CommandCenterData, EntityDetail, EntityLevel, EntityPerf, Recommendation, WinnerVerdict } from "@/lib/ads-intel/types";
import type { HistorySearch } from "@/lib/ads-intel/command-center";

type Actions = {
  loadDetail: (level: EntityLevel, externalId: string, periodKey: string, custom?: { start?: string; end?: string }) => Promise<EntityDetail | null>;
  search: (q: HistorySearch) => Promise<EntityPerf[]>;
  syncNow: () => Promise<{ ok: boolean; message: string }>;
};

const PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Aujourd'hui" }, { key: "7d", label: "7 j" }, { key: "14d", label: "14 j" }, { key: "30d", label: "30 j" },
  { key: "mtd", label: "Mois" }, { key: "90d", label: "90 j" }, { key: "year", label: "Année" }, { key: "custom", label: "Perso." },
];

const DECISION_LABEL: Record<Recommendation["decision"], string> = {
  SCALE: "SCALER", INCREASE_BUDGET: "AUGMENTER", MAINTAIN: "MAINTENIR", OPTIMIZE: "OPTIMISER", PAUSE_REVIEW: "REVOIR", REDUCE_BUDGET: "RÉDUIRE",
  TEST: "TESTER", REUSE_WINNER: "RÉUTILISER", CREATE_NEW_CREATIVE: "NOUVELLE CRÉATIVE", CHANGE_ANGLE: "CHANGER L'ANGLE", CHANGE_AUDIENCE: "CHANGER L'AUDIENCE", DO_NOTHING: "NE RIEN FAIRE",
};
const WINNER_LABEL: Record<WinnerVerdict["cls"], { label: string; tone: Tone }> = {
  WINNER: { label: "Winner", tone: "green" }, PROMISING: { label: "Prometteur", tone: "blue" }, STABLE: { label: "Stable", tone: "gray" },
  FATIGUING: { label: "Fatigue", tone: "orange" }, UNDERPERFORMING: { label: "Sous-performe", tone: "red" }, INSUFFICIENT_DATA: { label: "Données insuffisantes", tone: "gray" },
};
const PERF_LABEL = { EXCELLENT: { label: "Excellente", tone: "green" as Tone }, STRONG: { label: "Forte", tone: "green" as Tone }, AVERAGE: { label: "Moyenne", tone: "gray" as Tone }, WEAK: { label: "Faible", tone: "red" as Tone }, UNKNOWN: { label: "Inconnue", tone: "gray" as Tone } };
const OPP_LABEL = { SCALE: { label: "SCALER", tone: "green" as Tone }, OPTIMIZE: { label: "OPTIMISER", tone: "orange" as Tone }, REVIEW: { label: "REVOIR", tone: "red" as Tone }, MAINTAIN: { label: "MAINTENIR", tone: "gray" as Tone }, INSUFFICIENT: { label: "PAS ASSEZ DE DONNÉES", tone: "gray" as Tone } };
const PUSH_LABEL = { PUSH_MORE: { label: "🔥 POUSSER DAVANTAGE", tone: "green" as Tone }, PUSH: { label: "POUSSER", tone: "green" as Tone }, HOLD: { label: "MAINTENIR", tone: "gray" as Tone }, DONT_PUSH: { label: "⚠️ NE PAS POUSSER", tone: "red" as Tone }, INSUFFICIENT: { label: "PAS ASSEZ DE DONNÉES", tone: "gray" as Tone } };

const cost = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v >= 100 ? Math.round(v).toLocaleString("fr-FR") : v.toFixed(2)} MAD`);
const arrow = (d: { direction: string; pct: number | null }) => (d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : d.direction === "flat" ? "→" : "·");
const trendTone = (d: { direction: string }, invert = true): string => (d.direction === "flat" || d.direction === "unknown" ? "text-muted" : (d.direction === "down") === invert ? "text-green" : "text-red");
const dot = (t: Tone) => ({ green: "bg-green", orange: "bg-orange", red: "bg-red", blue: "bg-blue", gray: "bg-faint", yellow: "bg-yellow", purple: "bg-purple", accent: "bg-accent" }[t]);

export function AdsCommandCenter({ data, actions, custom }: { data: CommandCenterData; actions: Actions; custom?: { start?: string; end?: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ level: EntityLevel; externalId: string; title: string } | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [history, setHistory] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showHealth, setShowHealth] = useState(false);

  const href = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (data.period.key !== "30d") p.set("period", data.period.key);
    if (data.brandId) p.set("brand", data.brandId);
    if (custom?.start) p.set("start", custom.start);
    if (custom?.end) p.set("end", custom.end);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const s = p.toString();
    return s ? `/marketing/ads?${s}` : "/marketing/ads";
  }, [data.period.key, data.brandId, custom]);

  const open = useCallback((level: EntityLevel, externalId: string | null, title: string) => {
    if (!externalId) return;
    setDrawer({ level, externalId, title });
    setDetail(null); setLoadingDetail(true);
    actions.loadDetail(level, externalId, data.period.key, custom).then((d) => { setDetail(d); setLoadingDetail(false); }).catch(() => setLoadingDetail(false));
  }, [actions, data.period.key, custom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(null); setHistory(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sync = () => start(async () => {
    const r = await actions.syncNow().catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setSyncMsg(r.message);
    router.refresh();
  });

  const s = data.snapshot; const h = data.health; const d = data.data; const b = data.budget;
  const connTone: Tone = d.verdict === "LIVE" ? "green" : d.verdict === "DEGRADED" ? "orange" : d.verdict === "DOWN" ? "red" : "gray";
  const connLabel = d.verdict === "LIVE" ? "Meta connecté" : d.verdict === "DEGRADED" ? "Connexion dégradée" : d.verdict === "DOWN" ? "Meta injoignable" : "Non connecté";
  const verdictOf = (e: EntityPerf) => data.winnerVerdicts[`${e.level}:${e.key}`];

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ HEADER */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-semibold tracking-tight mr-2">Digital Ads</h1>
          <div className="flex rounded-xl border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => router.push(href({ period: p.key === "30d" ? null : p.key }))}
                className={clsx("px-2.5 h-7 rounded-lg text-[12px] font-medium", data.period.key === p.key ? "bg-ink text-white" : "text-muted hover:text-ink")}>{p.label}</button>
            ))}
          </div>
          {data.period.key === "custom" && (
            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); router.push(href({ period: "custom", start: String(fd.get("start") ?? ""), end: String(fd.get("end") ?? "") })); }}>
              <input type="date" name="start" defaultValue={data.period.start} className="input h-7 w-36 text-[12px]" />
              <input type="date" name="end" defaultValue={custom?.end ?? ""} className="input h-7 w-36 text-[12px]" />
              <button className="btn-secondary btn-sm h-7" type="submit">OK</button>
            </form>
          )}
          <select className="select h-8 w-44 text-[12.5px]" value={data.brandId ?? ""} onChange={(e) => router.push(href({ brand: e.target.value || null }))}>
            <option value="">Toutes les marques</option>
            {data.brands.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
          </select>
          <Badge tone="blue">META</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tone={connTone} dot>{connLabel}</Badge>
          <span className="text-muted">{d.lastSuccessfulSync ? `synchro ${fmtAgo(d.lastSuccessfulSync)}` : "jamais synchronisé"}</span>
          <button type="button" onClick={sync} disabled={pending} className="btn-primary btn-sm h-8">{pending ? "Synchronisation…" : "Synchroniser"}</button>
          <button type="button" onClick={() => setHistory(true)} className="btn-secondary btn-sm h-8">Historique 🔍</button>
        </div>
      </div>
      {syncMsg && <div className="text-[12px] text-muted -mt-2">{syncMsg}</div>}
      {d.verdict !== "LIVE" && d.verdict !== "NONE" && (
        <div className="rounded-xl border border-orange/40 bg-orange-soft/50 px-3 py-2 text-[12.5px]">
          <b>Connexion Meta {d.verdict === "DOWN" ? "coupée" : "dégradée"}.</b> {d.lastSyncError ?? "Une synchronisation a échoué."}{" "}
          <a href="/marketing/ads/diagnostic" className="underline">Ouvrir le diagnostic</a> — les chiffres ci-dessous datent de la dernière synchronisation réussie{d.lastSuccessfulSync ? ` (${fmtAgo(d.lastSuccessfulSync)})` : ""}.
        </div>
      )}

      {/* ----------------------------------------------- SNAPSHOT + HEALTH */}
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <Card className="cursor-pointer" >
          <div onClick={() => setShowHealth((v) => !v)} role="button">
            <div className="label">Santé Ads</div>
            <div className={clsx("mt-1 text-[34px] font-semibold tabular-nums leading-none", h.tone === "green" ? "text-green" : h.tone === "orange" ? "text-orange" : h.tone === "red" ? "text-red" : "text-faint")}>
              {h.tone === "gray" ? "—" : h.score}<span className="text-[14px] text-faint font-normal"> / 100</span>
            </div>
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink-2">
              {h.why.length ? h.why.map((w, i) => <li key={i}>• {w}</li>) : <li className="text-faint">Pas assez de dépense pour noter.</li>}
            </ul>
            {showHealth && h.components.length > 0 && (
              <div className="mt-2 pt-2 border-t border-line text-[11px] space-y-0.5">
                {h.components.map((c) => <div key={c.label} className="flex justify-between gap-2"><span className="text-muted">{c.label}</span><span className="tabular-nums">{c.score}/{c.max} <span className="text-faint">{c.note}</span></span></div>)}
              </div>
            )}
          </div>
        </Card>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <Mini label="Dépense" value={fmtMAD(s.spend, { compact: true })} delta={s.spendDelta} deltaLabel={data.period.prevLabel} />
          <Mini label={cap(s.resultLabel)} value={fmtNum(s.results)} delta={s.resultsDelta} good />
          <Mini label={s.costLabel} value={cost(s.costPerResult)} delta={s.costDelta} invert />
          <Mini label="Conversations" value={fmtNum(s.messages)} sub={s.landing ? `${fmtNum(s.landing)} vues de page` : `${fmtNum(s.clicks)} clics`} />
          <Mini label="CA régie" value={s.revenue > 0 ? fmtMAD(s.revenue, { compact: true }) : "—"} sub={s.roas !== null ? `ROAS ${s.roas.toFixed(2)}×` : "non mesuré"} />
          <Mini label="Budget mois" value={b.consumedPct !== null ? fmtPct(b.consumedPct) : "non défini"} sub={b.monthlyBudget ? `${fmtMAD(b.monthSpend, { compact: true })} / ${fmtMAD(b.monthlyBudget, { compact: true })}` : fmtMAD(b.monthSpend, { compact: true })}
            tone={b.status === "OVERSPENDING" ? "red" : b.status === "WATCH" ? "orange" : b.status === "ON_TRACK" ? "green" : undefined} />
        </div>
      </div>

      {/* ---------------------------------------------------- ACTION CENTER */}
      <Section title="🚨 Action Center" hint={`${data.allActions.length} élément(s) analysés · ${data.actions.length} décision(s) retenue(s)`} action={data.allActions.length > data.actions.length ? <button type="button" className="text-[12px] underline text-muted" onClick={() => setShowAllActions((v) => !v)}>{showAllActions ? "Réduire" : `Tout voir (${data.allActions.length})`}</button> : null}>
        {data.actions.length === 0 ? (
          <Card><p className="text-[13px] text-muted">Aucune décision à prendre : rien ne dépasse les seuils d&apos;analyse ({data.thresholds.minSpend} MAD, {data.thresholds.minDays} j) sur cette période.</p></Card>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(showAllActions ? data.allActions : data.actions).map((r) => <ActionCard key={r.id} r={r} onOpen={() => open(r.level, r.externalId, r.title)} />)}
          </div>
        )}
      </Section>

      {/* ---------------------------------------- ALLOCATION + WINNERS */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Où mettre l'argent" hint="Performance = coût par résultat vs le propre historique de la marque">
          <Card pad={false}>
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Marque</th><th className="num">Dépense</th><th>Performance</th><th className="num">Tend.</th><th>Décision</th><th className="num">Conf.</th></tr></thead>
              <tbody>
                {data.allocation.map((a) => (
                  <tr key={a.brandId ?? "none"} className="cursor-pointer hover:bg-surface-2" onClick={() => open("brand", a.brandId, a.brandName)}>
                    <td className="font-medium"><span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: a.brandColor ?? "#9ca3af" }} />{a.brandName}</td>
                    <td className="num">{fmtMAD(a.spend, { compact: true, suffix: false })}<span className="text-faint text-[11px]"> {Math.round(a.sharePct)} %</span></td>
                    <td><Badge tone={PERF_LABEL[a.performance].tone}>{PERF_LABEL[a.performance].label}</Badge><span className="block text-[11px] text-faint">{a.performanceWhy}</span></td>
                    <td className={clsx("num font-semibold", trendTone(a.trend))} title={a.trend.pct !== null ? `${Math.round(a.trend.pct)} %` : "non mesurable"}>{arrow(a.trend)}</td>
                    <td><Badge tone={OPP_LABEL[a.opportunity].tone}>{OPP_LABEL[a.opportunity].label}</Badge></td>
                    <td className="num text-muted">{a.confidence} %</td>
                  </tr>
                ))}
                {!data.allocation.length && <tr><td colSpan={6} className="text-muted">Aucune dépense sur la période.</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>

        <Section title="Winners & problèmes" hint="Volume, coût vs référence, stabilité, récence, fatigue">
          <Card>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <TopList title="Top campagnes" rows={data.winners.campaigns} verdictOf={verdictOf} onOpen={(e) => open("campaign", e.externalCampaignId, e.campaignName)} />
              <TopList title="Top créatives" rows={data.winners.creatives} verdictOf={verdictOf} onOpen={(e) => open("creative", e.externalCreativeId, e.campaignName)} thumbs />
              <TopList title="Top produits" rows={data.winners.products} verdictOf={verdictOf} onOpen={(e) => open("product", e.productId, e.campaignName)} />
            </div>
            {data.winners.offers.length > 0 && (
              <div className="mt-3 pt-2 border-t border-line text-[11.5px]"><span className="label">Top offres</span> {data.winners.offers.map((o) => <span key={o.key} className="ml-2">{o.value} ({o.brandName ?? "toutes marques"}) · {cost(o.costPerResult)}</span>)}</div>
            )}
            {data.problems.length > 0 && (
              <div className="mt-3 pt-2 border-t border-line">
                <div className="label mb-1">Problèmes</div>
                <ul className="space-y-1 text-[12px]">
                  {data.problems.map((p) => {
                    const v = verdictOf(p);
                    return <li key={`${p.level}:${p.key}`} className="flex items-center gap-2 cursor-pointer hover:underline" onClick={() => open(p.level, p.level === "creative" ? p.externalCreativeId : p.externalCampaignId, p.campaignName)}>
                      <Badge tone={WINNER_LABEL[v.cls].tone}>{WINNER_LABEL[v.cls].label}</Badge><span className="truncate">{p.brandName ? `${p.brandName} — ` : ""}{p.campaignName}</span><span className="text-faint tabular-nums ml-auto">{fmtMAD(p.spend, { compact: true, suffix: false })}</span>
                    </li>;
                  })}
                </ul>
              </div>
            )}
          </Card>
        </Section>
      </div>

      {/* ------------------------------------------- PUSH + CONTENT */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Quoi pousser" hint="Coût vs marque, créatives performantes, historique, stock">
          <Card pad={false}>
            <table className="tbl text-[12.5px]">
              <thead><tr><th>Produit</th><th>Décision</th><th className="num">Dépense</th><th className="num">Coût / résultat</th><th>Pourquoi</th></tr></thead>
              <tbody>
                {data.push.map((p) => (
                  <tr key={p.productId ?? p.productName} className="cursor-pointer hover:bg-surface-2" onClick={() => open("product", p.productId, p.productName)}>
                    <td className="font-medium">{p.productName}<span className="block text-[11px] text-faint">{p.brandName}</span></td>
                    <td><Badge tone={PUSH_LABEL[p.decision].tone}>{PUSH_LABEL[p.decision].label}</Badge></td>
                    <td className="num">{fmtMAD(p.spend, { compact: true, suffix: false })}</td>
                    <td className="num">{cost(p.costPerResult)}</td>
                    <td className="text-[11.5px] text-ink-2 min-w-[220px] max-w-[300px] whitespace-normal">{p.why.slice(0, 2).join(" · ") || "—"}</td>
                  </tr>
                ))}
                {!data.push.length && <tr><td colSpan={5} className="text-muted">Aucun produit identifié dans les publicités de la période. Le catalogage rattache les produits par leur nom dans les textes ; corrigez-les dans le détail d&apos;une publicité.</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>

        <Section title="Quoi publier" hint="Angles et formats éprouvés × produits à pousser, score /100">
          <Card>
            {data.content.length === 0 ? (
              <p className="text-[13px] text-muted">Pas encore de motif mesuré : il faut des créatives étiquetées avec au moins {data.thresholds.winnerMinSpend} MAD de dépense par angle. Lancez le catalogage puis le rattrapage historique.</p>
            ) : (
              <ol className="space-y-2">
                {data.content.map((o, i) => (
                  <li key={o.id} className="flex gap-3">
                    <div className="w-10 shrink-0 text-center"><div className="text-[18px] font-semibold tabular-nums leading-none">{o.score}</div><div className="text-[10px] text-faint">/100</div></div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">{i + 1}. {o.title}{o.crossBrand && <Badge tone="purple" className="ml-2">transversal</Badge>}</div>
                      <div className="text-[11.5px] text-muted">{[o.brandName, o.format ? `format : ${o.format}` : null].filter(Boolean).join(" · ")}</div>
                      <ul className="text-[11.5px] text-ink-2 mt-0.5">{o.why.slice(0, 3).map((w, j) => <li key={j}>• {w}</li>)}</ul>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </Section>
      </div>

      {/* --------------------------------- CREATIVE HEALTH + IMPACT + BUDGET */}
      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <Section title="Santé des créatives" hint="Créatives actives (ou en fatigue) — clic pour le détail">
          <Card pad={false}>
            <table className="tbl text-[12.5px]">
              <thead><tr><th></th><th>Créative</th><th className="num">Dépense</th><th className="num">CTR</th><th className="num">Coût / résultat</th><th className="num">Fréq.</th><th className="num">Tend.</th><th>Fatigue</th></tr></thead>
              <tbody>
                {data.creativeHealth.map((c) => (
                  <tr key={c.key} className="cursor-pointer hover:bg-surface-2" onClick={() => open("creative", c.externalCreativeId, c.campaignName)}>
                    <td className="w-10">{c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="w-9 h-9 rounded-lg object-cover" /> : <div className="w-9 h-9 rounded-lg bg-surface-2" />}</td>
                    <td className="max-w-[260px]"><div className="truncate font-medium">{c.campaignName}</div><div className="text-[11px] text-faint truncate">{[c.brandName, c.productName, c.tags?.angle, c.tags?.format].filter(Boolean).join(" · ")}</div></td>
                    <td className="num">{fmtMAD(c.spend, { compact: true, suffix: false })}</td>
                    <td className="num">{c.ctr !== null ? `${c.ctr.toFixed(2)} %` : "—"}</td>
                    <td className="num">{cost(c.costPerResult)}</td>
                    <td className="num">{c.fatigue.frequency !== null ? c.fatigue.frequency.toFixed(1) : c.frequency !== null ? c.frequency.toFixed(1) : "—"}</td>
                    <td className={clsx("num font-semibold", trendTone(c.trend))}>{arrow(c.trend)}</td>
                    <td><Badge tone={c.fatigue.status === "FATIGUING" ? "orange" : c.fatigue.status === "WATCH" ? "yellow" : c.fatigue.status === "OK" ? "green" : "gray"}>{c.fatigue.status === "FATIGUING" ? "Fatigue" : c.fatigue.status === "WATCH" ? "À surveiller" : c.fatigue.status === "OK" ? "OK" : "—"}</Badge></td>
                  </tr>
                ))}
                {!data.creativeHealth.length && <tr><td colSpan={8} className="text-muted">Aucune créative active identifiée. Le catalogage Meta (Comptes → Cataloguer) relie chaque publicité à sa créative.</td></tr>}
              </tbody>
            </table>
          </Card>
        </Section>

        <div className="space-y-3">
          <Section title="Impact business" hint="Dépense → résultats → sell-in (corrélation)">
            <Card>
              <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                <KV label="Dépense" value={fmtMAD(data.impact.spend, { compact: true })} />
                <KV label={cap(data.impact.resultKind === "reach" ? "personnes touchées" : s.resultLabel)} value={fmtNum(data.impact.results)} />
                <KV label="CA attribué (régie)" value={data.impact.measuredRevenue > 0 ? fmtMAD(data.impact.measuredRevenue, { compact: true }) : "—"} />
                <KV label="ROAS" value={data.impact.roas !== null ? `${data.impact.roas.toFixed(2)}×` : "non mesurable"} />
                <KV label="Sell-in marque (période)" value={data.impact.sellIn !== null ? fmtMAD(data.impact.sellIn, { compact: true }) : "—"} sub={data.impact.sellInDeltaPct !== null ? `${data.impact.sellInDeltaPct > 0 ? "+" : ""}${Math.round(data.impact.sellInDeltaPct)} % vs période précédente` : "pas encore comparable"} />
                <KV label="Pub / sell-in" value={data.impact.spendToSalesPct !== null ? fmtPct(data.impact.spendToSalesPct, 1) : "—"} />
                <KV label="Valeur estimée" value={data.impact.estimatedValue !== null ? fmtMAD(data.impact.estimatedValue, { compact: true }) : "non mesurable"} />
                <KV label="Contribution après pub" value={data.impact.contribution !== null ? fmtMAD(data.impact.contribution, { compact: true }) : "non mesurable"} />
              </div>
              <ul className="mt-2 text-[11px] text-faint space-y-0.5">{data.impact.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </Card>
          </Section>
          {data.anomalies.length > 0 && (
            <Section title="Anomalies (7 j)" hint="z-score vs 28 journées précédentes">
              <Card>
                <ul className="space-y-1 text-[12px]">
                  {data.anomalies.map((a, i) => <li key={i} className="flex gap-2"><Badge tone={a.severity === "high" ? "red" : "orange"}>{a.label}</Badge><span>{fmtDate(a.date)} : {a.metric === "spend" || a.metric === "cpm" || a.metric === "cpc" || a.metric === "costPerResult" ? cost(a.value) : a.metric === "ctr" ? `${a.value.toFixed(2)} %` : fmtNum(a.value)} <span className="text-faint">(attendu {a.metric === "ctr" ? `${a.expected.toFixed(2)} %` : a.metric === "results" ? fmtNum(a.expected) : cost(a.expected)}, z {a.z.toFixed(1)})</span></span></li>)}
                </ul>
              </Card>
            </Section>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ DATA STATUS */}
      <Card className="text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Badge tone={connTone} dot>{connLabel}</Badge>
          <span className="text-muted">Dernière synchro réussie : {d.lastSuccessfulSync ? `${fmtDate(d.lastSuccessfulSync)} (${fmtAgo(d.lastSuccessfulSync)})` : "aucune"}</span>
          <span className="text-muted">Historique en base : {d.historyFirstDay ? `${fmtDate(d.historyFirstDay)} → ${fmtDate(d.historyLastDay)}` : "vide"} · {fmtNum(d.closedRows)} journées-publicités closes</span>
          {d.backfill.map((bf) => <span key={bf.name} className="text-muted">{bf.name} : rattrapage {bf.status === "DONE" ? "terminé" : bf.status === "RUNNING" ? `en cours (${bf.cursor})` : bf.status === "ERROR" ? "en erreur" : "non lancé"}</span>)}
          {d.unavailableMonths.length > 0 && <span className="text-orange">Historique indisponible : {d.unavailableMonths.join(", ")}</span>}
          <a href="/marketing/ads/diagnostic" className="underline text-muted">Diagnostic</a>
          <a href="/marketing/ads/comptes" className="underline text-muted">Comptes</a>
          <button type="button" className="underline text-muted" onClick={() => setShowMemory((v) => !v)}>Mémoire marketing ({data.memory.length})</button>
        </div>
        {showMemory && (
          <ul className="mt-2 pt-2 border-t border-line space-y-1">
            {data.memory.length ? data.memory.map((m) => <li key={m.key}><Badge tone="purple">{m.scope}</Badge> <span className="ml-1">{m.statement}</span> <span className="text-faint">conf. {m.confidence} %</span></li>) : <li className="text-faint">Rien d&apos;appris encore : la mémoire se construit à partir des motifs mesurés.</li>}
          </ul>
        )}
      </Card>

      {drawer && <Drawer title={drawer.title} onClose={() => setDrawer(null)}>
        <DetailView detail={detail} loading={loadingDetail} onOpen={open} />
      </Drawer>}
      {history && <Drawer title="Recherche dans l'historique" onClose={() => setHistory(false)} wide>
        <HistoryView search={actions.search} brands={data.brands} onOpen={(lvl, id, title) => { open(lvl, id, title); }} />
      </Drawer>}
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide">{title}</h2>
        <div className="flex items-center gap-3">{hint && <span className="text-[11px] text-faint">{hint}</span>}{action}</div>
      </div>
      {children}
    </section>
  );
}

function Mini({ label, value, sub, delta, deltaLabel, invert, good, tone }: { label: string; value: string; sub?: string; delta?: number | null; deltaLabel?: string; invert?: boolean; good?: boolean; tone?: string }) {
  const dl = delta === null || delta === undefined ? null : delta;
  const isGood = dl === null ? null : invert ? dl < 0 : good ? dl > 0 : null;
  return (
    <div className="card card-pad !p-3">
      <div className="label text-[10.5px]">{label}</div>
      <div className={clsx("mt-1 text-[17px] font-semibold tabular-nums leading-tight", tone && `text-${tone}`)}>{value}</div>
      <div className="text-[11px] text-muted mt-0.5 truncate">
        {dl !== null && Number.isFinite(dl) ? <span className={clsx("font-medium", isGood === null ? "text-muted" : isGood ? "text-green" : "text-red")}>{dl > 0 ? "+" : ""}{Math.round(dl)} %</span> : null}
        {dl !== null && deltaLabel ? <span className="text-faint"> {deltaLabel}</span> : null}
        {sub ? <span>{dl !== null ? " · " : ""}{sub}</span> : null}
      </div>
    </div>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="label text-[10.5px]">{label}</div><div className="font-semibold tabular-nums">{value}</div>{sub && <div className="text-[11px] text-faint">{sub}</div>}</div>;
}

function ActionCard({ r, onOpen }: { r: Recommendation; onOpen: () => void }) {
  return (
    <div className={clsx("card card-pad !p-3 cursor-pointer hover:border-line-2 border-l-4", r.tone === "green" ? "border-l-green" : r.tone === "orange" ? "border-l-orange" : r.tone === "red" ? "border-l-red" : r.tone === "blue" ? "border-l-blue" : "border-l-faint")} onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide"><span className={clsx("w-2 h-2 rounded-full", dot(r.tone))} />{DECISION_LABEL[r.decision]}</span>
        <span className="text-[11px] text-muted tabular-nums" title={r.confidenceWhy.join("\n")}>Confiance {r.confidence} %</span>
      </div>
      <div className="mt-1 text-[13px] font-medium truncate" title={r.title}>{r.title}</div>
      <ul className="mt-1 text-[11.5px] text-ink-2 space-y-0.5">{r.why.slice(0, 3).map((w, i) => <li key={i} className="truncate" title={w}>{w}</li>)}</ul>
      <div className="mt-2 text-[12px]"><span className="label text-[10px]">Action</span><div className="font-medium">{r.action}</div></div>
    </div>
  );
}

function TopList({ title, rows, verdictOf, onOpen, thumbs }: { title: string; rows: EntityPerf[]; verdictOf: (e: EntityPerf) => WinnerVerdict | undefined; onOpen: (e: EntityPerf) => void; thumbs?: boolean }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {rows.length === 0 ? <div className="text-[11.5px] text-faint">Aucun élément au-dessus des seuils.</div> : (
        <ol className="space-y-1">
          {rows.map((e, i) => {
            const v = verdictOf(e);
            return (
              <li key={e.key} className="flex items-center gap-2 text-[12px] cursor-pointer hover:underline" onClick={() => onOpen(e)}>
                <span className="text-faint w-3">{i + 1}</span>
                {thumbs && (e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" className="w-6 h-6 rounded object-cover" /> : <span className="w-6 h-6 rounded bg-surface-2 inline-block" />)}
                <span className="truncate flex-1" title={e.campaignName}>{e.campaignName}</span>
                {v && <Badge tone={WINNER_LABEL[v.cls].tone}>{v.score}</Badge>}
                <span className="text-faint tabular-nums">{cost(e.costPerResult)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className={clsx("relative h-full bg-surface border-l border-line shadow-2xl overflow-y-auto w-full", wide ? "max-w-4xl" : "max-w-2xl")}>
        <div className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-center justify-between gap-3 z-10">
          <h3 className="text-[14px] font-semibold truncate">{title}</h3>
          <button type="button" className="btn-secondary btn-sm h-7" onClick={onClose}>Fermer</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function DetailView({ detail, loading, onOpen }: { detail: EntityDetail | null; loading: boolean; onOpen: (level: EntityLevel, id: string | null, title: string) => void }) {
  if (loading) return <p className="text-[13px] text-muted">Chargement…</p>;
  if (!detail) return <p className="text-[13px] text-muted">Aucune donnée pour cet élément sur la période.</p>;
  const e = detail.entity; const bm = detail.benchmark; const r = detail.recommendation; const w = detail.winner;
  const maxSpend = Math.max(1, ...detail.daily.map((p) => p.spend));
  const childLevel: EntityLevel = e.level === "campaign" ? "adset" : e.level === "adset" ? "ad" : e.level === "ad" ? "creative" : e.level === "brand" ? "campaign" : "ad";
  const idOf = (c: EntityPerf) => (childLevel === "adset" ? c.externalAdsetId : childLevel === "ad" ? c.externalId : childLevel === "creative" ? c.externalCreativeId : c.externalCampaignId);
  return (
    <div className="space-y-4 text-[12.5px]">
      <div className="flex gap-3">
        {e.thumbnailUrl && <img src={e.thumbnailUrl} alt="" className="w-20 h-20 rounded-xl object-cover" />}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5 items-center">
            <Badge tone={WINNER_LABEL[w.cls].tone}>{WINNER_LABEL[w.cls].label} · {w.score}</Badge>
            {e.effectiveStatus && <Badge tone={e.effectiveStatus === "ACTIVE" ? "green" : "gray"}>{e.effectiveStatus}</Badge>}
            {e.objective && <Badge tone="blue">{e.objective}</Badge>}
            {e.brandName && <Badge tone="gray">{e.brandName}</Badge>}
            {e.productName && <Badge tone="accent">{e.productName}</Badge>}
            {Object.entries(e.tags ?? {}).filter(([k]) => k !== "hook").map(([k, v]) => <Badge key={k} tone="purple">{v}</Badge>)}
          </div>
          <div className="text-[11.5px] text-muted mt-1">{e.accountName} · {e.firstDay ? `${fmtDate(e.firstDay)} → ${fmtDate(e.lastDay)}` : ""} · {e.days} j · {e.adCount} pub.</div>
          {e.body && <p className="mt-1 text-[12px] text-ink-2 line-clamp-3">{e.body}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <KV label="Dépense" value={fmtMAD(e.spend, { compact: true })} />
        <KV label="Résultats" value={fmtNum(e.results)} sub={e.resultKind} />
        <KV label="Coût / résultat" value={cost(e.costPerResult)} />
        <KV label="CTR" value={e.ctr !== null ? `${e.ctr.toFixed(2)} %` : "—"} />
        <KV label="CPM" value={cost(e.cpm)} />
        <KV label="Fréquence" value={e.frequency !== null ? e.frequency.toFixed(1) : "—"} />
      </div>

      {r && (
        <div className={clsx("rounded-xl border p-3", r.tone === "green" ? "border-green/40 bg-green-soft/40" : r.tone === "red" ? "border-red/40 bg-red-soft/40" : r.tone === "orange" ? "border-orange/40 bg-orange-soft/40" : "border-line bg-surface-2")}>
          <div className="flex justify-between"><b>{DECISION_LABEL[r.decision]}</b><span className="text-muted">Confiance {r.confidence} % · verdict {r.verdict}</span></div>
          <div className="mt-1">{r.headline}</div>
          <ul className="mt-1 text-[11.5px] text-ink-2">{r.why.map((x, i) => <li key={i}>• {x}</li>)}</ul>
          <div className="mt-1.5"><span className="label text-[10px]">Action</span> {r.action}</div>
          <details className="mt-1 text-[11px] text-faint"><summary>Pourquoi cette confiance</summary><ul>{r.confidenceWhy.map((x, i) => <li key={i}>{x}</li>)}</ul></details>
        </div>
      )}

      {bm && (
        <div>
          <div className="label mb-1">Benchmark historique</div>
          <p className="mb-1 font-medium">{bm.verdict}</p>
          <table className="tbl text-[12px]"><thead><tr><th>Référence</th><th className="num">Coût / résultat</th><th className="num">CTR</th><th>Note</th></tr></thead>
            <tbody>
              <tr><td>Cette période</td><td className="num font-semibold">{cost(e.costPerResult)}</td><td className="num">{e.ctr !== null ? `${e.ctr.toFixed(2)} %` : "—"}</td><td></td></tr>
              {[bm.previous, bm.brand, bm.objective, bm.historical, bm.best, bm.product].map((x) => <tr key={x.label}><td>{x.label}</td><td className="num">{cost(x.costPerResult)}</td><td className="num">{x.ctr !== null ? `${x.ctr.toFixed(2)} %` : "—"}</td><td className="text-faint">{x.note ?? ""}</td></tr>)}
            </tbody></table>
        </div>
      )}

      {detail.fatigue && (
        <div><div className="label mb-1">Fatigue</div><Badge tone={detail.fatigue.status === "FATIGUING" ? "orange" : detail.fatigue.status === "WATCH" ? "yellow" : detail.fatigue.status === "OK" ? "green" : "gray"}>{detail.fatigue.status}</Badge> <span className="text-ink-2">{detail.fatigue.reasons.join(" · ")}</span></div>
      )}

      {detail.daily.length > 0 && (
        <div>
          <div className="label mb-1">Dépense par jour ({detail.daily.length} j) · tendance coût {arrow(detail.trend)} {detail.trend.pct !== null ? `${Math.round(detail.trend.pct)} %` : ""}</div>
          <div className="flex items-end gap-px h-16">
            {detail.daily.map((p) => <div key={p.date} title={`${fmtDate(p.date)} : ${fmtMAD(p.spend)}`} className="flex-1 bg-accent/70 rounded-sm" style={{ height: `${Math.max(2, (p.spend / maxSpend) * 100)}%` }} />)}
          </div>
        </div>
      )}

      {detail.history.length > 1 && (
        <div>
          <div className="label mb-1">Historique mensuel</div>
          <table className="tbl text-[12px]"><thead><tr><th>Mois</th><th className="num">Dépense</th><th className="num">Résultats</th><th className="num">Coût / résultat</th></tr></thead>
            <tbody>{detail.history.slice(-18).reverse().map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{fmtMAD(m.spend, { compact: true, suffix: false })}</td><td className="num">{fmtNum(m.results)}</td><td className="num">{cost(m.costPerResult)}</td></tr>)}</tbody></table>
        </div>
      )}

      {detail.children.length > 0 && (
        <div>
          <div className="label mb-1">{childLevel === "adset" ? "Ensembles de publicités" : childLevel === "ad" ? "Publicités" : childLevel === "creative" ? "Créatives" : "Campagnes"} ({detail.children.length})</div>
          <table className="tbl text-[12px]"><thead><tr><th>Nom</th><th>État</th><th className="num">Dépense</th><th className="num">Résultats</th><th className="num">Coût</th><th className="num">CTR</th></tr></thead>
            <tbody>{detail.children.map((c) => <tr key={c.key} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(childLevel, idOf(c), c.campaignName)}>
              <td className="max-w-[260px] truncate">{c.campaignName}{c.body && childLevel === "adset" ? <span className="block text-[10.5px] text-faint truncate">{c.body}</span> : null}</td>
              <td>{c.effectiveStatus ? <Badge tone={c.effectiveStatus === "ACTIVE" ? "green" : "gray"}>{c.effectiveStatus}</Badge> : "—"}</td>
              <td className="num">{fmtMAD(c.spend, { compact: true, suffix: false })}</td><td className="num">{fmtNum(c.results)}</td><td className="num">{cost(c.costPerResult)}</td><td className="num">{c.ctr !== null ? `${c.ctr.toFixed(2)} %` : "—"}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

function HistoryView({ search, brands, onOpen }: { search: Actions["search"]; brands: CommandCenterData["brands"]; onOpen: (level: EntityLevel, id: string | null, title: string) => void }) {
  const [rows, setRows] = useState<EntityPerf[] | null>(null);
  const [pending, start] = useTransition();
  const [level, setLevel] = useState<"campaign" | "ad" | "creative">("ad");
  const run = (fd: FormData) => start(async () => {
    const q: HistorySearch = { q: String(fd.get("q") ?? "") || undefined, brandId: String(fd.get("brand") ?? "") || null, level, start: String(fd.get("start") ?? "") || undefined, end: String(fd.get("end") ?? "") || undefined, sort: (String(fd.get("sort") ?? "spend") as HistorySearch["sort"]), objective: String(fd.get("objective") ?? "") || null };
    setRows(await search(q).catch(() => []));
  });
  const idOf = (r: EntityPerf) => (level === "campaign" ? r.externalCampaignId : level === "creative" ? r.externalCreativeId : r.externalId);
  return (
    <div className="space-y-3 text-[12.5px]">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(new FormData(e.currentTarget)); }}>
        <label className="block flex-1 min-w-[180px]"><span className="label block mb-1">Texte (campagne, pub, créative)</span><input name="q" className="input h-9" placeholder="ex. collagen, avant/après…" /></label>
        <label className="block"><span className="label block mb-1">Marque</span><select name="brand" className="select h-9 w-40"><option value="">Toutes</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="block"><span className="label block mb-1">Niveau</span><select className="select h-9 w-32" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}><option value="campaign">Campagnes</option><option value="ad">Publicités</option><option value="creative">Créatives</option></select></label>
        <label className="block"><span className="label block mb-1">Objectif</span><select name="objective" className="select h-9 w-40"><option value="">Tous</option>{["OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_SALES", "OUTCOME_LEADS", "LINK_CLICKS", "MESSAGES"].map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
        <label className="block"><span className="label block mb-1">Du</span><input type="date" name="start" className="input h-9 w-36" /></label>
        <label className="block"><span className="label block mb-1">Au</span><input type="date" name="end" className="input h-9 w-36" /></label>
        <label className="block"><span className="label block mb-1">Tri</span><select name="sort" className="select h-9 w-40"><option value="spend">Dépense</option><option value="cost">Meilleur coût / résultat</option><option value="results">Résultats</option></select></label>
        <button className="btn-primary btn-sm h-9" type="submit" disabled={pending}>{pending ? "Recherche…" : "Chercher"}</button>
      </form>
      {rows && (
        <table className="tbl text-[12px]">
          <thead><tr><th>Nom</th><th>Marque</th><th>Produit</th><th>Période</th><th className="num">Dépense</th><th className="num">Résultats</th><th className="num">Coût</th><th className="num">CTR</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.key} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(level, idOf(r), r.campaignName)}>
              <td className="max-w-[280px]"><div className="truncate">{r.campaignName}</div>{r.tags?.angle && <div className="text-[10.5px] text-faint">{[r.tags.angle, r.tags.format].filter(Boolean).join(" · ")}</div>}</td>
              <td>{r.brandName ?? "—"}</td><td className="max-w-[140px] truncate">{r.productName ?? "—"}</td>
              <td className="text-faint whitespace-nowrap">{r.firstDay ? `${fmtDate(r.firstDay)} → ${fmtDate(r.lastDay)}` : ""}</td>
              <td className="num">{fmtMAD(r.spend, { compact: true, suffix: false })}</td><td className="num">{fmtNum(r.results)} <span className="text-faint">{r.resultKind}</span></td><td className="num">{cost(r.costPerResult)}</td><td className="num">{r.ctr !== null ? `${r.ctr.toFixed(2)} %` : "—"}</td>
            </tr>)}
            {!rows.length && <tr><td colSpan={8} className="text-muted">Aucun résultat.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

