# Prévision saisonnière par référence

Depuis le 03/10/2026, le stock cible et la commande conseillée de **Stock & achats** ne reposent plus sur la vente
moyenne « plate » des trois derniers mois, mais sur une **prévision mensuelle modélisée** qui tient compte des
événements saisonniers connus : Ramadan, saison solaire, rentrée. La vente moyenne reste affichée (c'est la rotation
constatée) ; la prévision s'y ajoute pour projeter les mois à venir.

## Ce que l'on trouve dans l'application

- **Stock & achats** (`/stock`) : colonne « Prév. 3 mois (modélisée) », couverture, stock cible et commande conseillée
  calculés sur la prévision, lien « Commander » sur chaque ligne à commander.
- **Prévision & commandes** (`/stock/prevision`) : par référence, la base désaisonnalisée et chaque mois de l'horizon avec
  l'indice appliqué (×1,15, ×0,75…), le stock, l'en-cours, le stock cible et la commande conseillée. Les références sont
  regroupées par fournisseur (marque → fournisseur de marchandises rattaché dans Fournisseurs). Le bouton
  **« Commander chez … »** ouvre une commande fournisseur pré-remplie avec toutes les quantités conseillées du groupe ;
  « Commander » sur une ligne ne pré-remplit que cette référence.
- **Nouvelle commande fournisseur** pré-remplie : quantités conseillées, dernier prix payé à ce fournisseur dans sa devise
  (sinon prix Exwork EUR de la fiche si le fournisseur facture en euros, sinon à saisir), note de traçabilité. Rien n'est
  enregistré avant « Enregistrer le brouillon » : vous ajustez quantités, prix, date de livraison attendue.
- **Paramètres → Règles & seuils → Prévision saisonnière** : mois de base, horizon, et les événements (libellé,
  coefficient, mots-clés, fenêtre récurrente « JJ/MM → JJ/MM », fenêtres explicites « AAAA-MM-JJ → AAAA-MM-JJ »). À côté
  de chaque coefficient, le **ratio observé** dans l'historique (36 mois).
- Fiche produit : prévision des trois prochains mois sous la commande conseillée.
- Copilote (`get_stock_coverage`) : `forecast_modelled_units` et `forecast_events`, annoncés comme modélisés.

## Règles

1. **Modélisée, jamais mesurée.** La prévision est étiquetée « modélisée » partout. Elle ne remplace aucune donnée : un
   produit sans vente a une base nulle et une prévision nulle ; une référence sans stock connu reste « stock non
   renseigné » et n'a pas de commande conseillée.
2. **Indice d'un mois** = produit, sur les événements qui concernent la référence, de
   `1 + (coefficient − 1) × part du mois couverte`. Ramadan 2027 (8 février → 9 mars) à ×1,15 couvre 21 jours sur 28 en
   février : indice 1,11. Un mois sans événement vaut 1.
3. **Base désaisonnalisée** = moyenne, sur les `baseMonths` derniers mois civils complets avant le mois de la date de
   référence (dernier import de ventes), de `ventes du mois ÷ indice du mois`. Les mois antérieurs à la première vente de
   la référence sont exclus. Sans aucun mois complet, la base est la vente moyenne glissante, et la page le dit.
4. **Prévision d'un mois** = base × indice. Aucune tendance n'est extrapolée.
5. **Stock cible** = demande modélisée sur délai fournisseur + stock de sécurité + 30 jours, à partir de la date de
   référence (reste du mois en cours proraté, puis mois entiers, puis base au-delà de l'horizon).
   **Commande conseillée** = stock cible − stock − en cours, arrondie au MOQ (formule inchangée).
   **Couverture** = jours de demande modélisée couverts par le stock ÷ 30 ; **rupture estimée** = date de référence +
   ces jours.
6. **Portée d'un événement** : mots-clés vides = toutes les références ; sinon celles dont le nom ou la catégorie contient
   un mot-clé (sans accents ni casse). Les fenêtres explicites servent aux événements mobiles (Ramadan : une par année, à
   compléter chaque année) ; la fenêtre récurrente aux saisons fixes, y compris à cheval sur le nouvel an.
7. **Ratio observé** = ventes journalières moyennes des jours couverts ÷ celles des autres jours, sur les références
   concernées, jours sans vente comptés pour zéro à partir de la première vente. C'est une corrélation observée, affichée
   pour calibrer, jamais appliquée d'office. Les coefficients par défaut ont été alignés le 03/10/2026 sur ces ratios
   (Ramadan ×1,15, solaire ×1,2 / ×0,75, rentrée ×1,05) ; ils se révisent dans Paramètres.
8. **Une seule définition** : `buildForecast()`, `seasonIndex()` et `demandSeries()` dans `src/lib/forecast-shared.ts`
   (pur, testé dans `tests/forecast.test.ts`) ; `computeCoverage()` reçoit la série et reste l'unique formule de
   couverture. Aucune page ne recalcule une prévision.

## Limites assumées

- Les événements sont définis à la main : un pic non paramétré (lancement, rupture fournisseur) n'est pas modélisé.
- Les mois civils font 28 à 31 jours alors que la couverture compte des mois de 30 jours : l'écart est de l'ordre de 2 %.
- Les fenêtres du Ramadan sont renseignées jusqu'en 2029 ; sans fenêtre pour une année, l'événement n'y joue pas.
