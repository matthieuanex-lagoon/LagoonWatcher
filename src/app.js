// Câblage de l'interface : navigation, formulaire du jour, bilan, journal,
// réglages. Les calculs vivent dans model.js, la persistance dans store.js.

import { dessinerGraphique, dessinerSparkline } from './charts.js';
import { addDays, formatDay, lastNDays, startOfWeek, toISO, todayISO } from './dates.js';
import {
  bilan,
  correlation,
  depuisCSV,
  derniereValeur,
  entreeVide,
  entreeVideOuPas,
  appliquerSuppressions,
  entreesTriees,
  estimerCalories,
  fusionner,
  fusionnerSuppressions,
  HUMEURS,
  instantMaj,
  marquerSupprimee,
  moyenne,
  moyenneGlissante,
  normaliserEntree,
  OBJECTIFS_DEFAUT,
  serie,
  serieEnCours,
  somme,
  tendancePoids,
  TYPES_ACTIVITE,
  versCSV,
} from './model.js';
import { charger, depuisJSON, sauver, versJSON } from './store.js';
import {
  chargerConfigSync,
  connecterGist,
  envoyerGist,
  sauverConfigSync,
  telechargerGist,
} from './sync.js';

/**
 * Version affichée dans les réglages et reportée dans les exports. À monter
 * à chaque changement de comportement : sans elle, impossible de savoir quelle
 * version tourne réellement sur un appareil, et un cache périmé se diagnostique
 * à l'aveugle.
 */
export const VERSION_APPLI = '2026-08-18 · 7';

const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

let etat = charger();
let dateCourante = todayISO();
let periode = 30;
let journalComplet = false; // le journal n'affiche que les dernières lignes par défaut

/* ── Formatage ─────────────────────────────────────────────────────── */

const nb = (v, decimales = 0) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
    : '—';

