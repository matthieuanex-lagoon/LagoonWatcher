import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, daySpan, formatAxisDay, lastNDays, startOfWeek, toISO } from '../src/dates.js';
import {
  bilan,
  correlation,
  depuisCSV,
  derniereValeur,
  entreeVide,
  entreeVideOuPas,
  fusionner,
  moyenne,
  moyenneGlissante,
  normaliserEntree,
  OBJECTIFS_DEFAUT,
  parSemaine,
  serie,
  serieEnCours,
  somme,
  tendancePoids,
  versCSV,
} from '../src/model.js';

/** Construit un jeu d'entrées depuis un objet compact { date: {champs} }. */
function jeu(brut) {
  const out = {};
  for (const [date, champs] of Object.entries(brut)) {
    out[date] = normaliserEntree({ ...entreeVide(date), ...champs });
  }
  return out;
}

test('dates : addDays et daySpan restent cohérents', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daySpan('2026-08-01', '2026-08-03').length, 3);
  assert.deepEqual(lastNDays(3, '2026-08-17'), ['2026-08-15', '2026-08-16', '2026-08-17']);
});

test('dates : le passage à l\'heure d\'été ne décale pas les jours', () => {
  // Dernier dimanche de mars en Europe : la journée fait 23 h.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(daySpan('2026-03-28', '2026-03-31').length, 4);
  assert.equal(toISO(new Date(2026, 9, 25, 12)), '2026-10-25');
});

test('dates : la semaine commence le lundi', () => {
  assert.equal(startOfWeek('2026-08-17'), '2026-08-17'); // lundi
  assert.equal(startOfWeek('2026-08-23'), '2026-08-17'); // dimanche → lundi précédent
  assert.equal(formatAxisDay('2026-08-05'), '05/08');
});

test('café : bornes et objectif par défaut', () => {
  assert.equal(OBJECTIFS_DEFAUT.cafe, 3);
  assert.equal(normaliserEntree({ date: '2026-08-17', cafe: '2' }).cafe, 2);
  assert.equal(normaliserEntree({ date: '2026-08-17', cafe: '0' }).cafe, 0);
  assert.equal(normaliserEntree({ date: '2026-08-17', cafe: '99' }).cafe, null);
  // Un café à zéro reste une journée renseignée.
  assert.equal(entreeVideOuPas(normaliserEntree({ date: '2026-08-17', cafe: 0 })), false);
});

test('bilan : moyenne de cafés par jour et dépassements de l\'objectif', () => {
  const entrees = jeu({
    '2026-08-15': { cafe: 4 },
    '2026-08-16': { cafe: 0 },
    '2026-08-17': { cafe: 5 },
  });
  const b = bilan(entrees, lastNDays(7, '2026-08-17'), { ...OBJECTIFS_DEFAUT, cafe: 3 });
  assert.equal(b.cafe.total, 9);
  assert.equal(b.cafe.parJour, 3); // moyenne sur les jours saisis, pas sur les 7
  assert.equal(b.cafe.jours, 3);
  assert.equal(b.cafe.joursSans, 1);
  assert.equal(b.cafe.depassements, 2);
  assert.equal(b.cafe.objectifJour, 3);
});

test('bilan : sans objectif café, aucun dépassement compté', () => {
  const entrees = jeu({ '2026-08-17': { cafe: 8 } });
  const b = bilan(entrees, lastNDays(7, '2026-08-17'), { ...OBJECTIFS_DEFAUT, cafe: null });
  assert.equal(b.cafe.depassements, 0);
  assert.equal(b.cafe.objectifJour, null);
});

test('normalisation : virgule décimale, bornes et champs vides', () => {
  const e = normaliserEntree({ date: '2026-08-17', poids: '72,4', calories: '2100', humeur: '4' });
  assert.equal(e.poids, 72.4);
  assert.equal(e.calories, 2100);
  assert.equal(e.humeur, 4);
  assert.equal(e.activite, null);
  // Hors bornes : rejeté plutôt que ramené dans l'intervalle, pour ne pas
  // inventer une valeur pendant la frappe.
  assert.equal(normaliserEntree({ date: '2026-08-17', poids: '7' }).poids, null);
  assert.equal(normaliserEntree({ date: '2026-08-17', humeur: '9' }).humeur, null);
  assert.equal(normaliserEntree({ date: 'pas-une-date' }), null);
});

