# Déployer COMANET OS en ligne (Supabase + Vercel)

Objectif : une URL du type `https://comanet-os.vercel.app` accessible à toute l'équipe, avec la base de données
hébergée chez Supabase (PostgreSQL managé, sauvegardes, Europe). Aucune installation n'est nécessaire sur un
ordinateur : la base se crée et se charge depuis la page **/installation** de l'application.

```
GitHub (code)  ──►  Vercel (application Next.js)  ──►  Supabase (PostgreSQL)
      ▲                                                     ▲
      └── chaque nouvelle version poussée sur GitHub        └── créée et chargée depuis /installation
          est déployée automatiquement
```

Compter 20 minutes la première fois. Les étapes 1 à 3 se font une seule fois.

---

## 1. Supabase — la base de données (5 min)

1. Créer un compte sur <https://supabase.com> (connexion avec GitHub ou e-mail), puis **New project** :
   - *Name* : `comanet-os`
   - *Database password* : générer un mot de passe fort et **le conserver** (il fait partie de la chaîne de connexion).
   - *Region* : **West EU (Paris)** — la plus proche de Casablanca.
   - *Plan* : Free suffit pour démarrer. Un projet Free est mis en pause après 7 jours sans activité (un clic pour le
     réactiver) ; le plan Pro (25 $/mois) supprime cette pause et ajoute les sauvegardes quotidiennes.
2. Attendre que le projet soit prêt (≈ 2 min).
3. En haut du tableau de bord, bouton **Connect** → onglet *Connection string* → méthode **Transaction pooler**
   (port `6543`). Copier l'URI et remplacer `[YOUR-PASSWORD]` par le mot de passe choisi. Elle ressemble à :

   ```
   postgresql://postgres.abcdefghijkl:MOT_DE_PASSE@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
   ```

   C'est la valeur de `DATABASE_URL`. (Pour les scripts en ligne de commande depuis un ordinateur — `db:push`,
   `db:import` — utiliser plutôt la chaîne **Session pooler**, port `5432`.)

## 2. GitHub — le code (3 min)

1. Créer un compte sur <https://github.com> si besoin, puis **New repository** : nom `comanet-os`, visibilité
   **Private**, sans README ni .gitignore (le projet en contient déjà).