const signe = (v, decimales = 1) => (typeof v === 'number' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${nb(Math.abs(v), decimales)}` : '—');

/** 95 min → « 1 h 35 ». */
function duree(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

/** Petit constructeur de DOM, pour que le rendu reste lisible. */
function h(balise, attrs = {}, ...enfants) {
  const n = document.createElement(balise);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, String(v));
  }
  for (const enfant of enfants.flat()) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    n.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return n;
}

let minuteurToast;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => t.classList.remove('visible'), 3200);
}

/* ── Enregistrement ────────────────────────────────────────────────── */

function persister({ silencieux = false } = {}) {
  const res = sauver(etat);
  const zone = $('#etat-sauvegarde');
  if (!res.ok) {
    zone.dataset.etat = 'erreur';
    zone.textContent = "Échec de l'enregistrement (stockage plein ou navigation privée).";
    return false;
  }
  if (!silencieux) {
    zone.dataset.etat = 'ok';
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    zone.textContent = `Enregistré à ${heure}`;
  }
  return true;
}

/* ── Thème ─────────────────────────────────────────────────────────── */

const THEMES = ['auto', 'clair', 'sombre'];

function appliquerTheme() {
  const pose = document.documentElement.dataset.theme;
  // En mode « système », on respecte un thème posé par la page hôte (un
  // visualiseur qui estampille data-theme) plutôt que de l'écraser : ce n'est
  // qu'en choisissant explicitement clair ou sombre qu'on reprend la main.
  if (etat.theme !== 'auto' || THEMES.includes(pose) || !pose) {
    document.documentElement.dataset.theme = etat.theme;
  }
  $$('#choix-theme .puce').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === etat.theme)));
}

/* ── Navigation ────────────────────────────────────────────────────── */

const VUES = ['jour', 'bilan', 'journal', 'reglages'];

function afficherVue(nom) {
  const vue = VUES.includes(nom) ? nom : 'jour';
  for (const v of VUES) $(`#vue-${v}`).hidden = v !== vue;
  $$('.onglets button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vue === vue)));
  if (location.hash.slice(1) !== vue) history.replaceState(null, '', `#${vue}`);
  if (vue === 'bilan') rendreBilan();
  if (vue === 'journal') rendreJournal();
  if (vue === 'reglages') rendreReglages();
  window.scrollTo({ top: 0 });
}

/* ── Vue « Jour » ──────────────────────────────────────────────────── */

function entreeDuJour(date) {
  return etat.entrees[date] ?? entreeVide(date);
}

function entreeCourante() {
  return entreeDuJour(dateCourante);
}

/**
 * Change la journée affichée. Passe toujours par ici : une saisie encore en
 * attente de son délai appartient à la journée où elle a été tapée, et doit
 * être écrite avant que l'affichage ne bascule.
 */
function allerAuJour(nouvelleDate) {
  if (nouvelleDate === dateCourante) return rendreJour();
  validerSaisieEnAttente();
  dateCourante = nouvelleDate;
  rendreJour();
}

function construireChampsStatiques() {
  const zone = $('#choix-humeur');
  for (const m of HUMEURS) {
    zone.append(
      h(
        'button',
        {
          type: 'button',
          dataset: { humeur: String(m.valeur) },
          'aria-pressed': 'false',
          'aria-label': `${m.label} (${m.valeur} sur 5)`,
          title: m.label,
          onclick: () => {
            clearTimeout(minuteurAuto);
            majEntree({ ...lireFormulaire(), humeur: entreeCourante().humeur === m.valeur ? null : m.valeur });
          },
        },
        m.emoji,
        h('span', {}, m.label),
      ),
    );
  }
}

/**
 * Poids le plus récent connu à cette date : base de l'estimation calorique.
 * On regarde en arrière plutôt qu'en avant — le poids d'après-demain ne dit
 * rien de l'effort d'aujourd'hui.
 */
function poidsPour(date) {
  const candidats = entreesTriees(etat.entrees).filter((e) => e.date <= date && typeof e.poids === 'number');
  return candidats.at(-1)?.poids ?? derniereValeur(etat.entrees, 'poids')?.valeur ?? null;
}

/**
 * « Journée sans sport » : une séance unique de zéro minute, sans type. C'est
 * une information — elle compte comme journée renseignée — là où une journée
 * sans aucune séance ne dit rien.
 */
function estJourneeSansSport(entree) {
  const seances = entree.activites ?? [];
  return seances.length === 1 && seances[0].minutes === 0 && !seances[0].type && seances[0].calories === null;
}

/** Séances telles qu'affichées, y compris les lignes en cours de saisie. */
function lireSeances() {
  return $$('#liste-activites .seance').map((ligne) => ({
    type: $('select', ligne).value,
    minutes: $('.minutes', ligne).value,
    calories: $('.kcal input', ligne).value,
    estimee: $('.kcal', ligne).dataset.estimee === 'true',
  }));
}

/**
 * Recalcule l'estimation d'une ligne. Une valeur saisie à la main n'est
 * jamais écrasée : c'est la promesse faite à l'utilisateur, sinon corriger
 * un chiffre ne servirait à rien.
 */
function rafraichirEstimation(ligne) {
  const champKcal = $('.kcal', ligne);
  const saisieManuelle = champKcal.dataset.estimee !== 'true' && $('input', champKcal).value !== '';
  if (saisieManuelle) return;
  const minutes = Number($('.minutes', ligne).value);
  const estimation = estimerCalories($('select', ligne).value, minutes, poidsPour(dateCourante));
  $('input', champKcal).value = estimation ?? '';
  champKcal.dataset.estimee = estimation === null ? 'false' : 'true';
  $('.marque-estimee', champKcal).hidden = estimation === null;
}

function ligneSeance(seance = { type: '', minutes: '', calories: '', estimee: false }) {
  const select = h(
    'select',
    { 'aria-label': "Type d'activité" },
    h('option', { value: '' }, 'type…'),
    TYPES_ACTIVITE.map((t) => h('option', { value: t.nom, selected: t.nom === seance.type }, t.nom)),
  );
  const minutes = h('input', {
    type: 'number', class: 'minutes', step: 5, min: 0, max: 1440, inputmode: 'numeric',
    placeholder: 'min', 'aria-label': 'Durée en minutes', value: seance.minutes ?? '',
  });
  const kcalInput = h('input', {
    type: 'number', step: 10, min: 0, max: 20000, inputmode: 'numeric',
    placeholder: 'kcal', 'aria-label': 'Calories dépensées', value: seance.calories ?? '',
  });
  const kcal = h(
    'div',
    { class: 'kcal', dataset: { estimee: String(Boolean(seance.estimee)) } },
    kcalInput,
    h('span', { class: 'marque-estimee', title: "Estimation d'après le type, la durée et votre poids", hidden: !seance.estimee }, '≈'),
  );
  const ligne = h(
    'div',
    { class: 'seance' },
    select,
    minutes,
    kcal,
    h('button', { type: 'button', class: 'retirer', 'aria-label': 'Retirer cette activité', title: 'Retirer' }, '×'),
  );

  const recalculer = () => {
    rafraichirEstimation(ligne);
    enregistrerSeances();
  };
  select.addEventListener('change', recalculer);
  minutes.addEventListener('change', recalculer);
  minutes.addEventListener('input', () => enregistrementDiffere());
  // Toucher au chiffre, c'est le reprendre à son compte : plus d'estimation.
  kcalInput.addEventListener('input', () => {
    kcal.dataset.estimee = 'false';
    $('.marque-estimee', kcal).hidden = true;
    enregistrementDiffere();
  });
  kcalInput.addEventListener('change', enregistrerSeances);
  $('.retirer', ligne).addEventListener('click', () => {
    ligne.remove();
    enregistrerSeances();
    rendreEtatSeances();
  });
  return ligne;
}

function enregistrerSeances() {
  clearTimeout(minuteurAuto);
  majEntree({ ...lireFormulaire(), activites: lireSeances() }, { rerendre: false });
  rendreEtatSeances();
}

function rendreEtatSeances() {
  const vide = $$('#liste-activites .seance').length === 0;
  $('#entete-seances').hidden = vide;
  $('#aucune-seance').hidden = !vide;
  $('#activite-repos').setAttribute('aria-pressed', String(estJourneeSansSport(entreeCourante())));

  // L'estimation a besoin du poids. Sans lui, le champ reste vide : autant
  // dire pourquoi, sinon la fonction passe pour cassée.
  const attendUnPoids =
    poidsPour(dateCourante) === null &&
    $$('#liste-activites .seance').some(
      (ligne) => Number($('.minutes', ligne).value) > 0 && $('.kcal input', ligne).value === '',
    );
  $('#sans-poids').hidden = !attendUnPoids;
}

function rendreSeances() {
  const zone = $('#liste-activites');
  zone.textContent = '';
  zone.append(
    h(
      'div',
      { class: 'entete-seances', id: 'entete-seances' },
      h('span', {}, 'Activité'),
      h('span', {}, 'Min'),
      h('span', {}, 'Kcal'),
      h('span', {}, ''),
    ),
    h('p', { class: 'aucune-seance', id: 'aucune-seance' }, 'Aucune activité pour cette journée.'),
  );
  for (const seance of entreeCourante().activites ?? []) zone.append(ligneSeance(seance));
  rendreEtatSeances();
}

function rendreJour() {
  const e = entreeCourante();
  $('#libelle-jour').textContent = formatDay(dateCourante);
  $('#champ-date').value = dateCourante;
  $('#champ-date').max = todayISO();
  $('#jour-suivant').disabled = dateCourante >= todayISO();

  $('#champ-poids').value = e.poids ?? '';
  $('#champ-calories').value = e.calories ?? '';
  $('#champ-alcool').value = e.alcool ?? '';
  $('#champ-cafe').value = e.cafe ?? '';
  $('#champ-note').value = e.note ?? '';

  $$('#choix-humeur button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.humeur) === e.humeur)));
  $('#alcool-zero').setAttribute('aria-pressed', String(e.alcool === 0));
  rendreSeances();
  $('#cafe-zero').setAttribute('aria-pressed', String(e.cafe === 0));
  $('#etat-sauvegarde').textContent = etat.entrees[dateCourante] ? 'Journée enregistrée' : '';
  $('#etat-sauvegarde').dataset.etat = '';

  rendreIndices();
}

/**
 * Contexte à droite de chaque intitulé : où on en est, sans changer de vue.
 * Appelé aussi après un enregistrement sans rendu complet, d'où l'état du
 * bouton d'effacement ici — sinon il resterait grisé sur une journée qu'on
 * vient de remplir.
 */
function rendreIndices() {
  const { entrees, objectifs } = etat;
  $('#effacer-jour').disabled = !entrees[dateCourante];
  const semaine = joursDepuis(startOfWeek(dateCourante), dateCourante);
  const sept = joursDepuis(addDays(dateCourante, -6), dateCourante);

  const dernier = derniereValeur(entrees, 'poids');
  const tendance = tendancePoids(entrees, dateCourante);
  const tendanceTexte = tendance.delta !== null ? ` · 7 j ${signe(tendance.delta, 1)} kg` : '';
  $('#indice-poids').textContent = dernier
    ? dernier.date === dateCourante
      ? `${nb(dernier.valeur, 1)} kg${tendanceTexte}`
      : `dernière pesée ${nb(dernier.valeur, 1)} kg · ${formatDay(dernier.date)}${tendanceTexte}`
    : 'première pesée';

  const moyCal = moyenne(sept.map((d) => entrees[d]?.calories ?? null));
  $('#indice-calories').textContent = moyCal !== null
    ? `moy. 7 j ${nb(moyCal)} kcal${objectifs.calories ? ` · objectif ${nb(objectifs.calories)}` : ''}`
    : objectifs.calories
      ? `objectif ${nb(objectifs.calories)} kcal`
      : '';

  const totalSemaine = somme(semaine.map((d) => entrees[d]?.activite ?? null));
  const kcalSemaine = somme(semaine.map((d) => entrees[d]?.sportKcal ?? null));
  $('#indice-activite').textContent = [
    `cette semaine ${duree(totalSemaine)}${objectifs.activite ? ` / ${duree(objectifs.activite)}` : ''}`,
    kcalSemaine ? `${nb(kcalSemaine)} kcal` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const verresSemaine = somme(semaine.map((d) => entrees[d]?.alcool ?? null));
  const secs = serieEnCours(entrees, dateCourante, (x) => x.alcool === 0);
  $('#indice-alcool').textContent = `cette semaine ${nb(verresSemaine)}${
    objectifs.alcool ? ` / ${nb(objectifs.alcool)}` : ''
  }${secs > 1 ? ` · ${secs} j sans` : ''}`;

  const cafeJour = entrees[dateCourante]?.cafe ?? null;
  const moyCafe = moyenne(sept.map((d) => entrees[d]?.cafe ?? null));
  $('#indice-cafe').textContent = [
    objectifs.cafe ? `objectif max ${nb(objectifs.cafe)} / jour` : null,
    cafeJour !== null && objectifs.cafe && cafeJour > objectifs.cafe ? 'dépassé' : null,
    moyCafe !== null ? `moy. 7 j ${nb(moyCafe, 1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const moyHumeur = moyenne(sept.map((d) => entrees[d]?.humeur ?? null));
  $('#indice-humeur').textContent = moyHumeur !== null ? `moy. 7 j ${nb(moyHumeur, 1)} / 5` : '';
}

function joursDepuis(debut, fin) {
  const out = [];
  for (let d = debut; d <= fin; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Met à jour la journée courante et enregistre (source unique de vérité).
 * `rerendre: false` pendant la frappe : réécrire les champs depuis l'état
 * déplacerait le curseur et effacerait une saisie encore incomplète.
 */
function majEntree(champs, { silencieux = false, rerendre = true, date = dateCourante } = {}) {
  const fusion = normaliserEntree({
    ...entreeDuJour(date),
    ...champs,
    date,
    maj: new Date().toISOString(),
  });
  if (!fusion) return;
  if (entreeVideOuPas(fusion)) delete etat.entrees[date];
  else {
    etat.entrees[date] = fusion;
    // Ressaisir une journée effacée annule sa suppression : sans ça, la
    // prochaine fusion la retirerait de nouveau.
    if (etat.suppressions?.[date]) {
      const { [date]: _oubliee, ...reste } = etat.suppressions;
      etat.suppressions = reste;
    }
  }
  persister({ silencieux });
  if (rerendre) rendreJour();
  else rendreIndices();
  envoiDiffere();
}

function lireFormulaire() {
  return {
    poids: $('#champ-poids').value,
    calories: $('#champ-calories').value,
    activites: lireSeances(),
    alcool: $('#champ-alcool').value,
    cafe: $('#champ-cafe').value,
    note: $('#champ-note').value,
  };
}

let minuteurAuto = null;
let jourEnAttente = null;

function enregistrementDiffere() {
  clearTimeout(minuteurAuto);
  // La journée est retenue ici, à la frappe. Sans ça, un minuteur qui se
  // déclenche après un changement de jour écrirait la saisie sur la mauvaise
  // journée — typiquement en revenant dans l'appli, qui repasse à aujourd'hui.
  jourEnAttente = dateCourante;
  const zone = $('#etat-sauvegarde');
  zone.dataset.etat = '';
  zone.textContent = 'Modification en cours…';
  minuteurAuto = setTimeout(() => {
    const cible = jourEnAttente;
    minuteurAuto = null;
    jourEnAttente = null;
    // Le jour affiché a changé entre-temps : la saisie a déjà été validée au
    // moment de la bascule, et le formulaire montre autre chose. On s'abstient.
    if (cible !== dateCourante) return;
    majEntree(lireFormulaire(), { rerendre: false, date: cible });
  }, 700);
}

/** Valide tout de suite une saisie encore en attente, sur sa journée d'origine. */
function validerSaisieEnAttente() {
  if (minuteurAuto === null) return;
  const cible = jourEnAttente ?? dateCourante;
  clearTimeout(minuteurAuto);
  minuteurAuto = null;
  jourEnAttente = null;
  majEntree(lireFormulaire(), { rerendre: false, silencieux: true, date: cible });
}

/** Le curseur est-il dans un champ du formulaire du jour ? */
function saisieEnCours() {
  return Boolean(document.activeElement?.closest?.('#formulaire-jour'));
}

/* ── Vue « Bilan » ─────────────────────────────────────────────────── */

function tuile({ etiquette, teinte, valeur, unite, detail, jauge, sparkline }) {
  const n = h(
    'div',
    { class: 'tuile', style: teinte ? `--teinte: var(--serie-${teinte})` : null },
    h('div', { class: 'etiquette-tuile' }, teinte ? h('i', { class: 'puce-couleur' }) : null, etiquette),
    h('div', { class: 'valeur-tuile' }, valeur, unite ? h('span', { class: 'unite' }, unite) : null),
    detail ? h('div', { class: 'discret' }, detail) : null,
  );
  if (jauge) {
    const part = Math.min(jauge.part, 1.5);
    n.append(
      h(
        'div',
        { class: 'jauge', dataset: { etat: jauge.depasse ? 'depasse' : 'ok' }, role: 'presentation' },
        h('i', { style: `width: ${Math.round(Math.min(part, 1) * 100)}%` }),
      ),
    );
  }
  if (sparkline) {
    const hote = h('div', { class: 'hote-sparkline' });
    n.append(hote);
    requestAnimationFrame(() => dessinerSparkline(hote, sparkline.points, { couleur: `var(--serie-${teinte})`, type: sparkline.type }));
  }
  return n;
}

function carteGraphique({ titre, teinte, resume, config, legende, note }) {
  const zone = h('div', { class: 'zone-graphique' });
  const carte = h(
    'section',
    { class: 'carte carte-graphique', style: `--teinte: var(--serie-${teinte})` },
    h(
      'div',
      { class: 'en-tete-graphique' },
      legende ? null : h('i', { class: 'repere-serie' }),
      h('h3', {}, titre),
      resume ? h('span', { class: 'resume' }, resume) : null,
    ),
    // Deux séries : la légende n'est pas décorative, c'est le seul canal
    // d'identité qui ne repose pas uniquement sur la couleur.
    legende
      ? h(
          'div',
          { class: 'legende' },
          legende.map((l) => h('span', {}, h('i', { style: `background: ${l.couleur}` }), l.nom)),
        )
      : null,
    zone,
    note ? h('p', { class: 'discret', style: 'margin: 8px 0 0' }, note) : null,
  );
  // Le dessin attend d'être dans le document pour connaître sa largeur.
  requestAnimationFrame(() => dessinerGraphique(zone, { ...config, titre, couleur: `var(--serie-${teinte})` }));
  return carte;
}

function rendreBilan() {
  const { entrees, objectifs } = etat;
  const jours = lastNDays(periode);
  const b = bilan(entrees, jours, objectifs);
  const cible = $('#contenu-bilan');
  cible.textContent = '';

  $$('#filtres-periode .puce').forEach((p) => p.setAttribute('aria-pressed', String(Number(p.dataset.jours) === periode)));

  if (!b.joursSaisis) {
    cible.append(
      h(
        'div',
        { class: 'carte' },
        h('p', { class: 'vide-etat' }, 'Rien à afficher sur cette période. Commencez par saisir une journée dans l\'onglet Jour.'),
      ),
    );
    return;
  }

  // Chiffre phare : le poids, avec sa tendance sur 7 jours.
  const tendance = tendancePoids(entrees, todayISO());
  const dernierPoids = derniereValeur(entrees, 'poids');
  const sensPoids = (() => {
    if (tendance.delta === null || Math.abs(tendance.delta) < 0.1) return 'neutre';
    if (!objectifs.poids || !dernierPoids) return 'neutre';
    // « Bon » = on va vers le poids visé, quel que soit le sens.
    return Math.sign(objectifs.poids - dernierPoids.valeur) === Math.sign(tendance.delta) ? 'bon' : 'mauvais';
  })();

  const joursSaisieSuite = serieEnCours(entrees, todayISO(), () => true);
  const joursSansAlcool = serieEnCours(entrees, todayISO(), (e) => e.alcool === 0);

  cible.append(
    h(
      'div',
      { class: 'heros' },
      h(
        'section',
        { class: 'carte hero' },
        h('div', { class: 'etiquette-hero' }, dernierPoids ? `Poids · ${formatDay(dernierPoids.date)}` : 'Poids'),
        h('div', { class: 'valeur-hero' }, nb(dernierPoids?.valeur ?? null, 1), h('span', { class: 'unite' }, 'kg')),
        h(
          'div',
          { class: 'delta', dataset: { sens: sensPoids } },
          tendance.delta === null
            ? h('span', { class: 'discret' }, 'tendance dès la deuxième semaine de pesées')
            : `${signe(tendance.delta, 1)} kg vs 7 jours précédents`,
        ),
        objectifs.poids && dernierPoids
          ? h('div', { class: 'discret', style: 'margin-top:4px' }, `Objectif ${nb(objectifs.poids, 1)} kg · ${signe(dernierPoids.valeur - objectifs.poids, 1)} kg`)
          : null,
      ),
      h(
        'section',
        { class: 'carte' },
        h('div', { class: 'etiquette-hero' }, 'Séries en cours'),
        h(
          'div',
          { class: 'series' },
          h(
            'div',
            {},
            h('span', { class: 'valeur-tuile' }, joursSansAlcool),
            h('span', { class: 'unite' }, joursSansAlcool > 1 ? 'jours sans alcool' : 'jour sans alcool'),
          ),
          h(
            'div',
            {},
            h('span', { class: 'valeur-tuile' }, joursSaisieSuite),
            h('span', { class: 'unite' }, joursSaisieSuite > 1 ? 'jours suivis d\'affilée' : 'jour suivi'),
          ),
        ),
        h('div', { class: 'discret', style: 'margin-top:4px' }, `${b.joursSaisis} / ${b.jours} jours renseignés sur la période`),
      ),
    ),
  );

  // Tuiles de synthèse
  cible.append(
    h(
      'div',
      { class: 'tuiles' },
      tuile({
        etiquette: 'Calories / jour',
        teinte: 'calories',
        valeur: nb(b.calories.moyenne),
        unite: 'kcal',
        detail:
          b.calories.ecartObjectif === null
            ? `${b.calories.jours} jours saisis`
            : `${signe(b.calories.ecartObjectif, 0)} kcal vs objectif`,
        sparkline: { points: serie(entrees, 'calories', jours), type: 'colonnes' },
      }),
      tuile({
        etiquette: 'Activité / semaine',
        teinte: 'activite',
        valeur: duree(b.activite.parSemaine),
        detail: b.activite.kcalTotal
          ? `${b.activite.seances} séances · ${nb(b.activite.kcalTotal)} kcal dépensées`
          : `${b.activite.joursActifs} jours actifs · ${duree(b.activite.total)} au total`,
        jauge: b.activite.objectifSemaine
          ? { part: b.activite.parSemaine / b.activite.objectifSemaine, depasse: false }
          : null,
      }),
      tuile({
        etiquette: 'Alcool / semaine',
        teinte: 'alcool',
        valeur: nb(b.alcool.parSemaine, 1),
        unite: 'verres',
        detail: `${b.alcool.joursSecs} jours sans · ${nb(b.alcool.total)} verres au total`,
        jauge: b.alcool.objectifSemaine
          ? {
              part: b.alcool.parSemaine / b.alcool.objectifSemaine,
              depasse: b.alcool.parSemaine > b.alcool.objectifSemaine,
            }
          : null,
      }),
      tuile({
        etiquette: 'Café / jour',
        teinte: 'cafe',
        valeur: nb(b.cafe.parJour, 1),
        unite: 'tasses',
        detail: b.cafe.objectifJour
          ? `${b.cafe.depassements} jours au-dessus de ${nb(b.cafe.objectifJour)} · ${b.cafe.joursSans} sans`
          : `${nb(b.cafe.total)} tasses au total · ${b.cafe.joursSans} jours sans`,
        jauge: b.cafe.objectifJour
          ? { part: (b.cafe.parJour ?? 0) / b.cafe.objectifJour, depasse: (b.cafe.parJour ?? 0) > b.cafe.objectifJour }
          : null,
      }),
      tuile({
        etiquette: 'Humeur moyenne',
        teinte: 'humeur',
        valeur: nb(b.humeur.moyenne, 1),
        unite: '/ 5',
        detail: `${b.humeur.haute} bonnes journées · ${b.humeur.basse} difficiles`,
        sparkline: { points: serie(entrees, 'humeur', jours), type: 'ligne' },
      }),
    ),
  );

  // Graphiques — un filtre de période unique en haut de la vue les cadre tous.
  const pointsPoids = serie(entrees, 'poids', jours);
  cible.append(
    carteGraphique({
      titre: 'Poids',
      teinte: 'poids',
      resume: b.poids.pesees > 1 ? `${signe(b.poids.delta, 1)} kg sur la période` : `${b.poids.pesees} pesée`,
      config: {
        type: 'ligne',
        points: pointsPoids,
        relier: true, // on ne se pèse pas tous les jours ; le poids existe quand même
        tendance: b.poids.pesees > 6 ? moyenneGlissante(pointsPoids, 7) : null,
        unite: 'kg',
        format: (v) => nb(v, 1),
        objectif: objectifs.poids ? { valeur: objectifs.poids, label: `objectif ${nb(objectifs.poids, 1)} kg` } : null,
      },
    }),
    b.activite.kcalTotal
      ? carteGraphique({
          titre: 'Calories absorbées et dépensées',
          teinte: 'calories',
          resume: `moy. ${nb(b.calories.moyenne)} absorbées`,
          note: 'Le sport n\'est qu\'une part de la dépense : le corps en brûle bien plus au repos.',
          legende: [
            { nom: 'Absorbées', couleur: 'var(--serie-calories)' },
            { nom: 'Dépensées en sport', couleur: 'var(--serie-activite)' },
          ],
          config: {
            type: 'colonnes-groupees',
            series: [
              { nom: 'Absorbées', couleur: 'var(--serie-calories)', points: serie(entrees, 'calories', jours) },
              { nom: 'Dépensées en sport', couleur: 'var(--serie-activite)', points: serie(entrees, 'sportKcal', jours) },
            ],
            unite: 'kcal',
            format: (v) => nb(v),
            objectif: objectifs.calories ? { valeur: objectifs.calories, label: `objectif ${nb(objectifs.calories)}` } : null,
          },
        })
      : carteGraphique({
          titre: 'Calories',
          teinte: 'calories',
          resume: b.calories.jours ? `moy. ${nb(b.calories.moyenne)} kcal` : null,
          config: {
            type: 'colonnes',
            points: serie(entrees, 'calories', jours),
            unite: 'kcal',
            format: (v) => nb(v),
            objectif: objectifs.calories ? { valeur: objectifs.calories, label: `objectif ${nb(objectifs.calories)}` } : null,
          },
        }),
    carteGraphique({
      titre: 'Activité',
      teinte: 'activite',
      resume: `${duree(b.activite.total)} au total`,
      config: {
        type: 'colonnes',
        points: serie(entrees, 'activite', jours),
        unite: 'min',
        format: (v) => nb(v),
      },
    }),
    carteGraphique({
      titre: 'Alcool',
      teinte: 'alcool',
      resume: `${nb(b.alcool.total)} verres · ${b.alcool.joursSecs} jours sans`,
      config: {
        type: 'colonnes',
        points: serie(entrees, 'alcool', jours),
        unite: (v) => (v > 1 ? 'verres' : 'verre'),
        format: (v) => nb(v),
      },
    }),
    carteGraphique({
      titre: 'Café',
      teinte: 'cafe',
      resume: b.cafe.jours ? `moy. ${nb(b.cafe.parJour, 1)} / jour` : null,
      config: {
        type: 'colonnes',
        points: serie(entrees, 'cafe', jours),
        unite: (v) => (v > 1 ? 'tasses' : 'tasse'),
        format: (v) => nb(v),
        objectif: objectifs.cafe ? { valeur: objectifs.cafe, label: `max ${nb(objectifs.cafe)} / jour` } : null,
      },
    }),
    carteGraphique({
      titre: 'Humeur',
      teinte: 'humeur',
      resume: b.humeur.jours ? `moy. ${nb(b.humeur.moyenne, 1)} / 5` : null,
      config: {
        type: 'points',
        points: serie(entrees, 'humeur', jours),
        unite: '/ 5',
        format: (v) => nb(v, 0),
        yDomaine: [0.6, 5.4],
        yGraduations: [1, 2, 3, 4, 5],
      },
    }),
  );

  const relations = rendreRelations(entrees, jours);
  if (relations) cible.append(relations);
}

/**
 * Quelques liens statistiques, uniquement quand il y a assez de jours croisés.
 * Ce sont des coïncidences mesurées, pas des explications — le texte le dit.
 */
function rendreRelations(entrees, jours) {
  const pistes = [
    { a: 'alcool', b: 'humeur', texte: (r) => `Les jours avec plus d'alcool vont avec une humeur ${r < 0 ? 'plus basse' : 'plus haute'}.` },
    { a: 'activite', b: 'humeur', texte: (r) => `Les jours avec plus d'activité vont avec une humeur ${r > 0 ? 'meilleure' : 'moins bonne'}.` },
    { a: 'calories', b: 'poids', texte: (r) => `Les périodes à plus de calories vont avec un poids ${r > 0 ? 'plus élevé' : 'plus bas'}.` },
    { a: 'alcool', b: 'calories', texte: (r) => `Les jours avec alcool sont ${r > 0 ? 'plus' : 'moins'} caloriques.` },
    { a: 'cafe', b: 'humeur', texte: (r) => `Les jours avec plus de café vont avec une humeur ${r > 0 ? 'meilleure' : 'plus basse'}.` },
    { a: 'cafe', b: 'activite', texte: (r) => `Les jours avec plus de café sont ${r > 0 ? 'plus' : 'moins'} actifs.` },
  ];
  const trouvees = [];
  for (const p of pistes) {
    const c = correlation(entrees, jours, p.a, p.b);
    if (c && Math.abs(c.r) >= 0.3) trouvees.push({ ...p, ...c });
  }
  if (!trouvees.length) return null;
  trouvees.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  return h(
    'section',
    { class: 'carte' },
    h('h3', {}, 'Ce que montrent les données'),
    h('p', { class: 'sous-titre' }, 'Liens observés sur la période. Une coïncidence chiffrée ne dit pas la cause.'),
    h(
      'ul',
      { style: 'margin:0; padding-left:18px; display:grid; gap:6px' },
      trouvees.slice(0, 3).map((t) =>
        h(
          'li',
          { style: 'font-size:0.88rem' },
          t.texte(t.r),
          h('span', { class: 'discret' }, ` (r = ${nb(t.r, 2)} sur ${t.n} jours)`),
        ),
      ),
    ),
  );
}

/* ── Vue « Journal » ───────────────────────────────────────────────── */

const LIGNES_JOURNAL = 60;

function rendreJournal() {
  const cible = $('#contenu-journal');
  cible.textContent = '';
  const toutes = entreesTriees(etat.entrees).reverse();

  if (!toutes.length) {
    cible.append(h('p', { class: 'vide-etat' }, 'Aucune journée enregistrée pour le moment.'));
    return;
  }

  const liste = journalComplet ? toutes : toutes.slice(0, LIGNES_JOURNAL);
  const corps = h(
    'tbody',
    {},
    liste.map((e) =>
      h(
        'tr',
        {},
        h(
          'td',
          {},
          h(
            'button',
            {
              class: 'lien-jour',
              type: 'button',
              onclick: () => {
                allerAuJour(e.date);
                afficherVue('jour');
              },
            },
            formatDay(e.date, { relative: false }),
          ),
        ),
        cellule(e.poids !== null ? nb(e.poids, 1) : null),
        cellule(e.calories !== null ? nb(e.calories) : null),
        cellule(e.activite !== null ? `${nb(e.activite)}${e.typeActivite ? ` · ${e.typeActivite}` : ''}` : null),
        cellule(e.sportKcal !== null ? nb(e.sportKcal) : null),
        cellule(e.alcool !== null ? nb(e.alcool) : null),
        cellule(e.cafe !== null ? nb(e.cafe) : null),
        cellule(e.humeur !== null ? `${HUMEURS[e.humeur - 1].emoji} ${e.humeur}` : null),
        h('td', { class: e.note ? null : 'vide', style: 'max-width:220px; white-space:normal; text-align:left', title: e.note || null }, e.note || '—'),
      ),
    ),
  );

  cible.append(
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['Date', 'Poids (kg)', 'Calories', 'Activité (min)', 'Sport (kcal)', 'Alcool', 'Café', 'Humeur', 'Note'].map((t) => h('th', { scope: 'col' }, t)),
        ),
      ),
      corps,
    ),
  );

  if (toutes.length > liste.length) {
    cible.append(
      h(
        'button',
        {
          class: 'bouton',
          type: 'button',
          style: 'margin-top:10px',
          onclick: () => {
            journalComplet = true;
            rendreJournal();
          },
        },
        `Afficher les ${toutes.length - liste.length} journées plus anciennes`,
      ),
    );
  }
}

