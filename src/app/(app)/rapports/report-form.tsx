"use client";

import { useActionState, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { generateReportAction } from "./actions";

type Period = { start: string; end: string; label: string };

export function ReportForm({ brands, weeks, months }: { brands: { id: string; name: string }[]; weeks: Period[]; months: Period[] }) {
  const [type, setType] = useState<"WEEKLY" | "MONTHLY_BRAND_REVIEW">("WEEKLY");
  const [state, action, pending] = useActionState(generateReportAction, null);
  const periods = type === "WEEKLY" ? weeks : months;
  return (
    <form action={action} className="space-y-3">
      <label className="block text-[12px]">
        <span className="label">Type</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="select mt-1">
          <option value="WEEKLY">COMANET WEEKLY (hebdomadaire, toutes marques)</option>
          <option value="MONTHLY_BRAND_REVIEW">MONTHLY BRAND REVIEW (mensuel, une marque)</option>
        </select>
      </label>
      {type === "MONTHLY_BRAND_REVIEW" && (
        <label className="block text-[12px]">
          <span className="label">Marque</span>
          <select name="brandId" className="select mt-1" required defaultValue="">
            <option value="" disabled>Choisir…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <label className="block text-[12px]">
        <span className="label">Période</span>
        <select name="period" className="select mt-1" key={type}>
          {periods.map((p) => <option key={p.start} value={`${p.start}|${p.end}`}>{p.label}</option>)}
        </select>
      </label>
      {state?.error && <div className="text-[12.5px] text-red">{state.error}</div>}
      <button type="submit" className="btn-primary btn-sm" disabled={pending}>
        {pending ? <><Loader2 size={14} className="animate-spin" /> Rédaction en cours (jusqu&apos;à une minute)…</> : <><Sparkles size={14} /> Générer le brouillon</>}
      </button>
      <div className="text-[11px] text-faint">Lecture seule : le copilote relit les données par les outils, ne cite que ce qu&apos;il a lu, et le rapport reste un brouillon jusqu&apos;à validation.</div>
    </form>
  );
}
