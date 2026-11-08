"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Minus, Plus, X } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { readRef, deleteRef, writeRef } from "@/lib/mobile/outbox";
import type { AnimationPayload } from "@/lib/mobile/outbox-shared";
import type { MobileClient, MobileProduct } from "@/lib/mobile/snapshot-shared";
import { ClientPicker } from "./client-picker";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";
import { localDay } from "./stock-editor";

/**
 * SAISIE DES VENTES — le chemin court : point de vente repris du jour, produits habituels déjà à l'écran, boutons + et −.
 * Elle remplace, sur le téléphone, le menu déroulant de la saisie rapide (`AnimationQuickForm`), mais envoie exactement les
 * mêmes champs, validés par `parseAnimationInput()`. L'enregistrement est immédiat, avec ou sans réseau.
 */
type Row = { productId: string; name: string; qty: number; stock: string };
type Draft = { clientId: string | null; rows: Row[] };


function Stepper({ row, onChange }: { row: Row; onChange: (qty: number) => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={() => onChange(Math.max(0, row.qty - 1))} className="h-11 w-11 rounded-xl border border-line bg-surface flex items-center justify-center text-ink" aria-label={`Une unité de moins — ${row.name}`}><Minus size={17} /></button>
      <input
        value={row.qty || ""} onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
        inputMode="numeric" pattern="[0-9]*" placeholder="0" aria-label={`Vendu — ${row.name}`}
        className="input h-11 w-12 px-1 text-center text-[16px] font-semibold"
      />
      <button type="button" onClick={() => onChange(row.qty + 1)} className="h-11 w-11 rounded-xl bg-accent text-white flex items-center justify-center" aria-label={`Une unité de plus — ${row.name}`}><Plus size={17} /></button>
    </div>
  );
}

