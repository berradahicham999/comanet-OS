# COMANET OS : audit de consultant et feuille de route

*Rédigé le 3 octobre 2026, après visite de l'application (base locale chargée avec le classeur « Compilé 2026 vf » : 13 039 lignes de ventes, 568 clients, 99 produits) et lecture du code des huit domaines (42 règles, 25 outils IA, 16 types d'import).*

Le regard est celui d'un consultant qui a vu les outils internes de grands laboratoires (L'Oréal Dermatological Beauty, Beiersdorf/Eucerin, Pierre Fabre) et les logiciels qu'ils achètent : Salesforce Consumer Goods Cloud, Veeva Vault CRM, IQVIA OCE, Repsly, Trax, Smartly, CreatorIQ, Later, Netstock, Sage/Odoo/Pennylane.

---

## 1. Verdict en une page

**Ce que vous avez déjà, et que peu de PME ont.** COMANET OS couvre ce que les grands groupes achètent en cinq ou six logiciels : analytique commerciale, intelligence client, prévision d'achats, retail execution (animations, stock en rayon, activations), CRM pharma avec contrôle de présence GPS, intelligence publicitaire, gestion commerciale avec journal de stock immuable et P&L, et un copilote IA outillé. Trois choix d'architecture sont au niveau des meilleurs et valent plus que n'importe quel écran :

- **Une notion métier = une fonction**, testée. Les groupes mettent des années à obtenir une « source unique de vérité » ; vous l'avez par construction.
- **Corrélation ≠ causalité, rien n'est estimé.** C'est exactement la discipline que les directions financières réclament aux marketeurs et que les outils du marché (ROAS « modélisé » des régies) violent en permanence.
- **L'IA lit par des outils typés, journalisés, limités par les droits, et ne peut écrire qu'une tâche proposée.** C'est le modèle « agent gouverné » que Veeva et Salesforce vendent en 2026 sous les noms Veeva AI Agents et Agentforce.

**Les cinq trous structurels.** Ce sont eux qui séparent aujourd'hui COMANET OS d'un outil de classe mondiale, bien plus que des écrans manquants.

1. **Le logiciel voit tout mais n'agit vers l'extérieur que par des liens `mailto:` et `wa.me`.** Aucun e-mail, aucun message WhatsApp, aucune notification push ne part du serveur ; aucune écriture vers Meta ; aucune API avec Cospharma ou Pharmafirst. Chez les leaders, 2026 est l'année de la « boucle fermée » : la recommandation déclenche l'action, l'action est mesurée, la mesure nourrit la recommandation suivante. Chez vous, la boucle s'arrête au Kanban des tâches.
2. **La force de vente sell-in, qui fait le chiffre, est le parent pauvre.** Le médical a un CRM complet (chrono, GPS, compte rendu, tournée, échantillons). Les commerciaux qui visitent 568 pharmacies n'ont rien : ni contacts, ni visites, ni prise de commande, ni tournée. La fiche client ne contient aucune interaction humaine, seulement des chiffres.
3. **Le sell-out reste une donnée rare.** Il n'existe que par les animations et les relevés manuels. Les ventes de Cospharma et Pharmafirst par pharmacie, la seule vraie mesure de la demande pour 60 % de votre volume, n'entrent pas dans l'outil. Les laboratoires leaders construisent tout sur le sell-out (panels, données grossistes, portails de commande).
4. **La prévision est une moyenne mobile sur trois mois.** Pas de saisonnalité (Ramadan, été solaire, rentrée), pas de prévision par référence et par mois, pas de plan de ventes et d'opérations partagé avec les achats. Le solaire Gamarde à -52 % sur trois mois en octobre est un effet saison, pas un signal : l'outil ne le sait pas.
5. **Personne ne sait si les recommandations marchent.** Les 42 règles produisent des cartes, mais aucun historique n'enregistre ce qui a été suivi ni le résultat observé. Sans cette mémoire, le moteur ne peut ni s'améliorer ni gagner la confiance de l'équipe.

**Un point de calendrier qui change la priorité.** La facturation électronique devient obligatoire au Maroc par paliers : grandes entreprises au 1er janvier 2026, moyennes au 1er juillet 2026, PME et TPE sous 10 M MAD de CA au 1er janvier 2027 (calendrier publié par la DGI et relayé par la presse économique, à faire confirmer par votre expert-comptable pour votre catégorie). Votre bascule hors Sage est prévue le 1er janvier 2027. Les deux chantiers doivent être conçus ensemble : une pièce émise par COMANET OS devra pouvoir être transmise au format et au canal que la DGI imposera.

