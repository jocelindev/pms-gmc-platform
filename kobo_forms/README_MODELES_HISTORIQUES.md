# Modeles historiques de collecte PMS GMC

Ce dossier conserve les anciens modeles XLSForm pour reprise, controle ou import ponctuel d'archives. La saisie active se fait maintenant dans la zone **Collecte de donnees** de la plateforme.

## 1. Source referentiel KPI et formules

Fichier historique : `PMS_GMC_Formulaire_1_Referentiel_KPI_Formules_2026_corrige_pays_20260720.xlsx`

Cette source permettait de declarer le referentiel KPI :

- pays / filiale d'application ;
- pole rattache ;
- ID KPI officiel ;
- intitule et definition ;
- formule de calcul ;
- unite, frequence, responsable et validation.

Dans la plateforme, ces informations sont maintenant saisies dans **Collecte de donnees > Referentiel KPI**.

## 2. Source objectifs mensuels

Fichier historique : `PMS_GMC_Formulaire_Objectifs_Mensuels_2026.xlsx`

Cette source permettait de declarer les cibles officielles du mois :

- pays / filiale ;
- pole ;
- ID KPI officiel ;
- periode objectif au format `AAAA-MM`, par exemple `2026-07` ;
- objectif mensuel ;
- unite ;
- mode de repartition : automatique, fixe, prorata jours ou hebdomadaire ;
- validation hierarchique.

Dans la plateforme, ces informations sont maintenant saisies dans **Collecte de donnees > Objectifs mensuels**.

## 3. Source donnees de calcul journalieres

Fichier historique : `PMS_GMC_Formulaire_2_Donnees_Calcul_Journalieres_2026.xlsx`

Cette source permettait de collecter les donnees brutes necessaires au calcul :

- date de collecte ;
- pays / filiale ;
- pole ;
- ID KPI officiel ;
- element de calcul ;
- valeur collectee ;
- validation et preuve optionnelle.

Dans la plateforme, ces informations sont maintenant saisies dans **Collecte de donnees > Donnees realisees**. Les donnees peuvent etre saisies soit en taux direct, soit avec un a trois elements de calcul.

## Regle commune ID KPI

Les trois sources utilisent le meme champ `ID KPI officiel`, propose en liste recherchable `KPI-001` a `KPI-200`.
Les KPI deja presents dans le catalogue affichent aussi l'intitule, la formule de calcul et la cible. Exemple : `KPI-001 - Chiffre d'affaires | Calcul: Volume produit x Prix unitaire HT | Cible: 100`.

- Dans le referentiel, cet ID declare le KPI officiel et sa formule.
- Dans les objectifs mensuels, cet ID rattache la cible mensuelle au KPI officiel.
- Dans les donnees de calcul, cet ID rattache les valeurs collectees au KPI a calculer.
- Les IDs apres les KPI deja catalogues sont des reserves pour les nouveaux KPI. Ils ne deviennent valides dans la plateforme qu'apres declaration dans le referentiel.

Si un objectif mensuel ou une donnee de calcul utilise un ID qui n'existe pas dans le referentiel, la plateforme le signale comme ecart de rapprochement au lieu de l'afficher comme KPI valide.

## Utilisation actuelle

1. Utiliser d'abord la zone **Collecte de donnees** pour saisir ou corriger les informations.
2. Consulter le referentiel existant avant d'ajouter un nouveau KPI.
3. Garder le meme `pays / filiale`, `pole`, `ID KPI officiel` et `mois` entre referentiel, objectifs et donnees de calcul.
4. Utiliser ces fichiers uniquement pour reprise historique ou controle ponctuel.

Important : choisir `Groupe` quand un KPI est commun a toutes les filiales. Dans les objectifs et les donnees de calcul, le `pays / filiale`, l'`ID KPI officiel`, le `pole` et le `mois` doivent correspondre au referentiel. L'`element de calcul` doit reprendre le meme libelle que celui utilise dans la formule.
