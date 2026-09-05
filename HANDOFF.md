# Reprise de la conversation — état au 5 septembre 2026

Document de passage de relais vers Claude Code. Lis d'abord `CLAUDE.md`
(architecture et règles), puis ceci (où on en est et ce qui reste).

---

## Ce qui tourne en production

https://comanet-os.vercel.app — Supabase `cfesexhagpbtiwsyhrzt` (Frankfurt), 4 migrations appliquées.
Comptes créés avec le mot de passe `comanet2026`, à changer dans Paramètres → Utilisateurs.

Données chargées : 9 001 lignes de vente (jusqu'au 30 juillet 2026), 98 produits, 533 clients,
9 marques, 18 utilisateurs, objectifs et budgets 2026.

---

## Historique des quatre chantiers livrés

**1. Mise en ligne (V1).** Supabase + Vercel, page `/installation` en 4 étapes
(connexion, schéma, socle, classeur), téléversement par morceaux de 1,5 Mo pour contourner
la limite de 4,5 Mo des fonctions serverless, endpoint `/api/health`.

**2. Réglementaire V2.** Suivi par variante déposée (marque × référence × type × contenance),
étape Certificat d'Enregistrement, anticipation de redépôt à 90 jours, historique des dépôts
et renouvellements, import et export Excel. 93 dossiers chargés — dont **22 déjà expirés**
que le fichier Excel ne montrait pas, sa colonne « Écart » étant une formule figée.

**3. Animations POS.** Cockpit sell-out par jour, ville, animatrice et point de vente ;
objectifs 2026 par ville et par marque avec proratisation ; plan d'action animatrice ;
import quotidien. 1 378 journées, 16 112 unités, 4 644 178 MAD — réconcilié au classeur à 0,05 %.

**4. Marketing Command Center, phases 1 et 2.** Détaillé ci-dessous.

---

## Marketing — ce qui existe

| Page | Contenu |
|---|---|
| `/marketing` | KPI (investissement, CA facturé, taux d'investissement, CA attribué mesuré, ROAS mesuré), timeline 13 mois marketing vs ventes avec corrélation Pearson, répartition de la dépense par famille, signaux à arbitrer, scorecard par marque, calendrier 360 |
| `/marketing/campagnes` | Liste filtrable par marque et statut, création complète (type, canal, cible, message, offre, KPI cible, responsable) |
| `/marketing/campagnes/[id]` | Campagne 360 : ventes avant/pendant/après sur les produits poussés, publicité par créative, **couverture de stock des produits poussés**, collaborations, contenus, dépenses, fiche éditable |
| `/marketing/ads` | Import de régie, diagnostic SCALE / OPTIMIZE / STOP / MAINTAIN / WATCH par campagne ou par créative, avec isolation du maillon fautif (diffusion, accroche, post-clic) |
| `/marketing/influence` | Répertoire, pipeline en 8 étapes, score 0-100 par influenceuse, saisie des statistiques post-publication |
| `/marketing/budgets` | Ancienne page `/marketing`, déplacée sans modification de fond |
| `/marketing/planning` | Planning éditorial existant, inchangé |

Bibliothèques : `src/lib/marketing.ts` (agrégats transverses), `src/lib/ads.ts` (moteur de
diagnostic publicitaire), `src/lib/influence.ts` (scoring des collaborations),
`src/lib/marketing-shared.ts` (nomenclatures).

Tables ajoutées par `drizzle/0003_marketing.sql` : `campaign_products`, `ad_accounts`,
`ad_metrics`, `ad_creatives`, `influencers`, `collaborations`, `activations`.
`campaigns`, `marketing_expenses` et `content_items` ont été **étendues**, pas remplacées.

Règles ajoutées à l'Action Center : `adsRule` (branchée en priorité sur `ad_metrics`, repli
sur les dépenses saisies), `influenceRule`, `campaignStockRule`.

---

## Reste à faire — phases 3 à 5 du cahier des charges

Hicham a spécifié un « Marketing Command Center » en 34 sections et 5 phases.
Les phases 1 et 2 sont livrées. L'ordre qu'il a fixé pour la suite :

**Phase 3**
- Planning éditorial avancé : vue calendrier par marque et plateforme, briefs, validation,
  rattachement aux campagnes et aux collaborations, statuts de production.
- Activations : la table `activations` existe et est reliée aux campagnes, produits, clients
  et dépenses, mais **aucune interface n'a été construite**. Types déjà définis dans
  `ACTIVATION_TYPES` (événement, sponsoring, padel, PLV, shooting, salon, sampling, goodies…).

**Phase 4**
- Marketing Analytics : analyses transverses par marque, canal et période.
- Ventes vs Marketing : croisement approfondi (la corrélation mensuelle existe déjà en
  vue d'ensemble, il manque le détail par marque et par produit).
- Marketing vs Stock : généraliser le garde-fou de la fiche campagne à tout le module.

**Phase 5**
- Automatisation, reporting périodique, AI Copilot.

Après chaque phase, il demande explicitement : tester l'application, corriger les bugs,
vérifier les relations entre les données, vérifier le responsive mobile, ne rien casser.

---

## Points ouverts

**86 produits « à qualifier »** créés depuis les colonnes du fichier d'animations.
Je lui avais proposé de préparer une table de correspondance pour les fusionner avec les
articles Sage ; il n'a pas encore répondu. Voir la fonction « Fusionner » de la fiche produit.

**Débordement horizontal de 18 px sur `/marketing/ads` en 390 px.** Cosmétique, rien n'est
coupé à l'écran ; aucun élément non scrollable ne dépasse. `/terrain` a le même symptôme
en plus marqué (811 px) et le précède. À traiter ensemble si l'occasion se présente.

**Le PAT GitHub utilisé pour les push a été collé dans la conversation** et devrait être
révoqué une fois le passage à Claude Code fait, puisque tu pousseras désormais depuis ta
machine avec tes propres identifiants.

---

## Deux bugs corrigés qui méritent d'être connus

**Encodage des CSV.** Les fichiers étaient lus en Windows-1252 quoi qu'il arrive. Sur un
export Meta (UTF-8), la colonne « Montant dépensé » n'était pas reconnue : l'import se serait
fait avec **0 MAD de dépense sur toutes les lignes**, sans la moindre erreur visible.
Corrigé par détection d'encodage dans `parse.ts` — ce qui fiabilise aussi les exports Sage.

**Annulation d'import.** L'action supprimait bien les lignes puis échouait en écrivant sa
remarque dans le journal (SQL brut sur une colonne jsonb) : pas de redirection, pas de
message, l'annulation paraissait sans effet alors que les données étaient parties.
Réécrite dans `src/lib/import/rollback.ts`.
