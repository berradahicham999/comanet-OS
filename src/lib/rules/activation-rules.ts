import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fmtDate, fmtMAD, iso } from "@/lib/format";
import { activationRefs } from "@/lib/activations/refs";
import { listActivations, type ActivationCard } from "@/lib/activations/queries";
import { listInventory } from "@/lib/activations/inventory";
import { LATENESS_LABELS, INVENTORY_STATUS_LABELS, type LatenessKind } from "@/lib/activations/shared";
import type { Rule, Recommendation } from "./types";

/**
 * Activations en retard — mêmes définitions que la fiche et la liste (`activationLateness()`),
 * sur toutes les activations ouvertes, sans portée (l'Action Center filtre ensuite par module).
 *  - CHECKLIST : étapes non cochées à J−7 (réglage `checklistAlertDays`) → action prioritaire ;
 *  - RESULTATS : terminée depuis plus de `resultsDelayDays` sans résultats → rappel ;
 *  - BUDGET    : engagé + matériel au-delà du prévu → alerte ;
 *  - STATUT    : date passée sans passage au statut suivant.
 * Chaque retard notifie une fois le pilote (une notification par activation et par type).
 */
const NOTIF: Record<LatenessKind, { type: string; body: (a: ActivationCard) => string }> = {
  CHECKLIST: { type: "ACTIVATION_CHECKLIST_LATE", body: (a) => `Checklist ${a.checklistDone}/${a.checklistTotal} à ${fmtDate(a.date)}.` },
  RESULTATS: { type: "ACTIVATION_RESULTS_DUE", body: () => "Terminée : saisissez participants, échantillons, pharmacies touchées pour mesurer le retour." },
  BUDGET: { type: "ACTIVATION_BUDGET_OVERRUN", body: (a) => `Engagé ${fmtMAD(a.committed + a.materials)} pour ${fmtMAD(a.planned)} prévus.` },
  STATUT: { type: "ACTIVATION_CHECKLIST_LATE", body: (a) => `Date ${fmtDate(a.date)} passée : mettez le statut à jour.` },
};

export const activationLateRule: Rule = {
  id: "activation-late",
  label: "Activations en retard",
  description: "Checklist incomplète à J−7, résultats non saisis après la fin, budget engagé au-delà du prévu, statut non mis à jour.",
  async run({ settings, now }) {
    const t = iso(now);
    const refs = await activationRefs();
    const all = await listActivations({}, { ownerId: null, clientIds: null, brandIds: null }, refs, settings.activations, t);
    const late = all.filter((a) => a.late.length);
    // Notifications au pilote, une seule par activation et par type de retard.
    const toNotify = late.flatMap((a) => a.late.filter((k) => a.responsibleId).map((k) => ({ a, k })));
    if (toNotify.length) {
      await db.execute(sql`
        insert into notifications (user_id, type, title, body, href, entity_type, entity_id)
        select v.user_id::uuid, v.type, v.title, v.body, v.href, 'activation', v.entity_id::uuid
        from (values ${sql.join(toNotify.map(({ a, k }) => sql`(${a.responsibleId}, ${NOTIF[k].type}, ${`${LATENESS_LABELS[k]} : ${a.name}`}, ${NOTIF[k].body(a)}, ${`/marketing/activations/${a.id}`}, ${a.id})`), sql`, `)}) as v(user_id, type, title, body, href, entity_id)
        where not exists (select 1 from notifications n where n.type = v.type and n.entity_id = v.entity_id::uuid and n.user_id = v.user_id::uuid and n.title = v.title)`);
    }
    const typeLabel = (k: string) => refs.types.find((x) => x.key === k)?.label ?? k;
    return late.flatMap((a): Recommendation[] => a.late.map((k) => ({
      key: `activation-late:${k.toLowerCase()}:${a.id}`,
      rule: "activation-late",
      category: k === "BUDGET" ? "BUDGET" : "MARKETING",
      priority: k === "CHECKLIST" || k === "BUDGET" ? "HIGH" : "MEDIUM",
      title: a.brand ? `${a.brand} — ${a.name}` : a.name,
      subtitle: `${LATENESS_LABELS[k]} · ${typeLabel(a.type)}`,
      facts: [
        { label: "Dates", value: `${fmtDate(a.date)}${a.endDate && a.endDate !== a.date ? ` → ${fmtDate(a.endDate)}` : ""}` },
        { label: "Statut", value: refs.statuses.find((s) => s.key === a.status)?.label ?? a.status },
        { label: "Pilote", value: a.responsible ?? "Non assigné" },
        ...(k === "CHECKLIST" ? [{ label: "Checklist", value: `${a.checklistDone}/${a.checklistTotal}` }] : []),
        ...(k === "BUDGET" ? [{ label: "Prévu", value: fmtMAD(a.planned) }, { label: "Engagé + matériel", value: fmtMAD(a.committed + a.materials) }] : []),
      ],
      why: k === "CHECKLIST" ? `L'activation démarre dans moins de ${settings.activations.checklistAlertDays} jours et des étapes de préparation ne sont pas cochées : risque de PLV absente, d'échantillons manquants ou de lieu non confirmé.`
        : k === "RESULTATS" ? `Terminée depuis plus de ${settings.activations.resultsDelayDays} jours sans résultats saisis : impossible de calculer le coût par contact ni de comparer cette activation aux autres.`
        : k === "BUDGET" ? `L'engagé (devis, factures, matériel sorti) dépasse le prévu validé de ${Math.round(a.overrunPct)} % : le Command Center affiche un dépassement sur la marque.`
        : "La date est passée et le statut n'a pas bougé : soit l'activation n'a pas eu lieu, soit la fiche n'est pas à jour, et les rappels de résultats ne partiront pas.",
      action: k === "CHECKLIST" ? "Ouvrir la fiche, cocher ce qui est fait, et traiter ou réassigner les étapes restantes." : k === "RESULTATS" ? "Saisir les résultats sur la fiche (bloc « Résultats »), puis passer à « Mesurée »." : k === "BUDGET" ? "Vérifier les lignes budgétaires ; si le dépassement est réel, le faire valider ou réduire un poste." : "Mettre le statut à jour (Démarrer / Terminer) ou décaler les dates.",
      task: { title: `${LATENESS_LABELS[k]} : ${a.name}`, dueInDays: k === "CHECKLIST" ? 1 : 3, role: "MARKETING", priority: k === "CHECKLIST" || k === "BUDGET" ? "HIGH" : "MEDIUM" },
      entity: { type: "activation", id: a.id, href: `/marketing/activations/${a.id}` },
      brandId: a.brandId,
      score: a.planned,
    })));
  },
};

