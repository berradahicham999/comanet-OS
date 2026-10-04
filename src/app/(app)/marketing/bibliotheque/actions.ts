"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePermission, brandInScope } from "@/lib/access";
import { parseSheet } from "@/lib/import/parse";
import { AXIS_KEYS, TEMPLATE_BY_KEY } from "@/lib/action-generator/catalog";
import { heroWord } from "@/lib/action-generator/engine";
import { TEMPLATE_COLUMNS, fieldsToTemplate, sheetRowToFields, slugKey, templateFromActivation, templateFromProposal, type TemplateFields } from "@/lib/action-generator/library-shared";
import { importTemplates, libraryTemplate, resetOrDeleteTemplate, saveTemplate, savePlaybook, setTemplateActive } from "@/lib/action-generator/library";
import { getAction } from "@/lib/marketing-plan/actions";
import type { ActionProposal, AxisKey } from "@/lib/action-generator/types";

const BASE = "/marketing/bibliotheque";
const refresh = () => { revalidatePath(BASE); revalidatePath("/marketing/priorites"); revalidatePath("/marketing/priorites/generer"); };
const back = (path: string, erreur: string): never => redirect(`${path}?erreur=${encodeURIComponent(erreur.slice(0, 900))}`);

function fieldsFrom(fd: FormData): Partial<TemplateFields> {
  const out: Partial<TemplateFields> = {};
  for (const c of TEMPLATE_COLUMNS) { const v = fd.get(c.key); if (v !== null) out[c.key] = String(v); }
  for (const k of ["ville", "pharmacies", "influenceuses", "actif"] as const) if (fd.has(`${k}_cb`)) out[k] = fd.get(k) ? "oui" : "non";
  return out;
}

export async function saveTemplateAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const original = String(formData.get("original") ?? "");
  const f = fieldsFrom(formData);
  const { raw, errors, active } = fieldsToTemplate(f);
  const path = `${BASE}/${original || "nouveau"}`;
  if (errors.length) back(path, errors.join(" · "));
  if (original && original !== raw.key) back(path, "La clé d'un modèle ne se change pas : dupliquer le modèle pour en créer un autre.");
  const res = await saveTemplate(raw, { id: user.id, name: user.name });
  if (!res.ok) back(path, res.errors.join(" · "));
  const key = (res as { key: string }).key;
  const entry = await libraryTemplate(key);
  if (entry && entry.active !== active) await setTemplateActive(key, active, { id: user.id, name: user.name });
  refresh();
  redirect(`${BASE}/${key}?ok=1`);
}

export async function toggleTemplateAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const key = String(formData.get("key") ?? ""); const active = String(formData.get("active") ?? "") === "1";
  if (!key) return;
  await setTemplateActive(key, active, { id: user.id, name: user.name });
  refresh();
}

export async function resetTemplateAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const key = String(formData.get("key") ?? ""); if (!key) return;
  const r = await resetOrDeleteTemplate(key, { id: user.id, name: user.name });
  refresh();
  redirect(r === "RESET" ? `${BASE}/${key}?ok=reset` : `${BASE}?ok=supprime`);
}

export async function duplicateTemplateAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const key = String(formData.get("key") ?? "");
  const entry = await libraryTemplate(key);
  if (!entry) throw new Error("Modèle introuvable.");
  const copy = { ...entry.template, key: slugKey("EQ", entry.template.family, randomUUID()), family: `${entry.template.family} (copie)` };
  const res = await saveTemplate(copy, { id: user.id, name: user.name }, { source: "EQUIPE" });
  if (!res.ok) back(`${BASE}/${key}`, res.errors.join(" · "));
  refresh();
  redirect(`${BASE}/${copy.key}?ok=1`);
}

