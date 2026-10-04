/**
 * Brief de production (logique PURE) : assemble le concept et le package en un document lisible par l'équipe, une
 * créatrice ou une agence, sans interprétation. Même structure à l'écran (page imprimable) et en Markdown (export,
 * champ « brief » du planning éditorial).
 */
import { SEVERITY_LABELS } from "./compliance";
import { FORMAT_LABELS, FUNNEL_LABELS, HOOK_LABELS, PERSONA_LABELS, TERRITORY_LABELS } from "./territories";
import type { BriefSection, ContentPackage, CreativeConcept, ProductionBrief } from "./types";

export type BriefMeta = { brandName: string; productName: string | null; audience: string; objective: string; generatedAt: string; budgetAxisLabel: string | null };

const sec = (key: string, title: string, lines: (string | null | undefined)[]): BriefSection => ({ key, title, lines: lines.filter((l): l is string => !!l && l.trim().length > 0) });

export function buildBrief(c: CreativeConcept, p: ContentPackage, meta: BriefMeta): ProductionBrief {
  const scriptA = p.scripts[0];
  const sections: BriefSection[] = [
    sec("objectif", "Objectif", [`${meta.objective} · étape ${FUNNEL_LABELS[c.funnelStage].toLowerCase()} · ${c.distribution === "BOTH" ? "organique + payant" : c.distribution === "PAID" ? "payant" : "organique"}`, `Réaction attendue : ${c.desiredConsumerReaction}`]),
    sec("produit", "Produit", [meta.productName ? `${meta.productName} (${meta.brandName})` : `Gamme ${meta.brandName}`, `Rôle du produit : ${c.productRole}`]),
    sec("cible", "Cible", [meta.audience, `Persona à l'image : ${PERSONA_LABELS[c.persona]}`]),
    sec("concept", "Concept créatif", [`${c.title}`, `Grande idée : ${c.bigIdea}`, `Territoire : ${TERRITORY_LABELS[c.creativeTerritory]} · mécanique : ${c.mechanicName} · déclencheur : ${c.psychologicalTrigger}`, `Message central : ${c.coreMessage}`, `Format : ${FORMAT_LABELS[c.recommendedFormat]}`]),
    sec("insight", "Insight consommateur", [`Tension : ${c.consumerTension}`, `Insight : ${c.insight}`]),
    sec("accroche", "Accroches", p.hooks.map((h) => `${HOOK_LABELS[h.type]} — ${h.text}`)),
    sec("script", `Script — ${scriptA?.label ?? "version A"} (${scriptA?.durationSec ?? 0} s)`, (scriptA?.scenes ?? []).map((s) => `Scène ${s.n} (${s.durationSec} s) — ${s.action}${s.dialogue ? ` · Dialogue : « ${s.dialogue} »` : ""}${s.voiceOver ? ` · Voix off : « ${s.voiceOver} »` : ""}`)),
    ...(p.scripts[1] ? [sec("script-b", `Script — ${p.scripts[1].label} (${p.scripts[1].durationSec} s)`, p.scripts[1].scenes.map((s) => `Scène ${s.n} (${s.durationSec} s) — ${s.action}${s.dialogue ? ` · « ${s.dialogue} »` : ""}`))] : []),
    sec("decoupage", "Découpage scène par scène", p.storyboard.map((s) => `${s.n}. ${s.durationSec} s · ${s.visual} · ${s.framing} · ${s.action}${s.onScreenText ? ` · texte : « ${s.onScreenText} »` : ""} · produit ${s.productVisible ? "visible" : "absent"}${s.transition ? ` · transition : ${s.transition}` : ""}`)),
    sec("plans", "Liste des plans", p.shotList.map((s) => `Plan ${String(s.n).padStart(2, "0")} · ${s.visual} · ${s.durationSec} s · ${s.framing} · produit : ${s.product ? "oui" : "non"}${s.notes ? ` · ${s.notes}` : ""}`)),
    sec("visuel", "Direction visuelle", [`Lumière : ${p.visual.lighting}`, `Décor : ${p.visual.environment}`, `Caméra : ${p.visual.cameraStyle}`, `Cadrage : ${p.visual.framing}`, `Mouvement : ${p.visual.movement}`, `Rythme : ${p.visual.pacing}`, `Montage : ${p.visual.editing}`, `Sous-titres : ${p.visual.subtitles}`, `Visibilité produit : ${p.visual.productVisibility}`]),
    sec("creatrice", "Direction de la créatrice", [p.visual.creatorDirection, `Ton : ${p.performance.tone}`, `Émotion : ${p.performance.emotionalTone}`, `Rythme : ${p.performance.pacing}`, `Expression : ${p.performance.expression}`, `Authenticité : ${p.performance.authenticity}`, ...p.performance.avoid.map((a) => `À éviter : ${a}`)]),
    sec("integration", "Intégration produit", [p.visual.productVisibility, c.productRole]),
    sec("textes", "Textes à l'écran", p.onScreenTexts),
    sec("cta", "Appel à l'action", [p.cta, ...p.ctaVariants.filter((x) => x !== p.cta).map((x) => `Variante : ${x}`)]),
    sec("legende", "Légende", p.caption.split("\n").filter(Boolean)),
    sec("hashtags", "Hashtags", [p.hashtags.join(" ")]),
    sec("organique", "Version organique", [`But : ${p.organic.goal}`, `Accroche : ${p.organic.hook}`, ...p.organic.structure.map((s, i) => `${i + 1}. ${s}`), `CTA : ${p.organic.cta}`, ...p.organic.notes]),
    sec("payant", "Version payante", [`But : ${p.paid.goal}`, `Accroche : ${p.paid.hook}`, ...p.paid.structure.map((s, i) => `${i + 1}. ${s}`), `CTA : ${p.paid.cta}`, p.paid.testBudgetMad !== null ? `Budget de test : ${Math.round(p.paid.testBudgetMad).toLocaleString("fr-FR")} MAD${meta.budgetAxisLabel ? ` (levier ${meta.budgetAxisLabel})` : ""}` : "Budget de test : non défini (aucun disponible sur le levier)", ...p.paidHookVariants.map((h) => `Accroche payante : ${h}`)]),
    sec("stories", "Idées de stories", p.storyIdeas),
    sec("miniature", "Miniature", [p.thumbnail]),
    sec("livrables", "Livrables et éléments nécessaires", p.assets),
    sec("notes", "Notes de production", p.productionNotes),
    sec("conformite", "Allégations et conformité", [
      ...p.claims.allowed.map((a) => `Autorisé (fiche produit) : ${a}`), ...p.claims.forbidden.map((f) => `Interdit : ${f}`), ...p.claims.mandatory.map((m) => `Mention obligatoire : ${m}`),
      ...(p.compliance.length ? p.compliance.map((f) => `Contrôle ${SEVERITY_LABELS[f.severity]} — ${f.text}${f.excerpt ? ` : « ${f.excerpt} »` : ""}`) : ["Contrôle automatique : aucune alerte ; relecture réglementaire obligatoire avant diffusion"]),
    ]),
    sec("kpi", "KPI", [...p.kpis.map((k) => `${k.label} : ${k.target} [${k.tag}]`), ...p.paid.kpis.filter((k) => !p.kpis.some((x) => x.label === k.label)).map((k) => `Payant · ${k.label} : ${k.target} [${k.tag}]`)]),
  ];
  const title = c.title;
  const subtitle = `${meta.brandName}${meta.productName ? ` · ${meta.productName}` : ""} · ${FORMAT_LABELS[c.recommendedFormat]} · brief généré le ${meta.generatedAt}${p.generatedBy === "RULES" ? " (squelette sans IA)" : ""}`;
  const markdown = [`# ${title}`, `_${subtitle}_`, "", ...sections.flatMap((s) => [`## ${s.title}`, ...s.lines.map((l) => `- ${l}`), ""])].join("\n");
  return { title, subtitle, sections, markdown };
}