/** Stock bas ou rupture sur le matériel marketing — même définition que l'inventaire (`inventoryStatus()`). */
export const inventoryLowRule: Rule = {
  id: "inventory-low",
  label: "Matériel marketing en stock bas",
  description: "Articles d'inventaire (PLV, échantillons, goodies, print) sous leur seuil d'alerte ou en rupture.",
  async run({ settings, now }) {
    const items = (await listInventory({}, iso(now), settings.activations.inventoryDormantDays)).filter((i) => i.status === "BAS" || i.status === "RUPTURE");
    return items.map((i): Recommendation => ({
      key: `inventory-low:${i.id}`,
      rule: "inventory-low",
      category: "MARKETING",
      priority: i.status === "RUPTURE" ? "HIGH" : "MEDIUM",
      title: i.brand ? `${i.brand} — ${i.name}` : i.name,
      subtitle: `${INVENTORY_STATUS_LABELS[i.status]} · ${i.category}`,
      facts: [
        { label: "En stock", value: `${i.stock} ${i.unit}` },
        { label: "Seuil", value: i.alertThreshold != null ? String(i.alertThreshold) : "—" },
        { label: "Sorties 90 j", value: String(i.outQty90) },
        { label: "Coût unitaire", value: fmtMAD(i.unitCost) },
      ],
      why: i.status === "RUPTURE" ? "Plus aucune unité disponible : la prochaine activation qui en a besoin sera bloquée." : `Le stock est passé sous le seuil d'alerte (${i.alertThreshold}) avec ${i.outQty90} sorties sur 90 jours.`,
      action: "Passer une commande fournisseur, puis enregistrer l'entrée sur la fiche article. Ou relever le seuil s'il est trop haut.",
      task: { title: `Réapprovisionner : ${i.name}`, dueInDays: 7, role: "MARKETING", priority: i.status === "RUPTURE" ? "HIGH" : "MEDIUM" },
      entity: { type: "inventory", id: i.id, href: `/marketing/materiel/${i.id}` },
      brandId: i.brandId,
      score: i.outQty90 * i.unitCost,
    }));
  },
};

export const activationRules: Rule[] = [activationLateRule, inventoryLowRule];