export function SaisieScreen() {
  const { phase, snapshot, submit, online } = useMobile();
  const t = snapshot?.terrain ?? null;
  const uid = snapshot?.user.id ?? null;

  const [client, setClient] = useState<MobileClient | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [more, setMore] = useState(false);
  const [date, setDate] = useState(localDay);
  const [startDate, setStartDate] = useState("");
  const [advised, setAdvised] = useState("");
  const [samples, setSamples] = useState("");
  const [comment, setComment] = useState("");
  const [emptyOk, setEmptyOk] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const byId = useMemo(() => new Map((t?.products ?? []).map((p) => [p.id, p])), [t]);

  /* Point de départ : brouillon interrompu, sinon point de vente du jour et produits habituels. */
  useEffect(() => {
    if (!t || !uid || ready) return;
    let stale = false;
    void readRef<Draft>(uid, "draft").catch(() => null).then((draft) => {
      if (stale) return;
      const planned = t.planned[0];
      const defaultId = draft?.clientId ?? planned?.clientId ?? t.lastClientId;
      const known = t.clients.find((c) => c.id === defaultId) ?? (planned ? { id: planned.clientId, name: planned.clientName, city: planned.city, mine: true } : null);
      setClient(known);
      const favorites = t.favoriteIds.flatMap((id) => { const p = byId.get(id); return p ? [{ productId: id, name: p.name, qty: 0, stock: "" }] : []; });
      setRows(draft?.rows.length ? draft.rows : favorites);
      setReady(true);
    });
    return () => { stale = true; };
  }, [t, uid, ready, byId]);

  /* Android ferme les onglets sans prévenir : la saisie en cours survit. */
  useEffect(() => {
    if (!ready || !uid) return;
    const handle = setTimeout(() => void writeRef(uid, "draft", { clientId: client?.id ?? null, rows } satisfies Draft).catch(() => {}), 400);
    return () => clearTimeout(handle);
  }, [ready, uid, client, rows]);

  const found = useMemo(() => {
    const k = normKey(search);
    if (k.length < 2) return [];
    const used = new Set(rows.map((r) => r.productId));
    return (t?.products ?? []).filter((p) => !used.has(p.id) && (normKey(p.name).includes(k) || normKey(p.brandName ?? "").includes(k))).slice(0, 8);
  }, [search, rows, t]);

  if (phase === "LOADING") return <Skeleton />;
  if (!t) return <NoData />;

  const last = client ? (t.lastStock[client.id] ?? {}) : {};
  const sold = rows.filter((r) => r.qty > 0);
  const units = sold.reduce((s, r) => s + r.qty, 0);

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.productId === id ? { ...r, ...p } : r)));
  const add = (p: MobileProduct) => { setRows((rs) => [{ productId: p.id, name: p.name, qty: 1, stock: "" }, ...rs]); setSearch(""); };

  async function save() {
    if (!client) return;
    if (!sold.length && !emptyOk) { setEmptyOk(true); return; }
    const payload: AnimationPayload = {
      clientId: client.id, date, startDate: startDate || undefined,
      lines: rows.filter((r) => r.qty > 0 || r.stock !== "").map((r) => ({ productId: r.productId, qty: String(r.qty), stock: r.stock })),
      customersAdvised: advised, samples, comment,
    };
    await submit("ANIMATION", payload, `${client.name} — ${units} u.`);
    if (uid) await deleteRef(uid, "draft").catch(() => {});
    setDone(`${units} unité${units > 1 ? "s" : ""} chez ${client.name}`);
    setRows((rs) => rs.map((r) => ({ ...r, qty: 0, stock: "" })));
    setAdvised(""); setSamples(""); setComment(""); setEmptyOk(false); setMore(false);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[20px] font-semibold text-ink">Saisie des ventes</h1>

      {done && (
        <div className="rounded-2xl bg-green-soft border border-green/30 px-4 py-3 text-[14px] text-green font-medium flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>Enregistrée : {done}.{online ? "" : " Elle partira au retour du réseau."}</span>
        </div>
      )}

      <section>
        <span className="label block mb-1">Point de vente</span>
        <ClientPicker clients={t.clients} value={client} onChange={setClient} online={online} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <span className="label">Mes produits</span>
          {units > 0 && <span className="text-[13px] font-semibold text-accent">{units} unité{units > 1 ? "s" : ""}</span>}
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ajouter un produit…" className="input h-12 text-[15px] mb-2" aria-label="Chercher un produit" />
        {found.length > 0 && (
          <div className="rounded-xl border border-line divide-y divide-line bg-surface mb-2">
            {found.map((p) => (
              <button key={p.id} type="button" onClick={() => add(p)} className="w-full text-left px-3 min-h-12 py-2 text-[14px]">
                {p.name}{p.brandName ? <span className="text-muted"> · {p.brandName}</span> : null}
              </button>
            ))}
          </div>
        )}
        {rows.length === 0 && <p className="text-[13px] text-muted py-2">Cherchez un produit pour commencer : vos produits habituels s&apos;afficheront ici au fil de vos saisies.</p>}
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.productId} className="card px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-[14px] leading-snug line-clamp-2">{r.name}</div>
                <Stepper row={r} onChange={(qty) => patch(r.productId, { qty })} />
              </div>
              {r.qty > 0 && (
                <label className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] text-muted">
                  <span>Reste en rayon{last[r.productId] ? ` (dernier relevé : ${last[r.productId].quantity})` : ""}</span>
                  <input value={r.stock} onChange={(e) => patch(r.productId, { stock: e.target.value.replace(/\D/g, "") })} inputMode="numeric" pattern="[0-9]*" placeholder="—" aria-label={`Reste en rayon — ${r.name}`} className="input h-11 w-16 px-1 text-center text-[15px]" />
                </label>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <button type="button" onClick={() => setMore((v) => !v)} className="min-h-11 text-[13.5px] text-muted flex items-center gap-1">
          <ChevronDown size={15} className={more ? "rotate-180" : ""} /> {more ? "Moins de détails" : "Autre date, clientes, échantillons"}
        </button>
        {more && (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[13px]"><span className="label block mb-1">Du (facultatif)</span><input type="date" value={startDate} max={date} onChange={(e) => setStartDate(e.target.value)} className="input h-12" /></label>
              <label className="block text-[13px]"><span className="label block mb-1">Au</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input h-12" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[13px]"><span className="label block mb-1">Clientes conseillées</span><input value={advised} onChange={(e) => setAdvised(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="input h-12" /></label>
              <label className="block text-[13px]"><span className="label block mb-1">Échantillons</span><input value={samples} onChange={(e) => setSamples(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="input h-12" /></label>
            </div>
            <label className="block text-[13px]"><span className="label block mb-1">Commentaire</span><textarea value={comment} onChange={(e) => setComment(e.target.value)} className="textarea" placeholder="Affluence, remarques…" /></label>
          </div>
        )}
      </section>

      {emptyOk && !sold.length && (
        <div className="rounded-xl bg-orange-soft border border-orange/30 px-3 py-2 text-[13.5px] text-orange flex items-center justify-between gap-2">
          <span>Aucune vente saisie. Enregistrer une journée sans vente ?</span>
          <button type="button" onClick={() => setEmptyOk(false)} className="h-11 w-11 flex items-center justify-center shrink-0" aria-label="Annuler"><X size={16} /></button>
        </div>
      )}

      <button type="button" disabled={!client} onClick={() => void save()} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">
        {emptyOk && !sold.length ? "Oui, enregistrer sans vente" : "Enregistrer"}
      </button>
    </div>
  );
}
