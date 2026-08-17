// Helpers de dates. Tout est manipulé en dates locales au format ISO court
// (`YYYY-MM-DD`) : c'est la clé d'un jour de suivi, et ça évite complètement
// les décalages de fuseau qu'on aurait avec des timestamps.

/** @param {Date} d */
export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date locale à midi : pas de surprise au passage à l'heure d'été. */
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Nombre de jours entre deux jours ISO (b - a). */
export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

/** Liste continue de jours ISO, bornes incluses. */
export function daySpan(fromIso, toIso) {
  const out = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Les `n` derniers jours en terminant par `endIso` (inclus). */
export function lastNDays(n, endIso = todayISO()) {
  return daySpan(addDays(endIso, -(n - 1)), endIso);
}

/** Lundi de la semaine du jour donné (semaine ISO). */
export function startOfWeek(iso) {
  const d = fromISO(iso);
  const shift = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « mer. 12 août » — et « aujourd'hui » / « hier » quand c'est le cas. */
export function formatDay(iso, { relative = true, withYear = false } = {}) {
  const today = todayISO();
  if (relative && iso === today) return "aujourd'hui";
  if (relative && iso === addDays(today, -1)) return 'hier';
  const d = fromISO(iso);
  const base = `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
  return withYear || d.getFullYear() !== fromISO(today).getFullYear()
    ? `${base} ${d.getFullYear()}`
    : base;
}

/** Étiquette courte pour un axe de graphique : « 12/08 ». */
export function formatAxisDay(iso) {
  const d = fromISO(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
