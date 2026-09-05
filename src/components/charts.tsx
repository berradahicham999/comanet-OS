"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell } from "recharts";
import { fmtMAD, fmtNum } from "@/lib/format";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm) - 1]} ${y.slice(2)}`;
}

const AXIS = { fontSize: 11, fill: "#6b7280" };
const GRID = "#ececea";

function MoneyTip({ active, payload, label, labelFormatter }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-[var(--shadow-pop)] text-[12px]">
      <div className="font-semibold mb-1">{labelFormatter ? labelFormatter(label ?? "") : label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums">{fmtMAD(p.value, { compact: true })}</span>
        </div>
      ))}
    </div>
  );
}

/** CA mensuel (barres) avec N-1 en ligne. */
export function MonthlyRevenueChart({ data, height = 220 }: { data: { month: string; amount: number; prev?: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => fmtMAD(v, { compact: true, suffix: false })} />
        <Tooltip content={<MoneyTip labelFormatter={monthLabel} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {data.some((d) => d.prev !== undefined) && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />}
        <Bar dataKey="amount" name="CA" fill="#0f766e" radius={[6, 6, 0, 0]} maxBarSize={36} />
        {data.some((d) => d.prev !== undefined) && <Bar dataKey="prev" name="N-1" fill="#d6d6d1" radius={[6, 6, 0, 0]} maxBarSize={36} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Barres horizontales simples (top N). */
export function HBarChart({ data, height, valueKey = "amount", color = "#0f766e", money = true }: { data: { name: string; amount?: number; value?: number; color?: string }[]; height?: number; valueKey?: "amount" | "value"; color?: string; money?: boolean }) {
  const h = height ?? Math.max(120, data.length * 30 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fill: "#3f434c" }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v) => (money ? fmtMAD(Number(v)) : fmtNum(Number(v)))} contentStyle={{ borderRadius: 12, border: "1px solid #e7e7e3", fontSize: 12 }} />
        <Bar dataKey={valueKey} radius={[0, 6, 6, 0]} maxBarSize={18}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Courbe simple (ex: ventes journalières). */
export function SimpleLine({ data, xKey, yKey, height = 160, color = "#0f766e", money = true }: { data: Record<string, unknown>[]; xKey: string; yKey: string; height?: number; color?: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => (money ? fmtMAD(v, { compact: true, suffix: false }) : fmtNum(v))} />
        <Tooltip formatter={(v) => (money ? fmtMAD(Number(v)) : fmtNum(Number(v)))} contentStyle={{ borderRadius: 12, border: "1px solid #e7e7e3", fontSize: 12 }} />
        <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
