# Déployer l'app mobile COMANET OS

L'app est le site, installé. iPhone : PWA depuis Safari. Android : APK (Trusted Web Activity) qui charge le site.
**Une mise à jour du site met l'app à jour, sans réinstallation.**

## Quand faut-il un nouvel APK ?

| Changement | Nouvel APK ? |
|---|---|
| Écrans, données, droits, tout ce qui est dans le site | Non |
| Icône, nom affiché, couleur de la barre | Oui |
| Domaine du site | Oui, et chaque téléphone perd ses données locales : à éviter |
| Package `ma.comanet.os` | Oui, c'est une autre app : à ne jamais changer |
| Nouvelle permission Android | Oui (GPS et notifications sont déjà activés dans le premier APK) |

## 0. Mettre le site sur app.comanet.ma, une seule fois

Le domaine de l'app est **`app.comanet.ma`** (décision du 07/11/2026). Il est inscrit dans l'APK : tout le reste en dépend, à faire d'abord.

1. **Vercel** → projet `comanet-os` → Settings → Domains → ajouter `app.comanet.ma`. Vercel affiche l'enregistrement DNS à créer.
2. **DNS de `comanet.ma`** (serveurs `stackdns.com`, l'hébergeur du site) : créer pour `app` l'enregistrement exact donné par Vercel.
   `app.comanet.ma` répond aujourd'hui par l'enregistrement général du domaine ; un enregistrement dédié prend le dessus,
   sans toucher au site `comanet.ma` ni aux e-mails.
3. Attendre que Vercel affiche **Valid Configuration**, puis vérifier :

```bash
curl -I https://app.comanet.ma/api/health
```

**Ne pas rediriger `comanet-os.vercel.app` tout de suite.** Pour un navigateur, ce sont deux sites distincts : la session et les saisies en attente
d'un téléphone restent sur l'ancienne adresse. Elle reste donc active pendant que l'équipe passe à la nouvelle, et les liens `/d/…` déjà envoyés
continuent de fonctionner. Avant de changer d'adresse, chaque téléphone ouvre l'ancienne une dernière fois avec du réseau, pour vider sa file.

## 1. Prérequis, une seule fois

- Un Mac ou un PC avec Node. Bubblewrap installe lui-même le JDK et le SDK Android à sa première exécution.
- Le site répond sur `app.comanet.ma` (section 0) : Bubblewrap y lit le manifest et les icônes.

```bash
npm i -g @bubblewrap/cli
```

## 2. Créer le keystore, une seule fois

Le keystore signe l'app. **Le perdre interdit toute mise à jour** : il faudrait publier une autre app et tout réinstaller.

```bash
keytool -genkeypair -v -keystore twa/comanet-os.keystore -alias comanet -keyalg RSA -keysize 2048 -validity 10000
```

- Choisir un mot de passe fort et le ranger dans un gestionnaire de mots de passe.
- Copier `twa/comanet-os.keystore` à deux endroits sûrs, hors du dépôt.
- **Ne jamais le committer** : le dépôt est public (`.gitignore` l'exclut). Ne jamais envoyer le mot de passe dans un chat.

## 3. Construire et signer l'APK

```bash
cd twa
```

```bash
bubblewrap update --manifest=./twa-manifest.json
```

```bash
bubblewrap build
```

Bubblewrap demande le mot de passe du keystore et produit `app-release-signed.apk`.

## 4. Relier le site à l'APK

Sans cette étape, l'app affiche une barre d'adresse. Récupérer l'empreinte :

```bash
keytool -list -v -keystore comanet-os.keystore -alias comanet
```

Dans Vercel, variables d'environnement de production :

- `TWA_SHA256_FINGERPRINTS` : la ligne `SHA256:` (publique, ce n'est pas un secret).
- `APK_URL` : `/downloads/comanet-os.apk`.

Vérifier : `https://app.comanet.ma/.well-known/assetlinks.json` doit afficher l'empreinte.

## 5. Publier l'APK

Copier `app-release-signed.apk` vers `public/downloads/comanet-os.apk`, committer et déployer. Le fichier n'est pas secret.
Le lien à partager est alors `https://app.comanet.ma/app`.

## 6. Changer de keystore

Android refuse une mise à jour signée par une autre clé : une rotation impose de désinstaller puis réinstaller, et ne se justifie qu'en cas de fuite.

1. Créer le nouveau keystore et construire l'APK.
2. Mettre **les deux** empreintes dans `TWA_SHA256_FINGERPRINTS`, séparées par une virgule, pendant la transition.
3. Faire réinstaller l'équipe, puis retirer l'ancienne empreinte.

## 7. Après chaque nouvel APK

Augmenter `appVersionCode` et `appVersionName` dans `twa/twa-manifest.json`, reconstruire, remplacer le fichier. L'installation se fait par-dessus l'ancienne.

## 8. Dépannage

| Symptôme | Cause probable |
|---|---|
| Barre d'adresse visible dans l'app | Empreinte absente ou fausse dans `assetlinks.json`, ou APK d'un autre keystore |
| « Application non installée » | Ancienne version signée par un autre keystore : désinstaller d'abord |
| Position refusée | Paramètres du téléphone → Applications → COMANET OS → Autorisations → Position |
| « Reconnectez-vous » | Session expirée ou appareil révoqué. Les saisies en attente restent sur le téléphone et partent après la connexion |

## 9. Activer les notifications (Web Push)

Une seule fois, sur un poste de confiance :

```bash
npx web-push generate-vapid-keys
```

Dans Vercel, variables de production : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secrète : jamais dans un chat ni dans le dépôt), `VAPID_SUBJECT` (`mailto:` d'une adresse COMANET). Redéployer.

Sans ces clés, tout fonctionne sauf l'envoi sur téléphone. Ne pas les changer ensuite : chaque téléphone devrait réactiver ses notifications.
Sur iPhone, les notifications ne marchent que dans l'app installée depuis Safari.

## Guide à envoyer à l'équipe par WhatsApp

> 📱 *Installer l'app COMANET*
> 1. Ouvrez ce lien : https://app.comanet.ma/app
> 2. Android : touchez *Télécharger*, ouvrez le fichier, autorisez l'installation. iPhone : dans Safari, *Partager* → *Sur l'écran d'accueil*.
> 3. Ouvrez *COMANET* et connectez-vous une fois : la session dure 30 jours.
> 4. Acceptez la position quand le téléphone la demande : elle n'est lue qu'au moment d'enregistrer.
> 5. Sans réseau, continuez à saisir : tout part seul au retour du réseau.
