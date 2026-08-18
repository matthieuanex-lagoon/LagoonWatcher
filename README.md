# LagoonWatcher

Mini application perso pour noter chaque jour **les calories, le poids, l'activité, l'alcool, le café et l'humeur**, et voir ce que ça donne sur la durée.

Pas de compte, pas de serveur, pas de dépendance : une page web statique qui stocke tout dans le navigateur et fonctionne hors ligne.

## Utilisation

**Sur l'ordinateur** — un serveur local suffit (les modules ES et le service worker ont besoin de `http://`, pas de `file://`) :

```bash
npm run serve      # puis ouvrir http://localhost:8080
```

**Sur le téléphone** — publiez le dossier sur GitHub Pages (`Settings → Pages → Deploy from a branch`, branche principale, dossier `/`), ouvrez l'URL, puis « Ajouter à l'écran d'accueil ». L'appli s'installe comme une application et s'ouvre sans réseau.

> GitHub Pages sur un dépôt **privé** demande un compte payant. Sur un compte
> gratuit, il faut passer le dépôt en public : cela publie le code, jamais les
> données de suivi — elles restent dans le navigateur et ne sont dans aucun
> fichier du dépôt.

## Les quatre écrans

| Écran | À quoi il sert |
|---|---|
| **Jour** | La saisie. Une carte par métrique, avec des raccourcis (+400 kcal, 45 min, −/+ un verre ou un café, 5 humeurs). Chaque intitulé rappelle où on en est : dernière pesée, moyenne 7 jours, total de la semaine. |
| **Bilan** | Poids en chiffre phare avec sa tendance sur 7 jours, quatre tuiles de synthèse, puis un graphique par métrique. La période (7 j / 30 j / 90 j / 1 an) s'applique à tout l'écran. |
| **Journal** | Tout l'historique en tableau. Une date se touche pour revenir la corriger. |
| **Réglages** | Objectifs, thème, export / import, suppression. |

Détails qui comptent à l'usage :

