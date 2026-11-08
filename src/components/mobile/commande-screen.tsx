"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { normKey } from "@/lib/import/normalize";
import { localDay } from "./stock-editor";
import { useMobile } from "./mobile-app";
import { NoData, Skeleton } from "./mobile-shell";

type Row = { productId: string; name: string; qty: number };

function Body() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { phase, snapshot, submit } = useMobile();
  const c = snapshot?.commercial ?? null;
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState("");

  const found = useMemo(() => {
    const k = normKey(q);
    if (!c || k.length < 2) return [];
    const used = new Set(rows.map((r) => r.productId));
    return c.products.filter((p) => !used.has(p.id) && (normKey(p.name).includes(k) || normKey(p.brandName ?? "").includes(k))).slice(0, 8);
  }, [c, q, rows]);

  if (phase === "LOADING") return <Skeleton />;
  if (!c) return <NoData />;
  const client = c.clients.find((x) => x.id === id);
  if (!client) return <NoData />;
  const setQty = (pid: string, qty: number) => setRows((rs) => (qty <= 0 ? rs.filter((r) => r.productId !== pid) : rs.map((r) => (r.productId === pid ? { ...r, qty } : r))));

  async function save() {
    if (!rows.length || !client) return;
    await submit("ORDER_DRAFT", { clientId: client.id, date: localDay(), notes, lines: rows.map((r) => ({ productId: r.productId, qty: String(r.qty) })) }, `Commande ${client.name} — ${rows.length} produit${rows.length > 1 ? "s" : ""}`);
    router.push(`/m/client?id=${client.id}`);
  }

  return (
    <div className="space-y-3">
      <Link href={`/m/client?id=${id}`} prefetch={false} className="min-h-11 inline-flex items-center gap-1 text-[13.5px] text-muted"><ArrowLeft size={16} /> {client.name}</Link>
      <h1 className="text-[20px] font-semibold text-ink">Commande sans réseau</h1>
      <p className="rounded-xl bg-orange-soft text-orange text-[13.5px] px-3 py-2">Elle partira en brouillon au retour du réseau. Prix, remises et plafond de crédit se contrôlent quand vous la confirmez.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter un produit…" className="input h-12 text-[15px]" aria-label="Chercher un produit" />
      {found.length > 0 && (
        <div className="rounded-xl border border-line divide-y divide-line bg-surface">
          {found.map((p) => <button key={p.id} type="button" onClick={() => { setRows((rs) => [{ productId: p.id, name: p.name, qty: 1 }, ...rs]); setQ(""); }} className="w-full text-left px-3 min-h-12 py-2 text-[14px]">{p.name}{p.brandName ? <span className="text-muted"> · {p.brandName}</span> : null}</button>)}
        </div>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.productId} className="card px-3 py-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 text-[14px] leading-snug line-clamp-2">{r.name}</div>
            <button type="button" onClick={() => setQty(r.productId, r.qty - 1)} className="h-11 w-11 rounded-xl border border-line bg-surface flex items-center justify-center" aria-label={`Une unité de moins — ${r.name}`}><Minus size={17} /></button>
            <span className="w-8 text-center text-[16px] font-semibold">{r.qty}</span>
            <button type="button" onClick={() => setQty(r.productId, r.qty + 1)} className="h-11 w-11 rounded-xl bg-accent text-white flex items-center justify-center" aria-label={`Une unité de plus — ${r.name}`}><Plus size={17} /></button>
          </li>
        ))}
      </ul>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="textarea" placeholder="Remarque (facultatif)" aria-label="Remarque" />
      <button type="button" disabled={!rows.length} onClick={() => void save()} className="btn-primary w-full h-14 text-[16px] disabled:opacity-50">Enregistrer sur le téléphone</button>
    </div>
  );
}

/** Commande prise là où il n'y a pas de réseau. Avec du réseau, c'est le formulaire complet de la pièce. */
export function CommandeScreen() {
  return <Suspense fallback={<Skeleton />}><Body /></Suspense>;
}