2. Pousser le code du dossier `comanet-os` dans ce dépôt. Deux options :
   - **Assisté** : générer un *fine-grained personal access token* limité au dépôt `comanet-os` avec la permission
     *Contents : Read and write* (Settings → Developer settings → Personal access tokens), le transmettre à
     l'assistant qui pousse le code, puis **révoquer le jeton** une fois le dépôt en place.
   - **Manuel** : GitHub Desktop (<https://desktop.github.com>) → *Add local repository* → *Publish repository*.

   Aucun fichier `.env` ne doit être poussé (il est ignoré par `.gitignore`).

## 3. Vercel — l'application (5 min)

1. Créer un compte sur <https://vercel.com> avec **Continue with GitHub** et autoriser l'accès au dépôt `comanet-os`.
2. **Add New… → Project** → *Import* `comanet-os`. Vercel détecte Next.js ; ne rien changer aux réglages de build.
3. Ouvrir **Environment Variables** et ajouter, avant de déployer :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | la chaîne *Transaction pooler* de l'étape 1 |
   | `DATABASE_SSL` | `true` |
   | `SESSION_SECRET` | une chaîne aléatoire longue (≥ 32 caractères), par ex. générée sur <https://generate-secret.vercel.app/48> |
   | `SETUP_KEY` | une clé (≥ 8 caractères) qui protégera la page `/installation` |

4. **Deploy**. Au bout de 2 à 3 minutes, Vercel affiche l'URL de production (`https://comanet-os-xxxx.vercel.app`).
5. Plan : le plan *Hobby* (gratuit) est réservé par Vercel à un usage personnel et non commercial. Pour COMANET,
   passer sur **Pro** (20 $/mois par membre) — il apporte aussi des délais d'exécution plus longs pour les gros
   imports, et des analyses d'usage.

`vercel.json` fixe la région d'exécution sur **Paris (cdg1)** pour rester à côté de la base Supabase. Si la base est
créée dans une autre région, adapter cette valeur (`fra1` Francfort, `dub1` Dublin, `lhr1` Londres).

## 4. Installation de la base depuis le navigateur (5 min)

1. Ouvrir `https://<votre-url>/installation` et entrer la `SETUP_KEY`.
2. Suivre les quatre étapes affichées :
   1. **Connexion** — vérifie `DATABASE_URL` / `DATABASE_SSL`.
   2. **Schéma** — *Créer le schéma* : applique les migrations SQL du dossier `drizzle/`.
   3. **Socle** — *Créer le socle* : utilisateurs (`hicham@`, `samy@`, `nasr@`, `demzin@`, `oumaima@`,
      `reglementaire@`, `animatrice@comanet.ma` — mot de passe `comanet2026`), marques du portefeuille, paramètres.
   4. **Données** — choisir le classeur **« Compilé 2026 vf.xlsx »** et *Charger le classeur* : correspondances
      clients / marques, ventes 2024-2026, stock, objectifs et budgets 2026. Le fichier est envoyé par morceaux
      puis traité (1 à 5 min selon la taille). Recharger le même classeur est sans risque : les lignes déjà
      présentes sont ignorées.
3. **Ouvrir COMANET OS**, se connecter, puis **changer les mots de passe** (Paramètres → Utilisateurs).
4. Ensuite, les exports mensuels Sage se chargent depuis **Imports** (menu Système) — même mécanisme par morceaux,
   fichiers jusqu'à 25 Mo.

La page `/installation` reste accessible aux administrateurs connectés (ou avec la `SETUP_KEY`). Pour la
neutraliser complètement, supprimer `SETUP_KEY` dans Vercel : seuls les Admin connectés y auront alors accès.

## 5. Mettre à jour l'application

1. Pousser la nouvelle version sur GitHub (branche `main`) → Vercel construit et déploie automatiquement (2-3 min).
   Chaque déploiement a son URL de prévisualisation ; l'URL de production ne change pas.
2. Si la version contient de nouvelles migrations (`drizzle/00xx_*.sql`), ouvrir `/installation` →
   **Appliquer les migrations**. Le cockpit le rappelle : l'étape 2 passe en « À vérifier ».
3. Revenir en arrière : Vercel → *Deployments* → déploiement précédent → **Promote to Production**.

## 6. Nom de domaine (facultatif)

Vercel → projet → *Settings* → *Domains* → ajouter `os.comanet.ma`, puis créer chez le registrar l'enregistrement
DNS indiqué (`CNAME os → cname.vercel-dns.com`). Le certificat HTTPS est automatique.

## 7. Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| `/installation` : « Connexion à la base impossible » | `DATABASE_URL` incomplète (mot de passe non remplacé), mauvais port (utiliser 6543), `DATABASE_SSL` absent. Après correction : Vercel → *Deployments* → **Redeploy**. |
| Page blanche / erreur 500 après déploiement | `SESSION_SECRET` manquant ou < 16 caractères. |
| Import qui s'arrête au bout de quelques minutes | Limite d'exécution de l'hébergeur (300 s sur Vercel). Diviser le classeur (ventes 2024 dans un fichier séparé chargé via *Imports*), ou passer en plan Pro. Le rechargement reprend là où il s'est arrêté grâce au dédoublonnage. |
| Supabase « Project paused » | Plan Free inactif 7 jours : bouton *Restore project* dans le tableau de bord Supabase. |
| « Fichier trop volumineux » | Maximum 25 Mo par fichier ; exporter une période plus courte depuis Sage. |
| Vérifier l'état du service | `https://<votre-url>/api/health` renvoie `{"ok":true,"db":"up"}`. |

## Variables d'environnement (récapitulatif)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | connexion PostgreSQL (Supabase : Transaction pooler, port 6543) |
| `DATABASE_SSL` | oui sur Supabase | `true` pour activer TLS |
| `SESSION_SECRET` | oui | signature des sessions (≥ 16 caractères, idéalement 48) |
| `SETUP_KEY` | recommandé | accès à `/installation` sans compte |
| `DATABASE_POOL_MAX` | non | connexions par instance (défaut : 5 sur Vercel) |
| `BUSINESS_TZ` | non | fuseau métier (défaut : `Africa/Casablanca`) |
