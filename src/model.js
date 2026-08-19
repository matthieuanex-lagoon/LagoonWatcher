// Modèle de données et calculs. Fonctions pures : aucune touche au DOM ni au
// localStorage, ce qui les rend testables directement avec `node --test`.

import { addDays, daySpan, daysBetween, startOfWeek, todayISO } from './dates.js';

/** Les six métriques suivies, dans l'ordre d'affichage. */
export const METRIQUES = ['poids', 'calories', 'activite', 'alcool', 'cafe', 'humeur', 'stress'];

/**
 * Types d'activité et leur intensité (MET, « Compendium of Physical
 * Activities »), qui sert à estimer les calories. Ce sont des valeurs
 * moyennes : une estimation reste une estimation, et l'appli la présente
 * comme telle.
 */
export const TYPES_ACTIVITE = [
  { nom: 'Marche', met: 3.5 },
  { nom: 'Course', met: 9 },
  { nom: 'Vélo', met: 7.5 },
  { nom: 'Natation', met: 7 },
  { nom: 'Muscu', met: 5 },
  { nom: 'Yoga', met: 3 },
  { nom: 'Sport collectif', met: 7 },
  { nom: 'Autre', met: 5 },
];

const MET_DEFAUT = 5;

/**
 * Estimation des calories d'une séance : MET × poids × durée. Sans poids
 * connu, on ne devine pas — mieux vaut un champ vide qu'un chiffre inventé.
 */
export function estimerCalories(type, minutes, poids) {
  if (!(minutes > 0) || !(poids > 0)) return null;
  const met = TYPES_ACTIVITE.find((t) => t.nom === type)?.met ?? MET_DEFAUT;
  return Math.round(met * poids * (minutes / 60));
}

export const HUMEURS = [
  { valeur: 1, emoji: '😞', label: 'Très bas' },
  { valeur: 2, emoji: '😕', label: 'Bas' },
  { valeur: 3, emoji: '😐', label: 'Neutre' },
  { valeur: 4, emoji: '🙂', label: 'Bien' },
  { valeur: 5, emoji: '😄', label: 'Très bien' },
];

/**
 * Le stress se lit à l'envers de l'humeur : 5 y est le plus mauvais score,
 * là où 5 est le meilleur pour l'humeur. Tout ce qui interprète ces échelles
 * doit en tenir compte — d'où deux listes séparées plutôt qu'une réutilisée.
 */
export const STRESS = [
  { valeur: 1, emoji: '😌', label: 'Serein' },
  { valeur: 2, emoji: '🙂', label: 'Léger' },
  { valeur: 3, emoji: '😕', label: 'Modéré' },
  { valeur: 4, emoji: '😣', label: 'Tendu' },
  { valeur: 5, emoji: '😫', label: 'Très tendu' },
];

export const OBJECTIFS_DEFAUT = {
  calories: 2200, // kcal / jour
  poids: null, // kg visés, optionnel
  activite: 150, // minutes / semaine (recommandation OMS)
  alcool: 10, // verres / semaine maximum
  cafe: 3, // tasses / jour maximum
};

/** Une journée vide : toutes les métriques sont optionnelles. */
export function entreeVide(date) {
  return {
    date,
    poids: null,
    calories: null,
    activites: [],
    activite: null,
    typeActivite: '',
    sportKcal: null,
    alcool: null,
    cafe: null,
    humeur: null,
    stress: null,
    note: '',
    maj: null,
  };
}

/**
 * Une valeur hors bornes est rejetée (`null`), pas ramenée dans l'intervalle :
 * corriger « 7 » en « 20 kg » pendant la frappe inventerait une donnée que
 * personne n'a saisie.
 */
