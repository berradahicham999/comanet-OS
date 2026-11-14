# Décisions d'agents : contrat `sources.decisions[]`

Les agents externes (CMO par marque, MBR, Ads pilot, proposition client…) écrivent leurs rapports dans la table
`ai_reports`. Pour qu'une recommandation d'un rapport devienne une **ligne à trancher** dans la zone « À décider »
du Cockpit (et sur le téléphone, `/m/validations`), l'agent la déclare dans `ai_reports.sources.decisions[]`.

Sans ce tableau, le rapport apparaît comme **une seule ligne « Rapport à lire »** (Ouvrir, Valider, Archiver).

## Ce que l'agent écrit

`sources` est un objet JSON. Les clés déjà utilisées (`tables`, `agents`, `meta_live`, `files`…) restent libres ;
`decisions` est un tableau d'objets :

```json
{
  "tables": ["sales", "ad_metrics"],
  "decisions": [
    {
      "id": "d1",
      "title": "Lancer l'offre 10 + 2 Gamarde en pharmacie",
      "why": "Sell-in Gamarde en retrait sur trois mois ; l'offre a porté le réassort au T2.",
      "amount_mad": 38000,
      "due_date": "2026-11-20",
      "owner_role": "MARKETING",
      "brand_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "expected_kpi": "Réassort de 40 pharmacies avant le 15/12",
      "review_date": "2026-12-20"
    }
  ]
}
```

| Champ | Type | Obligatoire | Règle |
|---|---|---|---|
| `id` | texte (ou nombre) | oui | Unique **dans le rapport**, stable. Un identifiant répété est ignoré à partir de la deuxième ligne. 80 caractères au plus. |
| `title` | texte | oui | Devient le titre de la tâche. 200 caractères au plus. |
| `why` | texte | oui | Le pourquoi, avec la donnée qui le justifie. Sa première ligne est affichée dans la file. |
| `amount_mad` | nombre ≥ 0 ou `null` | non | Montant en dirhams. Absent ou `null` = pas de montant : affiché « — », **jamais estimé**. Un texte (`"12 000"`) rend la ligne illisible. |
| `due_date` | `AAAA-MM-JJ` | oui | Échéance : sert au tri de la file et devient l'échéance de la tâche. |
| `owner_role` | texte | oui | Qui doit exécuter : un rôle (`ADMIN`, `MARKETING`, `TRADE`, `REGLEMENTAIRE`, `ANIMATRICE`, `DELEGUE_MEDICAL`, `MANAGER_MEDICAL`, ou en clair : « direction », « commercial »…) ou l'adresse e-mail d'un compte. |
| `brand_id` | UUID de `brands.id` ou `null` | non | Marque de la décision ; à défaut, celle du rapport. Sert à la portée : une décision hors du périmètre de la personne ne lui est pas proposée. |
| `expected_kpi` | texte | oui | Résultat attendu et comment le mesurer. |
| `review_date` | `AAAA-MM-JJ` | oui | Date à laquelle le résultat sera revu. |

Le rapport est créé avec `status = 'draft'` (les minuscules sont comprises). Le `type` est libre
(`gamarde_cmo_monthly`, `mbr_monthly`…).

## Ce que fait l'application

- **Ligne illisible** : une ligne qui ne respecte pas le tableau ci-dessus (champ manquant, date qui n'existe pas,
  montant en texte, `brand_id` qui n'est pas un UUID, identifiant répété) est **ignorée**, comptée, et signalée sur la
  page du rapport. Elle ne fait pas planter la lecture et n'est jamais « réparée ». Si aucune ligne n'est lisible, le
  rapport retombe en « Rapport à lire ».
- **Valider** une décision crée une tâche « À faire » (titre, échéance = `due_date`, responsable trouvé depuis
  `owner_role`, marque, résultat attendu, lien vers le rapport). Si aucun compte ne correspond à `owner_role`, la tâche
  naît sans assigné et le rôle demandé figure dans sa description.
- **Refuser** exige un motif. Aucune tâche n'est créée.
- **Le sort de chaque décision** est consigné par l'application dans `sources.outcomes`, à côté de ce que l'agent a
  écrit, qui n'est jamais modifié :

  ```json
  "outcomes": {
    "d1": { "status": "REJECTED", "at": "2026-11-14T09:12:00.000Z", "by_id": "…", "by_name": "Hicham", "reason": "Marge insuffisante", "task_id": null },
    "d2": { "status": "APPROVED", "at": "2026-11-14T09:10:00.000Z", "by_id": "…", "by_name": "Hicham", "reason": null, "task_id": "…" }
  }
  ```

  Un agent peut donc relire ses rapports précédents et savoir ce qui a été retenu, refusé (et pourquoi) et quelle tâche
  en est née. **Un agent n'écrit jamais `outcomes`.**
- **Le rapport passe `VALIDATED`** dès que toutes ses décisions lisibles sont tranchées (validées ou refusées). Tant
  qu'il en reste, le bouton « Valider » de la page du rapport est remplacé par « Trancher N décisions ».
- **Deux écrans en même temps** : la ligne du rapport est verrouillée pendant l'écriture. Une décision déjà tranchée
  sur le téléphone répond « Déjà validée par … » au bureau, qui se recharge. Un rapport supprimé entre-temps répond
  « Ce rapport a été supprimé ».

## Droits

« Valider » sur le module **Rapports** (ou administrateur), comme la validation d'un rapport ; la marque de la décision
doit être dans le périmètre de la personne. La prévisualisation « en tant que » reste en lecture seule. Chaque
validation et chaque refus laissent une trace dans le journal d'audit (`report_decision`).

## Code

| Quoi | Où |
|---|---|
| Lecture du contrat, bascule du rapport (pur, testé) | `src/lib/ai/report-decisions-shared.ts` |
| File des rapports en brouillon, écriture de `sources.outcomes` | `src/lib/ai/report-decisions.ts` |
| File unique « À décider » (téléphone + Cockpit) | `src/lib/validations/` |
| Tests | `tests/validations.test.ts` |
