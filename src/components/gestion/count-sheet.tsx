"use client";

import { useMemo, useRef, useState, useTransition } from "react";

/**
 * Feuille de comptage : TOUS les articles de l'inventaire (produits par marque, puis matériel
 * marketing — goodies, PLV, print — par catégorie), chacun avec sa case « quantité ». Le compteur tape
 * le chiffre à côté ; il est enregistré en quittant la case (ou Entrée, qui passe à la suivante).
 * La case montre SA quantité : celles des autres compteurs s'additionnent côté serveur.
 * À l'aveugle, le théorique n'arrive jamais sur cet écran.
 */
export type SheetLine = {
  key: string; kind: "PRODUIT" | "MATERIEL"; productId: string | null; itemId: string | null;
  name: string; ref: string | null; ean: string | null; group: string; unit: string | null;
  lot: string | null; expiry: string | null; theoretical?: string; mine: string | null;
};

type Status = "saving" | "ok" | "err";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fq = (v: string) => Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 });

export function CountSheet({ countId, lines, blind, save }: {
  countId: string;
  lines: SheetLine[];
  blind: boolean;
  save: (countId: string, input: { productId?: string | null; itemId?: string | null; lotNumber: string | null; quantity: string | null }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, l.mine === null ? "" : String(Number(l.mine))])));
  // Dernière valeur enregistrée par ligne : les filtres « à compter / comptés » s'y fient, pour qu'une ligne ne disparaisse pas pendant la frappe.
  const [saved, setSaved] = useState<Record<string, string>>(() => ({ ...values }));
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "TODO" | "DONE">("ALL");
  const [, start] = useTransition();
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Une saisie faite ailleurs (scanner, autre onglet) change « ma quantité » côté serveur : on la reprend, sans toucher à ce qui n'est pas encore enregistré.
  const [prevLines, setPrevLines] = useState(lines);
  if (lines !== prevLines) {
    setPrevLines(lines);
    const fresh: Record<string, string> = {};
    for (const l of lines) {
      const server = l.mine === null ? "" : String(Number(l.mine));
      if (server !== (saved[l.key] ?? "") && (values[l.key] ?? "") === (saved[l.key] ?? "")) fresh[l.key] = server;
    }
    if (Object.keys(fresh).length) { setValues((v) => ({ ...v, ...fresh })); setSaved((v) => ({ ...v, ...fresh })); }
  }

  const doneCount =lines.filter((l) => (saved[l.key] ?? "") !== "").length;
  const shown = useMemo(() => {
    const s = norm(query.trim());
    return lines.filter((l) => {
      if (filter === "TODO" && (saved[l.key] ?? "") !== "") return false;
      if (filter === "DONE" && (saved[l.key] ?? "") === "") return false;
      if (!s) return true;
      return l.ean === query.trim() || norm(`${l.name} ${l.ref ?? ""} ${l.group} ${l.lot ?? ""}`).includes(s);
    });
  }, [lines, query, filter, saved]);
  const groups = useMemo(() => {
    const m = new Map<string, { kind: SheetLine["kind"]; label: string; lines: SheetLine[] }>();
    for (const l of shown) {
      const k = `${l.kind}|${l.group}`;
      if (!m.has(k)) m.set(k, { kind: l.kind, label: l.group, lines: [] });
      m.get(k)!.lines.push(l);
    }
    return [...m.values()];
  }, [shown]);

  const commit = (l: SheetLine) => {
    const raw = (values[l.key] ?? "").trim().replace(",", ".");
    if (raw === (saved[l.key] ?? "")) return;
    if (raw !== "" && !(Number(raw) >= 0)) { setStatus((s) => ({ ...s, [l.key]: "err" })); setErrors((e) => ({ ...e, [l.key]: "Nombre positif attendu." })); return; }
    setStatus((s) => ({ ...s, [l.key]: "saving" }));
    start(async () => {
      const r = await save(countId, { productId: l.productId, itemId: l.itemId, lotNumber: l.lot, quantity: raw === "" ? null : raw });
      if (r.ok) {
        setSaved((v) => ({ ...v, [l.key]: raw }));
        setStatus((s) => ({ ...s, [l.key]: "ok" }));
        setErrors((e) => { const n = { ...e }; delete n[l.key]; return n; });
      } else {
        setStatus((s) => ({ ...s, [l.key]: "err" }));
        setErrors((e) => ({ ...e, [l.key]: r.error ?? "Enregistrement refusé." }));
      }
    });
  };
  const focusNext = (l: SheetLine) => {
    const i = shown.findIndex((x) => x.key === l.key);
    const next = shown[i + 1];
    if (next) { const el = inputs.current.get(next.key); el?.focus(); el?.select(); } else inputs.current.get(l.key)?.blur();
  };

  return (
    <div className="space-y-3 text-[13px]">
      <div className="card p-3 space-y-2 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <input className="input h-11 text-[15px]" placeholder="Chercher : nom, référence, code-barres…" value={query} inputMode="search" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const hit = lines.find((l) => l.ean && l.ean === query.trim()) ?? (shown.length === 1 ? shown[0] : null);
              if (hit) { const el = inputs.current.get(hit.key); el?.focus(); el?.select(); }
            }} />
          {query && <button type="button" className="btn-ghost btn-sm" onClick={() => setQuery("")}>Effacer</button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([["ALL", `Tout (${lines.length})`], ["TODO", `À compter (${lines.length - doneCount})`], ["DONE", `Comptés (${doneCount})`]] as const).map(([k, label]) => (
            <button key={k} type="button" className={`btn-sm ${filter === k ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
          <div className="ml-auto flex items-center gap-2 min-w-32">
            <div className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${lines.length ? Math.round((doneCount / lines.length) * 100) : 0}%` }} /></div>
            <span className="text-faint text-[11.5px] tabular-nums">{doneCount}/{lines.length}</span>
          </div>
        </div>
      </div>

      {groups.length === 0 && <p className="text-muted px-1">{filter === "TODO" ? "Tout est compté." : "Aucun article ne correspond."}</p>}

      {groups.map((g) => (
        <section key={`${g.kind}|${g.label}`} className="card p-0 overflow-hidden">
          <h3 className="px-4 py-2 bg-surface-2 border-b border-line font-semibold text-[12.5px] flex items-center gap-2">
            <span className="text-faint font-normal">{g.kind === "MATERIEL" ? "Matériel & goodies" : "Produits"} ·</span> {g.label}
            <span className="ml-auto text-faint font-normal tabular-nums">{g.lines.filter((l) => (saved[l.key] ?? "") !== "").length}/{g.lines.length}</span>
          </h3>
          <ul className="divide-y divide-line">
            {g.lines.map((l) => {
              const st = status[l.key];
              return (
                <li key={l.key} className="px-4 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-snug">{l.name}</div>
                    <div className="text-faint text-[11.5px]">
                      {[l.ref, l.lot ? `lot ${l.lot}${l.expiry ? ` · ${l.expiry.split("-").reverse().join("/")}` : ""}` : null, l.unit && l.kind === "MATERIEL" ? l.unit : null, !blind && l.theoretical !== undefined ? `théorique ${fq(l.theoretical)}` : null].filter(Boolean).join(" · ")}
                    </div>
                    {errors[l.key] && <div className="text-red text-[11.5px]">{errors[l.key]}</div>}
                  </div>
                  <span className="w-4 text-center text-[12px]" aria-live="polite">{st === "saving" ? <span className="text-faint">…</span> : st === "ok" ? <span className="text-green">✓</span> : st === "err" ? <span className="text-red">!</span> : null}</span>
                  <input
                    ref={(el) => { if (el) inputs.current.set(l.key, el); else inputs.current.delete(l.key); }}
                    className={`input h-11 w-24 text-[17px] text-right tabular-nums ${st === "err" ? "border-red" : ""}`}
                    inputMode={l.kind === "MATERIEL" ? "numeric" : "decimal"} enterKeyHint="next" placeholder="—" aria-label={`Quantité comptée : ${l.name}${l.lot ? ` lot ${l.lot}` : ""}`}
                    value={values[l.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [l.key]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    onBlur={() => commit(l)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(l); focusNext(l); } }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