function nombreOuNull(v, { min = 0, max = Infinity } = {}) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Nettoie une entrée venant d'un formulaire ou d'un import. */
export function normaliserEntree(brut) {
  const date = String(brut?.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const humeur = nombreOuNull(brut.humeur, { min: 1, max: 5 });
  const stress = nombreOuNull(brut.stress, { min: 1, max: 5 });
  return {
    date,
    poids: nombreOuNull(brut.poids, { min: 20, max: 400 }),
    calories: nombreOuNull(brut.calories, { min: 0, max: 20000 }),
    ...activiteNormalisee(brut),
    alcool: nombreOuNull(brut.alcool, { min: 0, max: 60 }),
    cafe: nombreOuNull(brut.cafe, { min: 0, max: 30 }),
    humeur: humeur === null ? null : Math.round(humeur),
    stress: stress === null ? null : Math.round(stress),
    note: String(brut.note ?? '').slice(0, 2000),
    // Horodatage de la dernière modification : sert d'arbitre quand deux
    // appareils ont touché la même journée. Jamais inventé ici — c'est
    // l'appelant qui le pose au moment d'enregistrer.
    maj: horodatageValide(brut.maj) ? brut.maj : null,
  };
}

/**
 * Une journée peut porter plusieurs séances. Les totaux (`activite`,
 * `sportKcal`) sont recalculés ici à partir de la liste : dérivés d'une
 * source unique, ils ne peuvent pas diverger. `typeActivite` reste rempli
 * pour l'affichage compact et les anciens exports.
 */
function activiteNormalisee(brut) {
  const liste = Array.isArray(brut.activites)
    ? brut.activites
    : // Format d'avant : une seule séance par journée.
      brut.activite !== null && brut.activite !== undefined && brut.activite !== ''
      ? [{ type: brut.typeActivite, minutes: brut.activite, calories: null, estimee: false }]
      : [];

  const activites = liste
    .map((a) => ({
      type: String(a?.type ?? '').slice(0, 40),
      minutes: nombreOuNull(a?.minutes, { min: 0, max: 1440 }),
      calories: nombreOuNull(a?.calories, { min: 0, max: 20000 }),
      estimee: Boolean(a?.estimee),
    }))
    // Une ligne sans durée ni calories ni type n'est qu'un formulaire à moitié
    // rempli : on ne la garde pas.
    .filter((a) => a.minutes !== null || a.calories !== null || a.type);

  const minutes = activites.map((a) => a.minutes).filter((v) => typeof v === 'number');
  const kcal = activites.map((a) => a.calories).filter((v) => typeof v === 'number');

  return {
    activites,
    activite: minutes.length ? minutes.reduce((x, y) => x + y, 0) : null,
    typeActivite: activites.map((a) => a.type).filter(Boolean).join(' + ').slice(0, 120),
    sportKcal: kcal.length ? kcal.reduce((x, y) => x + y, 0) : null,
  };
}

function horodatageValide(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** Instant de dernière modification, comparable ; 0 si la journée n'en porte pas. */
export function instantMaj(entree) {
  return horodatageValide(entree?.maj) ? Date.parse(entree.maj) : 0;
}

/** Une entrée sans aucune donnée ne mérite pas d'être stockée. */
export function entreeVideOuPas(e) {
  return (
    e.poids === null &&
    e.calories === null &&
    e.activite === null &&
    e.activites.length === 0 &&
    e.alcool === null &&
    e.cafe === null &&
    e.humeur === null &&
    e.stress === null &&
    !e.note.trim()
  );
}

/** Entrées triées du plus ancien au plus récent. */
export function entreesTriees(entrees) {
  return Object.values(entrees).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Série continue jour par jour pour une métrique, `null` là où rien n'est saisi.
 * Les graphiques ont besoin d'une grille de temps régulière, pas d'une liste
 * de points épars — sinon deux points à trois semaines d'écart se retrouvent
 * côte à côte et le trait ment.
 */
export function serie(entrees, metrique, jours) {
  return jours.map((date) => ({
    date,
    valeur: entrees[date]?.[metrique] ?? null,
  }));
}

export function moyenne(valeurs) {
  const v = valeurs.filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function somme(valeurs) {
  const v = valeurs.filter((x) => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) : 0;
}

/**
 * Moyenne glissante centrée, en ignorant les trous. Sert de ligne de tendance
 * sur le poids, où la variation jour à jour (± 1 kg d'eau) noie le signal.
 */
export function moyenneGlissante(points, fenetre = 7) {
  const demi = Math.floor(fenetre / 2);
  return points.map((p, i) => {
    const tranche = points.slice(Math.max(0, i - demi), i + demi + 1).map((q) => q.valeur);
    return { date: p.date, valeur: moyenne(tranche) };
  });
}

/** Dernière valeur non nulle d'une métrique, avec sa date. */
export function derniereValeur(entrees, metrique) {
  const triees = entreesTriees(entrees);
  for (let i = triees.length - 1; i >= 0; i--) {
    const v = triees[i][metrique];
    if (typeof v === 'number') return { date: triees[i].date, valeur: v };
  }
  return null;
}

/**
 * Tendance du poids : on compare la moyenne des 7 derniers jours saisis à celle
 * de la fenêtre de 7 jours précédente. Plus honnête qu'une différence entre
 * deux pesées isolées.
 */
export function tendancePoids(entrees, finIso = todayISO(), fenetre = 7) {
  const recents = daySpan(addDays(finIso, -(fenetre - 1)), finIso)
    .map((d) => entrees[d]?.poids)
    .filter((v) => typeof v === 'number');
  const anterieurs = daySpan(addDays(finIso, -(2 * fenetre - 1)), addDays(finIso, -fenetre))
    .map((d) => entrees[d]?.poids)
    .filter((v) => typeof v === 'number');
  const actuel = moyenne(recents);
  const precedent = moyenne(anterieurs);
  return {
    actuel,
    precedent,
    delta: actuel !== null && precedent !== null ? actuel - precedent : null,
  };
}

/**
 * Paliers d'alerte de la saisie du jour. Trois niveaux, du plus léger au plus
 * fort : `attention`, `serieux`, `critique`. `null` quand il n'y a rien à
 * signaler — un verre à zéro ou une journée sous l'objectif.
 */
export function alerteAlcool(verres) {
  if (typeof verres !== 'number' || verres <= 0) return null;
  if (verres <= 1) return 'attention';
  if (verres <= 2) return 'serieux';
  return 'critique';
}

/**
 * L'objectif calorique est un plafond : il n'y a dépassement qu'au-dessus,
 * et un dépassement de 300 pile reste dans la catégorie « moins de 300 ».
 */
export function alerteCalories(calories, objectif, seuil = 300) {
  if (typeof calories !== 'number' || !objectif || calories <= objectif) return null;
  return calories - objectif > seuil ? 'critique' : 'serieux';
}

/** Bilan d'une période, prêt à afficher. */
export function bilan(entrees, jours, objectifs = OBJECTIFS_DEFAUT) {
  const semaines = Math.max(jours.length / 7, 1 / 7);
  const valeurs = (m) => jours.map((d) => entrees[d]?.[m] ?? null);

  const poids = valeurs('poids').filter((v) => typeof v === 'number');
  const calories = valeurs('calories').filter((v) => typeof v === 'number');
  const activite = valeurs('activite');
  const alcool = valeurs('alcool');
  const sportKcal = valeurs('sportKcal');
  const sportSaisi = sportKcal.filter((v) => typeof v === 'number');
  const cafe = valeurs('cafe');
  const cafeSaisi = cafe.filter((v) => typeof v === 'number');
  const humeur = valeurs('humeur').filter((v) => typeof v === 'number');
  const stress = valeurs('stress').filter((v) => typeof v === 'number');

  const joursAvecAlcool = alcool.filter((v) => typeof v === 'number');
  const totalAlcool = somme(alcool);

  return {
    jours: jours.length,
    joursSaisis: jours.filter((d) => entrees[d]).length,
    poids: {
      debut: poids[0] ?? null,
      fin: poids.at(-1) ?? null,
      delta: poids.length > 1 ? poids.at(-1) - poids[0] : null,
      min: poids.length ? Math.min(...poids) : null,
      max: poids.length ? Math.max(...poids) : null,
      pesees: poids.length,
    },
    calories: {
      moyenne: moyenne(calories),
      total: somme(calories),
      jours: calories.length,
      ecartObjectif:
        calories.length && objectifs.calories
          ? moyenne(calories) - objectifs.calories
          : null,
    },
    activite: {
      total: somme(activite),
      parSemaine: somme(activite) / semaines,
      joursActifs: activite.filter((v) => typeof v === 'number' && v > 0).length,
      objectifSemaine: objectifs.activite ?? null,
      kcalTotal: somme(sportKcal),
      kcalParJour: moyenne(sportSaisi),
      joursAvecKcal: sportSaisi.length,
      seances: jours.reduce((n, d) => n + (entrees[d]?.activites?.length ?? 0), 0),
    },
    alcool: {
      total: totalAlcool,
      parSemaine: totalAlcool / semaines,
      joursSecs: joursAvecAlcool.filter((v) => v === 0).length,
      joursAvecConso: joursAvecAlcool.filter((v) => v > 0).length,
      objectifSemaine: objectifs.alcool ?? null,
    },
    cafe: {
      total: somme(cafe),
      parJour: moyenne(cafeSaisi),
      jours: cafeSaisi.length,
      joursSans: cafeSaisi.filter((v) => v === 0).length,
      depassements: objectifs.cafe ? cafeSaisi.filter((v) => v > objectifs.cafe).length : 0,
      objectifJour: objectifs.cafe ?? null,
    },
    humeur: {
      moyenne: moyenne(humeur),
      jours: humeur.length,
      basse: humeur.filter((v) => v <= 2).length,
      haute: humeur.filter((v) => v >= 4).length,
    },
    // Échelle inversée : ici, « haut » veut dire mauvais.
    stress: {
      moyenne: moyenne(stress),
      jours: stress.length,
      tendues: stress.filter((v) => v >= 4).length,
      sereines: stress.filter((v) => v <= 2).length,
    },
  };
}

/**
 * Série de jours consécutifs, en remontant depuis `finIso`, où le prédicat est
 * vrai. Un jour non saisi coupe la série : on ne peut pas affirmer une réussite
 * sur une journée dont on ne sait rien.
 */
export function serieEnCours(entrees, finIso, predicat) {
  let n = 0;
  for (let d = finIso; ; d = addDays(d, -1)) {
    const e = entrees[d];
    if (!e || !predicat(e)) break;
    n++;
    if (n > 3650) break;
  }
  return n;
}

/** Agrégation par semaine ISO, du plus ancien au plus récent. */
export function parSemaine(entrees, jours) {
  const paquets = new Map();
  for (const d of jours) {
    const cle = startOfWeek(d);
    if (!paquets.has(cle)) paquets.set(cle, []);
    paquets.get(cle).push(d);
  }
  return [...paquets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([semaine, joursSemaine]) => ({
      semaine,
      jours: joursSemaine,
      calories: moyenne(joursSemaine.map((d) => entrees[d]?.calories ?? null)),
      poids: moyenne(joursSemaine.map((d) => entrees[d]?.poids ?? null)),
      activite: somme(joursSemaine.map((d) => entrees[d]?.activite ?? null)),
      alcool: somme(joursSemaine.map((d) => entrees[d]?.alcool ?? null)),
      humeur: moyenne(joursSemaine.map((d) => entrees[d]?.humeur ?? null)),
    }));
}

/**
 * Corrélation de Pearson entre deux métriques sur les jours où les deux sont
 * saisies. Renvoie `null` en dessous de 8 paires : sur moins que ça, le chiffre
 * ne veut rien dire et vaut mieux ne rien afficher.
 */
export function correlation(entrees, jours, metriqueA, metriqueB, minPaires = 8) {
  const paires = jours
    .map((d) => [entrees[d]?.[metriqueA], entrees[d]?.[metriqueB]])
    .filter(([a, b]) => typeof a === 'number' && typeof b === 'number');
  if (paires.length < minPaires) return null;
  const xs = paires.map((p) => p[0]);
  const ys = paires.map((p) => p[1]);
  const mx = moyenne(xs);
  const my = moyenne(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < paires.length; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return { r: num / Math.sqrt(dx * dy), n: paires.length };
}

/**
 * Effacer une journée doit voyager comme une modification, sinon l'appareil
 * d'en face la réenverrait au prochain échange et elle réapparaîtrait. On garde
 * donc une trace datée de la suppression — une « pierre tombale » — que la
 * fusion peut arbitrer comme le reste : c'est la plus récente qui gagne.
 */
export function marquerSupprimee(suppressions, date, quand = new Date().toISOString()) {
  return { ...suppressions, [date]: quand };
}

/** Réunit deux registres de suppressions en gardant la date la plus récente. */
export function fusionnerSuppressions(a = {}, b = {}) {
  const out = { ...a };
  for (const [date, quand] of Object.entries(b)) {
    if (!out[date] || Date.parse(quand) > Date.parse(out[date])) out[date] = quand;
  }
  return out;
}

/**
 * Retire les journées dont la suppression est postérieure à leur dernière
 * modification. Une journée ressaisie après coup est donc bien conservée : sa
 * modification est alors plus récente que la suppression.
 */
export function appliquerSuppressions(entrees, suppressions = {}) {
  const out = {};
  for (const [date, entree] of Object.entries(entrees)) {
    const efface = suppressions[date];
    if (efface && Date.parse(efface) >= instantMaj(entree)) continue;
    out[date] = entree;
  }
  return out;
}

/** Une pierre tombale ne sert plus une fois la journée oubliée partout. */
export function elaguerSuppressions(suppressions = {}, maxJours = 365) {
  const limite = Date.now() - maxJours * 86400000;
  return Object.fromEntries(
    Object.entries(suppressions).filter(([, quand]) => Date.parse(quand) >= limite),
  );
}

/** CSV (séparateur `;`, lisible tel quel par Excel en locale FR). */
export function versCSV(entrees) {
  const colonnes = ['date', 'poids_kg', 'calories_kcal', 'activite_min', 'type_activite', 'sport_kcal', 'seances', 'alcool_verres', 'cafe_tasses', 'humeur_1_5', 'stress_1_5', 'modifie_le', 'note'];
  const echapper = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lignes = entreesTriees(entrees).map((e) =>
    [e.date, e.poids, e.calories, e.activite, e.typeActivite, e.sportKcal, encoderSeances(e.activites), e.alcool, e.cafe, e.humeur, e.stress, e.maj, e.note]
      .map(echapper)
      .join(';'),
  );
  return [colonnes.join(';'), ...lignes].join('\n');
}

/** Lit un CSV produit par `versCSV` (ou compatible : mêmes colonnes, `;` ou `,`). */
export function depuisCSV(texte) {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return [];
  const sep = (lignes[0].match(/;/g)?.length ?? 0) >= (lignes[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const entete = decouper(lignes[0], sep).map((c) => c.trim().toLowerCase());
  const iDate = entete.findIndex((c) => c.startsWith('date'));
  if (iDate === -1) return [];
  const index = (prefixe) => entete.findIndex((c) => c.startsWith(prefixe));
  const cols = {
    poids: index('poids'),
    calories: index('calories'),
    activite: index('activite'),
    typeActivite: index('type'),
    seances: index('seances'),
    alcool: index('alcool'),
    cafe: index('cafe'),
    humeur: index('humeur'),
    stress: index('stress'),
    maj: index('modifie'),
    note: index('note'),
  };
  const out = [];
  for (const ligne of lignes.slice(1)) {
    const cells = decouper(ligne, sep);
    const brut = { date: cells[iDate] };
    for (const [cle, i] of Object.entries(cols)) if (i !== -1) brut[cle] = cells[i];
    if (brut.seances) brut.activites = decoderSeances(brut.seances);
    const e = normaliserEntree(brut);
    if (e && !entreeVideOuPas(e)) out.push(e);
  }
  return out;
}

/**
 * Les séances tiennent dans une colonne, encodées `type:minutes:kcal:e`,
 * séparées par `|`. Le tableur garde ainsi des totaux lisibles en colonnes
 * propres, sans que l'aller-retour ne perde le détail.
 */
function encoderSeances(activites = []) {
  return activites
    .map((a) => [String(a.type ?? '').replace(/[|:]/g, ' '), a.minutes ?? '', a.calories ?? '', a.estimee ? 'e' : ''].join(':'))
    .join('|');
}

function decoderSeances(texte) {
  return String(texte)
    .split('|')
    .filter(Boolean)
    .map((bout) => {
      const [type, minutes, calories, estimee] = bout.split(':');
      return { type, minutes, calories, estimee: estimee === 'e' };
    });
}

function decouper(ligne, sep) {
  const out = [];
  let cur = '';
  let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (guillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else cur += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Fusionne des entrées dans un jeu existant, journée par journée.
 *
 * `strategie` décide du sort d'une journée présente des deux côtés :
 * - `remplacer` : l'entrante gagne. C'est le comportement d'un import manuel,
 *   où l'on choisit délibérément un fichier.
 * - `recente` : la plus récemment modifiée gagne. C'est ce qu'il faut pour la
 *   synchronisation, où les deux côtés sont légitimes et où seul l'horodatage
 *   peut départager.
 * - `conserver` : l'existante gagne.
 */
export function fusionner(existantes, importees, { strategie = 'remplacer' } = {}) {
  const out = { ...existantes };
  let ajoutees = 0;
  let misesAJour = 0;
  let ignorees = 0;
  for (const brut of importees) {
    const e = normaliserEntree(brut);
    if (!e || entreeVideOuPas(e)) {
      ignorees++;
      continue;
    }
    const actuelle = out[e.date];
    if (!actuelle) {
      out[e.date] = e;
      ajoutees++;
      continue;
    }
    const gagne =
      strategie === 'remplacer' ||
      (strategie === 'recente' && instantMaj(e) > instantMaj(actuelle));
    if (gagne) {
      out[e.date] = e;
      misesAJour++;
    } else ignorees++;
  }
  return { entrees: out, ajoutees, misesAJour, ignorees };
}

export { daysBetween };
