# App mobile COMANET OS — rapport d'inspection et plan (étape 0)

Inspection du 07/11/2026, sur le commit `3cf4c65`. Aucun code applicatif modifié, rien écrit en production.
Statut : **plan validé le 07/11/2026 avec les recommandations de la section 9. P1a livrée** (section 10), sauf l'APK : il attend le domaine et le keystore.

---

## 1. Ce qu'il faut retenir

1. **La base est meilleure que le brief ne le suppose.** Chrono, GPS au moment de l'action, file IndexedDB,
   idempotence par `client_event_id` et barre d'onglets mobile existent déjà pour les visites médicales et commerciales.
   On généralise, on ne crée pas.
2. **L'app n'est pas installable aujourd'hui.** Chrome répond `no-manifest` sur la prod. Il manque le manifest,
   les icônes, `assetlinks.json` et la page `/app`.
3. **La saisie animatrice et le relevé de stock ne fonctionnent pas hors connexion.** Ce sont des server actions, sans
   UUID client. C'est le plus gros manque, et c'est le cœur du besoin terrain.
4. **Trois écarts de sécurité existent déjà en production** (section 5). Le passage à une session de 30 jours et à une
   app installée les aggrave. Ils sont corrigés dans le socle, avant tout le reste.
5. **Le LCP n'est pas le problème. Le temps avant que l'écran réponde au doigt l'est** : environ 3 s en 3G au premier
   lancement. Le service worker règle les lancements suivants.
6. **« Proposition IA » n'existe pas dans l'application.** Le brief la cite comme un écran existant : c'est une skill
   Claude, hors de l'app. Dans l'app, il existe le plan d'action, `clientVisitBrief()` et `missingAssortment()`.

---

## 2. Cartographie

