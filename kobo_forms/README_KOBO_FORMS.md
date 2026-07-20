# Modeles KoboCollect PMS GMC

Ce dossier contient les deux modeles XLSForm a importer dans KoboToolbox.

## 1. Formulaire KPI et formules

Fichier corrige a importer : `PMS_GMC_Formulaire_1_Referentiel_KPI_Formules_2026_corrige_pays_20260720.xlsx`

UID Kobo publie : `agJCJ2VqwMGNk586NHJ39W`

Ce formulaire sert a declarer le referentiel KPI :

- pays / filiale d'application ;
- pole rattache ;
- ID KPI ;
- intitule et definition ;
- formule de calcul ;
- valeur cible / objectif ;
- unite, frequence, responsable et validation.

Ce formulaire alimente la source `KPI et formules` dans `Administration > KoboCollecte`.

## 2. Formulaire donnees de calcul journalieres

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
4. Importer le formulaire 2, puis le publier.
5. Dans la plateforme, aller dans `Administration > KoboCollecte`.
6. Verifier que les UID preconfigures sont bien affiches.
7. Pour automatiser, configurer le token API Kobo dans Render avec la variable secrete `PMS_KOBO_API_TOKEN`.
8. Sinon, renseigner le token dans l'interface et cliquer sur `Synchroniser depuis Kobo`.

Important : dans le formulaire 1, choisir `Groupe` quand un KPI est commun a toutes les filiales. Dans le formulaire 2, le `pays / filiale`, l'`ID KPI` et le `pole` doivent correspondre au formulaire 1. L'`element de calcul` doit reprendre le meme libelle que celui utilise dans la formule.
