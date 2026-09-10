# Digital Ads → Ads Command Center

Rapport d'audit et d'architecture, écrit avant la refonte (10 septembre 2026), puis tenu à jour.

## 1. Ce qui existe

| Couche | Fichier | Contenu |
|---|---|---|
| Client Graph API (lecture seule, `ads_read`) | `src/lib/meta/client.ts` | `listAccounts`, `getAccount`, `listCampaigns` (actives/en pause seulement), `fetchInsights` (niveau publicité, jour par jour, achats/leads/messages/LPV). Version `v23.0`. |
| Synchronisation | `src/lib/meta/sync.ts` | Fenêtre glissante 28 j (`full`, 6 h) + intrajournalier (`intraday`, toutes les heures). Upsert par `dedupe_key`, conversion MAD au taux saisi, verrou par compte, remplacement des lignes d'import fichier. |
| Journée en cours | `src/lib/meta/live.ts` | Fraîcheur des comptes, cumul intrajournalier, état de diffusion des campagnes. |
| Moteur de verdict | `src/lib/ads.ts` | `adsByDim()` (agrégat par campagne/pub/marque), `kpis()`, `diagnose()` SCALE/MAINTAIN/OPTIMIZE/STOP/WATCH avec seuils `settings.ads`. |
| Règle Action Center | `src/lib/rules/marketing-rules.ts` (`ads-performance`) | Appelle `diagnose()` sur 30 j vs 30 j. |
| Outil copilote | `src/lib/ai/tools/ads.ts` (`get_ads_performance`) | Même moteur. |
| Tables | `ad_accounts`, `ad_metrics` (journal jour × pub), `ad_campaign_states` (instantané), `campaign_ad_links` | Aucune table d'ensembles de publicités, de publicités ni de créatives : `ad_metrics` ne porte que des noms. |
| Écran | `/marketing/ads` (352 lignes) + `/marketing/ads/comptes` | KPI, journée en cours, état de diffusion, tableau campagnes avec verdict, courbe dépense/CA. |
| Cron Vercel | `vercel.json` | `intraday` à h+5, `full` à 6 h. |

## 2. Pourquoi cela ne fonctionne pas bien

1. **Aucun historique.** La synchro relit 28 jours ; tout ce qui précède la connexion (10 août 2026) n'existe pas en base. Impossible de comparer à « notre historique ».
2. **Verdict fondé sur l'achat.** `diagnose()` juge par CPA et ROAS d'achat. Or les comptes COMANET n'ont **aucun achat suivi** (0 sur 561 lignes) : les campagnes visent le trafic, les messages WhatsApp et la notoriété. Résultat : tout ressort STOP « aucune conversion » ou n'est pas jugé.
3. **Pas de créative.** Les noms de publicités sont « video », « 04 », « post ». Sans le texte et le format de la créative, aucun apprentissage sur les angles ou les accroches n'est possible.
4. **Pas de produit.** Rien ne relie une publicité à un produit du référentiel ; les campagnes ne portent le produit que dans leur nom, parfois.
5. **Écran de reporting.** 15 colonnes, une carte par métrique, aucune décision priorisée, aucun « où mettre l'argent », aucune opportunité de contenu.
6. **Connexion cassée en silence.** Le compte affiche « Jeton refusé (API access blocked) » depuis le 9 septembre 23 h ; rien ne dit si le problème est le jeton, l'application Meta, la permission ou le compte.

## 3. État réel de la connexion Meta (10/09/2026)

- `META_ACCESS_TOKEN` est configuré sur Vercel (jamais en local ni en base).
- Dernier appel : **refusé** — message Meta « API access blocked ». Ce message n'est pas un jeton expiré (code 190) : il désigne une **application** bloquée ou restreinte (mode développement, accès Marketing API retiré, alerte non traitée), ou un jeton d'utilisateur système dont l'application a été désactivée.
- Un seul compte est activé : **COMANET MOROCCO** (`act_1174521700705307`, EUR, fuseau Europe/Madrid), 511 lignes API du 10/08 au 08/09/2026.
- La page `/marketing/ads/diagnostic` (nouvelle) exécute désormais les appels réels : `debug_token`, `me`, `me/permissions`, `me/adaccounts`, puis pour chaque compte activé : compte → campagnes → ensembles → publicités → créatives → insights, et une sonde de rétention (insights à 36 mois). Elle affiche le statut HTTP, le code, le sous-code, le message et l'endpoint de chaque échec. Le statut « connecté » n'est plus déduit de la présence du jeton.

## 4. Données Meta réellement accessibles (par l'utilisateur Meta d'Hicham)