| Sujet | État réel |
|---|---|
| Pages et routes | 145 pages, 28 `route.ts`, 57 fichiers `"use server"`. 161 fichiers en `force-dynamic` : presque tout est rendu par le serveur à chaque requête |
| Layouts | 2 seulement. `(app)/layout.tsx` lit les droits, les notifications et la visite en cours à chaque navigation, donc **aucune coquille n'est statique** aujourd'hui |
| États de chargement | **Aucun** `loading.tsx`, `error.tsx` ni `not-found.tsx` dans tout `src/app` |
| Navigation | `AppShell` : menu latéral, tiroir mobile, barre basse de 4 onglets + « Plus ». `mobileTabsForPermissions()` choisit les onglets |
| Accueil | `homeFor()` : la portée OWN mène à la saisie, à Ma journée ou aux commandes ; sinon le Cockpit |
| Auth | JWT signé dans un cookie `httpOnly`, **7 jours, sans renouvellement**, sans table de sessions. `users.active` est relu à chaque requête (seule révocation possible : suspendre le compte) |
| Filtre d'accès | `src/proxy.ts`, liste `PUBLIC`. `/.well-known/assetlinks.json` répond 307 vers `/login` : à ouvrir |
| Droits | 19 modules × 4 actions, portée OWN / ASSIGNED / ALL, 7 interrupteurs, assignations marques et clients. **Aucune décision sur `users.role`** (un test l'interdit) |
| Notifications | Table `notifications`, `notify()`, cloche, page `/notifications`. Point d'entrée unique : Web Push s'y branche directement |
| Service worker | `public/sw.js`, 48 lignes, enregistré depuis Ma journée et Ma tournée |
| Hors connexion | `src/lib/medical/field-client.ts` : `fieldQueue("medical" \| "crm")`, routes `/api/medical/visit-events` et `/api/crm/visit-events` |
| Tests | 952 tests unitaires verts (base de référence du 07/11). Playwright présent sans runner `@playwright/test` : scripts `scripts/e2e.mjs` et `shot.mjs` |
| Mode sombre | Aucun. Aucune variante dans `globals.css` |

---

## 3. État des écrans à 360 px

Mesuré sur un build de production local, viewport 360×800, tactile, cache vide. « < 44 px » compte les éléments cliquables de
moins de 44 px de haut ou de large (liens de texte compris) : c'est un indicateur, pas un défaut par élément.

| Écran | Route | JS gzip | Débordement | État réel |
|---|---|---:|---:|---|
| Saisie animatrice | `/terrain/saisie` | 166 KB | 0 | **Utilisable, pas rapide.** Dates en tête, liste native jusqu'à 157 produits, aucun favori, aucun stepper. `usualProductsForAnimatrice()` existe mais **n'est appelée nulle part**. Au moins 20 gestes pour 5 produits. Pas hors connexion, pas de GPS |
| Ma journée (déléguée) | `/medical/journee` | 171 KB | 0 | **Bon, le plus abouti.** « Démarrer » fait 40 px. Le compte rendu est une page serveur : il ne se remplit pas hors connexion |
| Ma tournée (commercial) | `/clients/tournee` | 173 KB | 0 | **Fonctionnel mais mal ordonné.** L'aide GPS puis les statistiques passent avant la liste des visites : le premier écran ne dit pas quoi faire. Pas réouvrable hors connexion |
| Fiche client | `/clients/[id]` | **273 KB** | **125 px** | **À reprendre.** Le graphique charge environ 110 KB. Pensée pour le bureau |
| Stock point de vente | onglet de la fiche | 273 KB | 0 | Formulaire serveur, pas hors connexion, relevé rejoué = doublon |
| Commande client | `/gestion/pieces/nouveau` | 172 KB | 0 | Saisie mobile correcte, en ligne uniquement |
| Action Center | `/actions` | 164 KB | **21 px** | Cartes trop larges, le bouton Copilote couvre le texte, 161 cibles sur 166 sous 44 px |
| Mes tâches | `/taches` | 162 KB | 0 | Lisible, lignes basses |
| Recherche | `/recherche` | 162 KB | **146 px** | Colonne de droite coupée |
| Validations | `/marketing/activations/validation` | 166 KB | 0 | Activations seulement. **Pas de file unique** contenus + BL + dépenses |
| Stock & achats | `/stock` | 162 KB | **12 px** | Tableau large, à garder sur ordinateur |
| Cockpit | `/` | **275 KB** | 0 | Lourd, graphiques, 297 ms de serveur en local |
| Proposition IA | — | — | — | **N'existe pas** |

Autres constats :

- L'animatrice voit les onglets **Cockpit** et **Action Center**, qui ne la concernent pas.
- « Commandes clients » passe sur deux lignes dans la barre basse.
- L'aide GPS dit « touchez l'icône à gauche de l'adresse » : **dans une app installée, il n'y a plus de barre d'adresse.**
  Le texte doit renvoyer aux réglages du téléphone.

---

## 4. Mesures

**Méthode.** Prod : routes publiques seulement. Pages authentifiées : build de production local avec base jetable
(160 produits, 300 clients, 8 000 ventes synthétiques). Profils : 4G = 150 ms, 1,6 Mbit/s, CPU ×4 ; 3G = 300 ms, 700 kbit/s, CPU ×6.

| Écran | Lighthouse 4G | Lighthouse 3G | LCP réel 4G | LCP réel 3G | Répond au doigt 4G | Répond au doigt 3G |
|---|---:|---:|---:|---:|---:|---:|
| `/terrain/saisie` | 96 | 80 | 0,65 s | 1,36 s | 1,42 s | **3,04 s** |
| `/medical/journee` | 99 | 83 | 0,64 s | 1,35 s | 1,41 s | **3,09 s** |
| `/clients/tournee` | 98 | 82 | 0,64 s | 1,35 s | 1,45 s | **3,13 s** |
| `/clients/[id]` | — | — | 0,68 s | 1,39 s | 1,59 s | **3,49 s** |
| `/` (Cockpit) | 96 | 77 | 0,79 s | 1,35 s | 1,73 s | **3,51 s** |
| `/actions` | 98 | 80 | 0,69 s | 1,34 s | 1,48 s | **3,07 s** |
| `/login` (**prod**) | 100 | 88 | — | — | — | — |

- **Le LCP de Lighthouse est pessimiste.** Son modèle donne 2,2 à 2,8 s en 4G et 4,6 à 6,2 s en 3G, alors que l'élément LCP
  est un paragraphe déjà rendu par le serveur (délai de rendu observé : 49 ms). La colonne « réel » vient d'un bridage réel
  du réseau et du CPU. **Il faut choisir quel chiffre fait foi pour l'acceptation** : je propose la mesure réelle, Lighthouse restant le garde-fou du score.
- **Poids de la coquille : 161 KB gzip**, dont 141 KB pour le socle du framework (mesuré sur `/login`). Il reste **environ 29 KB de marge**
  sous la cible de 170 KB. Tenable, à condition de charger à la demande le Copilote et les graphiques.
- **TTFB prod** : `/login` 220 à 250 ms à chaud, 708 ms au premier appel (démarrage à froid). `/api/health` 220 à 350 ms.

**Limites de ces mesures, à ne pas sur-interpréter :**

- Les **TTFB réels des pages authentifiées ne sont pas mesurés** : la connexion Vercel refuse l'accès aux métriques de l'équipe
  `comanet` (403). Speed Insights n'est pas installé non plus.
- Le serveur local n'a ni la latence ni le volume de la prod. Ajouter au moins 0,25 à 0,7 s aux chiffres ci-dessus.
- Le CPU bridé d'un Mac n'est pas un Android d'entrée de gamme. Seul un téléphone réel tranchera.
- **Lighthouse n'a plus de catégorie PWA depuis la version 12.** Le critère « PWA installable » se vérifiera avec le contrôle
  d'installabilité de Chrome (`Page.getInstallabilityErrors`) et sur téléphone.
- Rien n'a été testé sur iPhone ni sur un Android physique.

---

## 5. Écarts de sécurité déjà présents

Constatés à la lecture du code, non rejoués sur un téléphone.

| # | Écart | Conséquence |
|---|---|---|
| S1 | `sw.js` garde le HTML de `/medical/journee` et **rien ne vide le cache à la déconnexion** | La page de la déléguée, avec ses données, reste lisible hors connexion après la déconnexion |
| S2 | La file IndexedDB **n'est pas liée à un utilisateur**, et le serveur attribue l'action à la session courante | Sur un téléphone partagé, les actions en attente de A partent au nom de B |
| S3 | `/api/client-stock/[clientId]` vérifie le module mais **pas la portée client** | Qui voit Terrain ou Clients lit les relevés de n'importe quel client |

Défauts techniques du même fichier `sw.js` :

- Le cache `_next/static` n'est **jamais purgé** : il grossit à chaque déploiement.
- `/clients/tournee` enregistre le service worker **mais n'est pas dans sa liste** : la page ne se rouvre pas sans réseau.
- Une session expirée pendant une tournée s'affiche comme « en attente de réseau » : rien n'est perdu, mais rien n'est expliqué.
- Une action refusée par le serveur **sort de la file avec un simple message**. Acceptable pour une visite, pas pour une saisie de ventes.

---

## 6. Architecture proposée

**Le point dur.** Le brief demande un app shell en cache-first, mais toutes les pages sont rendues par le serveur avec les données
de l'utilisateur. Mettre ce HTML en cache produirait exactement l'écart S1, et une page ancienne appellerait des server actions
qui n'existent plus après un déploiement.

**Proposition : un seul site, deux couches.**

1. **Écrans terrain hors connexion, sous `/m`** (nouveau groupe de routes). Coquille **statique sans aucune donnée utilisateur**,
   mise en cache. Elle affiche les composants client existants (`AnimationQuickForm`, `TourDay`, `VisitDay`), alimentés par IndexedDB au
   lieu des props serveur. `/m` est le `start_url` unique : un manifest est par site, il ne peut pas varier par rôle, c'est l'écran qui s'adapte.
2. **Écrans en ligne** (Action Center, Tâches, Brief, Validations) : pages serveur existantes, dans la même barre basse, sans cache de HTML authentifié.

Règles :

- **Persona déduite des droits**, jamais de `users.role` : `personaOf(perms, scope, flags)`, pure et testée, à côté de `homeFor()`.
- **Mutations terrain par routes API**, pas par server actions : `parseAnimationInput()`, `saveAnimation()` et `recordReadings()`
  restent les seules écritures. Les routes ne font que les appeler.
- **Idempotence** : `client_event_id` sur `animations` et `client_stock_readings` (migration 0055), sur le modèle de `visit_events`.
- **Conflit** = même `dedupe_key` sous un autre UUID (déjà saisi depuis un autre appareil), ou saisie refusée. La saisie reste en « à corriger »,
  elle n'est jamais supprimée en silence.
- **Base IndexedDB par utilisateur** (corrige S2). Déconnexion : purge des caches et des référentiels, avertissement si des saisies sont en attente.
- **Sessions** : table `user_sessions` (appareil, dernier passage, `revoked_at`), `sid` dans le JWT, renouvellement glissant dans le proxy, révocation
  depuis la fiche utilisateur, inactivité réglée dans `settings`. Les jetons actuels restent valides jusqu'à leur expiration.

---

## 7. Réutiliser, adapter, créer

| Réutiliser tel quel | Adapter | Créer |
|---|---|---|
| `capturePosition()`, `verifyVisit()`, `recordAction()`, `recordClientVisitAction()` | `fieldQueue()` : types `animation` et `stock`, lien utilisateur, état « à corriger » | `src/app/manifest.ts`, icônes 192 / 512 / maskable |
| `saveAnimation()`, `parseAnimationInput()`, `recordReadings()` | `AnimationQuickForm` : favoris, stepper, envoi par la file | Groupe de routes `/m` et `personaOf()` |
| `usualProductsForAnimatrice()`, `lastClientForAnimatrice()` | `TourDay`, `VisitDay` : visites en tête, boutons 44 px, données locales | `/api/m/bootstrap` : référentiels filtrés par portée |
| `animatriceScores()`, `clientVisitBrief()`, `missingAssortment()` | `src/proxy.ts` : `/.well-known`, `/app`, fichier APK | Routes `/api/m/animations`, `/api/m/client-stock` |
| `getMorningBrief()`, `allRecommendations()` | `src/lib/auth.ts` : 30 jours, `sid` | Table `user_sessions` et écran des appareils |
| `notify()`, `adoptionByWeek()`, `adoptionByAnimatrice()` | `notify()` : envoi Web Push (P2) | Page `/app`, `/.well-known/assetlinks.json`, `DEPLOY_MOBILE.md` |
| `count-scanner.tsx` (scan sur Chrome Android) | `LocationSetup` : aide sans barre d'adresse | File unique de validations (P2), `app_events` (P3) |

---

## 8. Phases et estimations

En jours de développement, à ±30 %, hors temps de test terrain de l'équipe.

| Phase | Contenu | Estimation |
|---|---|---:|
| **P1a** | Socle PWA, nouveau service worker (corrige S1), sessions et appareils, coquille par persona, file généralisée (corrige S2), migration 0055, écrans **Animatrice**, `/app`, APK | 9 à 12 j |
| **P1b** | Écrans **Commercial** : recherche, fiche courte, stock modifiable hors connexion, pack conseillé, commandes et BL, tâches. Correction de S3 si elle n'est pas déjà faite | 6 à 8 j |
| **P2** | Déléguées (compte rendu hors connexion), brief DG, validations par swipe, Web Push | 8 à 11 j |
| **P3** | Scan code-barres, mesure d'adoption, mode sombre des écrans mobiles, optimisations | 8 à 10 j |

**Écart avec le brief** : je propose de couper P1 en deux. D'un bloc, ce serait 15 à 20 jours et une seule PR très lourde sur une app en production.
Avec P1a, les animatrices testent sur le terrain plusieurs semaines plus tôt, et leurs retours corrigent P1b.

**Le mode sombre passe en P3**, limité aux écrans mobiles : le thème n'en a aucun et l'étendre aux 145 pages serait un chantier à part.

### Risques

| Risque | Conséquence | Parade |
|---|---|---|
| **Changement de domaine après diffusion de l'APK** | L'adresse est inscrite dans l'APK : nouvel APK pour tous, données locales perdues | Décision 1, avant le premier build |
| **Perte du keystore** | Plus aucune mise à jour de l'APK sur le même package | Sauvegarde hors dépôt (dépôt public), mot de passe dans un gestionnaire, gardés par Hicham |
| **Serwist sur Next 16.3 + Turbopack** | Essayé le 07/11 : il compile, mais précharge 69 fichiers (1,69 Mo, tout le bureau) à chaque déploiement et sert le worker à une autre adresse | **Écarté.** `/sw.js` généré par `src/lib/mobile/sw-source.ts`, qui ne précharge que la coquille |
| **Migration du service worker** | L'ancien reste actif sur les téléphones s'il n'est pas remplacé à la même adresse | Garder `/sw.js` ou livrer un remplaçant qui se désinscrit |
| **iOS** | Pas de synchro app fermée : l'envoi se fait à l'ouverture. Stockage séparé entre Safari et l'app installée. Permission GPS à vérifier | Vider la file avant de passer à l'app, test sur iPhone réel, le dire à l'équipe |
| **Android sans services Google ou sans Chrome** | Le mode plein écran peut ne pas fonctionner | Solution de repli dans l'APK, inventaire des téléphones de l'équipe |
| **Permissions de l'APK** | Ajouter GPS ou notifications plus tard impose une réinstallation | Activer `locationDelegation` et `enableNotifications` **dès le premier APK** |
| **Preview Vercel** | L'APK plein écran ne marche que sur le domaine final. Base utilisée par les previews non vérifiée (accès Vercel refusé) | **Vérifier avant tout test** qu'une preview n'écrit pas sur la prod |
| **GPS à la saisie animatrice** | Nouveau contrôle sur des salariées : l'information GPS actuelle ne parle que des visites | Avis dédié, à accepter. Vérification du cadre CNDP (loi 09-08) par un conseil : hors de ma compétence |
| **Révocation hors ligne** | Un téléphone révoqué sans réseau garde ses données locales jusqu'au prochain contact | Durée de vie limitée des référentiels, aucun coût ni marge en local. IndexedDB n'est pas chiffré : le code du téléphone reste la vraie protection |

### Prérequis matériels

Le Mac n'a ni Java ni `adb`. Bubblewrap demande un JDK et le SDK Android, et sait les installer. Le keystore doit être créé par Hicham :
son mot de passe ne doit passer ni par le chat, ni par le dépôt. Il faut aussi un Android physique et un iPhone pour le test réel.

---

## 9. Décisions à valider

| # | Décision | Ma recommandation |
|---|---|---|
| 1 | **Domaine définitif de l'app**, à figer avant le premier APK | Un sous-domaine à toi (`app.comanet.ma`) si le DNS est accessible, sinon rester sur `comanet-os.vercel.app` en connaissance de cause |
| 2 | **Architecture `/m`** (section 6) et **découpage P1a / P1b** | Valider les deux |
| 3 | **Points de vente en local pour l'animatrice.** Aujourd'hui elle voit tous les clients ; le brief interdit tout autre périmètre en cache | Ne stocker que les siens et ceux des 90 derniers jours ; les autres par recherche en ligne |
| 4 | **Proposition IA**, qui n'existe pas | P1b : « pack conseillé » sans IA, à partir de `missingAssortment()` et `clientVisitBrief()`. Version IA en P3, si le pack est utilisé |
| 5 | **Commande hors connexion**, absente du brief alors que c'est le besoin du commercial en sous-sol | Commande en ligne en P1b. Brouillon hors connexion, confirmé à la synchro, en P2 (environ +2 j) |
| 6 | **Quel LCP fait foi** pour l'acceptation | La mesure réelle (Lighthouse simulé échouerait sur tous les écrans authentifiés en 3G) |

**Avant de démarrer** :

- Les changements non commités de la branche `feat/planning-lisible` (logo dans `app-shell.tsx`, `sidebar.tsx`, `login`, `public/brand/`) doivent être
  fusionnés ou mis de côté : P1a modifie ces fichiers et part de `main`.
- Facultatif : autoriser l'accès Vercel de l'équipe `comanet` pour obtenir les vrais TTFB et vérifier la base des previews.

**Choix que je prends par défaut, sauf avis contraire** : APK servi depuis `public/` (fichier non secret), `/app` accessible sans connexion et sans aucune donnée,
déconnexion après 30 minutes d'inactivité pour les administrateurs (réglable), icône carrée dérivée du logo, à remplacer si tu en fournis une.

---

## 10. Résultat de P1a

Mesures sur build de production local, mêmes profils qu'en section 4.

| Critère | Avant | Après | Cible |
|---|---:|---:|---:|
| Installable (Chrome) | `no-manifest` | oui | oui |
| JS à froid, écran terrain | 166 à 173 KB | **148 à 150 KB** | < 170 KB |
| LCP réel à froid, 3G | 1,36 s | 1,41 s | < 4 s |
| Écran réactif, 1er lancement, 3G | 3,04 s | 2,74 s | — |
| Écran réactif, lancements suivants, 3G | 3,04 s | **environ 0,1 s** | < 100 ms par interaction |
| Débordement à 360 px | 0 | 0 | 0 |
| Cibles sous 44 px | 5 sur `/terrain/saisie` | **0** sur tous les écrans `/m` | 0 |
| Saisie de 5 produits | au moins 20 gestes | 15 touches `+` ici, moins en saisie au clavier | < 45 s |

Preuves : 39 contrôles du parcours en mode avion (`scripts/mobile-e2e.mjs`), 15 contrôles d'intégration (`scripts/mobile-integration.ts`), tests unitaires.

**Ce qui reste à prouver sur téléphone** : APK sur Android physique, PWA sur iPhone physique, saisie chronométrée de 5 produits, GPS réel.
Le gabarit iPhone 13 du parcours tourne dans Chrome : il vérifie la mise en page, pas le comportement de Safari.

---

## Sources

- [Serwist, intégration Turbopack](https://serwist.pages.dev/docs/next/turbo)
- [Lighthouse 12.0.0, retrait de la catégorie PWA](https://github.com/googlechrome/lighthouse/releases/tag/v12.0.0)
- [Chrome, critères d'installabilité](https://developer.chrome.com/blog/update-install-criteria?hl=en)
- [Bubblewrap, CLI](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md?plain=1)
- [Bubblewrap, gestion des fonctionnalités Android](https://app.unpkg.com/@bubblewrap/core@1.23.0/files/dist/lib/features/FeatureManager.js)
