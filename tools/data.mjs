// Co Meri právě říká: dnešní shrnutí, a dokud žádné není, ukázková data.
// Při natáčení (`npm run video`) vždy vymyšlený den z data/video.json. Skutečná data se v něm ani nečtou.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateForScreen } from './time.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// MERI_BRIEF jen na zkoušky: jiné shrnutí, které se smí přepsat (třeba změnami z rozhovoru).
export const BRIEF = process.env.MERI_BRIEF || join(ROOT, 'data', 'brief.json');
// Shrnutí zítřka pro přepínač Dnes / Zítra (tools/brief.mjs --tomorrow). Vzniká, až si ho někdo přepne.
export const BRIEF_TOMORROW = process.env.MERI_BRIEF
  ? process.env.MERI_BRIEF.replace(/(\.json)?$/, '-tomorrow.json')
  : join(ROOT, 'data', 'brief-tomorrow.json');
const SAMPLE = join(ROOT, 'data', 'sample.json');
const VIDEO_DATA = join(ROOT, 'data', 'video.json');

export const VIDEO = process.env.MERI_VIDEO === '1' || process.argv.includes('--video');

// Shrnutí uložené do 22. 11. 2026 mělo české klíče a hodnoty. Převede se při čtení, nové už vzniká anglicky.
// Pryč při zveřejnění (do té doby ho přepíše další načtení dat).
const OLD_KEYS = {
  ukazka: 'sample', vytvoreno: 'createdAt', zdroje: 'sources', nenacteno: 'failed', pozdrav: 'greeting', pocasi: 'weather',
  dnes: 'today', prehled: 'tiles', panely: 'panels', maily: 'mails', posta: 'inbox', vety: 'sentences', sber: 'sourceData',
  vetyZ: 'sentencesFingerprint', chyby: 'errors', pripominky: 'reminders', cas: 'time', ikona: 'icon', ton: 'tone', nazev: 'title',
  zdroj: 'source', cislo: 'value', pod: 'caption', podTon: 'captionTone', titulek: 'heading', polozky: 'items', nadpis: 'title',
  predmet: 'subject', kdo: 'who', stitek: 'label', pocet: 'count', vic: 'more', od: 'from', o_cem: 'about', kdy: 'when',
  druh: 'kind', dulezity: 'important', specha: 'urgent', zvyraznit: 'highlight', konce: 'ends', mezera: 'gap', mluvene: 'spoken',
  teplota: 'temperature', srazky: 'precipitation', datum: 'date', sance_na_srazky: 'precipitation_chance', zitra: 'tomorrow',
  nejnizsi: 'lowest', nejvyssi: 'highest', popis: 'description', misto: 'place', smer: 'direction', opakovani: 'repeat',
  kroky: 'steps', zazvonilo: 'rang', razeni: 'sortKey', celodenni: 'allDay',
};
const OLD_SOURCE_IDS = { kalendar: 'calendar', pocasi: 'weather' };
const OLD_IDS = { pocasi: 'weather', maily: 'mails', uzivatele: 'users' };
const OLD_KINDS = {
  po_terminu: 'overdue', dnes_uz_bylo: 'today_past', dnes: 'today', misto: 'place', kdykoli: 'anytime', kalendar: 'calendar',
  seznam: 'list', rutina: 'routine', clovek: 'person', oznameni: 'notification', novinky: 'news',
};
const OLD_ICONS = {
  telefon: 'phone', klapka: 'clapper', kalendar: 'calendar', kosik: 'basket', opakovani: 'repeat', zvonek: 'bell', misto: 'place',
  brouk: 'bug', lide: 'people', mrak: 'cloud', dest: 'rain',
};
const VALUES = { kind: OLD_KINDS, icon: OLD_ICONS, id: OLD_IDS };
const LISTS = { highlight: OLD_IDS, sources: OLD_SOURCE_IDS, failed: OLD_SOURCE_IDS };

function convert(value, key) {
  if (Array.isArray(value)) return value.map((x) => (LISTS[key] && typeof x === 'string' ? LISTS[key][x] ?? x : convert(x, key)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const nk = key === 'sourceData' ? OLD_SOURCE_IDS[k] ?? k : OLD_KEYS[k] ?? k;
        return [nk, convert(v, nk)];
      }),
    );
  }
  return typeof value === 'string' && VALUES[key] ? VALUES[key][value] ?? value : value;
}
export const fromOldBrief = (brief) => (brief && ('vety' in brief || 'dnes' in brief) ? convert(brief, null) : brief);
const readBrief = (file) => fromOldBrief(JSON.parse(readFileSync(file, 'utf8')));

export function currentData() {
  // Jen na zkoušky okna: jiný soubor se shrnutím, třeba s vypnutými zdroji.
  if (process.env.MERI_DATA) return readBrief(process.env.MERI_DATA);
  if (VIDEO) {
    const data = readBrief(VIDEO_DATA);
    // Datum je dnešní, ať nevypadá staře v den natáčení.
    data.weather.date = dateForScreen(new Date());
    return data;
  }
  return readBrief(existsSync(BRIEF) ? BRIEF : SAMPLE);
}

// Shrnutí zítřka, nebo null, když ještě žádné není (natáčení a zkušební MERI_DATA zítřek nemají).
export function tomorrowData() {
  if (VIDEO || process.env.MERI_DATA || !existsSync(BRIEF_TOMORROW)) return null;
  return readBrief(BRIEF_TOMORROW);
}

// Nový zítřek (data bez AI hned po přepnutí, tools/brief.mjs --tomorrow s větami).
export function writeTomorrowBrief(brief) {
  const tempFile = `${BRIEF_TOMORROW}.new`;
  writeFileSync(tempFile, `${JSON.stringify(brief, null, 2)}\n`);
  renameSync(tempFile, BRIEF_TOMORROW);
}

// Změna uloženého zítřka (živá data: Merora, kalendář a počasí na zítřek). Jako updateBrief.
export function updateTomorrowBrief(change) {
  if (VIDEO || process.env.MERI_DATA || !existsSync(BRIEF_TOMORROW)) return null;
  const fresh = change(readBrief(BRIEF_TOMORROW));
  if (!fresh) return null;
  const tempFile = `${BRIEF_TOMORROW}.update`;
  writeFileSync(tempFile, `${JSON.stringify(fresh, null, 2)}\n`);
  renameSync(tempFile, BRIEF_TOMORROW);
  return fresh;
}

// Změna uloženého shrnutí (rozhovor, živá data). zmena dostane shrnutí a vrátí nové, nebo null = beze změny.
// Ve videu a se zkušebním MERI_DATA se nic neukládá. Vrací uložené shrnutí, nebo null.
// Přes vlastní dočasný soubor, ať se nepotká se sběrem (tools/brief.mjs píše přes .new).
export function updateBrief(change) {
  if (VIDEO || process.env.MERI_DATA || !existsSync(BRIEF)) return null;
  const fresh = change(readBrief(BRIEF));
  if (!fresh) return null;
  const tempFile = `${BRIEF}.update`;
  writeFileSync(tempFile, `${JSON.stringify(fresh, null, 2)}\n`);
  renameSync(tempFile, BRIEF);
  return fresh;
}
