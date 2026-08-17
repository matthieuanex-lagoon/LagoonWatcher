// Graphiques en SVG, sans dépendance. Une seule série par graphique (donc pas
// de légende : le titre de la carte dit ce qui est tracé), survol avec repère
// vertical + infobulle, et le Journal sert de vue tableau équivalente.

import { formatAxisDay, formatDay } from './dates.js';

const NS = 'http://www.w3.org/2000/svg';
const MARGE = { haut: 16, droite: 16, bas: 26, gauche: 46 };

function el(nom, attrs = {}) {
  const n = document.createElementNS(NS, nom);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  return n;
}

/** Graduations « rondes » (1 / 2 / 5 × 10^n) couvrant l'intervalle. */
function graduations(min, max, cible = 4) {
  if (!(max > min)) {
    const v = max ?? 0;
    return [v];
  }
  const brut = (max - min) / cible;
  const magnitude = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= brut) ?? 10 * magnitude;
  const debut = Math.ceil(min / pas) * pas;
  const out = [];
  for (let v = debut; v <= max + pas / 1000; v += pas) out.push(Number(v.toFixed(6)));
  return out;
}

function domaine(valeurs, { zero = false, marge = 0.08, force } = {}) {
  if (force) return force;
  const v = valeurs.filter((x) => typeof x === 'number');
  if (!v.length) return [0, 1];
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (zero) min = Math.min(0, min);
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * marge;
  return [zero ? min : min - pad, max + pad];
}

/** Coins arrondis en haut, carrés sur la ligne de base (spec des marques). */
function cheminColonne(x, y, largeur, hauteur, rayon = 4) {
  const r = Math.max(0, Math.min(rayon, largeur / 2, hauteur));
  return [
    `M${x} ${y + hauteur}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}`,
    `H${x + largeur - r}`,
    `Q${x + largeur} ${y} ${x + largeur} ${y + r}`,
    `V${y + hauteur}`,
    'Z',
  ].join(' ');
}

/**
 * Dessine un graphique dans `hote` et se redessine tout seul au redimensionnement.
 *
 * @param {HTMLElement} hote
 * @param {object} config
 * @param {'ligne'|'colonnes'|'points'} config.type
 * @param {{date: string, valeur: number|null}[]} config.points
 * @param {string} config.couleur       variable CSS de la série
 * @param {string|((v:number)=>string)} [config.unite] texte ou fonction (pour le pluriel)
 * @param {(v:number)=>string} [config.format]
 * @param {{valeur:number,label:string}} [config.objectif] repère horizontal
 * @param {{date:string,valeur:number|null}[]} [config.tendance] courbe secondaire discrète
 * @param {[number,number]} [config.yDomaine]
 * @param {number[]} [config.yGraduations]
 * @param {boolean} [config.zero]        inclure 0 dans l'échelle
 * @param {boolean} [config.relier]      relier les points par-dessus les jours vides
 * @param {number} [config.hauteur]
 */
export function dessinerGraphique(hote, config) {
  const rendu = () => rendre(hote, config);
  rendu();
  if (!hote._observateur) {
    hote._observateur = new ResizeObserver(() => {
      clearTimeout(hote._minuteur);
      hote._minuteur = setTimeout(() => hote._rendu?.(), 60);
    });
    hote._observateur.observe(hote);
  }
  hote._rendu = rendu;
}

