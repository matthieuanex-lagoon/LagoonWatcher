// Persistance. Tout reste dans le navigateur (localStorage) : pas de compte,
// pas de serveur, pas de données de santé qui partent ailleurs. La sauvegarde
// se fait par export JSON depuis les réglages.

import { elaguerSuppressions, entreeVideOuPas, normaliserEntree, OBJECTIFS_DEFAUT } from './model.js';

const CLE = 'lagoonwatcher.v1';
const VERSION = 1;

function etatVide() {
  return { version: VERSION, entrees: {}, suppressions: {}, objectifs: { ...OBJECTIFS_DEFAUT }, theme: 'auto' };
}

export function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return etatVide();
    const donnees = JSON.parse(brut);
    return {
      version: VERSION,
      entrees: nettoyerEntrees(donnees.entrees),
      suppressions: elaguerSuppressions(nettoyerSuppressions(donnees.suppressions)),
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

/** Ne garde que des couples date → horodatage exploitables. */
function nettoyerSuppressions(brut) {
  const out = {};
  for (const [date, quand] of Object.entries(brut ?? {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof quand === 'string' && !Number.isNaN(Date.parse(quand))) {
      out[date] = quand;
    }
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
        suppressions: etat.suppressions ?? {},
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
      versionAppli: etat.versionAppli ?? null,
      objectifs: etat.objectifs,
      suppressions: etat.suppressions ?? {},
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
    suppressions: donnees.suppressions ?? {},
    objectifs: donnees.objectifs ?? null,
  };
}

/**
 * Demande au navigateur de ne pas évincer les données de ce site. Sans ça,
 * Chrome et Safari peuvent les effacer sous pression de stockage ou après une
 * période d'inactivité — et tout part d'un coup, y compris la clé de
 * sauvegarde en ligne. La demande est silencieuse sur Chrome (accordée selon
 * l'usage du site, garantie pour une appli installée) ; ailleurs elle peut
 * être refusée sans que ce soit une erreur.
 */
export async function assurerStockagePersistant() {
  try {
    if (!navigator.storage?.persist) return { disponible: false };
    const dejaAccorde = await navigator.storage.persisted?.();
    const persistant = dejaAccorde || (await navigator.storage.persist());
    const { usage, quota } = (await navigator.storage.estimate?.()) ?? {};
    return { disponible: true, persistant, usage, quota };
  } catch {
    return { disponible: false };
  }
}

export { CLE };