function cellule(valeur) {
  return h('td', { class: valeur === null ? 'vide' : null }, valeur ?? '—');
}

/* ── Vue « Réglages » ──────────────────────────────────────────────── */

function rendreReglages() {
  $('#objectif-calories').value = etat.objectifs.calories ?? '';
  $('#objectif-poids').value = etat.objectifs.poids ?? '';
  $('#objectif-activite').value = etat.objectifs.activite ?? '';
  $('#objectif-alcool').value = etat.objectifs.alcool ?? '';
  $('#objectif-cafe').value = etat.objectifs.cafe ?? '';
  appliquerTheme();

  rendreSync();
  $('#version-appli').textContent = `Version ${VERSION_APPLI}`;
  const liste = entreesTriees(etat.entrees);
  $('#resume-donnees').textContent = liste.length
    ? `${liste.length} journées enregistrées, du ${formatDay(liste[0].date, { relative: false, withYear: true })} au ${formatDay(
        liste.at(-1).date,
        { relative: false, withYear: true },
      )}.`
    : 'Aucune donnée enregistrée pour le moment.';
}

function lireObjectifs() {
  const lire = (sel, defaut) => {
    const v = $(sel).value.trim();
    if (v === '') return defaut;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : defaut;
  };
  etat.objectifs = {
    calories: lire('#objectif-calories', null),
    poids: lire('#objectif-poids', null),
    activite: lire('#objectif-activite', null),
    alcool: lire('#objectif-alcool', null),
    cafe: lire('#objectif-cafe', null),
  };
  persister({ silencieux: true });
  envoiDiffere();
}

