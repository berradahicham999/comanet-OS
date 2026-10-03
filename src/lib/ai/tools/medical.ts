/**
 * Outils médicaux du copilote (Médical v2) : fiche prescripteur (ordonnances, potentiel, produits à
 * présenter) et contrôle terrain des visites. Lecture seule ; aucune position GPS ne sort vers le modèle.
 * Définitions officielles : `prescriptions-shared.ts`, `gps-shared.ts`, `field-report.ts`.
 */
import { z } from "zod";
import { isAdmin } from "@/lib/permissions-shared";
import type { AiTool, ToolResult } from "./types";
import { round, unavailable } from "./shared";

const doctorSchema = z.object({
  doctor: z.string().min(2).describe("Nom du médecin (prénom et / ou nom, avec ou sans « Dr »)."),
});

export const getDoctorProfile: AiTool<typeof doctorSchema> = {
  name: "get_doctor_profile",
  description:
    "Fiche d'un médecin : dernier compte rendu, objections, échantillons déjà remis, ordonnances rapprochées (produits prescrits), potentiel A/B/C (saisi ou calculé, avec ses motifs) et 3 produits à présenter, déduits de ce que prescrivent ses pairs (corrélation observée, nombre d'observations fourni).",
  module: "medical",
  action: "view",
  schema: doctorSchema,
  async run(input, ctx): Promise<ToolResult> {
    const m = ctx.deps.medical;
    if (!m) return unavailable("Lectures médicales non branchées.", "—");
    const ref = await m.findDoctor(input.doctor, ctx.access.userId, ctx.access.ownOnly);
    if (!ref) return unavailable(`Aucun médecin trouvé pour « ${input.doctor} »${ctx.access.ownOnly ? " dans vos secteurs" : ""}.`, "Vérifier l'orthographe ou chercher dans Médical → Médecins.", "Médical");
    const b = await m.doctorBrief(ref.id);
    if (!b) return unavailable("Fiche introuvable.", "—");
    const p = b.prescriptions;
    return {
      available: true,
      source: "Médical — visites (comptes rendus), ordonnances importées (rapprochées), échantillons remis",
      scope: ref.name,
      data: {
        doctor: { name: b.doctor.name, specialty: b.doctor.specialty, city: b.doctor.city },
        last_report: b.lastReport,
        objections: b.objections,
        samples_given: b.samples,
        prescriptions: p ? { lines: p.observations, first_date: p.firstDate, last_date: p.lastDate, products: p.products.slice(0, 15).map((x) => ({ product: x.name, brand: x.brand, lines: x.lines, units: x.units, last_date: x.lastDate })) } : null,
        potential: { level: b.doctor.potential, source: b.doctor.potentialSource, computed_level: p?.potential.computed?.level ?? null, reasons: p?.potential.computed?.reasons ?? [], observations: p?.potential.computed?.observations ?? 0 },
        recommended_products: p?.recommendations.items.map((r) => ({ product: r.name, brand: r.brand, why: r.why, support: r.support, base: r.base, score_pct: round(r.score * 100) })) ?? [],
        recommendation_note: p?.recommendations.note ?? null,
        peers_observed: p?.recommendations.peers ?? 0,
      },
      rowCount: 1 + (p?.products.length ?? 0),
      links: [{ label: "Ouvrir la fiche médecin", href: `/medical/medecins/${ref.id}` }],
      notes: ["Les produits recommandés sont une corrélation observée chez les pairs, pas une preuve d'efficacité d'une visite."],
    };
  },
};

const fieldSchema = z.object({
  delegate: z.string().optional().describe("Nom de la déléguée ; absent = toutes celles de votre portée."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Début (AAAA-MM-JJ), défaut : il y a 7 jours."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fin (AAAA-MM-JJ), défaut : aujourd'hui."),
});

export const getFieldControl: AiTool<typeof fieldSchema> = {
  name: "get_field_control",
  description:
    "Contrôle terrain des visites médicales (direction et managers) : visites réalisées et non effectuées, objectifs hebdo et mensuels, durée moyenne, part de visites vérifiées par GPS, répartition par statut de contrôle et motifs les plus fréquents (hors zone, GPS refusé, durée, envoi différé…), couverture du fichier et respect de la fréquence. Aucune coordonnée n'est renvoyée.",
  module: "medical",
  action: "validate",
  schema: fieldSchema,
  async run(input, ctx): Promise<ToolResult> {
    const m = ctx.deps.medical;
    if (!m) return unavailable("Lectures médicales non branchées.", "—");
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const to = input.to ?? iso(ctx.now);
    const from = input.from ?? iso(new Date(ctx.now.getTime() - 7 * 86_400_000));
    const r = await m.fieldSummary(ctx.access.userId, isAdmin(ctx.access.perms), input.delegate ?? null, from, to);
    if (!r) return unavailable(input.delegate ? `Déléguée « ${input.delegate} » introuvable dans votre portée.` : "Le contrôle terrain est réservé à la direction et aux managers des déléguées.", "Demander l'accès à la direction, ou vérifier le nom de la déléguée.", "Médical — suivi terrain");
    const k = r.kpis;
    return {
      available: true,
      source: "Médical — chrono de visite et contrôle de présence (visit_events)",
      period: { start: from, end: to, label: `du ${from} au ${to}` },
      scope: r.delegate ?? "toutes les déléguées de votre portée",
      data: {
        visits_done: k.realized, visits_not_done: k.notDone, active_days: k.days, visits_per_active_day: k.perDay,
        week: { done: k.week.done, objective: k.week.objective }, month: { done: k.month.done, objective: k.month.objective },
        avg_duration_min: k.avgDuration, verified_pct: k.verifiedPct, gps_controlled_visits: k.controlled,
        verification_by_status: r.byStatus, top_reasons: r.topReasons,
        file_coverage: k.coverage, frequency_respected: k.frequency,
      },
      rowCount: k.realized + k.notDone,
      links: [{ label: "Ouvrir le suivi terrain", href: `/medical/suivi?from=${from}&to=${to}` }],
      notes: ["« À vérifier » signale une anomalie à examiner, pas une faute : un cabinet secondaire ou une clinique expliquent souvent un écart."],
    };
  },
};
