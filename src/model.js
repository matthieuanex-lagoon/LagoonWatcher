// Modèle de données et calculs. Fonctions pures : aucune touche au DOM ni au
// localStorage, ce qui les rend testables directement avec `node --test`.

import { addDays, daySpan, daysBetween, startOfWeek, todayISO } from './dates.js';

/** Les cinq métriques suivies, dans l'ordre d'affichage. */
export const METRIQUES = ['poids', 'calories', 'activite', 'alcool', 'humeur'];

export const TYPES_ACTIVITE = [
  'Marche',
  'Course',
  'Vélo',
  'Natation',
  'Muscu',
  'Yoga',
  'Sport collectif',
  'Autre',
];

export const HUMEURS = [
  { valeur: 1, emoji: '😞', label: 'Très bas' },
  { valeur: 2, emoji: '😕', label: 'Bas' },
  { valeur: 3, emoji: '😐', label: 'Neutre' },
  { valeur: 4, emoji: '🙂', label: 'Bien' },
  { valeur: 5, emoji: '😄', label: 'Très bien' },
];

export const OBJECTIFS_DEFAUT = {
  calories: 2200, // kcal / jour
  poids: null, // kg visés, optionnel
  activite: 150, // minutes / semaine (recommandation OMS)
  alcool: 10, // verres / semaine maximum
};

/** Une journée vide : toutes les métriques sont optionnelles. */
export function entreeVide(date) {
  return {
    date,
    poids: null,
    calories: null,
    activite: null,
    typeActivite: '',
    alcool: null,
    humeur: null,
    note: '',
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
  return {
    date,
    poids: nombreOuNull(brut.poids, { min: 20, max: 400 }),
    calories: nombreOuNull(brut.calories, { min: 0, max: 20000 }),
    activite: nombreOuNull(brut.activite, { min: 0, max: 1440 }),
    typeActivite: String(brut.typeActivite ?? '').slice(0, 40),
    alcool: nombreOuNull(brut.alcool, { min: 0, max: 60 }),
    humeur: humeur === null ? null : Math.round(humeur),
    note: String(brut.note ?? '').slice(0, 2000),
  };
}

/** Une entrée sans aucune donnée ne mérite pas d'être stockée. */
export function entreeVideOuPas(e) {
  return (
    e.poids === null &&
    e.calories === null &&
    e.activite === null &&
    e.alcool === null &&
    e.humeur === null &&
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

/** Bilan d'une période, prêt à afficher. */
export function bilan(entrees, jours, objectifs = OBJECTIFS_DEFAUT) {
  const semaines = Math.max(jours.length / 7, 1 / 7);
  const valeurs = (m) => jours.map((d) => entrees[d]?.[m] ?? null);

  const poids = valeurs('poids').filter((v) => typeof v === 'number');
  const calories = valeurs('calories').filter((v) => typeof v === 'number');
  const activite = valeurs('activite');
  const alcool = valeurs('alcool');
  const humeur = valeurs('humeur').filter((v) => typeof v === 'number');

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
    },
    alcool: {
      total: totalAlcool,
      parSemaine: totalAlcool / semaines,
      joursSecs: joursAvecAlcool.filter((v) => v === 0).length,
      joursAvecConso: joursAvecAlcool.filter((v) => v > 0).length,
      objectifSemaine: objectifs.alcool ?? null,
    },
    humeur: {
      moyenne: moyenne(humeur),
      jours: humeur.length,
      basse: humeur.filter((v) => v <= 2).length,
      haute: humeur.filter((v) => v >= 4).length,
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

/** CSV (séparateur `;`, lisible tel quel par Excel en locale FR). */
export function versCSV(entrees) {
  const colonnes = ['date', 'poids_kg', 'calories_kcal', 'activite_min', 'type_activite', 'alcool_verres', 'humeur_1_5', 'note'];
  const echapper = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lignes = entreesTriees(entrees).map((e) =>
    [e.date, e.poids, e.calories, e.activite, e.typeActivite, e.alcool, e.humeur, e.note]
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
    alcool: index('alcool'),
    humeur: index('humeur'),
    note: index('note'),
  };
  const out = [];
  for (const ligne of lignes.slice(1)) {
    const cells = decouper(ligne, sep);
    const brut = { date: cells[iDate] };
    for (const [cle, i] of Object.entries(cols)) if (i !== -1) brut[cle] = cells[i];
    const e = normaliserEntree(brut);
    if (e && !entreeVideOuPas(e)) out.push(e);
  }
  return out;
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

/** Fusionne des entrées importées dans un jeu existant. */
export function fusionner(existantes, importees, { remplacer = true } = {}) {
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
    if (out[e.date]) {
      if (!remplacer) {
        ignorees++;
        continue;
      }
      misesAJour++;
    } else ajoutees++;
    out[e.date] = e;
  }
  return { entrees: out, ajoutees, misesAJour, ignorees };
}

export { daysBetween };