function telechargerFichier(nomFichier, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = h('a', { href: url, download: nomFichier });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function horodatage() {
  return todayISO();
}

async function importerFichier(fichier) {
  const texte = await fichier.text();
  let importees = [];
  let objectifs = null;
  let suppressionsImportees = null;
  try {
    if (/\.csv$/i.test(fichier.name) || (!texte.trimStart().startsWith('{') && !texte.trimStart().startsWith('['))) {
      importees = depuisCSV(texte);
    } else {
      const lu = depuisJSON(texte);
      importees = lu.entrees;
      objectifs = lu.objectifs;
      suppressionsImportees = lu.suppressions;
    }
  } catch (err) {
    toast(`Fichier illisible : ${err.message}`);
    return;
  }
  if (!importees.length) {
    toast('Aucune journée exploitable dans ce fichier.');
    return;
  }
  const conflits = importees.filter((e) => etat.entrees[String(e.date).slice(0, 10)]).length;
  const message = `Importer ${importees.length} journée(s) ?${
    conflits ? `\n\n${conflits} journée(s) déjà enregistrée(s) seront remplacées.` : ''
  }`;
  if (!confirm(message)) return;

  const res = fusionner(etat.entrees, importees, { strategie: 'remplacer' });
  if (suppressionsImportees) etat.suppressions = fusionnerSuppressions(etat.suppressions ?? {}, suppressionsImportees);
  etat.entrees = appliquerSuppressions(res.entrees, etat.suppressions ?? {});
  if (objectifs) etat.objectifs = { ...OBJECTIFS_DEFAUT, ...objectifs };
  persister({ silencieux: true });
  rendreJour();
  rendreReglages();
  toast(`${res.ajoutees} ajoutée(s), ${res.misesAJour} mise(s) à jour${res.ignorees ? `, ${res.ignorees} ignorée(s)` : ''}.`);
  envoiDiffere();
}

/* ── Mise à jour de l'appli ────────────────────────────────────────── */

// Vérification discrète, à l'ouverture et de loin en loin : un onglet resté
// ouvert plusieurs jours ne doit pas tourner indéfiniment sur du vieux code.
const PERIODE_VERSION = 30 * 60 * 1000;

async function versionEnLigne() {
  try {
    const rep = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!rep.ok) return null;
    return (await rep.json())?.version ?? null;
  } catch {
    // Hors ligne, ou version en un seul fichier sans version.json : dans les
    // deux cas il n'y a rien à proposer, et surtout rien à signaler.
    return null;
  }
}

