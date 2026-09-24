"use client";

import { useMemo, useState } from "react";
import { planAllocation } from "@/lib/gestion/receivables-shared";

/**
 * Saisie d'un règlement : mode, montant, référence ; l'imputation est proposée sur les factures les
 * plus anciennes (même règle que le serveur) et reste modifiable facture par facture.
 */
export type PaymentFormInvoice = { id: string; number: string; date: string; dueDate: string | null; balance: string; daysLate: number | null; isSimulation: boolean };

const fmt = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PaymentForm({ clientId, invoices, modes, today, action }: {
  clientId: string;
  invoices: PaymentFormInvoice[];
  modes: { key: string; label: string; requiresDueDate: boolean; collectedOnReceipt: boolean }[];
  today: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const [modeKey, setModeKey] = useState(modes[0]?.key ?? "");
  const [amount, setAmount] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const mode = modes.find((m) => m.key === modeKey);
  const total = Number(amount.replace(",", ".")) || 0;
  const allocated = Object.values(alloc).reduce((s, v) => s + (Number(v.replace(",", ".")) || 0), 0);
  const left = Math.round((total - allocated) * 100) / 100;

  const propose = (a: string) => {
    const plan = planAllocation(a.replace(",", ".") || "0", invoices.map((i) => ({ id: i.id, dueDate: i.dueDate, date: i.date, balance: i.balance })));
    setAlloc(Object.fromEntries(plan.map((p) => [p.invoiceId, p.amount])));
  };
  const openTotal = useMemo(() => invoices.reduce((s, i) => s + Number(i.balance), 0), [invoices]);

  return (
    <form action={action} className="space-y-4 text-[13px]">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block"><span className="label block mb-1">Date de réception</span><input type="date" name="date" defaultValue={today} className="input h-9" required /></label>
        <label className="block"><span className="label block mb-1">Mode</span>
          <select name="modeKey" className="select h-9" value={modeKey} onChange={(e) => setModeKey(e.target.value)}>{modes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
        <label className="block"><span className="label block mb-1">Montant (MAD) *</span>
          <input name="amount" className="input h-9 text-right" inputMode="decimal" value={amount} required onChange={(e) => { setAmount(e.target.value); propose(e.target.value); }} /></label>
        {mode?.requiresDueDate && <label className="block"><span className="label block mb-1">Échéance *</span><input type="date" name="dueDate" className="input h-9" required /></label>}
        <label className="block"><span className="label block mb-1">{mode?.collectedOnReceipt ? "Référence" : "N° de chèque / effet *"}</span><input name="reference" className="input h-9" required={!mode?.collectedOnReceipt} /></label>
        <label className="block"><span className="label block mb-1">Banque</span><input name="bank" className="input h-9" /></label>
        <label className="block sm:col-span-2"><span className="label block mb-1">Note</span><input name="notes" className="input h-9" /></label>
      </div>
      <p className="text-[12px] text-muted">{mode?.collectedOnReceipt ? "Encaissé dès l'enregistrement." : "Entre en portefeuille : il faudra le remettre en banque puis confirmer l'encaissement (ou l'impayé)."}</p>

      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold">Imputation sur les factures ouvertes ({fmt(openTotal)} MAD)</h3>
          <span className={`tabular-nums ${left < 0 ? "text-red" : left > 0 ? "text-orange" : "text-green"}`}>{left < 0 ? `Dépasse de ${fmt(-left)} MAD` : left > 0 ? `${fmt(left)} MAD non imputés (restera sur le règlement)` : "Tout est imputé"}</span>
        </div>
        {invoices.length === 0 ? <p className="text-muted">Aucune facture ouverte : le règlement restera non imputé (acompte, trop-perçu).</p> : (
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-faint border-b border-line"><th className="py-1.5 font-medium">Facture</th><th className="py-1.5 font-medium">Échéance</th><th className="py-1.5 font-medium text-right">Solde</th><th className="py-1.5 font-medium text-right w-36">Imputer</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="py-1.5 font-mono">{i.number}{i.isSimulation && <span className="text-faint font-sans text-[11px]"> · simulation</span>}</td>
                  <td className={`py-1.5 ${i.daysLate && i.daysLate > 0 ? "text-red" : ""}`}>{i.dueDate ? i.dueDate.split("-").reverse().join("/") : "—"}{i.daysLate && i.daysLate > 0 ? ` · ${i.daysLate} j de retard` : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(Number(i.balance))}</td>
                  <td className="py-1.5 text-right"><input name={`alloc_${i.id}`} className="input h-8 text-right w-32" inputMode="decimal" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-end"><button className="btn-primary" type="submit" disabled={!total || left < 0}>Enregistrer le règlement</button></div>
    </form>
  );
}