---

## 2. Benchmark module par module

Pour chaque module : ce que font les meilleurs outils du marché, ce que COMANET OS a, l'écart, et où l'IA apporte quelque chose de réel (pas un chatbot de plus).

### 2.1 Cockpit et Action Center

| | |
|---|---|
| **Les meilleurs** | Salesforce Agentforce, Gainsight, Pigment : un centre de décision personnalisé par rôle, des alertes qui partent vers la personne (mobile, e-mail, messagerie), un suivi du « taux d'adoption » des recommandations, et des règles que l'utilisateur peut activer, désactiver ou ajuster lui-même. |
| **COMANET OS** | 42 règles avec pourquoi / quoi faire / impact, tâche en un clic, écart motivé 30 jours, brief du matin IA, bouton « Expliquer ». Recalcul en direct à chaque chargement, sans historique. |
| **Écart** | Aucun filtre (période, marque, commercial), aucun export, aucune alerte sortante, aucune mesure d'efficacité des règles, pas d'interrupteur par règle, pas d'action groupée. |
| **À développer** | (1) Table `recommendation_history` : chaque recommandation est photographiée à sa première apparition, puis à sa disparition, avec l'issue (tâche créée, écartée, résolue seule) et la valeur observée ensuite. (2) Digest quotidien par personne, envoyé par WhatsApp ou e-mail, limité à trois actions. (3) Interrupteur et seuil par règle dans la liste « Règles actives ». |
| **IA** | Le brief du matin existe ; le faire partir sur le téléphone de chaque responsable, filtré par sa portée, est le geste à plus fort impact. Ensuite, un « bilan hebdomadaire des recommandations » : lesquelles ont été suivies, ce qui s'est passé après, formulé comme corrélation observée. |

### 2.2 Ventes et objectifs

