# Permissions modulaires par utilisateur — schéma proposé (avant codage)

Statut : **livré sur la branche `feat/event-engine-animation-completed`** (migration `0012_permissions_modulaires`,
non encore appliquée en production : bouton « Appliquer les migrations » sur `/installation`).
Ce document remplace la section 10.1 « Rôles et permissions » du cahier des charges. Les sections 1 à 5
sont la proposition d'origine, la section 6 les décisions d'Hicham, la section 7 ce qui a été livré.

## 1. Ce qui existe déjà (migration `0006_rbac`)

| Table | État | Constat |
|---|---|---|
| `roles`, `role_permissions`, `user_roles` | en base, résolues par `src/lib/permissions.ts` (union des rôles) | **Aucun écran ne les écrit** : `/parametres` ne modifie que l'enum `users.role`. |
| `user_scopes` (ALL / TEAM / OWN, `brand_ids`, `cities`) | en base | **Jamais lue ni écrite** par l'application. Aucune requête ne filtre par périmètre. |
| `audit_logs` | en base | Jamais alimentée. |
| Actions | `view / create / edit / delete / export / admin` | Le cahier veut `Voir / Créer / Modifier / Valider` + interrupteurs transverses. |
| Modules | 17 clés techniques (cockpit, actions, ventes, clients, produits, marques, stock, terrain, terrain_animatrices, reglementaire, marketing, medical, medical_admin, taches, imports, parametres, recherche) | Le cahier en liste 13, découpées autrement (Budgets, Influence, Assets, Rapports séparés du Marketing). |
| Module Médical | livré en V1 (`715a674`) : délégués, secteurs, spécialités, médecins, visites, produits présentés, échantillons, planning | Manquent : marques du prescripteur, objections/documentation, valorisation MAD des échantillons et décompte budget, corrélation zones ↔ ventes, **mode hors ligne**. |

Conclusion : on ne repart pas de zéro, on **finit et on redécoupe** le RBAC existant.

## 2. Modèle cible

Un utilisateur = **une matrice propre** (`user_permissions`) + **un périmètre** + **des interrupteurs transverses**.
Les modèles de rôle ne sont plus liés à l'utilisateur : ils servent à pré-remplir, puis on oublie le lien.

```
users ──1..n── user_permissions (module, view, create, edit, validate)
      ──1..1── user_scope        (scope: OWN | ASSIGNED | ALL)
      ──1..n── user_brand_assignments (brand_id)
      ──1..n── user_client_assignments (client_id)
      ──1..1── user_flags        (6 interrupteurs transverses)

role_templates ──1..n── role_template_permissions   (pré-remplissage uniquement)
               ──1..1── flags par défaut du modèle

permission_audit_logs (qui, quoi, pour qui, avant/après, quand)
```

### 2.1 `user_permissions` — remplace `user_roles` + `role_permissions` comme source de vérité

| Colonne | Type | Note |
|---|---|---|
| `user_id` | uuid → users | cascade |
| `module` | varchar(50) | clé du catalogue (§3) |
| `can_view` | bool | |
| `can_create` | bool | implique `can_view` (contrainte SQL `check`) |
| `can_edit` | bool | implique `can_view` |
| `can_validate` | bool | implique `can_view` |
| `updated_at`, `updated_by` | | |

Clé unique `(user_id, module)`. Une ligne absente = aucun droit.

### 2.2 `user_scope` (renommage de `user_scopes`, simplifiée)

| Colonne | Type | Note |
|---|---|---|
| `user_id` | uuid, PK | |
| `scope` | enum `data_scope` : `OWN`, `ASSIGNED`, `ALL` | remplace ALL/TEAM/OWN. `TEAM` est retiré (voir question Q4). |

La portée est **globale par utilisateur** (une seule valeur), pas par module — c'est ce que décrit le cahier.
La colonne `module` de `user_scopes` disparaît.

### 2.3 Assignations de périmètre

- `user_brand_assignments (user_id, brand_id)` — remplace le tableau `brand_ids`.
- `user_client_assignments (user_id, client_id)` — nouveau.
- `users.city` conservé : sert déjà aux animatrices.