function rendre(hote, config) {
  const {
    type = 'ligne',
    points = [],
    couleur = 'var(--serie-1)',
    unite = '',
    format = (v) => arrondir(v),
    objectif = null,
    tendance = null,
    yDomaine,
    yGraduations,
    zero = false,
    relier = false,
    hauteur = 190,
  } = config;

  hote.textContent = '';
  const largeur = Math.max(hote.clientWidth || hote.offsetWidth || 320, 240);
  const renseignes = points.filter((p) => typeof p.valeur === 'number');

  if (!renseignes.length) {
    const vide = document.createElement('p');
    vide.className = 'graphique-vide';
    vide.textContent = 'Pas encore de données sur cette période.';
    hote.append(vide);
    return;
  }

  const aire = {
    x: MARGE.gauche,
    y: MARGE.haut,
    l: largeur - MARGE.gauche - MARGE.droite,
    h: hauteur - MARGE.haut - MARGE.bas,
  };
  const valeursEchelle = points.map((p) => p.valeur);
  if (objectif) valeursEchelle.push(objectif.valeur);
  const [yMin, yMax] = domaine(valeursEchelle, { zero: zero || type === 'colonnes', force: yDomaine });
  const y = (v) => aire.y + aire.h - ((v - yMin) / (yMax - yMin || 1)) * aire.h;
  const bande = aire.l / points.length;
  const x = (i) => aire.x + bande * (i + 0.5);

  const svg = el('svg', {
    viewBox: `0 0 ${largeur} ${hauteur}`,
    width: largeur,
    height: hauteur,
    role: 'img',
    tabindex: '0',
    'aria-label': resumeAccessible(config, renseignes),
  });
  svg.style.setProperty('--serie', couleur);

  // Grille et axe Y — filets solides, une nuance au-dessus du fond.
  const gGrille = el('g', { class: 'grille' });
  for (const t of yGraduations ?? graduations(yMin, yMax)) {
    if (t < yMin - 1e-9 || t > yMax + 1e-9) continue;
    gGrille.append(el('line', { x1: aire.x, x2: aire.x + aire.l, y1: y(t), y2: y(t), class: 'ligne-grille' }));
    const etiquette = el('text', { x: aire.x - 8, y: y(t) + 4, class: 'graduation', 'text-anchor': 'end' });
    etiquette.textContent = formatGraduation(t);
    gGrille.append(etiquette);
  }
  svg.append(gGrille);

  // Axe X : premier, milieu, dernier — juste assez pour se repérer.
  const gAxe = el('g', { class: 'axe-x' });
  const indicesAxe = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  for (const i of indicesAxe) {
    const t = el('text', {
      x: Math.min(Math.max(x(i), aire.x + 12), aire.x + aire.l - 12),
      y: hauteur - 8,
      class: 'graduation',
      'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle',
    });
    t.textContent = formatAxisDay(points[i].date);
    gAxe.append(t);
  }
  gAxe.append(el('line', { x1: aire.x, x2: aire.x + aire.l, y1: aire.y + aire.h, y2: aire.y + aire.h, class: 'ligne-base' }));
  svg.append(gAxe);

  const gData = el('g', { class: 'donnees' });

  if (type === 'colonnes') {
    const largeurCol = Math.min(24, Math.max(2, bande - 2)); // l'écart de 2px sépare les voisines
    for (const [i, p] of points.entries()) {
      if (typeof p.valeur !== 'number' || p.valeur === 0) continue;
      const hautCol = Math.max(1.5, y(Math.min(yMin, 0)) - y(p.valeur));
      gData.append(
        el('path', {
          d: cheminColonne(x(i) - largeurCol / 2, y(p.valeur), largeurCol, hautCol),
          class: 'colonne',
        }),
      );
    }
    // Un jour saisi à zéro n'est pas un jour vide : petit trait sur la base.
    for (const [i, p] of points.entries()) {
      if (p.valeur !== 0) continue;
      gData.append(
        el('line', {
          x1: x(i) - Math.min(12, largeurCol / 2),
          x2: x(i) + Math.min(12, largeurCol / 2),
          y1: aire.y + aire.h,
          y2: aire.y + aire.h,
          class: 'colonne-zero',
        }),
      );
    }
  } else if (type === 'points') {
    for (const [i, p] of points.entries()) {
      if (typeof p.valeur !== 'number') continue;
      gData.append(el('circle', { cx: x(i), cy: y(p.valeur), r: 4.5, class: 'point' }));
    }
  } else {
    for (const segment of segments(points, relier)) {
      gData.append(
        el('path', {
          d: segment.map((s, k) => `${k ? 'L' : 'M'}${x(s.i)} ${y(s.valeur)}`).join(' '),
          class: 'ligne',
        }),
      );
    }
    for (const [i, p] of points.entries()) {
      if (typeof p.valeur !== 'number') continue;
      gData.append(el('circle', { cx: x(i), cy: y(p.valeur), r: 3.5, class: 'point-ligne' }));
    }
  }

  if (tendance) {
    for (const segment of segments(tendance, relier)) {
      if (segment.length < 2) continue;
      gData.append(
        el('path', {
          d: segment.map((s, k) => `${k ? 'L' : 'M'}${x(s.i)} ${y(s.valeur)}`).join(' '),
          class: 'ligne-tendance',
        }),
      );
    }
  }

  svg.append(gData);

  // Repère d'objectif tracé après les marques : un seuil masqué par une
  // colonne ne sert à rien. L'étiquette porte un halo couleur fond (paint-order)
  // pour rester lisible là où elle croise une colonne.
  if (objectif && objectif.valeur >= yMin && objectif.valeur <= yMax) {
    const g = el('g', { class: 'objectif' });
    g.append(el('line', { x1: aire.x, x2: aire.x + aire.l, y1: y(objectif.valeur), y2: y(objectif.valeur), class: 'ligne-objectif' }));
    const t = el('text', { x: aire.x + 3, y: y(objectif.valeur) - 6, class: 'etiquette-objectif', 'text-anchor': 'start' });
    t.textContent = objectif.label;
    g.append(t);
    svg.append(g);
  }

  // Étiquetage sélectif : la dernière valeur, et l'extrême si elle est ailleurs.
  const dernier = [...points].map((p, i) => ({ ...p, i })).filter((p) => typeof p.valeur === 'number').at(-1);
  const extreme = [...points]
    .map((p, i) => ({ ...p, i }))
    .filter((p) => typeof p.valeur === 'number')
    .reduce((a, b) => (b.valeur > a.valeur ? b : a));
  const gEtiquettes = el('g', { class: 'etiquettes' });
  for (const p of dedoublonner([dernier, extreme])) {
    const t = el('text', {
      x: Math.min(Math.max(x(p.i), aire.x + 4), aire.x + aire.l - 4),
      y: Math.max(y(p.valeur) - 10, aire.y + 9),
      class: 'etiquette-valeur',
      'text-anchor': p.i > points.length * 0.75 ? 'end' : p.i < points.length * 0.25 ? 'start' : 'middle',
    });
    t.textContent = `${format(p.valeur)}${uniteDe(unite, p.valeur)}`;
    gEtiquettes.append(t);
  }
  svg.append(gEtiquettes);

  // Couche de survol : repère vertical + infobulle, plus le clavier (flèches).
  const repere = el('line', { y1: aire.y, y2: aire.y + aire.h, class: 'repere', visibility: 'hidden' });
  const marqueur = el('circle', { r: 5.5, class: 'marqueur-survol', visibility: 'hidden' });
  svg.append(repere, marqueur);

  const bulle = document.createElement('div');
  bulle.className = 'infobulle';
  bulle.hidden = true;
  hote.append(svg, bulle);

  let indexActif = -1;
  const viser = (i) => {
    const p = points[i];
    if (!p) return masquer();
    indexActif = i;
    repere.setAttribute('x1', x(i));
    repere.setAttribute('x2', x(i));
    repere.setAttribute('visibility', 'visible');
    if (typeof p.valeur === 'number') {
      marqueur.setAttribute('cx', x(i));
      marqueur.setAttribute('cy', y(p.valeur));
      marqueur.setAttribute('visibility', 'visible');
    } else marqueur.setAttribute('visibility', 'hidden');
    bulle.hidden = false;
    bulle.innerHTML = '';
    const jour = document.createElement('strong');
    jour.textContent = formatDay(p.date, { relative: false });
    const val = document.createElement('span');
    val.textContent =
      typeof p.valeur === 'number' ? `${format(p.valeur)}${uniteDe(unite, p.valeur)}` : 'non renseigné';
    bulle.append(jour, val);
    const gauche = Math.min(Math.max(x(i) - bulle.offsetWidth / 2, 4), largeur - bulle.offsetWidth - 4);
    bulle.style.left = `${gauche}px`;
    const ancre = typeof p.valeur === 'number' ? y(p.valeur) - bulle.offsetHeight - 12 : aire.y;
    bulle.style.top = `${Math.min(Math.max(ancre, 0), hauteur - bulle.offsetHeight)}px`;
  };
  const masquer = () => {
    indexActif = -1;
    repere.setAttribute('visibility', 'hidden');
    marqueur.setAttribute('visibility', 'hidden');
    bulle.hidden = true;
  };

  const indexDepuisX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * largeur;
    return Math.min(points.length - 1, Math.max(0, Math.floor((px - aire.x) / bande)));
  };
  svg.addEventListener('pointermove', (e) => viser(indexDepuisX(e.clientX)));
  svg.addEventListener('pointerdown', (e) => viser(indexDepuisX(e.clientX)));
  svg.addEventListener('pointerleave', masquer);
  svg.addEventListener('blur', masquer);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const depart = indexActif === -1 ? (e.key === 'ArrowRight' ? -1 : points.length) : indexActif;
      viser(Math.min(points.length - 1, Math.max(0, depart + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') masquer();
  });
}

