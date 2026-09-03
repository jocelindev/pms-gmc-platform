# Base de donnees Palladium Africa Hub central

La plateforme utilise une couche de persistance hybride :

- en local, elle utilise `database/pms_gmc.sqlite` ;
- en production, elle utilise PostgreSQL automatiquement si `DATABASE_URL` ou `PMS_DATABASE_URL` est defini.

## Fichiers

```text
database/schema.sql          Schema relationnel
database/db.py              Connexion SQLite/PostgreSQL
database/init_database.py    Script d'initialisation et de seed
database/pms_gmc.sqlite      Base SQLite locale generee
```

## Reinitialiser la base

Depuis le dossier `pms-gmc-platform` :

```powershell
python database/init_database.py --reset
```

Le script lit les donnees deja presentes dans `scripts/data.js` puis alimente les tables principales.

## Connecter PostgreSQL

Sur Render ou tout autre hebergeur, ajouter une variable d'environnement :

```text
DATABASE_URL=postgresql://utilisateur:mot_de_passe@hote:5432/base
```

Au demarrage, `start.py` initialise les tables si necessaire puis lance le serveur. SQLite reste disponible pour le developpement local.

## Tables principales

- `users` : responsables, managers, analystes et administrateurs.
- `profiles` : Administrateur, PDG / Management, Direction, Manager / Responsable, Analyste BI.
- `permissions` et `profile_permissions` : matrice des droits d'acces, dont le droit `management` pour la vue PDG.
- `poles` : poles et directions de suivi KPI.
- `user_access` : affectation utilisateur par utilisateur, avec pole, profil et dashboard autorise.
- `kpis` : catalogue KPI par pole.
- `kpi_objectives` : objectifs KPI alimentes par la collecte integree ou KoboCollect.
- `kobo_forms` et `kobo_form_fields` : formulaires et mapping des sources de collecte.
- `kobo_submissions` : donnees collectees via la plateforme ou KoboCollect.
- `validation_queue` : anomalies et controles avant publication.
- `reports` : rapports hebdomadaires, mensuels, trimestriels, etc.
- `notifications` : alertes et relances.
- `audit_logs` : historique des actions.

## Vues utiles

- `v_user_access_details` : liste lisible des affectations utilisateur.
- `v_profile_permissions_matrix` : droits par profil.
- `v_kpi_dashboard_by_pole` : resume des KPI par pole.

## Production

Pour une base durable, utiliser PostgreSQL. Le fichier SQLite local reste utile pour tester sans impacter les donnees de production.