Ce que « ses propres données » veut dire, module par module, est fixé dans le code (§4).

### 2.4 `user_flags` — interrupteurs transverses

| Colonne | Contrôle |
|---|---|
| `see_purchase_prices_and_margins` | `products.cost_price`, marges, prix d'achat partout |
| `see_global_budgets` | totaux d'enveloppes toutes marques |
| `see_internal_costs` | `influencer_collaborations.fee`, rémunération animatrices |
| `approve_spend` | validation d'une dépense (indépendant de `can_validate` module Budgets) |
| `export_data` | tout export xlsx/csv/pdf, tous modules |
| `read_activity_log` | consultation du journal d'activité et du journal des droits |

### 2.5 `role_templates` + `role_template_permissions` + flags

`roles` actuelle est renommée `role_templates` ; `home_path` et `priority` sont conservés (page d'accueil du modèle
appliqué en dernier, modifiable ensuite sur la fiche utilisateur). `is_system` disparaît : **tout modèle est
renommable et supprimable**, sauf s'il n'en reste qu'un. Appliquer un modèle = `OR` case par case avec la matrice
courante (cumulatif, jamais d'écrasement).

### 2.6 `permission_audit_logs`

| Colonne | |
|---|---|
| `actor_id`, `actor_name` | qui |
| `target_user_id`, `target_user_name` | pour qui |
| `change` | `PERMISSIONS`, `SCOPE`, `ASSIGNMENTS`, `FLAGS`, `SUSPEND`, `REACTIVATE`, `TEMPLATE_APPLIED`, `DUPLICATED` |
| `before`, `after` | jsonb, diff lisible |
| `created_at` | |

Table dédiée plutôt que `audit_logs` générique, pour que la revue périodique reste simple à requêter.

### 2.7 `users`

- `role` (enum) : **conservé un cycle** en lecture seule, recalculé à partir des modules pour les rares
  endroits qui l'utilisent encore (session JWT, `medical_delegates`), puis supprimé.
- `active` → statut `ACTIVE | SUSPENDED` (un compte suspendu garde ses données et sa configuration).
- Nouveau `last_login_at`.

## 3. Catalogue des modules (clés techniques → libellé)

| Clé | Libellé | Chemins |
|---|---|---|
| `produits` | Référentiel produits | /produits, /marques, /stock (voir Q2) |
| `reglementaire` | Réglementaire | /reglementaire |
| `ventes` | Suivi commercial et ventes | /ventes, import ventes, objectifs |
| `clients` | Clients et trade marketing | /clients, /terrain calendrier trade |
| `marketing` | Marketing digital | /marketing, campagnes, ads, planning |
| `influence` | Influence et UGC | /marketing/influence |
| `budgets` | Budgets | /marketing/budgets |
| `terrain` | Terrain / animations | /terrain, /terrain/saisie, animatrices |
| `medical` | Délégué médical | /medical/* |
| `taches` | Tâches et projets | /taches |
| `assets` | Bibliothèque d'assets | nouveau, /assets |
| `rapports` | Rapports et exports | nouveau, /rapports |
| `administration` | Administration | /parametres, /imports, utilisateurs |

Modules actuels absorbés : `cockpit` et `actions` (visibles dès qu'un module est visible, filtrés par ses droits),
`recherche` (idem), `marques` et `stock` (→ `produits`), `terrain_animatrices` (→ `terrain` + portée),
`medical_admin` (→ `medical` avec `can_validate`), `imports` et `parametres` (→ `administration`).

## 4. Sémantique de « ses propres données » (portée OWN) et « Valider »

| Module | OWN = | Valider = |
|---|---|---|
| terrain | animations où `animatrice_id = moi` | clôturer / valider une animation, un rapport |
| medical | médecins et visites où `delegate_id = moi`, mon stock d'échantillons | valider une visite, ajuster le stock d'échantillons, gérer délégués/secteurs |
| taches | tâches assignées à moi ou créées par moi | clôturer une tâche d'autrui |
| clients / ventes | (OWN n'a pas de sens → traité comme ASSIGNED) | valider un objectif |
| marketing / influence | campagnes et collaborations dont je suis responsable | publier / clôturer une campagne |
| budgets | (OWN = ASSIGNED) | engager ou valider une ligne (`approve_spend` requis en plus) |
| reglementaire | dossiers dont je suis responsable | valider un dépôt / une étape |
| produits / assets / rapports | (pas de notion de propriétaire → OWN = ASSIGNED) | publier un asset, valider une fiche |
| administration | — | — |

Portée ASSIGNED = filtre `brand_id ∈ mes marques` **ou** `client_id ∈ mes clients`, selon la table.

## 5. Migration depuis l'existant (sans perte)

1. Créer les nouvelles tables.
2. Pour chaque utilisateur : aplatir `user_roles → role_permissions` (ou à défaut `users.role`) en lignes
   `user_permissions` avec le **remappage des 17 clés vers les 13** ; `can_validate` = ancien `can_admin`
   ou `can_delete`.
3. `user_scopes` → `user_scope` : `TEAM` devient `ASSIGNED` ; `brand_ids` → `user_brand_assignments`.
4. Flags : ADMIN → tout ; MARKETING → budgets globaux + coûts internes ; autres → tout à faux, sauf `export_data`
   qui reprend l'ancien `can_export`.
5. `roles` → `role_templates` avec leur matrice remappée. Les 7 modèles livrés restent disponibles comme
   pré-remplissage.
6. Vérification bloquante : au moins un compte actif avec `administration.can_validate`.
7. Suppression de `user_roles`, `role_permissions`, `user_scopes` **dans une migration ultérieure**, une fois
   l'écran validé en production.

## 6. Décisions d'Hicham (7 septembre 2026)

1. Cockpit, Action Center, Recherche : pas de case ; visibles dès qu'un module l'est, filtrés selon les droits.
2. **Stock et achats** = module séparé du référentiel produits.
3. Imports rattachés à leur module (import ventes = Créer sur Ventes). Configuration de la connexion et du mapping = Administration.
4. Portée « équipe » retirée de l'interface ; `users.manager_id` conservée en base, inutilisée.
5. « Valider » = action irréversible ou externe (dépôt, publication, engagement d'une dépense, clôture d'animation). Toute validation touchant à l'argent = Administration.
6. Réservé à l'Administration : utilisateurs et droits, modèles de rôle, seuils, taux de change, connexion Meta, migrations, démo, budgets annuels par marque, suppression définitive, export complet. **Personne ne modifie ses propres droits.**
7. Portée OWN sur un module sans propriétaire = ASSIGNED.
8. Prévisualisation : lecture seule stricte, bandeau permanent avec le compte simulé.
9. Hors ligne : lot séparé, terrain + médical ensemble, après les permissions.
10. Enum `users.role` conservée en lecture seule recalculée jusqu'à vérification en production. Récapitulatif = page HTML imprimable.

## 7. Ce qui est livré

### Écrans (module Administration, « Valider » requis)
- `/parametres/utilisateurs` — liste : nom, e-mail, puces des modules actifs, portée, statut, dernière connexion ; recherche, filtre par module, comptes suspendus.
- `/parametres/utilisateurs/nouveau` — profil + matrice (modèles cumulatifs, dépendances gérées, portée, assignations marques/clients, interrupteurs).
- `/parametres/utilisateurs/[id]` — fiche : matrice, profil, **Prévisualiser en tant que** (bandeau permanent, lecture seule, sortie par `/api/preview/exit`), suspension/réactivation, duplication, historique des droits du compte. Sa propre fiche est en lecture seule.
- `/parametres/modeles`, `/parametres/modeles/[id]`, `/parametres/modeles/nouveau` — modèles de rôle éditables ; huit livrés (Administrateur, Animatrice, Délégué médical, Manager médical, Marketing, Réglementaire, Commercial / Trade, Infographiste).
- `/parametres/droits-journal` — qui a changé quoi, pour qui, quand, avec le diff avant/après lisible.
- `/parametres/recapitulatif` — récapitulatif imprimable de tous les comptes (une fiche par compte, CSS d'impression).

### Sécurité côté serveur
- `requireAccess`, `requirePermission`, `requireAdmin`, `requireFlag`, `requireAnyModule` dans chaque page et action ; les droits sont relus à chaque requête (`react.cache`), donc **application immédiate**.
- Filtres de portée : `isOwnOnly()` (terrain, médical, tâches), `brandFilter()` / `clientFilter()` (ventes, clients, campagnes, influence, budgets, planning, tâches).
- Interrupteurs appliqués : marges (produits, stock, budgets, valorisation des échantillons), coûts internes (influence, campagnes, coût d'animation), budgets globaux (totaux de `/marketing/budgets`), export (export réglementaire), journal d'activité (`/parametres/evenements`), validation d'une dépense (`saveExpense` hors PLANNED).
- Garde-fous : dernier administrateur protégé (SQL de migration + `saveUserConfig` + suspension), personne ne modifie ses propres droits, contrainte `CHECK` sur les dépendances.

### Migration (0012)
Remappage des 17 anciens modules vers les 14 nouveaux, portée déduite (animatrices et délégués en OWN),
interrupteurs reproduisant ce que chaque ancien rôle voyait, modèles livrés, refus si aucun compte actif
n'hérite d'Administration. Les anciennes tables (`roles`, `role_permissions`, `user_roles`, `user_scopes`)
restent en place, inutilisées ; `users.role` est recalculée à chaque enregistrement (`legacyRoleFor`).
`users.active = false` = compte suspendu (pas de nouvel enum de statut : moins de surface de migration).

### Module Délégué médical — compléments
Marques concernées par prescripteur (`doctor_brands`), objections et documentation laissée sur la visite,
valorisation des échantillons (prix d'achat, sinon prix COMANET ; « non mesurable » sans prix) décomptée
du budget de la marque dans la définition officielle (`src/lib/budget.ts`, champ `samplesValue`),
analyse « zones visitées vs ventes en pharmacie » présentée comme **corrélation observée** sur le
dashboard médical. Le mode hors ligne est un lot séparé (décision 9).

### Tests
`tests/permissions.test.ts` : dépendances, cumul, rôle legacy, lecture du formulaire, les cinq cas
d'acceptation, et l'interdiction de toute décision d'accès sur `user.role`.

## 8. Portée par ville et « toutes les marques » (22 septembre 2026, migration `0022_portee_ville`)

Demande d'Hicham : assigner les clients aux animatrices un par un est trop lourd ; chaque animatrice doit
couvrir **toute la base clients de sa ville** et **toutes les marques**.

- `user_scope.all_brands` : toutes les marques, y compris celles créées plus tard. La liste
  `user_brand_assignments` est conservée (elle revient si l'on décoche).
- `user_city_assignments (user_id, city)` : tous les clients de ces villes entrent dans la portée,
  **y compris les clients importés plus tard**, en plus des clients cochés un à un.
- Rapprochement par `cityKey()` (`src/lib/animations-shared.ts`) : « FES », « Fès » et « FÈS » ne font qu'une ville.
- Résolution dans `resolveAccessFor()` via `expandAssignments()` (`src/lib/permissions-shared.ts`) : villes et
  « toutes les marques » sont dépliées en `brandIds` / `clientIds`. Aucune page, règle ni outil IA n'a changé :
  `brandFilter()`, `clientFilter()` et consorts voient simplement des listes complètes.
- Écran : fiche utilisateur → bloc « Villes » (bouton « + Sa ville » d'après le champ Ville de la fiche) et case
  « Toutes les marques ». Liste des comptes → « Appliquer à toutes les animatrices » (`applyCityScopeToAnimatrices()`) :
  chaque animatrice active avec une ville reçoit sa ville et toutes les marques, en cumul, journalisé compte par compte.
- Avant l'application de la migration, colonne et table absentes sont tolérées (portée vide) : la connexion ne casse pas.
