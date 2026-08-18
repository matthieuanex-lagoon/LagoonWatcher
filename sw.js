// Service worker : l'appli doit s'ouvrir et fonctionner hors ligne, y compris
// une fois installée sur le téléphone. Aucune donnée de suivi ne passe ici —
// elles vivent dans localStorage, pas dans le cache.

const CACHE = 'lagoonwatcher-v3';

const FICHIERS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/icone.svg',
  './assets/icone-maskable.svg',
  './src/app.js',
  './src/charts.js',
  './src/dates.js',
  './src/model.js',
  './src/store.js',
  './src/sync.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FICHIERS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord, cache en secours : on récupère une mise à jour dès qu'il y a
// du réseau, sans jamais se retrouver bloqué sans lui.
self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET' || new URL(requete.url).origin !== location.origin) return;
  // Le fichier de version sert justement à détecter qu'un cache est périmé :
  // le servir depuis ce cache le rendrait aveugle.
  if (new URL(requete.url).pathname.endsWith('/version.json')) {
    e.respondWith(fetch(requete).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  e.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) caches.open(CACHE).then((c) => c.put(requete, reponse.clone()));
        return reponse;
      })
      .catch(() => caches.match(requete).then((c) => c ?? caches.match('./index.html'))),
  );
});