test('une entrée sans donnée est considérée comme vide, un zéro ne l\'est pas', () => {
  assert.equal(entreeVideOuPas(entreeVide('2026-08-17')), true);
  assert.equal(entreeVideOuPas(normaliserEntree({ date: '2026-08-17', alcool: 0 })), false);
  assert.equal(entreeVideOuPas(normaliserEntree({ date: '2026-08-17', note: 'ok' })), false);
});

test('serie : grille continue avec des trous explicites', () => {
  const entrees = jeu({ '2026-08-15': { poids: 72 }, '2026-08-17': { poids: 71.5 } });
  const s = serie(entrees, 'poids', lastNDays(3, '2026-08-17'));
  assert.deepEqual(
    s.map((p) => p.valeur),
    [72, null, 71.5],
  );
});

test('agrégats : moyenne et somme ignorent les jours non saisis', () => {
  assert.equal(moyenne([2, null, 4]), 3);
  assert.equal(moyenne([null, null]), null);
  assert.equal(somme([2, null, 4]), 6);
  assert.equal(somme([null]), 0);
});

test('moyenneGlissante lisse sans propager les trous', () => {
  const points = [
    { date: 'a', valeur: 70 },
    { date: 'b', valeur: null },
    { date: 'c', valeur: 74 },
  ];
  const lisse = moyenneGlissante(points, 3);
  assert.equal(lisse[1].valeur, 72, 'le trou est comblé par les voisins');
  assert.equal(lisse[0].valeur, 70, 'au bord, la fenêtre est simplement tronquée');
  assert.equal(lisse[2].valeur, 74);
});

test('tendancePoids compare deux fenêtres de sept jours', () => {
  const entrees = jeu({
    '2026-08-04': { poids: 74 },
    '2026-08-06': { poids: 74 },
    '2026-08-15': { poids: 73 },
    '2026-08-17': { poids: 73 },
  });
  const t = tendancePoids(entrees, '2026-08-17');
  assert.equal(t.actuel, 73);
  assert.equal(t.precedent, 74);
  assert.equal(t.delta, -1);
});

test('tendancePoids : pas de tendance sans historique comparable', () => {
  const t = tendancePoids(jeu({ '2026-08-17': { poids: 73 } }), '2026-08-17');
  assert.equal(t.delta, null);
});

test('derniereValeur remonte la saisie la plus récente', () => {
  const entrees = jeu({ '2026-08-10': { poids: 74 }, '2026-08-16': { calories: 2000 } });
  assert.deepEqual(derniereValeur(entrees, 'poids'), { date: '2026-08-10', valeur: 74 });
  assert.equal(derniereValeur(entrees, 'humeur'), null);
});

test('bilan agrège les métriques sur la période', () => {
  const jours = lastNDays(7, '2026-08-17');
  const entrees = jeu({
    '2026-08-11': { poids: 74, calories: 2400, activite: 60, alcool: 2, humeur: 3 },
    '2026-08-14': { calories: 2000, activite: 0, alcool: 0, humeur: 5 },
    '2026-08-17': { poids: 73, calories: 2200, activite: 45, alcool: 0, humeur: 4 },
  });
  const b = bilan(entrees, jours, { ...OBJECTIFS_DEFAUT, calories: 2200 });

  assert.equal(b.jours, 7);
  assert.equal(b.joursSaisis, 3);
  assert.equal(b.poids.delta, -1);
  assert.equal(b.calories.moyenne, 2200);
  assert.equal(b.calories.ecartObjectif, 0);
  assert.equal(b.activite.total, 105);
  assert.equal(b.activite.parSemaine, 105);
  assert.equal(b.activite.joursActifs, 2); // le jour de repos saisi à 0 n'en est pas un
  assert.equal(b.alcool.total, 2);
  assert.equal(b.alcool.joursSecs, 2);
  assert.equal(b.alcool.joursAvecConso, 1);
  assert.equal(b.humeur.moyenne, 4);
  assert.equal(b.humeur.haute, 2);
  assert.equal(b.humeur.basse, 0);
});

test('bilan : période vide sans plantage', () => {
  const b = bilan({}, lastNDays(30, '2026-08-17'));
  assert.equal(b.joursSaisis, 0);
  assert.equal(b.calories.moyenne, null);
  assert.equal(b.activite.total, 0);
  assert.equal(b.poids.delta, null);
});

