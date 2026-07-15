# PMS GMC Group - Prototype web

Premiere base de developpement pour la plateforme Performance Management System de GMC Group.

## Ouvrir la plateforme avec la base locale

Lancer d'abord le serveur local qui connecte l'interface a SQLite :

```powershell
python start.py --port 5184
```

Puis ouvrir :

```text
http://127.0.0.1:5184/
```

Connexion de demonstration :

```text
Identifiant admin : admin
Mot de passe admin : Admin@2026!

Identifiant responsable exemple : directeur.financier@palladium.local
Mot de passe responsable initial : Palladium@2026!
```

Les responsables peuvent aussi se connecter avec leur email local, par exemple `directeur.financier@palladium.local`, avec le meme code temporaire.

L'ancienne ouverture du fichier HTML reste possible pour consultation, mais les enregistrements en base passent par le serveur local.

## Mettre la plateforme en ligne gratuitement

Le projet est prepare pour un premier deploiement gratuit sur Render.

1. Creer un depot GitHub, par exemple `pms-gmc-platform`.
2. Envoyer le dossier `pms-gmc-platform` dans ce depot.
3. Dans Render, choisir **New +** puis **Blueprint**.
4. Connecter le depot GitHub.
5. Render lit le fichier `render.yaml` et cree le service web.
6. Une fois le deploiement termine, Render donne une adresse publique du type :

```text
https://pms-gmc-platform.onrender.com
```

Connexion de demonstration :

```text
Identifiant admin : admin
Mot de passe admin : Admin@2026!
```

Note importante : l'offre gratuite convient pour une demonstration externe. La base SQLite est creee automatiquement au premier demarrage si elle n'existe pas. Pour conserver les donnees entre redeploiements, configurer un stockage persistant Render et pointer `PMS_DB_PATH` vers ce volume, par exemple `/var/data/pms_gmc.sqlite`. Les mots de passe initiaux peuvent etre changes par variables d'environnement : `PMS_ADMIN_PASSWORD` et `PMS_DEFAULT_USER_PASSWORD`. Pour une exploitation officielle, il faudra ensuite migrer vers PostgreSQL, securiser les secrets Kobo, renforcer les mots de passe et prevoir les sauvegardes.

## Ouvrir le prototype statique

Ouvrir le fichier suivant dans un navigateur :

```text
C:\Users\dquin\Documents\developpement Web\pms-gmc-platform\index.html
```

## Synchronisation KoboCollect

L'onglet KoboCollect permet maintenant de renseigner l'adresse serveur KoboToolbox, l'UID du formulaire et le jeton API, puis de lancer une synchronisation via `/api/kobo/sync`.

- Le serveur lit les metadonnees du formulaire Kobo et enregistre les champs detectes dans SQLite.
- Les soumissions Kobo sont importees dans `kobo_submissions`, avec dedoublonnage par identifiant de soumission.
- Le jeton API sert uniquement a la synchronisation courante : il n'est pas renvoye a l'interface ni affiche comme formulaire actif.
- Dans Administration > KoboCollecte, la logique PMS distingue deux formulaires : un formulaire `KPI et formules` par pole, et un formulaire `Elements de calcul` qui collecte les donnees brutes utilisees par ces formules.
- Le formulaire `KPI et formules` est aligne sur `Copie de Catalogu.xlsx` : 26 champs, 74 KPI, 11 groupes de rattachement, 0 formule manquante et 13 cibles a completer.

## Contenu de cette version

- Tableau de bord groupe COMEX.
- Supervision KoboCollect/KoboToolbox.
- Pipeline KoboCollect vers PMS : reception, controle, mapping, calcul KPI et publication.
- File de validation des anomalies avant integration.
- Referentiel KPI.
- Centre d'alertes.
- Plans d'action SMART.
- Amelioration continue.
- Module pertes CA horaire.
- Suivi de performance par pole avec checklist de publication.
- Reporting periodique par pole : hebdomadaire, mensuel, trimestriel, semestriel et annuel.
- Historique des rapports, commentaires responsables, validation N+1 et exports JSON/CSV.
- Administration et droits d'acces.

## Donnees integrees depuis les fichiers source

- `Catalogue_et_Guide_methodologique_KPI_Palladium_Africa_2026.xlsx` : 74 KPI, 11 groupes de rattachement, repartition par categorie et controles methodologiques.
- `GMC_FICHE_COLLECTE_V2.xlsx` : 7 domaines de collecte et 44 formules de calcul issues de l'onglet `FORMULE`.
- `CDC_PMS_GMC_Group_2026.docx` : modules fonctionnels, logique RAG, palette Palladium/GMC et exigences PMS.

## Structure du code

```text
index.html              Structure des ecrans
styles.css              Design system Palladium/GMC
scripts/data.js         Donnees metier centralisees
scripts/renderers.js    Fonctions de rendu de l'interface
scripts/api.js          Connecteur entre l'interface et l'API locale
app.js                  Etat, navigation et interactions utilisateur
server.py               API locale et serveur web de developpement
start.py                Demarrage avec creation automatique de la base si absente
database/schema.sql     Schema de la base SQLite
database/init_database.py Script de creation et d'alimentation de la base
database/pms_gmc.sqlite Base de donnees locale generee
```

## Principes integres

- KoboCollect/KoboToolbox est la source primaire des donnees.
- L'objectif principal est le suivi des performances par pole et la production de rapports periodiques.
- Chaque rapport doit consolider KPI, donnees Kobo, alertes RAG, commentaires, plans d'action et validation N+1.
- La file de validation bloque les donnees douteuses avant calcul et publication.
- Les exports du prototype produisent des fichiers locaux JSON ou CSV pour simuler les livrables.
- Palette Palladium/GMC : bleu `#1F3864`, dore `#D6A838`, bleu secondaire `#2E75B6`.
- RAG reserve aux statuts KPI et alertes.
- Version sans dependances frontend pour demarrer rapidement.
- Base SQLite locale branchee via une API Python legere.
- Les objectifs KPI, droits par profil, affectations utilisateur, formulaires Kobo actifs et rapports generes sont persistables dans SQLite.
- Page de connexion locale avec mots de passe hashes, session utilisateur, profil et acces par pole.

## Prochaines etapes conseillees

1. Transformer ce prototype en application React/Next.js.
2. Migrer l'API locale vers FastAPI ou Node.js pour une exploitation multi-utilisateur.
3. Migrer SQLite vers PostgreSQL : filiales, directions, poles, KPIs, soumissions Kobo, alertes, plans d'action.
4. Brancher KoboToolbox via API ou webhook.
5. Ajouter authentification, roles RBAC et audit trail complet.
6. Generer les rapports reels Word/PDF/PowerPoint/Excel a partir des donnees consolidees par pole et periodicite.