| | |
|---|---|
| **Les meilleurs** | Analytique sell-in de type Power BI / Tableau avec décomposition de l'écart (prix, volume, mix, clients perdus, clients gagnés), objectifs déclinés par commercial, secteur, client et produit (Anaplan, Pigment), prévision glissante. |
| **COMANET OS** | 7 dimensions, 8 périodes, comparaison M-1 et N-1, run-rate du mois, objectifs par marque et par mois. Lecture seule. |
| **Écart** | Pas d'export, pas de marge dans l'analyse, pas d'objectif par commercial ni par client, pas de croisement de dimensions (marque × secteur), pas de prévision au-delà du mois. |
| **À développer** | (1) Export Excel sur chaque table (droit existant). (2) Objectifs par commercial et par client, saisis dans l'interface, suivis sur une page « Mon objectif ». (3) Décomposition de l'écart de CA, qui transforme « CygneLab -54 % » en « 7 clients n'ont pas recommandé, 2 ont réduit le panier, prix inchangé ». |
| **IA** | Statistique avant modèle de langage : une prévision par référence et par mois avec saisonnalité (méthode ETS ou Prophet, 24 à 36 mois d'historique disponibles), étiquetée « prévision modélisée » et jamais mélangée au réel. Le copilote rédige ensuite l'explication de l'écart à partir de la décomposition, pas l'inverse. |

### 2.3 Clients (intelligence client)

| | |
|---|---|
| **Les meilleurs** | Salesforce Consumer Goods Cloud et HubSpot : contacts (le pharmacien, l'acheteur, la préparatrice), chronologie de toutes les interactions, visites planifiées et réalisées, score de santé explicable, « next best action », assortiment manquant par rapport aux clients comparables, encours et retards de paiement sur la même fiche. |
| **COMANET OS** | Segmentation automatique (6 segments), rythme de commande et prochaine commande théorique, plan d'action calculé, produits achetés, stock en rayon, identité légale, fusion de fiches, audit. Très solide sur le chiffre. |
| **Écart** | Aucun contact nommé, aucune chronologie d'interactions, aucune visite commerciale, aucune carte, aucun objectif par client, encours absent de la fiche (il vit dans Gestion). Le segment « À risque » peut afficher « Analyser la baisse » sur un client à +456 % : le libellé suppose une baisse alors que le déclencheur est un retard de commande. |
| **À développer** | (1) **CRM commercial** : contacts, chronologie (visite, appel, WhatsApp, commande, règlement, animation, réclamation), visites avec le même moteur chrono / GPS que le médical (réutiliser `visit_events`, ne pas recréer). (2) Encours, échu et dernier règlement sur la vue d'ensemble client. (3) « Assortiment manquant » : produits que les clients du même type, de la même ville et du même CA achètent et que ce client n'achète pas. |
| **IA** | Le « pre-call agent » de Veeva, version COMANET : avant chaque visite, une fiche d'une page rédigée par le copilote à partir des outils (dernières commandes, retard, produits manquants, stock en rayon, animation récente, encours). Puis un score de propension à l'inactivité par client, calculé par un modèle simple et explicable (rythme, panier, ancienneté, retard), affiché comme probabilité, jamais comme certitude. |

### 2.4 Produits et marques

| | |
|---|---|
| **Les meilleurs** | Un PIM (Akeneo, Salsify) : fiche produit riche (INCI, allégations autorisées, argumentaire pharmacien, visuels, fiches techniques), prix historisés par canal, marge en liste, cycle de vie (lancement, actif, fin de série). |
| **COMANET OS** | Fiche complète côté chiffre (CA, tendance, stock, couverture, marge, lots, CMUP, top clients, réglementaire, objectifs). Fiches marketing Gamarde déjà remplies. |
| **Écart** | Pas de création de marque dans l'interface, pas d'historique de prix, marge seulement sur la fiche (pas en liste), objectifs produit non modifiables. Tendance 3 mois « -261 % » sur un produit : une baisse ne peut dépasser -100 %, les avoirs doivent être traités ou l'indicateur borné. |
| **À développer** | (1) Prix et conditions historisés (date d'effet), condition pour le P&L et les pièces. (2) Marge et contribution par marque et par produit en liste, avec tri. (3) Statut de cycle de vie, qui alimente les règles (un produit en fin de série ne déclenche pas « à commander »). |
| **IA** | Enrichissement de la fiche marketing à partir des sites des marques et des DMP (déjà fait à la main pour Gamarde) : INCI, allégations, contre-indications, argumentaire pharmacien en trois phrases. Cette base alimente ensuite le contenu, la formation des animatrices et l'e-detailing médical. |

### 2.5 Stock et achats

| | |
|---|---|
| **Les meilleurs** | Netstock, Slimstock, Lokad, Odoo : prévision probabiliste avec saisonnalité, stock de sécurité calculé sur la variabilité, planning d'arrivage, optimisation du conteneur ou de la palette, simulation « que se passe-t-il si je retarde la commande », commande fournisseur générée depuis la proposition. |
| **COMANET OS** | Couverture par dépôt (COMANET réel + photos Cospharma et Pharmafirst), stock cible = délai + sécurité + 1 mois, MOQ, commande conseillée avec valeur, lots et péremption, CMUP au coût de revient réel (devise + frais d'approche). Base très saine. |
| **Écart** | Moyenne simple sur trois mois, pas de saisonnalité ; la commande conseillée n'est reliée à rien (bouton « créer la commande fournisseur » absent) ; pas de simulation ; le sell-out n'entre pas dans la prévision ; pas d'export. |
| **À développer** | (1) Bouton « Commander » qui pré-remplit une commande fournisseur par fournisseur à partir des commandes conseillées. (2) Saisonnalité par famille (solaire, hydratation, compléments) issue de l'historique. (3) Planning d'arrivage : commandes en cours sur une frise, avec date de rupture estimée. |
| **IA** | La prévision de 2.2 réutilisée ici : stock cible = prévision des N prochains mois (pas la moyenne des 3 derniers), avec un intervalle. Le copilote explique en une phrase pourquoi commander maintenant (délai, saison, rupture estimée), avec les chiffres de l'outil. |

### 2.6 Gestion commerciale et P&L

| | |
|---|---|
| **Les meilleurs** | Sage, Odoo, Pennylane, Qonto : devis et commande client, facture électronique conforme, relances automatiques multicanal avec scénarios, rapprochement bancaire par import de relevé, lettrage automatique, prévision de trésorerie, OCR des factures fournisseurs, export des écritures vers le cabinet comptable. |
| **COMANET OS** | BL, facture, avoir, règlements, balance âgée, relances, achats avec coût de revient, inventaires mobiles avec scan, P&L mensuel par marque, bascule contrôlée, ZIP de PDF et récapitulatif Excel. C'est un vrai noyau d'ERP commercial, avec une rigueur (montants exacts, journal immuable) que Sage n'a pas. |
| **Écart** | Pas de devis ni de commande client, pas de rapprochement bancaire, pas d'export d'écritures comptables, relances uniquement par liens manuels, pas de prévision de trésorerie, pas de facture électronique. |
| **À développer** | (1) **Facture électronique DGI** : prévoir dès maintenant le format d'échange et la signature, aligné sur la bascule du 1er janvier 2027. (2) Export d'écritures au format du cabinet (journal des ventes, achats, banque) : c'est ce qui remplace définitivement Sage aux yeux du comptable. (3) Relances automatiques : scénario J+3, J+15, J+30 par WhatsApp ou e-mail, avec approbation la première fois. (4) Commande client, pour la prise de commande terrain et le portail (2.7). |
| **IA** | (1) OCR des factures fournisseurs (PDF reçus par e-mail) pour pré-remplir la facture fournisseur et la rapprocher des réceptions, écarts signalés jamais corrigés. (2) Lettrage proposé des règlements sur les factures. (3) Prévision de trésorerie à 90 jours à partir des échéances, du DSO par client et des commandes fournisseurs, présentée comme projection. |

### 2.7 Prise de commande et sell-out distributeurs (module absent)

| | |
|---|---|
| **Les meilleurs** | Les laboratoires dermo-cosmétiques ouvrent un portail ou une application de commande B2B pour les pharmacies (catalogue, promotions, encours, historique, réassort en un clic) et reçoivent de leurs grossistes les ventes par pharmacie. Seuls 11 % des fabricants pharma offrent une commande B2B en ligne : l'avantage est encore à prendre. |
| **COMANET OS** | Rien côté pharmacie. Les photos de stock Cospharma et Pharmafirst existent ; leurs ventes par point de vente n'existent pas dans l'outil. |
| **À développer** | (1) **Import des ventes distributeurs par pharmacie** (fichier mensuel de Cospharma et Pharmafirst) : c'est le sell-out à grande échelle, et le moteur d'import sait déjà le faire. (2) **Commande pharmacie par WhatsApp** : un message en darija ou en français (« 12 Procollagenium, 6 fluide Gamarde ») est lu par le copilote, transformé en commande client proposée, confirmée par le commercial, puis BL. (3) À 12 mois, un portail de commande avec encours, promotions et historique. |
| **IA** | La lecture des commandes en langage naturel (texte ou photo d'un bon manuscrit) est le cas d'usage IA le plus rentable de tout l'audit : il crée de la donnée de commande propre, à la source, sans ressaisie. |

### 2.8 Marketing : vue d'ensemble, campagnes, budgets

| | |
|---|---|
| **Les meilleurs** | Allocadia / Uptempo, Planful : budget phasé par mois, workflow d'approbation des dépenses, lien entre la dépense et la facture fournisseur, objectifs chiffrés par campagne, calendrier des mécaniques promotionnelles (10 + 2, cure 3 mois, coffret) avec simulation de marge avant lancement. |
| **COMANET OS** | Budget annuel par marque et par catégorie, consommation définie une seule fois, dépense régie dédoublonnée, campagnes avec ventes avant / pendant / après, scorecard par marque, calendrier 360. |
| **Écart** | Budgets annuels sans phasage mensuel, KPI de campagne en texte libre, pas d'approbation hors activations, pas de lien avec les factures fournisseurs, pas de module de promotions (la « moulinette d'offres » existe comme skill Claude en dehors de l'application). |
| **À développer** | (1) Phasage mensuel du budget et courbe réel vs plan. (2) **Module Promotions et offres** : mécanique, marge pharmacie, marge distributeur, unités nécessaires pour rembourser l'offre, verdict rentable / limite / à refuser, puis suivi des ventes sur la période. (3) Objectif chiffré par campagne (résultat Meta, sell-in, sell-out) avec réalisé. |
| **IA** | Post-mortem automatique à la fin de chaque campagne : dépense, résultat officiel, ventes avant / pendant / après, stock, verdict, rédigé par le copilote dans le format Donnée / Analyse / Hypothèse / Recommandation. Simulateur d'offre conversationnel posé sur le module Promotions. |

### 2.9 Digital Ads

| | |
|---|---|
| **Les meilleurs** | Smartly, Madgicx, Revealbot, Triple Whale : règles automatiques (pause si coût > X, budget +20 % si winner), application des décisions avec approbation, tests d'incrémentalité géographiques, génération et test de créatives, suivi des conversions côté serveur (CAPI), insights organiques. |
| **COMANET OS** | Le diagnostic est au niveau du marché, voire au-dessus sur l'honnêteté : résultat officiel selon l'objectif Meta, benchmark multi-référence, anomalies, fatigue, winners, « où mettre l'argent », « quoi pousser », « quoi publier », mémoire. Lecture seule. |
| **Écart** | Aucune action vers Meta, pas de TikTok ni Google en API, pas d'insights organiques, pas de mesure des conversions WhatsApp, code mort (`live.ts`, `saveAdCreative`, `refreshMetaNow`), jeton Meta bloqué depuis 24 jours. |
| **À développer** | (1) **« Appliquer » avec approbation** : pause, reprise, changement de budget via l'API Marketing, journalisés, avec un plafond quotidien. (2) Tests d'incrémentalité : couper la pub une semaine sur une ville et comparer le sell-in, seule façon honnête de dépasser la corrélation sans modèle opaque. (3) Insights organiques Instagram et Facebook (même jeton, autre endpoint). |
| **IA** | Pipeline créatif : brief produit (2.4) → 5 variantes d'accroche et de script conformes aux allégations autorisées → visuels générés → validation → publication en test. La boucle « quoi publier » existe déjà ; il manque la production. |

### 2.10 Influence

| | |
|---|---|
| **Les meilleurs** | CreatorIQ, GRIN, Kolsquare : découverte de profils, statistiques récupérées par API, contrats et briefs, codes promo et liens trackés suivis automatiquement, paiements, détection des publications. |
| **COMANET OS** | Pipeline en 8 statuts, score à trois axes, collaborations avec stats saisies à la main, CA attribué uniquement par code promo saisi. |
| **Écart** | 100 % manuel, pas de brief ni de contrat, pas de suivi automatique des codes, pas de découverte. |
| **À développer** | (1) Si le site Shopify est actif : connecteur pour remonter les commandes par code promo (CA attribué réellement mesuré, dans l'esprit de la règle). (2) Brief et contrat générés depuis la collaboration, envoyés par WhatsApp. (3) Stats par API Instagram pour les comptes qui acceptent le partenariat rémunéré. |
| **IA** | Rédaction du brief influenceuse (ton, mentions obligatoires, allégations interdites, livrables) et vérification du contenu reçu contre la charte de la marque (la skill `brand-review` existe déjà hors application). |

### 2.11 Planning éditorial

| | |
|---|---|
| **Les meilleurs** | Later, Hootsuite, Sprout, Planable : publication et programmation réelles, statistiques automatiques, approbation externe (agence, marque), génération de légendes, meilleure heure de publication. |
| **COMANET OS** | Calendrier mois / semaine / liste, glisser-déposer, briefs structurés, livrables versionnés, workflow de validation par marque, notifications internes. Très bon outil de production. |
| **Écart** | « Programmé » n'est qu'un statut ; rien n'est publié ; stats saisies à la main ; pas de génération IA ; fichiers en base Postgres (bytea). |
| **À développer** | (1) Publication Instagram et Facebook par l'API Graph depuis le statut « Programmé », stats remontées 48 h après. (2) Passage des fichiers à Supabase Storage (le module `assets.ts` a été conçu pour ça). (3) Accès validateur externe (agence, marque) par lien signé. |
| **IA** | Génération de la légende, des hashtags et de trois accroches depuis le brief et la fiche produit, avec contrôle automatique des allégations interdites avant validation. C'est l'usage IA le plus attendu par une équipe marketing. |

### 2.12 Activations, matériel, animations (retail execution)

| | |
|---|---|
| **Les meilleurs** | Repsly, Salesforce Retail Execution, Trax : application mobile hors connexion, pointage GPS, photos de rayon analysées par reconnaissance d'image (facings, part de linéaire, PLV présente, prix), audit « perfect store », planning des animatrices, coût réel par journée. |
| **COMANET OS** | Activations avec checklist, budget, résultats, effet ventes avant / après et verdict ; matériel avec mouvements ; animations avec saisie mobile, score animatrice, plan d'action, objectifs par ville. |
| **Écart** | Photo = lien texte, pas de téléversement ; pas de GPS ni de pointage pour les animatrices ; pas de hors connexion (le service worker ne couvre que le médical) ; pas de planning malgré le statut PLANNED ; pas d'export ; événement ANIMATION_COMPLETED sans traitement. |
| **À développer** | (1) Même socle mobile que le médical pour les animatrices : Démarrer / Terminer, position, hors connexion, photo. (2) Planning des animations (calendrier, affectation, coût prévu). (3) Audit « rayon parfait » : checklist de présence (PLV, facings, prix affiché, testeur) à chaque passage. |
| **IA** | Lecture des photos de rayon : produits COMANET détectés, facings, PLV visible, comparé au relevé précédent. Vision par modèle multimodal, résultat proposé puis confirmé par l'animatrice, jamais écrit seul. Coaching hebdomadaire par animatrice rédigé à partir des scores. |

### 2.13 Médical

| | |
|---|---|
| **Les meilleurs** | Veeva Vault CRM, IQVIA OCE : tournée optimisée, e-detailing (présentation sur tablette avec suivi de ce qui a été montré), saisie vocale du compte rendu, agent de préparation de visite, notes de frais, consentement et conformité des données médecins. |
| **COMANET OS** | Chrono et GPS avec contrôle de présence, hors connexion, corrections tracées, ordonnances avec rapprochement, potentiel A/B/C, segments, impact des visites en corrélation observée, tournée suggérée, échantillons avec prévision, objectifs par délégué. C'est votre module le plus avancé, proche de Veeva sur le contrôle terrain. |
| **Écart** | Tournée sans optimisation de distance (coordonnées stockées, non exploitées, « V1 volontairement simple »), pas d'e-detailing, pas de notes de frais, fiche pré-visite indisponible hors connexion. |
| **À développer** | (1) Ordre de tournée par distance et créneaux (les coordonnées existent). (2) E-detailing léger : fiches produit (2.4) présentées depuis « Ma journée », produits montrés enregistrés dans le compte rendu. (3) Indemnités kilométriques calculées depuis les positions validées. |
| **IA** | Compte rendu dicté (voix → texte structuré : produits, objections, prochaine action), relu par la déléguée. Fiche pré-visite rédigée par le copilote (ordonnances récentes du médecin, potentiel, dernière visite, échantillons restants), mise en cache pour le hors connexion. |

### 2.14 Réglementaire, tâches, notifications, rapports

| | |
|---|---|
| **Les meilleurs** | Dossiers avec fichiers, alertes multicanal, calendrier, tâches récurrentes, rapports planifiés envoyés automatiquement. |
| **COMANET OS** | Suivi DMP / ATD / CE complet avec règles et tâches automatiques ; tâches Kanban avec commentaires ; notifications in-app pour contenus et activations ; rapports IA hebdo et mensuels validés par la direction. |
| **Écart** | Documents = lien URL ; automatisation à l'ouverture de l'écran et non par cron ; aucune notification à l'assignation d'une tâche ; aucun canal sortant ; rapports non planifiés, export Markdown seulement ; types de notification affichés en code brut hors contenus. |
| **À développer** | (1) **Un service d'envoi unique** (`src/lib/notify/`) : e-mail (Resend ou équivalent) et WhatsApp Business API, avec préférences par personne et journal. Tout le reste (tâche assignée, recommandation critique, relance client, rapport prêt, alerte réglementaire) passe par lui. (2) Cron pour le réglementaire et les rapports. (3) Fichiers réglementaires dans `content_assets` comme les autres modules. |
| **IA** | Rapport hebdomadaire généré le lundi à 7 h, validé en un clic, envoyé en PDF. Lecture des courriers de l'administration (DMP, décisions) pour pré-remplir les dates du dossier, confirmées par Oumaima. |

### 2.15 Socle technique

| | |
|---|---|
| **Constat** | Next.js 16, Drizzle, Supabase, Vercel : stack moderne et bien tenue, tests unitaires sur les définitions, scripts d'intégration. Pas de manifest PWA (application non installable), hors connexion limité au médical, pas de sauvegarde vérifiée ni de supervision des erreurs, recherche par LIKE, fichiers en base. |
| **À développer** | (1) Manifest et icônes : l'application s'installe sur les téléphones des animatrices, commerciaux et déléguées. (2) Supervision des erreurs (Sentry ou équivalent) et vérification de la restauration Supabase (PITR). (3) Stockage objet pour les fichiers. (4) Recherche plein texte Postgres. (5) Une API lecture seule documentée pour le jour où un partenaire (Cospharma, cabinet comptable) voudra se connecter. |

---

## 3. Où l'IA change vraiment la donne

Le principe à garder : **statistique pour prévoir, agents outillés pour préparer et rédiger, vision pour lire des photos et des documents, jamais un chiffre inventé, toujours une personne qui valide avant une action externe.** Classement par rapport impact / effort.

| # | Cas d'usage | Ce qu'il crée | Données nécessaires | Garde-fou |
|---|---|---|---|---|
| 1 | Digest quotidien par personne sur WhatsApp ou e-mail (brief du matin existant, filtré par portée) | Adoption : l'outil vient à l'équipe | Service d'envoi (2.14) | Trois actions maximum, chiffres issus des outils |
| 2 | Lecture des commandes pharmacie reçues par WhatsApp (texte ou photo) → commande client proposée | Donnée de commande propre à la source, sell-in en temps réel | Commande client (2.6), WhatsApp Business API | Confirmation par le commercial avant BL |
| 3 | Fiche pré-visite commerciale et médicale rédigée par le copilote | Visites préparées, assortiment manquant proposé | CRM commercial (2.3) | Format Donnée / Analyse / Hypothèse / Recommandation |
| 4 | Prévision par référence et par mois avec saisonnalité (ETS / Prophet) | Achats et stock cible fiables, alerte avant la saison | 24 à 36 mois de sell-in (disponibles) | Étiquette « modélisé », intervalle affiché, jamais fusionné au réel |
| 5 | Génération de contenu conforme (légendes, accroches, briefs influence) depuis la fiche produit | Production éditoriale ×3 | Fiches produit enrichies (2.4) | Contrôle des allégations interdites avant validation |
| 6 | OCR factures fournisseurs → facture fournisseur pré-remplie et rapprochée | Saisie achats divisée par 5 | Boîte e-mail dédiée | Écarts signalés, jamais corrigés automatiquement |
| 7 | Lecture des photos de rayon (facings, PLV, rupture) | Sell-out et exécution en magasin mesurés | Téléversement photo (2.12) | Résultat confirmé par l'animatrice |
| 8 | Compte rendu de visite dicté → structuré | Qualité des comptes rendus, temps gagné | Micro du téléphone | Relecture avant enregistrement |
| 9 | Post-mortem automatique de campagne et d'activation | Mémoire marketing réelle | Existant | Corrélation observée, pas d'attribution |
| 10 | « Appliquer » une décision Ads avec approbation et plafond | Boucle fermée sur le digital | Jeton Meta avec `ads_management` | Journal, plafond quotidien, annulation en un clic |

Ce qu'il faut **éviter** : un modèle d'attribution marketing opaque (MMM) avant d'avoir des tests d'incrémentalité, et des agents qui écrivent sans validation. Votre règle « corrélation ≠ causalité » est un avantage concurrentiel, pas une limite.

---

## 4. Feuille de route proposée

### 0 à 90 jours : fondations de la boucle fermée

1. **Sécurité** : retirer les identifiants de démo de la page de connexion de production (voir section 5), changer les mots de passe des sept comptes du seed.
2. **Service d'envoi** e-mail + WhatsApp Business API, préférences par personne, journal. Premiers usages : tâche assignée, recommandation critique, brief du matin, relance client.
3. **PWA** installable, hors connexion étendu à la saisie des animatrices et aux inventaires.
4. **Historique des recommandations** et interrupteur par règle.
5. **CRM commercial** version 1 : contacts, chronologie, visites avec le moteur chrono / GPS existant, encours sur la fiche.
6. **Commande fournisseur depuis la commande conseillée**, export Excel sur toutes les tables.
7. **Import des ventes distributeurs par pharmacie** (Cospharma, Pharmafirst).

### 3 à 6 mois : la demande et l'argent

8. **Commande client** + lecture des commandes WhatsApp par le copilote.
9. **Prévision saisonnière** par référence, branchée sur le stock cible et le cockpit.
10. **Facture électronique DGI** conçue avec la bascule du 1er janvier 2027, export d'écritures pour le cabinet, relances automatiques.
11. **Module Promotions et offres** (la moulinette d'offres dans l'application).
12. **Génération de contenu** et publication Instagram / Facebook depuis le planning.
13. **« Appliquer » sur Digital Ads** avec approbation, insights organiques, jeton Meta rétabli.

### 6 à 12 mois : l'avantage concurrentiel

14. **Portail de commande pharmacie** (catalogue, encours, historique, promotions).
15. **Lecture des photos de rayon** et audit « rayon parfait ».
16. **E-detailing** et compte rendu dicté pour le médical, tournée optimisée.
17. **Tests d'incrémentalité** sur le digital et les animations ; MMM seulement ensuite.
18. **OCR achats, lettrage, prévision de trésorerie.**

---

## 5. Correctifs constatés pendant la visite

À traiter indépendamment de la feuille de route.

- **Identifiants de démo affichés en production.** `src/app/login/page.tsx:28` affiche « Démo : hicham@comanet.ma / comanet2026 » sur https://comanet-os.vercel.app/login, et le dépôt est public. À retirer immédiatement et faire tourner les mots de passe.
- **`npm run db:import` ne fonctionne plus** : le moteur d'import charge désormais `src/lib/medical/prescriptions.ts`, protégé par `server-only`. La commande doit être lancée avec `node --conditions=react-server --import tsx scripts/import-workbook.ts`, comme les scripts d'intégration ; le `package.json` et le CLAUDE.md sont à mettre à jour.
- **Action Center, règle `client-intel`** : « Analyser la baisse et visiter » apparaît sur COTE PARA avec une évolution 3 mois de +456 %. Le segment « À risque » est déclenché par le retard de commande, mais le texte explique une baisse. Séparer les deux motifs.
- **Tendance 3 mois « -261 % »** (MULTIVIT KIDS) : une baisse ne peut dépasser -100 % ; des avoirs ou retours entrent dans le calcul. Les traiter à part ou borner l'affichage.
- **Date de référence** : fausse alerte, retirée après vérification. Le Cockpit avait été consulté avant la fin de l'import ; une fois les ventes chargées, il se cale bien sur la dernière vente (29 juillet 2026), comme Ventes et l'Action Center.
- **Meta** : jeton refusé depuis 24 jours (« API access blocked ») ; les chiffres Ads datent de la dernière synchronisation.
- **Code mort** : `liveCampaigns`, `intradayTotals`, `accountsFreshness` (`src/lib/meta/live.ts`), actions `saveAdCreative` et `refreshMetaNow` ; événement `ANIMATION_COMPLETED` sans traitement.
- **Notifications** : seuls les types « contenus » ont un libellé ; les autres s'affichent en code.
- **Perimètres de CA** : la vue Marketing affiche « CA facturé (Sage) 5,4 M » (tous sites) et le P&L « CA HT 2,2 M » (COMANET direct) pour la même année. Les deux sont justes ; un lecteur ne le sait pas. Un glossaire des périmètres, affiché au survol de chaque KPI, éviterait les mauvaises lectures.

---

## Sources externes consultées

- Calendrier de la facturation électronique au Maroc : [Le360](https://fr.le360.ma/economie/facturation-electronique-le-detail-du-calendrier-de-mise-en-place_2EQSNG2DTVB6PGBBHQ6OCFT6CY/), [Upsilon Consulting](https://upsilon-consulting.com/facturation-electronique-maroc-2026/), [Inyad](https://inyad.com/blog/calendrier-facture-electronique-maroc-2026-2028), [Banqup](https://www.banqup.com/fr-fr/resources/compliance-pulse/morocco).
- Salesforce Consumer Goods Cloud et Agentforce (Visit Assistant, Retail Execution) : [Salesforce](https://www.salesforce.com/consumer-goods/), [Digital Commerce 360](https://www.digitalcommerce360.com/2025/04/22/salesforce-agentforce-consumer-goods-agentic-ai/), [Simplus, Winter '26](https://www.simplus.com/winter-26-is-coming-heres-what-you-need-to-know-in-retail-and-consumer-goods).
- Veeva AI Agents pour Vault CRM (Pre-call, Voice, Free Text) : [Veeva](https://www.veeva.com/resources/veeva-ai-agents-now-available-to-increase-productivity-and-customer-centricity/), [PharmaVoice](https://www.pharmavoice.com/press-release/20251203-veeva-ai-agents-now-available-to-increase-productivity-and-customer-centric/).
- Commande B2B dans la pharmacie : [Scandit](https://www.scandit.com/resources/guides/boost-pharma-revenue), [B2B Wave](https://www.b2bwave.com/p/why-b2b-ecommerce-is-an-opportunity-for-medical-and-pharmaceutical-wholesalers), [Kolonell](https://kolonell.com/en/blog/wholesale-pharmacy-distributor-b2b-ordering-platform-2026).