test('serieEnCours : un jour non saisi coupe la série', () => {
  const entrees = jeu({
    '2026-08-14': { alcool: 0 },
    '2026-08-16': { alcool: 0 },
    '2026-08-17': { alcool: 0 },
  });
  assert.equal(serieEnCours(entrees, '2026-08-17', (e) => e.alcool === 0), 2);
  assert.equal(serieEnCours(entrees, '2026-08-17', () => true), 2);
  assert.equal(serieEnCours({}, '2026-08-17', () => true), 0);
});

test('parSemaine regroupe du lundi au dimanche', () => {
  const entrees = jeu({
    '2026-08-16': { activite: 30, alcool: 1 }, // dimanche → semaine du 10
    '2026-08-17': { activite: 45, alcool: 0 }, // lundi → semaine du 17
  });
  const semaines = parSemaine(entrees, daySpan('2026-08-10', '2026-08-17'));
  assert.deepEqual(
    semaines.map((s) => [s.semaine, s.activite]),
    [
      ['2026-08-10', 30],
      ['2026-08-17', 45],
    ],
  );
});

test('correlation : silencieuse en dessous du seuil de paires', () => {
  const petit = jeu({ '2026-08-16': { alcool: 3, humeur: 2 }, '2026-08-17': { alcool: 0, humeur: 4 } });
  assert.equal(correlation(petit, daySpan('2026-08-16', '2026-08-17'), 'alcool', 'humeur'), null);

  const brut = {};
  for (let i = 0; i < 10; i++) {
    brut[`2026-08-${String(i + 1).padStart(2, '0')}`] = { alcool: i, humeur: Math.max(1, 5 - Math.round(i / 2.5)) };
  }
  const c = correlation(jeu(brut), daySpan('2026-08-01', '2026-08-10'), 'alcool', 'humeur');
  assert.equal(c.n, 10);
  assert.ok(c.r < -0.9, `corrélation attendue franchement négative, obtenu ${c.r}`);
});

test('CSV : aller-retour sans perte', () => {
  const entrees = jeu({
    '2026-08-16': { poids: 73.2, calories: 2150, activite: 40, typeActivite: 'Vélo', alcool: 2, cafe: 3, humeur: 4, note: 'Sortie; ok' },
    '2026-08-17': { alcool: 0, humeur: 5 },
  });
  const relu = depuisCSV(versCSV(entrees));
  assert.equal(relu.length, 2);
  assert.deepEqual(relu[0], entrees['2026-08-16']);
  assert.deepEqual(relu[1], entrees['2026-08-17']);
});

test('CSV : un export sans colonne café reste importable', () => {
  const relu = depuisCSV('date;poids_kg;calories_kcal;alcool_verres;humeur_1_5\n2026-08-17;73,5;2100;1;4\n');
  assert.equal(relu.length, 1);
  assert.equal(relu[0].cafe, null);
  assert.equal(relu[0].alcool, 1);
});

test('CSV : accepte la virgule comme séparateur', () => {
  const relu = depuisCSV('date,poids_kg,calories_kcal\n2026-08-17,73.5,2100\n');
  assert.equal(relu.length, 1);
  assert.equal(relu[0].poids, 73.5);
  assert.equal(relu[0].calories, 2100);
});

test('fusionner : remplace les journées existantes et ignore le vide', () => {
  const existantes = jeu({ '2026-08-17': { calories: 2000 } });
  const res = fusionner(existantes, [
    { date: '2026-08-17', calories: 2500 },
    { date: '2026-08-18', poids: 73 },
    { date: 'invalide' },
    { date: '2026-08-19' },
  ]);
  assert.equal(res.entrees['2026-08-17'].calories, 2500);
  assert.equal(res.ajoutees, 1);
  assert.equal(res.misesAJour, 1);
  assert.equal(res.ignorees, 2);
  assert.equal(existantes['2026-08-17'].calories, 2000, 'le jeu source ne doit pas être modifié');
});

test('fusionner : mode sans remplacement', () => {
  const existantes = jeu({ '2026-08-17': { calories: 2000 } });
  const res = fusionner(existantes, [{ date: '2026-08-17', calories: 2500 }], { remplacer: false });
  assert.equal(res.entrees['2026-08-17'].calories, 2000);
  assert.equal(res.ignorees, 1);
});
