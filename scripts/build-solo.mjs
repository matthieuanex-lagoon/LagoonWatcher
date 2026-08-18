// Construit une version en un seul fichier (`lagoonwatcher.solo.html`) : styles
// et modules intégrés, aucune ressource externe. Pratique pour s'envoyer l'appli
// par mail, l'ouvrir depuis un fichier local, ou la publier telle quelle.
import { readFileSync, writeFileSync } from 'node:fs';

const racine = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const lire = (f) => readFileSync(`${racine}/${f}`, 'utf8');

/* ── Corps de la page ─────────────────────────────────────────────── */
const html = lire('index.html');
const corps = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
  .trim();

/* ── Styles ───────────────────────────────────────────────────────── */
// Le visualiseur d'artifact estampille data-theme="dark"/"light" sur la
// racine, alors que l'appli utilise ses propres valeurs (auto/clair/sombre).
// On fait reconnaître les deux, sinon la page rendrait le texte d'un thème
// sur le fond de l'autre.
let css = lire('assets/styles.css')
  .replace(
    "  :root:not([data-theme='clair']) {",
    "  :root:not([data-theme='clair']):not([data-theme='light']) {",
  )
  .replace(":root[data-theme='sombre'] {", ":root[data-theme='sombre'],\n:root[data-theme='dark'] {");

if (!css.includes("[data-theme='dark']") || !css.includes(":not([data-theme='light'])")) {
  throw new Error('Adaptation du thème non appliquée : vérifier les sélecteurs de styles.css');
}

/* ── Modules ──────────────────────────────────────────────────────── */
// Concaténation dans l'ordre des dépendances, mots-clés de module retirés.
// Aucun nom de premier niveau n'est partagé entre les modules (vérifié plus bas).
const ordre = ['src/dates.js', 'src/model.js', 'src/store.js', 'src/charts.js', 'src/app.js'];
const modules = ordre.map((f) => {
  let src = lire(f)
    .replace(/^import\s[\s\S]*?from\s+'[^']+';\n/gm, '')
    .replace(/^export\s+\{[^}]*\};\n/gm, '')
    .replace(/^export\s+(function|const|class|async)/gm, '$1');
  if (f === 'src/app.js') {
    // Pas de service worker dans un artifact : le fichier n'existe pas ici.
    src = src.replace(/if \('serviceWorker' in navigator[\s\S]*?\n}\n/, '');
    if (src.includes('serviceWorker')) throw new Error('Bloc service worker encore présent');
  }
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`Import/export résiduel dans ${f}`);
  return `/* ═══ ${f} ═══ */\n${src.trim()}`;
});

/* ── Garde-fou : pas de collision de noms entre modules ───────────── */
const vus = new Map();
for (const [i, src] of modules.entries()) {
  for (const m of src.matchAll(/^(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const precedent = vus.get(m[1]);
    if (precedent !== undefined && precedent !== i) {
      throw new Error(`Collision de nom « ${m[1]} » entre ${ordre[precedent]} et ${ordre[i]}`);
    }
    vus.set(m[1], i);
  }
}

const sortie = `<title>LagoonWatcher</title>
<style>
${css.trim()}
</style>

${corps}

<script type="module">
${modules.join('\n\n')}
</script>
`;

writeFileSync(`${racine}/lagoonwatcher.solo.html`, sortie);
console.log(`${Math.round(sortie.length / 1024)} Ko · ${vus.size} déclarations de premier niveau, aucune collision`);
