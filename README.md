# Palladium Africa Hub central - Prototype web

Premiere base de developpement pour la tour de controle des performances Groupe de Palladium Africa.

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

Note importante : l'offre gratuite convient pour une demonstration externe. En local, la base SQLite est creee automatiquement au premier demarrage si elle n'existe pas. Pour conserver les donnees en production, configurer une base PostgreSQL et ajouter son URL dans Render via `DATABASE_URL` ou `PMS_DATABASE_URL`. Les mots de passe initiaux peuvent etre changes par variables d'environnement : `PMS_ADMIN_PASSWORD` et `PMS_DEFAULT_USER_PASSWORD`. Pour une exploitation officielle, il faudra aussi securiser les secrets d'import, renforcer les mots de passe et prevoir les sauvegardes.

## Base de donnees de production

La plateforme sait maintenant fonctionner avec deux modes :

- SQLite local : aucune configuration supplementaire, utile pour tester.
- PostgreSQL production : ajouter `DATABASE_URL=postgresql://...` ou `PMS_DATABASE_URL=postgresql://...`.

Au demarrage, `start.py` initialise les tables et les donnees de reference si necessaire. L'API `/api/health` indique le backend actif (`sqlite` ou `postgresql`).

## Ouvrir le prototype statique

Ouvrir le fichier suivant dans un navigateur :

```text
C:\Users\dquin\Documents\developpement Web\pms-gmc-platform\index.html
```

## Collecte interne et imports historiques

La source primaire des donnees est maintenant la zone **Collecte de donnees** de la plateforme. Les responsables y renseignent directement :

- le referentiel KPI et les formules ;
- les objectifs mensuels ;
- les donnees realisees et les elements de calcul.

Des modeles historiques XLSForm restent disponibles dans `kobo_forms/` uniquement pour les reprises ou controles d'anciens fichiers :

- `PMS_GMC_Formulaire_1_Referentiel_KPI_Formules_2026_corrige_pays_20260720.xlsx` pour le referentiel KPI et les formules ;
- `PMS_GMC_Formulaire_Objectifs_Mensuels_2026.xlsx` pour les objectifs mensuels officiels ;
- `PMS_GMC_Formulaire_2_Donnees_Calcul_Journalieres_2026.xlsx` pour les donnees brutes journalieres de calcul.

La logique PMS distingue trois sources : `KPI et formules`, `Objectifs mensuels` et `Elements de calcul`.

Le moteur PMS rapproche automatiquement les trois sources par `pays / filiale + pole + ID KPI officiel + periode`, applique la formule du catalogue, calcule l'objectif a date a partir de l'objectif mensuel, puis alimente le tableau de bord et l'onglet `Suivi par pole`.

Les objectifs mensuels et les donnees de calcul dont l'ID KPI n'existe pas dans le referentiel sont signales comme ecarts de rapprochement. Si les donnees realisees existent mais que l'objectif mensuel manque, le KPI reste calcule mais son statut reste en attente d'objectif au lieu d'etre classe rouge a tort.

Les anciennes variables d'import externe sont conservees en code uniquement pour compatibilite technique legacy. Elles ne constituent plus le parcours utilisateur principal.

## Contenu de cette version

- Tableau de bord groupe COMEX.
- Calendrier global type Power BI pour filtrer les periodes de suivi et de reporting.
- Collecte interne dans la plateforme.
- Pipeline collecte vers PMS : reception, controle, mapping, calcul KPI et publication.
- File de validation des anomalies avant integration.
- Referentiel KPI.
- Centre d'alertes.
- Plans d'action SMART.
- Amelioration continue.
- Module pertes CA horaire.
- Suivi de performance par pole avec checklist de publication.
- Reporting periodique par pole : hebdomadaire, mensuel, trimestriel, semestriel et annuel.
- Historique des rapports, commentaires responsables, validation N+1 et exports JSON/CSV.
- Administration et droits d'acces par utilisateur, pays / filiale, pole et profil.

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
database/schema.sql     Schema relationnel compatible SQLite/PostgreSQL
database/db.py          Couche de connexion SQLite/PostgreSQL
database/init_database.py Script de creation et d'alimentation de la base
database/pms_gmc.sqlite Base de donnees locale generee
```

## Principes integres

- La collecte interne Hub central est la source primaire des donnees.
- L'objectif principal est le suivi des performances par pole et la production de rapports periodiques.
- Chaque rapport doit consolider KPI, donnees collectees, alertes RAG, commentaires, plans d'action et validation N+1.
- La file de validation bloque les donnees douteuses avant calcul et publication.
- Les exports du prototype produisent des fichiers locaux JSON ou CSV pour simuler les livrables.
- Palette Palladium/GMC : bleu `#1F3864`, dore `#D6A838`, bleu secondaire `#2E75B6`.
- RAG reserve aux statuts KPI et alertes.
- Version sans dependances frontend pour demarrer rapidement.
- Base locale SQLite et base production PostgreSQL branchees via une API Python legere.
- Les objectifs KPI, droits par profil, affectations utilisateur, sources de collecte actives et rapports generes sont persistables en base.
- Page de connexion locale avec mots de passe hashes, session utilisateur, profil et acces par pole.

## Prochaines etapes conseillees

1. Transformer ce prototype en application React/Next.js.
2. Migrer l'API locale vers FastAPI ou Node.js pour une exploitation multi-utilisateur.
3. Brancher une base PostgreSQL durable en production puis mettre en place les sauvegardes.
4. Conserver l'import externe uniquement en appoint si necessaire.
5. Ajouter authentification, roles RBAC et audit trail complet.
6. Generer les rapports reels Word/PDF/PowerPoint/Excel a partir des donnees consolidees par pole et periodicite.