async function verifierVersion() {
  const enLigne = await versionEnLigne();
  $('#bandeau-maj').hidden = !(enLigne && enLigne !== VERSION_APPLI);
}

/**
 * Met à jour en protégeant d'abord la saisie : on valide ce qui est en
 * attente, on l'envoie si la sauvegarde en ligne est active, et seulement
 * ensuite on vide les caches et on recharge.
 */
async function appliquerMiseAJour() {
  const bouton = $('#appliquer-maj');
  bouton.disabled = true;
  bouton.textContent = 'Mise à jour…';
  validerSaisieEnAttente();
  if (configSync) {
    clearTimeout(minuteurEnvoi);
    await envoyerMaintenant({ discret: true });
  }
  await viderCaches();
  location.reload();
}

/** Désinscrit le service worker et vide ses caches. Les données n'y sont pas. */
async function viderCaches() {
  try {
    const registres = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registres ?? []).map((r) => r.unregister()));
    const noms = await caches?.keys?.();
    await Promise.all((noms ?? []).map((n) => caches.delete(n)));
  } catch (err) {
    console.warn('Nettoyage du cache incomplet', err);
  }
}

/* ── Sauvegarde en ligne ───────────────────────────────────────────── */

let configSync = chargerConfigSync();
let minuteurEnvoi;
let envoiEnCours = false;
let envoiEnAttente = false;

