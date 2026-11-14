"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { fmtDate, fmtMAD } from "@/lib/format";
import { KIND_META, type ValidationItem } from "@/lib/validations/shared";
import { decideValidationAction } from "@/app/(app)/a-decider/actions";

const keyOf = (i: ValidationItem) => `${i.kind}|${i.id}`;

/**
 * Lignes de la zone « À décider » (Cockpit et page complète). L'écran ne décide de rien : chaque bouton envoie la
 * décision à `decideValidationAction()`, qui repasse par les droits de la file concernée. Un refus exige un motif.
 * Une ligne déjà tranchée ailleurs (téléphone, autre poste) le dit et disparaît au rechargement.
 */
export function DecisionQueue({ items, today, readOnly }: { items: ValidationItem[]; today: string; readOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function decide(item: ValidationItem, decision: "OK" | "KO", comment: string | null) {
    const key = keyOf(item);
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    startTransition(async () => {
      const r = await decideValidationAction({ kind: item.kind, id: item.id, decision, comment });
      setBusy(null);
      setRefusing(null);
      if (r.ok) setDone((d) => ({ ...d, [key]: decision === "OK" ? "Validé" : item.kind === "RAPPORT" ? "Archivé" : "Refusé" }));
      else if (r.stale) setDone((d) => ({ ...d, [key]: r.error }));
      else setErrors((e) => ({ ...e, [key]: r.error }));
      router.refresh();
    });
  }

  return (
    <ul className="card divide-y divide-line">
      {items.map((item) => {
        const key = keyOf(item);
        const meta = KIND_META[item.kind];
        const late = item.dueDate !== null && item.dueDate < today;
        const working = pending && busy === key;
        return (
          <li key={key} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-[280px]">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                  <span className="font-medium truncate" title={item.title}>{item.title}</span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted truncate" title={item.why ?? item.context}>{item.why ?? item.context}</div>
              </div>
              <div className="w-[110px] text-right whitespace-nowrap">
                <div className="label">Montant</div>
                <div className="tabular-nums font-medium">{item.amountMad === null ? <span className="text-faint">—</span> : fmtMAD(item.amountMad)}</div>
              </div>
              <div className="w-[104px] text-right whitespace-nowrap">
                <div className="label">Échéance</div>
                <div className={late ? "tabular-nums font-medium text-red" : "tabular-nums font-medium"}>{item.dueDate === null ? <span className="text-faint">—</span> : fmtDate(item.dueDate)}</div>
              </div>
              <div className="flex items-center justify-end gap-1.5 shrink-0 sm:min-w-[300px]">
                {done[key] ? (
                  <span className="text-[12.5px] text-muted">{done[key]}</span>
                ) : (
                  <>
                    {!readOnly && (
                      <>
                        <button type="button" disabled={pending} onClick={() => decide(item, "OK", null)} className="btn-primary btn-sm disabled:opacity-50"><Check size={14} /> {working ? "Envoi…" : "Valider"}</button>
                        <button type="button" disabled={pending} onClick={() => { if (item.needsReason) { setReason(""); setRefusing(refusing === key ? null : key); } else decide(item, "KO", null); }} className="btn-secondary btn-sm disabled:opacity-50"><X size={14} /> {item.refuseLabel}</button>
                      </>
                    )}
                    <Link href={item.href} className="btn-ghost btn-sm"><ExternalLink size={14} /> Ouvrir</Link>
                  </>
                )}
              </div>
            </div>
            {errors[key] && <p role="alert" className="mt-2 rounded-lg bg-red-soft text-red text-[12.5px] px-3 py-1.5">{errors[key]}</p>}
            {refusing === key && !done[key] && (
              <form className="mt-2 flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) decide(item, "KO", reason.trim()); }}>
                <textarea autoFocus required value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="textarea flex-1 basis-[280px] text-[13px]" placeholder="Motif (obligatoire)" aria-label={`Motif — ${item.refuseLabel} : ${item.title}`} />
                <button type="submit" disabled={pending || !reason.trim()} className="btn-primary btn-sm disabled:opacity-50">{item.refuseLabel}</button>
                <button type="button" onClick={() => setRefusing(null)} className="btn-ghost btn-sm">Annuler</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
