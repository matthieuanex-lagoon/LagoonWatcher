// Sauvegarde en ligne dans un gist GitHub privé.
//
// Pourquoi un gist plutôt qu'un serveur : il n'y a rien à héberger, rien à
// payer, et le compte existe déjà. L'appli parle directement à l'API GitHub
// depuis le navigateur (l'API autorise les requêtes inter-origines).
//
// Le jeton vit dans le stockage local, sous une clé distincte des données de
// suivi : ainsi un export de données ne l'emporte jamais avec lui.

const CLE_CONFIG = 'lagoonwatcher.sync';
const API = 'https://api.github.com';
const FICHIER = 'lagoonwatcher.json';
const MARQUEUR = 'LagoonWatcher — sauvegarde de suivi personnel';

export function chargerConfigSync() {
  try {
    const brut = localStorage.getItem(CLE_CONFIG);
    if (!brut) return null;
    const c = JSON.parse(brut);
    return c?.jeton ? { jeton: c.jeton, gistId: c.gistId ?? null, dernier: c.dernier ?? null } : null;
  } catch {
    return null;
  }
}

export function sauverConfigSync(config) {
  if (!config) localStorage.removeItem(CLE_CONFIG);
  else localStorage.setItem(CLE_CONFIG, JSON.stringify(config));
}

/** Erreur porteuse d'un message affichable tel quel. */
class ErreurSync extends Error {}

// Au-delà de cette taille, `keepalive` n'est plus permis par les navigateurs.
const LIMITE_KEEPALIVE = 60 * 1024;

async function appel(jeton, chemin, options = {}) {
  const { garderEnVie = false, ...reste } = options;
  let reponse;
  try {
    reponse = await fetch(`${API}${chemin}`, {
      ...reste,
      // Quitter l'appli interrompt les requêtes en cours — Safari le fait sans
      // ménagement. `keepalive` demande au navigateur de terminer l'envoi même
      // une fois la page partie, ce qui est exactement le cas de l'envoi
      // déclenché au moment où l'on quitte.
      ...(garderEnVie && (reste.body?.length ?? 0) < LIMITE_KEEPALIVE ? { keepalive: true } : {}),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jeton}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    // Rien n'est perdu : les données restent sur l'appareil et le prochain
    // envoi rattrapera. Reste à dire laquelle des deux causes s'applique —
    // hors ligne, ou page qui interdit les connexions sortantes (certains
    // aperçus intégrés le font, et l'échec y est identique à une coupure).
    throw new ErreurSync(
      navigator.onLine
        ? 'Impossible de joindre GitHub. Certains aperçus intégrés bloquent les connexions sortantes : essayez depuis l\'appli publiée.'
        : 'Pas de connexion — la sauvegarde en ligne reprendra plus tard.',
    );
  }

  if (reponse.status === 401) throw new ErreurSync('Clé refusée par GitHub. Elle a peut-être expiré ou été supprimée.');
  if (reponse.status === 403) {
    throw new ErreurSync(
      reponse.headers.get('x-ratelimit-remaining') === '0'
        ? 'Trop de requêtes vers GitHub : réessayez dans une heure.'
        : "Clé sans l'autorisation « gist ». Recréez-la en cochant cette case.",
    );
  }
  if (reponse.status === 404) throw new ErreurSync('Sauvegarde introuvable sur GitHub (gist supprimé ?).');
  if (!reponse.ok) throw new ErreurSync(`GitHub a répondu ${reponse.status}.`);
  return reponse.status === 204 ? null : reponse.json();
}

/**
 * Vérifie la clé et retrouve — ou crée — le gist de sauvegarde.
 * Réutiliser le gist existant évite d'en semer un nouveau à chaque appareil.
 */
export async function connecterGist(jeton, contenuInitial) {
  const gists = await appel(jeton, '/gists?per_page=100');
  const existant = gists.find((g) => g.description === MARQUEUR && g.files?.[FICHIER]);
  if (existant) return { jeton, gistId: existant.id, dernier: null, cree: false };

  const cree = await appel(jeton, '/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: MARQUEUR,
      public: false,
      files: { [FICHIER]: { content: contenuInitial } },
    }),
  });
  return { jeton, gistId: cree.id, dernier: null, cree: true };
}

/** Contenu distant, ou `null` si la sauvegarde est encore vide. */
export async function telechargerGist({ jeton, gistId }) {
  const gist = await appel(jeton, `/gists/${gistId}`);
  const fichier = gist.files?.[FICHIER];
  if (!fichier) return null;
  // Au-delà d'un mégaoctet, GitHub tronque le contenu et ne donne qu'une URL.
  if (fichier.truncated && fichier.raw_url) {
    const brut = await fetch(fichier.raw_url);
    if (!brut.ok) throw new ErreurSync('Sauvegarde illisible sur GitHub.');
    return brut.text();
  }
  return fichier.content ?? null;
}

export async function envoyerGist({ jeton, gistId }, contenu, { garderEnVie = false } = {}) {
  await appel(jeton, `/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FICHIER]: { content: contenu } } }),
    garderEnVie,
  });
  return new Date().toISOString();
}

export { ErreurSync, MARQUEUR, FICHIER };
