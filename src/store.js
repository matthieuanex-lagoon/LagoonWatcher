// Persistance. Tout reste dans le navigateur (localStorage) : pas de compte,
// pas de serveur, pas de données de santé qui partent ailleurs. La sauvegarde
// se fait par export JSON depuis les réglages.

import { entreeVideOuPas, normaliserEntree, OBJECTIFS_DEFAUT } from './model.js';

const CLE = 'lagoonwatcher.v1';
const VERSION = 1;

function etatVide() {
  return { version: VERSION, entrees: {}, objectifs: { ...OBJECTIFS_DEFAUT }, theme: 'auto' };
}

export function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return etatVide();
    const donnees = JSON.parse(brut);
    return {
      version: VERSION,
      entrees: nettoyerEntrees(donnees.entrees),
      objectifs: { ...OBJECTIFS_DEFAUT, ...(donnees.objectifs ?? {}) },
      theme: ['auto', 'clair', 'sombre'].includes(donnees.theme) ? donnees.theme : 'auto',
    };
  } catch (err) {
    console.error('Données illisibles, on repart à vide', err);
    return etatVide();
  }
}

function nettoyerEntrees(brut) {
  const out = {};
  // Un export peut être un objet indexé par date ou un tableau : on accepte les deux.
  const liste = Array.isArray(brut) ? brut : Object.values(brut ?? {});
  for (const b of liste) {
    const e = normaliserEntree(b);
    if (e && !entreeVideOuPas(e)) out[e.date] = e;
  }
  return out;
}

export function sauver(etat) {
  try {
    localStorage.setItem(
      CLE,
      JSON.stringify({
        version: VERSION,
        entrees: etat.entrees,
        objectifs: etat.objectifs,
        theme: etat.theme,
      }),
    );
    return { ok: true };
  } catch (err) {
    // Quota dépassé : on le remonte à l'appelant pour l'afficher plutôt que de
    // laisser croire que c'est enregistré.
    console.error('Échec de la sauvegarde', err);
    return { ok: false, erreur: err };
  }
}

export function versJSON(etat) {
  return JSON.stringify(
    {
      application: 'LagoonWatcher',
      version: VERSION,
      exporteLe: new Date().toISOString(),
      objectifs: etat.objectifs,
      entrees: Object.values(etat.entrees).sort((a, b) => a.date.localeCompare(b.date)),
    },
    null,
    2,
  );
}

/** Lit un export JSON. Lève une erreur parlante si le fichier n'est pas exploitable. */
export function depuisJSON(texte) {
  const donnees = JSON.parse(texte);
  const liste = Array.isArray(donnees) ? donnees : (donnees.entrees ?? donnees.entries);
  if (!liste) throw new Error("Aucune entrée trouvée dans ce fichier.");
  return {
    entrees: Array.isArray(liste) ? liste : Object.values(liste),
    objectifs: donnees.objectifs ?? null,
  };
}

export { CLE };