function etatSync(texte, etat = '') {
  const zone = $('#sync-etat');
  if (!zone) return;
  zone.textContent = texte;
  zone.dataset.etat = etat;
}

function rendreSync() {
  const actif = Boolean(configSync);
  $('#sync-deconnecte').hidden = actif;
  $('#sync-connecte').hidden = !actif;
  if (!actif) return;
  $('#sync-lien').textContent = configSync.gistId ? `Gist : ${configSync.gistId}` : '';
  if (configSync.dernier) {
    const d = new Date(configSync.dernier);
    etatSync(`Sauvegardé ${formatDay(toISO(d), { relative: true })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
  } else etatSync('Sauvegarde active, aucun envoi pour le moment.', 'attente');
}

// Tant que l'appli est à l'écran, on va voir si un autre appareil a écrit.
// Cinq minutes : assez pour que ça suive une utilisation normale, assez peu
// pour ne pas réveiller la radio du téléphone sans raison.
const PERIODE_SYNC = 5 * 60 * 1000;
let minuteurPeriodique;

function planifierSyncPeriodique() {
  clearInterval(minuteurPeriodique);
  if (!configSync) return;
  minuteurPeriodique = setInterval(() => {
    if (!document.hidden) recupererMaintenant({ discret: true });
  }, PERIODE_SYNC);
}

/** Envoi groupé : on attend la fin de la saisie plutôt que d'appeler à chaque touche. */
function envoiDiffere() {
  if (!configSync) return;
  clearTimeout(minuteurEnvoi);
  etatSync('Modification à envoyer…', 'attente');
  minuteurEnvoi = setTimeout(() => envoyerMaintenant({ discret: true }), 4000);
}

async function envoyerMaintenant({ discret = false, garderEnVie = false } = {}) {
  if (!configSync) return;
  if (envoiEnCours) {
    // Une saisie pendant un envoi : on repassera juste après, sinon la
    // dernière modification resterait au sol.
    envoiEnAttente = true;
    return;
  }
  envoiEnCours = true;
  etatSync('Envoi en cours…', 'attente');
  try {
    const quand = await envoyerGist(configSync, versJSON({ ...etat, versionAppli: VERSION_APPLI }), { garderEnVie });
    configSync = { ...configSync, dernier: quand };
    sauverConfigSync(configSync);
    rendreSync();
    if (!discret) toast('Sauvegarde envoyée.');
  } catch (err) {
    etatSync(err.message, 'erreur');
    if (!discret) toast(err.message);
  } finally {
    envoiEnCours = false;
    if (envoiEnAttente) {
      envoiEnAttente = false;
      envoiDiffere();
    }
  }
}

/**
 * Récupère la sauvegarde et la fusionne journée par journée : la version la
 * plus récemment modifiée gagne. Rien n'est écrasé en bloc, donc une saisie
 * faite hors ligne sur ce téléphone survit à une récupération.
 */
async function recupererMaintenant({ discret = false } = {}) {
  if (!configSync) return;
  // Une récupération réécrit les champs depuis l'état : tant que le curseur
  // est dans le formulaire, on repasse plus tard plutôt que d'effacer une
  // saisie sous les doigts. Un appui explicite sur le bouton, lui, passe.
  if (discret && saisieEnCours()) return;
  validerSaisieEnAttente();
  etatSync('Récupération…', 'attente');
  try {
    const contenu = await telechargerGist(configSync);
    if (!contenu) {
      etatSync('Sauvegarde en ligne encore vide.', 'attente');
      return;
    }
    const lu = depuisJSON(contenu);
    const res = fusionner(etat.entrees, lu.entrees, { strategie: 'recente' });
    etat.suppressions = fusionnerSuppressions(etat.suppressions ?? {}, lu.suppressions);
    const change = res.ajoutees + res.misesAJour;
    etat.entrees = appliquerSuppressions(res.entrees, etat.suppressions);
    if (lu.objectifs) etat.objectifs = { ...OBJECTIFS_DEFAUT, ...lu.objectifs };
    persister({ silencieux: true });
    rendreJour();
    rendreReglages();
    if (!discret || change) toast(change ? `${change} journée(s) récupérée(s).` : 'Déjà à jour.');

    // Ce que cet appareil a de plus frais que le distant doit repartir :
    // sinon une saisie faite hors ligne resterait ici jusqu'à la prochaine.
    const dateDistante = new Map(
      lu.entrees.map((e) => [String(e?.date ?? '').slice(0, 10), instantMaj(e)]),
    );
    const aEnvoyer = Object.entries(etat.entrees).some(
      ([jour, e]) => instantMaj(e) > (dateDistante.get(jour) ?? -1),
    );
    if (aEnvoyer) envoiDiffere();
    else rendreSync();
  } catch (err) {
    etatSync(err.message, 'erreur');
    if (!discret) toast(err.message);
  }
}

async function connecterSync() {
  const jeton = $('#champ-jeton').value.trim();
  if (!jeton) return toast("Collez d'abord la clé d'accès.");
  const bouton = $('#sync-connecter');
  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  try {
    const config = await connecterGist(jeton, versJSON({ ...etat, versionAppli: VERSION_APPLI }));
    configSync = { jeton: config.jeton, gistId: config.gistId, dernier: null };
    sauverConfigSync(configSync);
    $('#champ-jeton').value = '';
    rendreSync();
    // Un gist préexistant vient d'un autre appareil : on récupère avant
    // d'envoyer, sinon cet appareil-ci écraserait l'historique de l'autre.
    if (config.cree) await envoyerMaintenant();
    else await recupererMaintenant();
    await envoyerMaintenant({ discret: true });
    planifierSyncPeriodique();
    toast(config.cree ? 'Sauvegarde en ligne créée.' : 'Sauvegarde existante retrouvée.');
  } catch (err) {
    toast(err.message);
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Activer la sauvegarde';
  }
}

function deconnecterSync() {
  if (!confirm('Désactiver la sauvegarde en ligne sur cet appareil ?\n\nLa clé est oubliée ici. Le gist et son contenu restent sur GitHub.')) return;
  clearTimeout(minuteurEnvoi);
  clearInterval(minuteurPeriodique);
  configSync = null;
  sauverConfigSync(null);
  rendreSync();
  toast('Sauvegarde en ligne désactivée sur cet appareil.');
}

/* ── Écouteurs ─────────────────────────────────────────────────────── */

function brancher() {
  $$('.onglets button').forEach((b) => b.addEventListener('click', () => afficherVue(b.dataset.vue)));
  window.addEventListener('hashchange', () => afficherVue(location.hash.slice(1)));

  $('#bascule-theme').addEventListener('click', () => {
    const suite = { auto: 'clair', clair: 'sombre', sombre: 'auto' };
    etat.theme = suite[etat.theme] ?? 'auto';
    appliquerTheme();
    persister({ silencieux: true });
    toast(`Thème : ${{ auto: 'système', clair: 'clair', sombre: 'sombre' }[etat.theme]}`);
  });
  $$('#choix-theme .puce').forEach((b) =>
    b.addEventListener('click', () => {
      etat.theme = b.dataset.theme;
      appliquerTheme();
      persister({ silencieux: true });
    }),
  );

  // Navigation de date
  $('#jour-precedent').addEventListener('click', () => allerAuJour(addDays(dateCourante, -1)));
  $('#jour-suivant').addEventListener('click', () => {
    allerAuJour(dateCourante < todayISO() ? addDays(dateCourante, 1) : dateCourante);
  });
  $('#champ-date').addEventListener('change', (e) => allerAuJour(e.target.value || dateCourante));
  $('#libelle-jour').addEventListener('dblclick', () => allerAuJour(todayISO()));

  // Champs du formulaire : enregistrement différé pendant la frappe,
  // immédiat quand on quitte le champ.
  for (const sel of ['#champ-poids', '#champ-calories', '#champ-alcool', '#champ-cafe', '#champ-note']) {
    $(sel).addEventListener('input', enregistrementDiffere);
    $(sel).addEventListener('change', () => {
      clearTimeout(minuteurAuto);
      majEntree(lireFormulaire());
    });
  }

  $('#formulaire-jour').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(minuteurAuto);
    majEntree(lireFormulaire());
    toast('Journée enregistrée.');
  });

  // Raccourcis : ils partent de ce qui est affiché à l'écran, y compris une
  // valeur tapée mais pas encore validée.
  const valeurAffichee = (sel) => {
    const brut = $(sel).value.trim();
    if (brut === '') return null;
    const n = Number(brut.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const appliquer = (champs) => {
    clearTimeout(minuteurAuto);
    majEntree({ ...lireFormulaire(), ...champs });
  };

  $$('#ajouts-calories .puce').forEach((b) =>
    b.addEventListener('click', () => appliquer({ calories: (valeurAffichee('#champ-calories') ?? 0) + Number(b.dataset.ajout) })),
  );
  $('#ajouter-activite').addEventListener('click', () => {
    const ligne = ligneSeance();
    $('#liste-activites').append(ligne);
    rendreEtatSeances();
    $('select', ligne).focus();
  });
  // « Journée sans sport » : zéro minute, ce qui n'est pas la même chose
  // qu'une journée non renseignée — la distinction compte dans les séries.
  $('#activite-repos').addEventListener('click', () => {
    const dejaRepos = estJourneeSansSport(entreeCourante());
    clearTimeout(minuteurAuto);
    majEntree({ ...lireFormulaire(), activites: dejaRepos ? [] : [{ type: '', minutes: 0, calories: null }] });
  });
  $('#alcool-moins').addEventListener('click', () => appliquer({ alcool: Math.max(0, (valeurAffichee('#champ-alcool') ?? 0) - 1) }));
  $('#alcool-plus').addEventListener('click', () => appliquer({ alcool: Math.min(60, (valeurAffichee('#champ-alcool') ?? 0) + 1) }));
  $('#alcool-zero').addEventListener('click', () => appliquer({ alcool: valeurAffichee('#champ-alcool') === 0 ? null : 0 }));
  $('#cafe-moins').addEventListener('click', () => appliquer({ cafe: Math.max(0, (valeurAffichee('#champ-cafe') ?? 0) - 1) }));
  $('#cafe-plus').addEventListener('click', () => appliquer({ cafe: Math.min(30, (valeurAffichee('#champ-cafe') ?? 0) + 1) }));
  $('#cafe-zero').addEventListener('click', () => appliquer({ cafe: valeurAffichee('#champ-cafe') === 0 ? null : 0 }));

  $('#effacer-jour').addEventListener('click', () => {
    if (!etat.entrees[dateCourante]) return;
    if (!confirm(`Effacer les données du ${formatDay(dateCourante, { relative: false })} ?`)) return;
    delete etat.entrees[dateCourante];
    // Sans trace datée, l'appareil d'en face renverrait la journée au prochain
    // échange et elle réapparaîtrait ici.
    etat.suppressions = marquerSupprimee(etat.suppressions ?? {}, dateCourante);
    persister({ silencieux: true });
    rendreJour();
    envoiDiffere();
    toast('Journée effacée.');
  });

  // Bilan
  $$('#filtres-periode .puce').forEach((b) =>
    b.addEventListener('click', () => {
      periode = Number(b.dataset.jours);
      rendreBilan();
    }),
  );

  // Réglages
  for (const sel of ['#objectif-calories', '#objectif-poids', '#objectif-activite', '#objectif-alcool', '#objectif-cafe']) {
    $(sel).addEventListener('change', () => {
      lireObjectifs();
      rendreIndices();
    });
  }
  $('#export-json').addEventListener('click', () => {
    telechargerFichier(`lagoonwatcher-${horodatage()}.json`, versJSON({ ...etat, versionAppli: VERSION_APPLI }), 'application/json');
    toast('Export JSON téléchargé.');
  });
  $('#export-csv').addEventListener('click', () => {
    telechargerFichier(`lagoonwatcher-${horodatage()}.csv`, versCSV(etat.entrees), 'text/csv;charset=utf-8');
    toast('Export CSV téléchargé.');
  });
  $('#bouton-import').addEventListener('click', () => $('#fichier-import').click());
  $('#fichier-import').addEventListener('change', async (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = '';
    if (fichier) await importerFichier(fichier);
  });
  $('#sync-connecter').addEventListener('click', connecterSync);
  $('#champ-jeton').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connecterSync();
    }
  });
  $('#sync-envoyer').addEventListener('click', () => envoyerMaintenant());
  $('#sync-recuperer').addEventListener('click', () => recupererMaintenant());
  $('#sync-deconnecter').addEventListener('click', deconnecterSync);
  // Quitter la page envoie tout de suite ce qui attendait ; y revenir va
  // chercher ce que les autres appareils ont écrit entre-temps.
  document.addEventListener('visibilitychange', () => {
    if (!configSync) return;
    if (document.hidden) {
      clearTimeout(minuteurEnvoi);
      validerSaisieEnAttente();
      envoyerMaintenant({ discret: true, garderEnVie: true });
    } else {
      recupererMaintenant({ discret: true });
    }
  });

  // La vérification de version ne dépend pas de la sauvegarde en ligne : un
  // appareil qui ne synchronise rien doit lui aussi savoir qu'il est périmé.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) verifierVersion();
  });
  // iOS ne déclenche pas toujours visibilitychange en quittant l'appli ;
  // pagehide, lui, est fiable. Les deux mènent au même envoi.
  window.addEventListener('pagehide', () => {
    if (!configSync) return;
    clearTimeout(minuteurEnvoi);
    validerSaisieEnAttente();
    envoyerMaintenant({ discret: true, garderEnVie: true });
  });
  window.addEventListener('focus', () => {
    if (configSync && !document.hidden) recupererMaintenant({ discret: true });
  });
  window.addEventListener('online', () => {
    if (!configSync) return;
    recupererMaintenant({ discret: true });
    envoiDiffere();
  });

  $('#forcer-maj').addEventListener('click', appliquerMiseAJour);
  $('#appliquer-maj').addEventListener('click', appliquerMiseAJour);

  $('#tout-effacer').addEventListener('click', () => {
    const n = Object.keys(etat.entrees).length;
    if (!n) return toast('Il n\'y a rien à effacer.');
    if (!confirm(`Supprimer définitivement ${n} journée(s) ? Cette action est irréversible.`)) return;
    etat.entrees = {};
    etat.suppressions = {};
    persister({ silencieux: true });
    rendreJour();
    rendreReglages();
    toast('Toutes les données ont été supprimées.');
  });

  // Un autre onglet a modifié les données : on se resynchronise.
  window.addEventListener('storage', () => {
    etat = charger();
    appliquerTheme();
    rendreJour();
    const visible = VUES.find((v) => !$(`#vue-${v}`).hidden);
    if (visible === 'bilan') rendreBilan();
    if (visible === 'journal') rendreJournal();
    if (visible === 'reglages') rendreReglages();
  });

  // Le jour peut changer pendant que l'appli reste ouverte. On valide d'abord
  // la saisie en attente : elle appartient au jour affiché, pas à aujourd'hui.
  // Et on ne quitte une journée que si elle est restée vide.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    validerSaisieEnAttente();
    if (dateCourante < todayISO() && !etat.entrees[dateCourante]) allerAuJour(todayISO());
  });
}

/* ── Démarrage ─────────────────────────────────────────────────────── */

construireChampsStatiques();
brancher();
appliquerTheme();
rendreJour();
afficherVue(location.hash.slice(1) || 'jour');

if (configSync) {
  recupererMaintenant({ discret: true });
  planifierSyncPeriodique();
}

verifierVersion();
setInterval(() => {
  if (!document.hidden) verifierVersion();
}, PERIODE_VERSION);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré', err));
  });
}
