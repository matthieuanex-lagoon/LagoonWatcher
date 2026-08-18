import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

/**
 * Le bandeau de mise à jour compare la version du code à celle servie par
 * `version.json`. Si les deux divergent, il s'affiche en permanence ou jamais
 * — les deux pannes étant silencieuses, ce test est leur seul garde-fou.
 */
test('version.json est aligné sur VERSION_APPLI', () => {
  const codeVersion = lire('src/app.js').match(/VERSION_APPLI = '([^']+)'/)?.[1];
  const fichierVersion = JSON.parse(lire('version.json')).version;
  assert.ok(codeVersion, 'VERSION_APPLI introuvable dans src/app.js');
  assert.equal(fichierVersion, codeVersion);
});

test('version.json est servi hors ligne et mis en cache par le service worker', () => {
  const sw = lire('sw.js');
  // Il doit être exclu du cache : c'est lui qui détecte qu'un cache est périmé.
  assert.match(sw, /version\.json/);
  assert.doesNotMatch(
    lire('sw.js').match(/const FICHIERS = \[[\s\S]*?\];/)[0],
    /version\.json/,
    "version.json ne doit pas figurer dans la liste des fichiers mis en cache",
  );
});

test('chaque module du site est mis en cache par le service worker', () => {
  const listeSw = lire('sw.js').match(/const FICHIERS = \[[\s\S]*?\];/)[0];
  const modules = [...lire('index.html').matchAll(/src="(src\/[^"]+)"/g)].map((m) => m[1]);
  // app.js est le seul module référencé par la page ; les autres viennent de
  // ses imports. On vérifie que tous les fichiers de src/ y figurent.
  assert.ok(modules.includes('src/app.js'));
  for (const f of ['app', 'charts', 'dates', 'model', 'store', 'sync']) {
    assert.match(listeSw, new RegExp(`src/${f}\\.js`), `src/${f}.js absent du cache hors ligne`);
  }
});
