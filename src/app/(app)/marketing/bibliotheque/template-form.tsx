import { AXES, AXIS_KEYS, OBJECTIVES, OBJECTIVE_KEYS, ROLE_LABELS, TARGETS, TARGET_KEYS } from "@/lib/action-generator/catalog";
import { ACTIVATION_TYPE_KEYS, CAMPAIGN_CHANNELS, COST_ITEMS, FORMATS, type TemplateFields } from "@/lib/action-generator/library-shared";
import { BUDGET_CATEGORIES } from "@/lib/budget-categories";
import { Card } from "@/components/ui";
import { saveTemplateAction } from "./actions";

/** Formulaire d'un modèle : mêmes champs et même syntaxe que l'import Excel (`TEMPLATE_COLUMNS`). */
export function TemplateForm({ fields, original, readOnly, keyLocked }: { fields: TemplateFields; original: string | null; readOnly: boolean; keyLocked: boolean }) {
  const ro = readOnly;
  const text = (k: keyof TemplateFields, label: string, o: { placeholder?: string; hint?: React.ReactNode; className?: string } = {}) => (
    <label className={`block ${o.className ?? ""}`}><span className="label block mb-1">{label}</span>
      <input name={k} defaultValue={fields[k]} placeholder={o.placeholder} readOnly={ro} className="input h-9" />
      {o.hint && <span className="block text-[11.5px] text-muted mt-0.5">{o.hint}</span>}</label>
  );
  const area = (k: keyof TemplateFields, label: string, rows: number, hint?: React.ReactNode) => (
    <label className="block"><span className="label block mb-1">{label}</span>
      <textarea name={k} defaultValue={fields[k]} rows={rows} readOnly={ro} className="textarea font-mono text-[12.5px] leading-5" />
      {hint && <span className="block text-[11.5px] text-muted mt-0.5">{hint}</span>}</label>
  );
  const check = (k: "ville" | "pharmacies" | "influenceuses" | "actif", label: string) => (
    <label className="flex items-center gap-2 text-[13px]"><input type="hidden" name={`${k}_cb`} value="1" /><input type="checkbox" name={k} value="oui" defaultChecked={fields[k] === "oui"} disabled={ro} />{label}</label>
  );

  return (
    <form action={saveTemplateAction} className="space-y-4 text-[13px]">
      <input type="hidden" name="original" value={original ?? ""} />
      <Card title="Identité">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label block mb-1">Clé</span>
            <input name="cle" defaultValue={fields.cle} readOnly={ro || keyLocked} className="input h-9 font-mono" />
            <span className="block text-[11.5px] text-muted mt-0.5">{keyLocked ? "fixe ; dupliquer pour en créer un autre" : "majuscules, chiffres et _"}</span></label>
          <label className="block"><span className="label block mb-1">Levier</span>
            <select name="levier" defaultValue={fields.levier} disabled={ro} className="select h-9">{AXIS_KEYS.map((a) => <option key={a} value={a}>{AXES[a].label}</option>)}</select></label>
          {text("famille", "Famille", { placeholder: "Padel Challenge, Staff hospitalier…", className: "lg:col-span-2" })}
        </div>
        <div className="grid gap-3 mt-3">
          {text("nom", "Nom (texte à variables)", { placeholder: "{heros} Padel Challenge {ville|}" })}
          {area("concept", "Concept (texte à variables)", 4, <>Variables : {"{heros} {produit} {marque} {ville} {cible} {benefice} {actif} {angle} {saison}"} ; {"{variable|texte}"} si la donnée peut manquer. {"{benefice}"} et {"{actif}"} viennent de la fiche marketing du produit.</>)}
        </div>
      </Card>

      <Card title="Quand le proposer">
        <div className="grid sm:grid-cols-2 gap-3">
          {area("objectifs", "Objectifs (clé:affinité %)", 2, <>Clés : {OBJECTIVE_KEYS.map((k) => `${k} (${OBJECTIVES[k]})`).join(", ")}. Absent = jamais proposé pour cet objectif.</>)}
          {area("cibles", "Cibles", 2, <>Clés : {TARGET_KEYS.map((k) => `${k} (${TARGETS[k]})`).join(", ")}</>)}
          {text("produits", "Types de produit", { hint: "ANY, ou DERMO, COMPLEMENT, SOLAIRE" })}
          {text("canaux", "Canaux (affichés)", { placeholder: "Événement, Instagram, Pharmacies" })}
          {text("saisons", "Saisons (clé:+1 / -1)", { hint: "ramadan, solaire-haute, solaire-basse, rentree (Paramètres → Prévision)" })}
          {text("reserve", "Réservé à (saisons | mois | libellé)", { placeholder: "ramadan |  | Ramadan", hint: "vide = toute l'année ; ex. « | 5 | Fête des mères »" })}
        </div>
      </Card>

      <Card title="Budget et portée">
        <div className="grid grid-cols-3 gap-3">{text("budget_min", "Budget min (MAD)")}{text("budget_ideal", "Budget idéal")}{text("budget_max", "Budget max")}</div>
        <div className="grid gap-3 mt-3">
          {area("postes", "Postes (libellé ; catégorie ; part % ; poste d'activation)", 6, <>Une ligne par poste, total 100 %. Catégories : {BUDGET_CATEGORIES.join(", ")}. Postes d&apos;activation (obligatoires pour une activation) : {Object.keys(COST_ITEMS).join(", ")}.</>)}
          {text("portee", "Portée (contacts ; coût par contact ; essai % ; achat % ; unités ; meta)", { hint: "Hypothèses du modèle, affichées comme telles. « meta » : le coût par résultat Meta mesuré remplace le coût par contact quand il existe." })}
          {area("kpi", "KPI propres (libellé ; valeur ou /coût × facteur)", 3, "« Pharmacies touchées ; 25 » (fixe) ou « Joueurs ; /110 × 0,6 » (budget ÷ 110 × 0,6).")}
        </div>
      </Card>

      <Card title="Exécution">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label block mb-1">Complexité</span>
            <select name="complexite" defaultValue={fields.complexite} disabled={ro} className="select h-9"><option value="LOW">Faible</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Élevée</option></select></label>
          {text("preparation", "Préparation (jours)")}{text("duree", "Durée (jours)")}{text("non_repetition", "Non-répétition (jours)")}
        </div>
        <div className="mt-3">{text("execution", "Exécution", { hint: <>ACTIVATION:type ({ACTIVATION_TYPE_KEYS.join(", ")}) ou CAMPAGNE:type:canal ({CAMPAIGN_CHANNELS.join(", ")})</> })}</div>
        <div className="grid lg:grid-cols-2 gap-3 mt-3">
          {area("etapes", "Étapes (J-30 ; libellé ; rôle)", 10, <>Rôles : {Object.entries(ROLE_LABELS).map(([k, v]) => `${k} (${v})`).join(", ")}. Aucune étape avant J − préparation.</>)}
          {area("contenus", "Contenus (J-7 ; format ; nombre ; titre)", 10, <>Formats : {FORMATS.join(", ")}</>)}
        </div>
        <div className="flex flex-wrap gap-5 mt-3">{check("ville", "S'appuie sur une ville")}{check("pharmacies", "S'appuie sur des pharmacies")}{check("influenceuses", "S'appuie sur des influenceuses")}{check("actif", "Actif (proposé par le générateur)")}</div>
        <div className="mt-3">{text("conformite", "Point de conformité (allégations)")}</div>
      </Card>

      {!ro && <div className="flex gap-2"><button className="btn-primary">Enregistrer le modèle</button></div>}
    </form>
  );
}
