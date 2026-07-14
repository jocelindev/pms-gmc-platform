# Base de donnees PMS GMC Group

Cette base SQLite sert de premiere couche de persistance pour la plateforme PMS.

## Fichiers

```text
database/schema.sql          Schema relationnel
database/init_database.py    Script d'initialisation et de seed
database/pms_gmc.sqlite      Base SQLite locale generee
```

## Reinitialiser la base

Depuis le dossier `pms-gmc-platform` :

```powershell
python database/init_database.py --reset
```

Le script lit les donnees deja presentes dans `scripts/data.js` puis alimente les tables principales.

## Tables principales

- `users` : responsables, managers, analystes et administrateurs.
- `profiles` : Administrateur, Direction, Manager / Responsable, Analyste BI.
- `permissions` et `profile_permissions` : matrice des droits d'acces.
- `poles` : poles et directions de suivi KPI.
- `user_access` : affectation utilisateur par utilisateur, avec pole, profil et dashboard autorise.
- `kpis` : catalogue KPI par pole.
- `kpi_objectives` : objectifs KPI alimentes par formulaire KoboCollect.
- `kobo_forms` et `kobo_form_fields` : formulaires et mapping KoboCollect.
- `kobo_submissions` : donnees collectees via KoboCollect.
- `validation_queue` : anomalies et controles avant publication.
- `reports` : rapports hebdomadaires, mensuels, trimestriels, etc.
- `notifications` : alertes et relances.
- `audit_logs` : historique des actions.

## Vues utiles

- `v_user_access_details` : liste lisible des affectations utilisateur.
- `v_profile_permissions_matrix` : droits par profil.
- `v_kpi_dashboard_by_pole` : resume des KPI par pole.

## Prochaine etape

Brancher l'interface web sur une API backend qui lira et ecrira dans cette base.
Pour une mise en production, la meme structure peut etre migree vers PostgreSQL.