| Compte | ID | Devise | Business | Dépense visible | Période |
|---|---|---|---|---|---|
| COMANET MOROCCO | 1174521700705307 | EUR | RLI GROUP | ~7 000 € | mars 2025 → aujourd'hui (compte principal actuel) |
| Auracos Morocco | 817335139978498 | EUR | Comanet | ~1 500 € | juil. 2023 → mars 2025 |
| Hicham Brd | 1175169265997506 | EUR | (personnel) | ~1 900 € | oct. 2023 → févr. 2025 |
| Alphascience Maroc | 322183503662872 | EUR | alphascience_maroc | ~500 € | mars 2024 → mars 2025 |
| Gamardemaroc | 1071394291028835 | USD | Gamarde Maroc | ~465 $ | mai → oct. 2025 |
| Ainhoa Maroc | 1025791255605952 | EUR | Ainhoa Maroc | ~90 € | juil. → oct. 2024 |
| MAKARI | 649483017759704 | EUR | Comanet | ~250 € | févr. → mars 2025 |
| Gamarde maroc | 1063598458543775 | EUR | Laboratoires Gamarde Maroc | 0 depuis 2023 | — |
| Auracos Maroc | 1457029734728051 | USD | RLI GROUP | non interrogeable (compte **UNSETTLED**, impayé) | — |
| 282923318080789 | — | USD | Comanet | compte **fermé** | — |

Conclusion : l'historique 2023+ existe, réparti sur **7 comptes et 5 Business Managers**. Le jeton actuel (utilisateur système d'un seul business) ne peut pas tous les voir : chaque compte doit être attribué à l'utilisateur système, ou un jeton par business doit être fourni (`META_ACCESS_TOKEN` accepte désormais plusieurs jetons séparés par des virgules ; chaque compte utilise le premier jeton qui y a accès).

Métriques disponibles : dépense, impressions, couverture, fréquence, clics, clics sur lien, vues de page, conversations démarrées, leads, achats et valeur (toujours 0 ici), vues vidéo, engagements ; objectif, statut, budgets ; créatives (titre, texte, miniature, image, vidéo, type d'objet, appel à l'action).

## 5. Historique récupérable depuis 2023

