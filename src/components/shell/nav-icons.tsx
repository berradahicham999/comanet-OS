"use client";

import {
  LayoutDashboard, Zap, ChartColumn, Users, Package, Tags, Boxes, Megaphone, CalendarDays,
  Store, ClipboardList, Sparkles, ShieldCheck, SquareCheck, Upload, Settings, type LucideProps,
} from "lucide-react";

const ICONS = {
  LayoutDashboard, Zap, ChartColumn, Users, Package, Tags, Boxes, Megaphone, CalendarDays,
  Store, ClipboardList, Sparkles, ShieldCheck, SquareCheck, Upload, Settings,
} as const;

export function NavIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? LayoutDashboard;
  return <Icon {...props} />;
}