/** Tronçons continus (on ne relie pas deux points séparés par un jour vide). */
/** L'unité peut dépendre de la valeur : « 1 verre » mais « 3 verres ». */
function uniteDe(unite, valeur) {
  const texte = typeof unite === 'function' ? unite(valeur) : unite;
  return texte ? ` ${texte}` : '';
}

/**
 * Tronçons à relier. Par défaut, un jour vide coupe le trait : pour des calories
 * ou des minutes de sport, relier deux jours distants inventerait une continuité
 * qui n'existe pas. Avec `relier`, tous les points renseignés forment un seul
 * tracé — c'est ce qu'on veut pour le poids, qui existe aussi les jours sans
 * pesée (l'axe X reste le temps réel, donc la pente ne ment pas).
 */
function segments(points, relier = false) {
  if (relier) {
    const marques = points.map((p, i) => ({ i, valeur: p.valeur })).filter((p) => typeof p.valeur === 'number');
    return marques.length ? [marques] : [];
  }
  const out = [];
  let cur = [];
  for (const [i, p] of points.entries()) {
    if (typeof p.valeur === 'number') cur.push({ i, valeur: p.valeur });
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function dedoublonner(liste) {
  const vus = new Set();
  return liste.filter((p) => p && !vus.has(p.i) && vus.add(p.i));
}

function arrondir(v) {
  if (Math.abs(v) >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

function formatGraduation(v) {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}k`;
  if (Number.isInteger(v)) return v.toLocaleString('fr-FR');
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function resumeAccessible(config, renseignes) {
  const vals = renseignes.map((p) => p.valeur);
  const f = config.format ?? arrondir;
  const max = Math.max(...vals);
  return `${config.titre ?? 'Graphique'} : ${renseignes.length} jours renseignés, de ${f(Math.min(...vals))} à ${f(
    max,
  )}${uniteDe(config.unite ?? '', max)}. Valeurs détaillées dans le Journal.`.trim();
}

/** Mini-courbe des tuiles de synthèse (12 derniers points, sans axes). */
export function dessinerSparkline(hote, points, { couleur = 'var(--serie-1)', type = 'ligne' } = {}) {
  hote.textContent = '';
  const l = 88;
  const h = 26;
  const derniers = points.slice(-12);
  const vals = derniers.map((p) => p.valeur).filter((v) => typeof v === 'number');
  if (vals.length < 2) return;
  const min = Math.min(...vals, type === 'colonnes' ? 0 : Math.min(...vals));
  const max = Math.max(...vals);
  const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const bande = l / derniers.length;
  const svg = el('svg', { viewBox: `0 0 ${l} ${h}`, width: l, height: h, class: 'sparkline', 'aria-hidden': 'true' });
  svg.style.setProperty('--serie', couleur);
  if (type === 'colonnes') {
    for (const [i, p] of derniers.entries()) {
      if (typeof p.valeur !== 'number' || p.valeur === 0) continue;
      const larg = Math.max(2, bande - 2);
      svg.append(el('rect', { x: i * bande + 1, y: y(p.valeur), width: larg, height: Math.max(1.5, h - 3 - y(p.valeur)), rx: 1.5, class: 'colonne' }));
    }
  } else {
    for (const segment of segments(derniers)) {
      if (segment.length < 2) continue;
      svg.append(
        el('path', {
          d: segment.map((s, k) => `${k ? 'L' : 'M'}${s.i * bande + bande / 2} ${y(s.valeur)}`).join(' '),
          class: 'ligne',
        }),
      );
    }
  }
  hote.append(svg);
}
