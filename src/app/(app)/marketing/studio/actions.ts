"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/access";
import { decisionScopeFor } from "@/lib/decisions/server";
import { parseOpportunityKey } from "@/lib/creative/opportunities";
import { buildPackageFor, generateConceptsFor, sendToPlanning, variationsFor } from "@/lib/creative/server";
import { getConcept, setConceptStatus } from "@/lib/creative/store";
import type { ConceptStatus } from "@/lib/creative/types";
import { conceptHref, opportunityHref } from "@/components/creative-studio";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const isUuid = (v: string | null): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const BASE = "/marketing/studio";
const STATUSES: ConceptStatus[] = ["PROPOSED", "APPROVED", "REJECTED", "BUILT", "SENT", "ARCHIVED"];

function refresh(conceptId?: string | null) {
  revalidatePath(BASE); revalidatePath("/marketing"); revalidatePath("/marketing/planning"); revalidatePath("/taches");
  if (conceptId) revalidatePath(`${BASE}/concept/${conceptId}`);
}
const withNote = (href: string, note: string | null) => (note ? `${href}${href.includes("?") ? "&" : "?"}note=${encodeURIComponent(note)}` : href);

/** Génère (ou régénère) les concepts d'une opportunité : Créer sur Marketing. */
export async function generateConceptsAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const key = str(formData, "key");
  const k = key ? parseOpportunityKey(key) : null;
  if (!key || !k) throw new Error("Opportunité invalide.");
  const scope = await decisionScopeFor(k.brandId);
  const res = await generateConceptsFor(scope, key, { id: user.id, name: user.name }, { regenerate: !!str(formData, "regenerate") });
  refresh();
  const note = res.warning ?? (res.dropped > 0 ? `${res.dropped} concept(s) écarté(s) par la revue créative ou la conformité.` : null);
  redirect(withNote(opportunityHref(key), note));
}

/** Construit le package de contenu d'un concept : Créer sur Marketing. */
export async function buildPackageAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const id = str(formData, "id");
  if (!isUuid(id)) throw new Error("Concept invalide.");
  const c = await getConcept(id);
  if (!c) throw new Error("Concept introuvable.");
  const scope = await decisionScopeFor(c.brandId);
  const res = await buildPackageFor(scope, id, { id: user.id, name: user.name });
  refresh(id);
  redirect(withNote(conceptHref(id, "accroches"), res.warning ?? (res.blocked ? "Le package porte une allégation bloquante : à corriger avant l'envoi en production." : null)));
}

/** Variations créatives d'un package : Créer sur Marketing. */
export async function variationsAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const id = str(formData, "id");
  if (!isUuid(id)) throw new Error("Concept invalide.");
  const c = await getConcept(id);
  if (!c) throw new Error("Concept introuvable.");
  const scope = await decisionScopeFor(c.brandId);
  const res = await variationsFor(scope, id, { id: user.id, name: user.name });
  refresh(id);
  redirect(withNote(conceptHref(id, "variations"), res.warning));
}

/** Approuver, écarter (motif), archiver ou rouvrir un concept : Modifier sur Marketing. */
export async function conceptStatusAction(formData: FormData) {
  const user = await requirePermission("marketing", "edit");
  const id = str(formData, "id"); const status = str(formData, "status") as ConceptStatus | null;
  if (!isUuid(id) || !status || !STATUSES.includes(status)) throw new Error("Demande invalide.");
  const c = await getConcept(id);
  if (!c) throw new Error("Concept introuvable.");
  const scope = await decisionScopeFor(c.brandId);
  if (!scope.allBrands.some((b) => b.id === c.brandId)) throw new Error("Hors périmètre.");
  const reason = str(formData, "reason");
  if (status === "REJECTED" && !reason) throw new Error("Un motif est obligatoire pour écarter un concept.");
  await setConceptStatus(id, status, { id: user.id, name: user.name }, reason);
  refresh(id);
  if (str(formData, "back") === "concept") redirect(conceptHref(id));
  redirect(opportunityHref(c.opportunityKey));
}

/** Envoi en production : crée le contenu du planning éditorial et sa tâche. Créer sur Marketing. */
export async function sendToPlanningAction(formData: FormData) {
  const user = await requirePermission("marketing", "create");
  const id = str(formData, "id");
  if (!isUuid(id)) throw new Error("Concept invalide.");
  const c = await getConcept(id);
  if (!c) throw new Error("Concept introuvable.");
  const date = str(formData, "date");
  if (!isDate(date)) throw new Error("Date de publication obligatoire.");
  const deadline = str(formData, "deadline");
  const responsibleId = str(formData, "responsibleId");
  const scope = await decisionScopeFor(c.brandId);
  const res = await sendToPlanning(scope, id, { id: user.id, name: user.name }, { date, deadline: isDate(deadline) ? deadline : null, responsibleId: isUuid(responsibleId) ? responsibleId : null, platform: str(formData, "platform") });
  refresh(id);
  redirect(`/marketing/planning/${res.contentItemId}`);
}