- **Limite Meta : 37 mois glissants** pour les insights. Depuis septembre 2026, la plus ancienne journée lisible est **août 2023**. Janvier–juillet 2023 est perdu côté API (aucun compte n'a dépensé sur cette période de toute façon).
- Le moteur de rattrapage (`src/lib/meta/backfill.ts`) part de `settings.metaHistoryStart` (défaut `2023-01-01`), mois par mois, au niveau publicité, jour par jour, et note pour chaque mois refusé « Historique indisponible pour cette période » avec la raison Meta. Il est **reprenable** (curseur par compte) pour tenir dans les 300 s d'une fonction Vercel : cron quotidien à 3 h + bouton sur l'écran des comptes.
- Les campagnes, ensembles, publicités et créatives sont catalogués dans `ad_entities` (y compris archivés) pour que l'historique ait des noms, des objectifs, des textes et des formats.

## 6. Données manquantes (ne seront jamais inventées)

- **CA attribué** : aucun pixel d'achat. ROAS et CPA d'achat affichent « — ». La mesure officielle est le **coût par résultat** de l'objectif (message, vue de page, lead, couverture).
- **Marge / contribution** : le bloc « Impact business » relie dépense → résultats → sell-in de la marque sur la période (corrélation observée) ; la contribution après publicité n'est calculable que si une valeur par résultat est saisie (`settings.adsIntel.valuePerResult`, vide par défaut → « non mesurable »).
- **Produit** : rattaché automatiquement quand son nom apparaît dans la campagne, l'ensemble, la publicité ou le texte de la créative ; sinon « sans produit », modifiable à la main.
- **Saisonnalité** : uniquement à partir des mois réellement observés (Ramadan, rentrée, été… sont des étiquettes de calendrier, jamais des hypothèses de performance).

## 7. Architecture cible

```
Meta Graph API ──► client.ts (lecture) ──► sync.ts (28 j) + backfill.ts (2023→) + entities.ts (catalogue)
                                              │
                        ad_metrics (jour × pub, MAD) · ad_entities (campagne/ensemble/pub/créative + produit + tags)
                                              │
                               src/lib/ads-intel/  (pur, réutilisable, sans UI)
   data.ts ─► benchmark.ts ─► trend.ts ─► anomaly.ts ─► fatigue.ts ─► winners.ts ─► content.ts ─► recommend.ts
                                              │
                          command-center.ts (une charge utile pour l'écran) · agent.ts (fonctions pour l'IA) · memory.ts
                                              │
                        /marketing/ads (une page, drawers) · Action Center · copilote (get_ads_intelligence)
```

Règles : `diagnose()` reste le seul moteur de verdict (rendu **objectif-aware** : coût par résultat au lieu du CPA d'achat quand l'objectif n'est pas la vente) ; tous les seuils dans `settings.ads` et `settings.adsIntel` ; chaque recommandation porte WHY / DATA / ACTION / CONFIDENCE ; « ne rien faire » est une décision.

## 8. Wireframe de la page unique

```
DIGITAL ADS   [Aujourd'hui|7j|14j|30j|MTD|90j|Année|Perso]  [Toutes marques ▾]  META  ● Connecté · synchro il y a 12 min  [Synchroniser]
┌ Santé 74/100 ─ pourquoi : coût/résultat −18 % vs historique · 2 winners actifs · 1 créative fatiguée · 1 anomalie ┐
│ Dépense 6 530 │ Résultats 12 400 vues de page │ Coût/résultat 0,53 │ Messages 374 │ CA régie — │ Budget 71 % │
├ 🚨 ACTION CENTER (max 5) ─────────────────────────────────────────────────────────────────────────────────────┤
│ 🟢 SCALE  AURACOS — Pro-Collagenium 8/24   coût/résultat −22 % vs marque · stable 9 j · conf. 84 %  → +20 %/3 j  │
│ 🟠 OPTIMISER  CYGNELAB — Beauty Boost   CTR stable, CPC +28 %, coût/msg +24 % → audience/enchère · conf. 71 %   │
│ ⚪ NE RIEN FAIRE  DULCIMA — Awareness  stable, conf. 66 %                                                         │
├ OÙ METTRE L'ARGENT ──────────────────────┬ WINNERS & PROBLÈMES ───────────────────────────────────────────────┤
│ Marque   Dépense  Perf.   Tend.  Décision│ Top campagnes · Top créatives · Top produits · Fatigue                │
├ QUOI POUSSER ─────────────────────────────┬ QUOI PUBLIER (3–5 opportunités, score /100) ───────────────────────┤
├ IMPACT BUSINESS  dépense → résultats → sell-in marque (corrélation) ─────────────────────────────────────────┤
└ DONNÉES  Meta connecté · dernière synchro · historique 08/2023 → · 2 mois indisponibles  [Historique 🔍]     ┘
```
Tout clic ouvre un drawer (campagne → ensembles → publicités → créatives, historique, benchmark, recommandation, raisons). Le drawer « Historique » cherche par date, marque, produit, campagne, créative, objectif, performance.

## 9. Decision Engine

Entrée : une entité (campagne, publicité, créative, produit, marque) avec sa période, sa période précédente, ses benchmarks et sa série journalière.

1. **Éligibilité** : dépense ≥ `ads.minSpend`, jours ≥ `ads.minDays`, sinon `INSUFFICIENT_DATA` (jamais un winner à 30 MAD).
2. **Verdict** : `diagnose()` (SCALE / MAINTAIN / OPTIMIZE / STOP / WATCH) sur le coût par résultat de l'objectif.
3. **Cause** (créative vs campagne) : CTR bas → créative ; CTR bon + résultats bas → offre/page/produit ; CTR bon + CPC haut → enchère/audience ; coût qui monte avec la fréquence → fatigue.
4. **Décision** : SCALE, MAINTAIN, OPTIMIZE, PAUSE_REVIEW, TEST, REUSE_WINNER, CREATE_NEW_CREATIVE, CHANGE_ANGLE, CHANGE_AUDIENCE, INCREASE_BUDGET, REDUCE_BUDGET, DO_NOTHING.
5. **Confiance** (0–100) = volume de dépense × nombre de jours × stabilité (1 − coefficient de variation) × présence de benchmarks × qualité des données (journées closes, produit identifié).
6. Croisement stock : un SCALE vérifie `isUnderTension()` sur le produit rattaché.

## 10. Content Opportunity Engine

1. Chaque créative est **étiquetée** (auto, corrigeable) : format (Reel, vidéo, image, carrousel, post existant), angle (avant/après, témoignage, problème → solution, FAQ, éducatif, démonstration, promo/offre, événement, routine), accroche (première phrase), produit, marque.
2. Pour chaque motif (marque × angle, marque × format, produit × angle, transversal) : dépense, résultats, coût par résultat, nombre de créatives, récence, comparé au benchmark de la marque.
3. Score d'opportunité /100 = performance historique du motif (40) + adéquation produit (20 : produit star ou sous-exploité avec stock) + récence/absence de fatigue (15) + volume de preuve (15) + saison observée (10).
4. Sortie : 3 à 5 idées « NEXT CONTENT » (« Vidéo problème → solution pour Sebo-Control », « Témoignage Auracos »), avec pourquoi et données ; motifs transversaux (« fonctionne pour Auracos et CygneLab ») signalés.
5. **Mémoire marketing** (`ad_memory`) : phrases datées avec preuves, recalculées chaque nuit, lisibles par le copilote.