/** Ce qui marche par marque : poids par levier (%), favoris, écartés, note. Conviction de la direction : droit Valider. */
export async function savePlaybookAction(formData: FormData) {
  const user = await requirePermission("marketing", "validate");
  const brandId = String(formData.get("brandId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(brandId) || !(await brandInScope(brandId))) return;
  const levers: Partial<Record<AxisKey, number>> = {};
  for (const a of AXIS_KEYS) { const v = Number(String(formData.get(`lever_${a}`) ?? "").replace(",", ".")); if (Number.isFinite(v) && v > 0) levers[a] = Math.min(100, v) / 100; }
  await savePlaybook(brandId, { levers, favorites: formData.getAll("favorites").map(String).filter(Boolean), avoid: formData.getAll("avoid").map(String).filter(Boolean), note: String(formData.get("note") ?? "").trim() || null }, { id: user.id, name: user.name });
  refresh();
  redirect(`${BASE}?ok=marque#marque-${brandId}`);
}

/** Import Excel / CSV : une ligne par modèle, mêmes colonnes que l'export. */
export async function importLibraryAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(BASE, "Choisir un fichier Excel ou CSV.");
  const sheet = parseSheet(Buffer.from(await (file as File).arrayBuffer()));
  const rows: { line: number; raw: unknown }[] = [], errors: string[] = [];
  sheet.rows.forEach((row, i) => {
    const f = sheetRowToFields(row);
    if (!f.cle && !f.nom) return;
    if (!f.cle) f.cle = slugKey("IM", f.famille || f.nom || "MODELE", randomUUID());
    const { raw, errors: e } = fieldsToTemplate(f);
    if (e.length) errors.push(`ligne ${sheet.headerRow + i + 2} : ${e.slice(0, 3).join(" ; ")}`); else rows.push({ line: sheet.headerRow + i + 2, raw });
  });
  const res = await importTemplates(rows, { id: user.id, name: user.name });
  refresh();
  const msg = `${res.saved.length} modèle(s) importé(s)${errors.length + res.errors.length ? ` · ${errors.length + res.errors.length} ligne(s) refusée(s) : ${[...errors, ...res.errors].slice(0, 6).join(" · ")}` : ""}`;
  redirect(`${BASE}?import=${encodeURIComponent(msg.slice(0, 900))}`);
}

/** « Enregistrer comme modèle » depuis une action générée réalisée. */
export async function saveFromActionAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = String(formData.get("actionId") ?? "");
  const a = await getAction(id);
  if (!a || !(await brandInScope(a.brandId))) throw new Error("Action introuvable.");
  const spec = a.spec as ActionProposal | null;
  if (!spec) back(`/marketing/priorites/${id}`, "Seule une action issue du générateur peut devenir un modèle (elle porte sa fiche complète). Pour une activation, utiliser le bouton de l'activation.");
  const source = (await libraryTemplate(spec!.templateKey))?.template ?? TEMPLATE_BY_KEY.get(spec!.templateKey) ?? null;
  const hero = a.productName ? heroWord({ name: a.productName }, a.brandName) : null;
  const t = templateFromProposal(spec!, source, { key: slugKey("AC", a.title, randomUUID()), brand: a.brandName, hero, label: `${spec!.family} — ${a.brandName} (réalisé)` });
  const res = await saveTemplate(t, { id: user.id, name: user.name }, { source: "ACTION", originActionId: id });
  if (!res.ok) back(`/marketing/priorites/${id}`, res.errors.join(" · "));
  refresh();
  redirect(`${BASE}/${t.key}?ok=depuis`);
}

/** « Enregistrer comme modèle » depuis une activation réalisée (budget par poste, checklist datée). */
export async function saveFromActivationAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = String(formData.get("activationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const a = (await db.execute<{ name: string; type: string; description: string | null; date: string; end_date: string | null; city: string | null; brand_id: string | null; brand: string | null; product: string | null }>(sql`
    select a.name, a.type, a.description, a.date::text as date, a.end_date::text as end_date, a.city, a.brand_id, b.name as brand, p.name as product
    from activations a left join brands b on b.id = a.brand_id left join products p on p.id = a.product_id where a.id = ${id}::uuid`)).rows[0];
  if (!a || (a.brand_id && !(await brandInScope(a.brand_id)))) throw new Error("Activation introuvable.");
  const [lines, checklist] = await Promise.all([
    db.execute<{ cost_item_key: string; label: string; planned: number; spent: number; committed: number }>(sql`select cost_item_key, label, planned::float8 as planned, spent::float8 as spent, committed::float8 as committed from activation_budget_lines where activation_id = ${id}::uuid order by sort`),
    db.execute<{ label: string; due_date: string | null }>(sql`select label, due_date::text as due_date from activation_checklist_items where activation_id = ${id}::uuid order by sort`),
  ]);
  // Le réel prime : dépensé, sinon engagé, sinon prévu.
  const budget = lines.rows.map((l) => ({ costItem: l.cost_item_key, label: l.label, planned: Number(l.spent) || Number(l.committed) || Number(l.planned) }));
  const t = templateFromActivation({ name: a.name, type: a.type, description: a.description, date: a.date, endDate: a.end_date, city: a.city, brand: a.brand, product: a.product }, budget, checklist.rows.map((c) => ({ label: c.label, dueDate: c.due_date })), slugKey("AV", a.name, randomUUID()));
  const res = await saveTemplate(t, { id: user.id, name: user.name }, { source: "ACTIVATION", originActivationId: id });
  if (!res.ok) back(`/marketing/activations/${id}`, res.errors.join(" · "));
  refresh();
  redirect(`${BASE}/${t.key}?ok=depuis`);
}
