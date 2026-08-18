# LagoonWatcher

Mini application perso pour noter chaque jour **les calories, le poids, l'activité, l'alcool et l'humeur**, et voir ce que ça donne sur la durée.

Pas de compte, pas de serveur, pas de dépendance : une page web statique qui stocke tout dans le navigateur et fonctionne hors ligne.

## Utilisation

**Sur l'ordinateur** — un serveur local suffit (les modules ES et le service worker ont besoin de `http://`, pas de `file://`) :

```bash
npm run serve      # puis ouvrir http://localhost:8080
```

**Sur le téléphone** — publiez le dossier sur GitHub Pages (`Settings → Pages → Deploy from a branch`, dossier `/`), ouvrez l'URL, puis « Ajouter à l'écran d'accueil ». L'appli s'installe comme une application et s'ouvre sans réseau.

## Les quatre écrans

| Écran | À quoi il sert |
|---|---|
| **Jour** | La saisie. Une carte par métrique, avec des raccourcis (+400 kcal, 45 min, −/+ un verre, 5 humeurs). Chaque intitulé rappelle où on en est : dernière pesée, moyenne 7 jours, total de la semaine. |
| **Bilan** | Poids en chiffre phare avec sa tendance sur 7 jours, quatre tuiles de synthèse, puis un graphique par métrique. La période (7 j / 30 j / 90 j / 1 an) s'applique à tout l'écran. |
| **Journal** | Tout l'historique en tableau. Une date se touche pour revenir la corriger. |
| **Réglages** | Objectifs, thème, export / import, suppression. |

Détails qui comptent à l'usage :

- **La saisie est enregistrée au fil de la frappe** ; le bouton *Enregistrer* est là pour la tranquillité, pas par obligation.
- **Une journée à zéro n'est pas une journée vide.** « 0 verre » et « repos » sont des informations : elles comptent dans les séries de jours sans alcool et dans les jours actifs. Un jour non saisi, lui, casse la série — on ne peut pas créditer une journée dont on ne sait rien.
- **On peut revenir en arrière** avec les flèches ‹ › ou le sélecteur de date (double-clic sur le libellé pour revenir à aujourd'hui).
- **Le poids se lit en tendance.** La variation d'un jour à l'autre, c'est surtout de l'eau : le bilan compare deux moyennes de 7 jours et le graphique superpose une moyenne glissante.
- **Les liens entre métriques** (alcool ↔ humeur, activité ↔ humeur…) n'apparaissent qu'à partir de 8 journées croisées, avec le coefficient et le nombre de jours. C'est une coïncidence mesurée, pas une explication.

## Vos données restent chez vous

Tout est dans le `localStorage` du navigateur, sur l'appareil. Rien n'est envoyé nulle part — il n'y a aucun serveur à qui envoyer quoi que ce soit.

La contrepartie : **vider les données du navigateur efface le suivi**, et un autre appareil ou un autre navigateur repart de zéro. D'où l'export dans les réglages :

- **JSON** — la sauvegarde complète (journées + objectifs), réimportable telle quelle.
- **CSV** — séparateur `;`, s'ouvre directement dans un tableur.

L'import accepte les deux formats et fusionne : les journées déjà présentes sont remplacées, les autres ajoutées. Il demande confirmation en annonçant le nombre de journées concernées.

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
src/charts.js              graphiques SVG (ligne, colonnes, points) + survol
src/app.js                 câblage de l'interface
sw.js, manifest.webmanifest  installation et fonctionnement hors ligne
scripts/build-solo.mjs     assemblage de la version en un seul fichier
tests/model.test.js        20 tests sur le modèle
```

Les calculs sont séparés de l'affichage : `model.js` et `dates.js` ne touchent ni au DOM ni au stockage, ce qui rend les tests directs (`node --test`). Les graphiques sont dessinés à la main en SVG — une seule série par graphique, palette validée en clair comme en sombre, étiquetage sélectif, et le Journal sert de vue tableau équivalente.

Stockage versionné sous la clé `lagoonwatcher.v1` : les données illisibles ou hors bornes sont ignorées au chargement plutôt que de faire planter l'appli.

## Bon à savoir

C'est un carnet de suivi personnel, pas un outil médical : aucun calcul de besoins caloriques, aucun conseil, aucun seuil de santé. Les objectifs sont ceux que vous saisissez — la seule valeur par défaut empruntée à une recommandation publique est les 150 min d'activité par semaine de l'OMS, modifiable comme le reste.
