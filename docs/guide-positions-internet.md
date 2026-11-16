# Positions vérifiées sur Internet et alerte « visite hors zone »

Pour la direction. Deux choses :

1. **Chaque cabinet et chaque point de vente est comparé à Google Maps.** L'application cherche la fiche sur Google
   (nom + ville, au Maroc) et compare la position trouvée à celle relevée sur le terrain.
2. **Une visite faite loin de la bonne adresse vous est notifiée tout de suite** (dans l'application et sur le téléphone),
   à vous, à Samy et au manager de la personne.

## Ce que fait l'application toute seule

| Situation | Ce qui se passe |
|---|---|
| La fiche n'a aucune position, Google trouve le lieu | La position Google est posée sur la fiche, **à valider**. Elle devient validée quand une visite démarre à moins de 150 m. |
| Position « à valider » (premier Démarrer ou historique du CRM) et Google à moins de 150 m | **Validée automatiquement** : deux sources indépendantes sont d'accord. Trace dans le journal d'audit (« Contrôle Internet »). |
| Position « à valider » loin de Google | Rien ne change : à trancher sur la carte. |
| Position **validée** loin de Google | Rien ne change ; l'écart s'affiche dans le panneau et vous recevez « Position à revoir ». |
| Google ne trouve rien, ou plusieurs lieux possibles (deux « Pharmacie Al Amal » dans la ville) | Rien ne change ; la fiche est listée « rien de sûr sur Google ». |

Google ne prouve jamais une présence à lui seul. Une position validée n'est jamais modifiée automatiquement.

## L'alerte « visite hors zone »

Quand une déléguée ou une commerciale appuie sur Démarrer, Terminer ou « non effectuée » à plus de 150 m (le rayon du
paramétrage) d'une position **validée**, en tenant compte de la précision annoncée par le téléphone, une notification part
immédiatement : « Démarrage à 1,2 km du cabinet de Dr X (rayon 150 m, précision ± 12 m), à 10:42 », avec le lien vers la visite.
Une seule alerte par visite. Une position imprécise (± 800 m) ne déclenche pas d'alerte : la visite reste seulement « à vérifier ».

## Où le voir

- **Médical → Suivi terrain** et **Clients → Suivi des visites** (vue équipe) : panneau « Positions vérifiées sur Internet » —
  comptes par verdict, liste des écarts avec les deux positions sur Google Maps, bouton « Prendre la position Google »,
  bouton « Vérifier maintenant ».
- Sur les cartes : le **G** bleu est le lieu Google ; un trait rouge le relie à la fiche en cas d'écart.
- **Médical → Paramétrage** (administrateurs) : distance de concordance, ressemblance du nom, fiches vérifiées par heure
  (0 = pause), validation automatique et alerte (interrupteurs).

## Mise en route

1. Google Cloud Console → nouveau projet → activer **Places API (New)** → Identifiants → créer une clé API, la restreindre
   à « Places API (New) ». Un compte de facturation est demandé ; à ce volume (environ 1 400 fiches une fois, puis les nouvelles),
   on reste normalement dans la part gratuite mensuelle de Google : vérifiez-le dans la console.
2. Vercel → Settings → Environment Variables → `GOOGLE_MAPS_API_KEY` = la clé, puis redéployer.
3. Appliquer la migration 0058 depuis `/installation`.

Les noms des médecins et des points de vente (avec ville et spécialité) sont envoyés à Google pour la recherche, rien d'autre.
