"use client";

import {
  LayoutDashboard, Zap, ChartColumn, Users, Package, Tags, Boxes, Megaphone, CalendarDays,
  Store, ClipboardList, Sparkles, ShieldCheck, SquareCheck, Upload, Settings,
  Rocket, MousePointerClick, Heart, Wallet,
  Stethoscope, UserRound, IdCard, CalendarCheck, Map, FlaskConical, LandPlot, BriefcaseMedical, SlidersHorizontal,
  ScrollText, UserCog, Images, FileBarChart, PartyPopper, ChartLine,
  ClipboardCheck, Warehouse, Truck, FileText, PackagePlus, ArrowRightLeft,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  LayoutDashboard, Zap, ChartColumn, Users, Package, Tags, Boxes, Megaphone, CalendarDays,
  Store, ClipboardList, Sparkles, ShieldCheck, SquareCheck, Upload, Settings,
  Rocket, MousePointerClick, Heart, Wallet,
  Stethoscope, UserRound, IdCard, CalendarCheck, Map, FlaskConical, LandPlot, BriefcaseMedical, SlidersHorizontal,
  ScrollText, UserCog, Images, FileBarChart, PartyPopper, ChartLine,
  ClipboardCheck, Warehouse, Truck, FileText, PackagePlus, ArrowRightLeft,
} as const;

export function NavIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? LayoutDashboard;
  return <Icon {...props} />;
}
