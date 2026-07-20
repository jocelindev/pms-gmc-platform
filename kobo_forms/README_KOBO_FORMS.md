# Modeles KoboCollect PMS GMC

Ce dossier contient les modeles XLSForm a importer dans KoboToolbox.

## 1. Formulaire KPI et formules

Fichier corrige a importer : `PMS_GMC_Formulaire_1_Referentiel_KPI_Formules_2026_corrige_pays_20260720.xlsx`

UID Kobo publie : `agJCJ2VqwMGNk586NHJ39W`

Ce formulaire sert a declarer le referentiel KPI :

- pays / filiale d'application ;
- pole rattache ;
- ID KPI ;
- intitule et definition ;
- formule de calcul ;
- unite, frequence, responsable et validation.

Ce formulaire alimente la source `KPI et formules` dans `Administration > KoboCollecte`.

## 2. Formulaire objectifs mensuels

Fichier : `PMS_GMC_Formulaire_Objectifs_Mensuels_2026.xlsx`

Ce formulaire sert a declarer les cibles officielles du mois :

- pays / filiale ;
- pole ;
- ID KPI ;
- periode objectif au format `AAAA-MM`, par exemple `2026-07` ;
- objectif mensuel ;
- unite ;
- mode de repartition : automatique, fixe, prorata jours ou hebdomadaire ;
- validation hierarchique.

La plateforme utilise ce formulaire pour calculer automatiquement l'objectif a date et le `Vs Target`.

## 3. Formulaire donnees de calcul journalieres

Fichier : `PMS_GMC_Formulaire_2_Donnees_Calcul_Journalieres_2026.xlsx`

UID Kobo publie : `aZ5JcFjcL9YvnQozqHWrqN`

Ce formulaire sert a collecter les donnees brutes necessaires au calcul :

- date de collecte ;
- pays / filiale ;
- pole ;
- ID KPI ;
- element de calcul ;
- valeur collectee ;
- validation et preuve optionnelle.

La plateforme rapproche ces donnees avec le referentiel par `pays / filiale + pole + ID KPI + date`.
Pour chaque mois, le PMS calcule aussi le cumul du 1er jour du mois jusqu'a la date selectionnee.

## Utilisation dans KoboToolbox

1. Aller dans KoboToolbox.
2. Creer un nouveau projet par import XLSForm.
3. Importer le formulaire 1, puis le publier.
4. Importer le formulaire Objectifs mensuels, puis le publier.
5. Importer le formulaire Donnees de calcul, puis le publier.
6. Dans la plateforme, aller dans `Administration > KoboCollecte`.
7. Verifier les UID du referentiel et des donnees de calcul, puis renseigner l'UID du formulaire Objectifs mensuels.
8. Pour automatiser, configurer le token API Kobo dans Render avec la variable secrete `PMS_KOBO_API_TOKEN`.
9. Sinon, renseigner le token dans l'interface et cliquer sur `Synchroniser depuis Kobo`.

Important : dans le formulaire 1, choisir `Groupe` quand un KPI est commun a toutes les filiales. Dans le formulaire Objectifs et dans le formulaire Donnees, le `pays / filiale`, l'`ID KPI`, le `pole` et le `mois` doivent correspondre au referentiel. L'`element de calcul` doit reprendre le meme libelle que celui utilise dans la formule.