- **La saisie est enregistrée au fil de la frappe** ; le bouton *Enregistrer* est là pour la tranquillité, pas par obligation.
- **Une journée à zéro n'est pas une journée vide.** « 0 verre », « 0 café » et « repos » sont des informations : elles comptent dans les séries de jours sans alcool et dans les jours actifs. Un jour non saisi, lui, casse la série — on ne peut pas créditer une journée dont on ne sait rien.
- **On peut revenir en arrière** avec les flèches ‹ › ou le sélecteur de date (double-clic sur le libellé pour revenir à aujourd'hui).
- **Le poids se lit en tendance.** La variation d'un jour à l'autre, c'est surtout de l'eau : le bilan compare deux moyennes de 7 jours et le graphique superpose une moyenne glissante.
- **Les liens entre métriques** (alcool ↔ humeur, café ↔ humeur, activité ↔ humeur…) n'apparaissent qu'à partir de 8 journées croisées, avec le coefficient et le nombre de jours. C'est une coïncidence mesurée, pas une explication.

## Vos données restent chez vous

Tout est dans le `localStorage` du navigateur, sur l'appareil. Rien n'est envoyé nulle part — il n'y a aucun serveur à qui envoyer quoi que ce soit.

La contrepartie : **vider les données du navigateur efface le suivi**, et un autre appareil ou un autre navigateur repart de zéro. D'où l'export dans les réglages :

- **JSON** — la sauvegarde complète (journées + objectifs), réimportable telle quelle.
- **CSV** — séparateur `;`, s'ouvre directement dans un tableur.

L'import reconnaît les colonnes par leur nom : un export réalisé avant l'ajout
d'une métrique reste importable, la colonne manquante vaut simplement « non
renseigné ».

L'import accepte les deux formats et fusionne : les journées déjà présentes sont remplacées, les autres ajoutées. Il demande confirmation en annonçant le nombre de journées concernées.

## Sauvegarde en ligne (optionnelle)

Pour retrouver son suivi d'un appareil à l'autre, l'appli peut recopier ses journées dans un **gist privé** du compte GitHub de l'utilisateur. Il n'y a rien à héberger : le navigateur parle directement à l'API GitHub.

Mise en route, une fois par appareil : créer une clé sur [github.com → jetons](https://github.com/settings/tokens/new?scopes=gist&description=LagoonWatcher) en cochant **uniquement `gist`**, puis la coller dans `Réglages → Sauvegarde en ligne`. Le premier appareil crée le gist, les suivants le retrouvent par sa description — il n'y en a jamais deux.

Ensuite, c'est automatique :

| Moment | Ce qui se passe |
|---|---|
| Quelques secondes après une saisie | envoi |
| En quittant l'appli (page masquée) | envoi immédiat de ce qui restait |
| À l'ouverture | récupération |
| Au retour dans l'appli (premier plan) | récupération |
| Toutes les 5 minutes, appli à l'écran | récupération |
| Au retour du réseau | récupération puis envoi |

Le rythme de 5 minutes ne s'applique que lorsque la page est visible : en arrière-plan, l'appli n'interroge rien et ne réveille pas la radio du téléphone.

Ce qui rend la chose sûre à l'usage :

- **La fusion se fait journée par journée, la plus récemment modifiée gagne.** Chaque entrée porte son horodatage de modification, donc une saisie faite hors ligne sur un téléphone n'est pas écrasée par une récupération. Rien n'est jamais remplacé en bloc.
- **Activer la sauvegarde sur un appareil déjà rempli récupère avant d'envoyer**, pour ne pas écraser l'historique venu d'ailleurs.
- **La clé vit dans le stockage local, sous une clé distincte des données** : un export JSON ou CSV ne l'emporte jamais avec lui. Elle n'autorise que l'accès aux gists — ni au code, ni au reste du compte.
- **Une coupure réseau ne perd rien** : les données restent sur l'appareil et le prochain envoi rattrape.
- **Effacer une journée se propage.** La suppression laisse une trace datée, si bien que l'appareil d'en face ne la renvoie pas au prochain échange. Ressaisir la journée plus tard annule la trace : c'est toujours la dernière action qui gagne. Ces traces sont oubliées au bout d'un an.
- **Une récupération n'écrase jamais une saisie en cours** : tant que le curseur est dans un champ, la récupération automatique repasse plus tard ; et une modification encore dans son délai d'attente est validée avant la fusion, pour qu'elle porte son horodatage et gagne l'arbitrage.

À savoir : un gist privé n'est pas chiffré. Il est invisible pour les autres, mais lisible par GitHub. Pour de la donnée de santé que l'on préfère illisible côté serveur, il faudrait ajouter un chiffrement par mot de passe avant l'envoi.

## Développement

```bash
npm test           # tests unitaires du modèle (node:test, aucune dépendance)
npm run build:solo # regroupe tout dans lagoonwatcher.solo.html (un seul fichier)
```

`build:solo` produit une version autonome — styles et modules intégrés, aucune
ressource externe — pratique pour s'envoyer l'appli par mail, l'ouvrir depuis un
fichier local ou la publier ailleurs. Le script échoue plutôt que de produire un
fichier douteux : il vérifie qu'aucun `import` ne subsiste et qu'aucun nom de
premier niveau n'entre en collision entre les modules.

```
index.html                 structure des quatre écrans
assets/styles.css          styles et couleurs (thème clair / sombre)
src/dates.js               manipulation des jours en ISO local
src/model.js               modèle, agrégats, corrélations, CSV — fonctions pures
src/store.js               lecture / écriture du localStorage
src/sync.js                sauvegarde en ligne dans un gist GitHub privé
src/charts.js              graphiques SVG (ligne, colonnes, points) + survol
src/app.js                 câblage de l'interface
sw.js, manifest.webmanifest  installation et fonctionnement hors ligne
scripts/build-solo.mjs     assemblage de la version en un seul fichier
tests/model.test.js        32 tests sur le modèle
```

Les calculs sont séparés de l'affichage : `model.js` et `dates.js` ne touchent ni au DOM ni au stockage, ce qui rend les tests directs (`node --test`). Les graphiques sont dessinés à la main en SVG — une seule série par graphique, palette validée en clair comme en sombre, étiquetage sélectif, et le Journal sert de vue tableau équivalente.

Le module d'assemblage refuse un import de namespace (`import * as x`) : la mise à plat retire les imports, et les appels `x.foo()` n'auraient plus d'objet — mieux vaut échouer au build qu'à l'exécution.

Stockage versionné sous la clé `lagoonwatcher.v1` : les données illisibles ou hors bornes sont ignorées au chargement plutôt que de faire planter l'appli.

## Bon à savoir

C'est un carnet de suivi personnel, pas un outil médical : aucun calcul de besoins caloriques, aucun conseil, aucun seuil de santé. Les objectifs sont ceux que vous saisissez — les seules valeurs par défaut sont des repères usuels (150 min d'activité par semaine, d'après l'OMS), tous modifiables.
