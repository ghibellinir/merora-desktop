// Nastavení Meri: které zdroje jsou zapnuté a jejich volby. Leží mimo repo v ~/.meri/settings.json,
// ať se osobní věci nedostanou do gitu. Když soubor chybí, platí výchozí hodnoty ze zdrojů.
// Tvar: { "voice": false, "refreshHours": 3, "meroraLive": true, "briefLength": "short", "mentionRings": false,
//   "rules": ["…"], "sources": { "gmail": { "enabled": false }, "weather": { "enabled": true } } }
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadEnv } from './elevenlabs.mjs';

export const SETTINGS = process.env.MERI_SETTINGS || join(homedir(), '.meri', 'settings.json');

// Do 22. 11. 2026 bylo nastavení v ~/.meri/nastaveni.json a mělo české klíče. Převede se při čtení a starý
// soubor se jednou přepíše do settings.json (zůstane vedle, nic se nemaže). Pryč při zveřejnění.
const OLD_FILE = join(homedir(), '.meri', 'nastaveni.json');
const OLD_KEYS = {
  hlas: 'voice', obnova: 'refreshHours', meroraHned: 'meroraLive', delka: 'briefLength', zazvoneni: 'mentionRings',
  pravidla: 'rules', osloveni: 'salutation', rod: 'gender', poloha: 'location', uvitano: 'welcomed', zdroje: 'sources',
};
const OLD_VALUES = { gender: { muz: 'male', zena: 'female' }, briefLength: { kratke: 'short', normalni: 'normal' } };
const OLD_LOCATION = { mesto: 'city', sirka: 'latitude', delka: 'longitude' };
const OLD_SOURCE_IDS = { kalendar: 'calendar', pocasi: 'weather' };
const OLD_OPTIONS = { zapnuto: 'enabled', organizace: 'organization', projekt: 'project', bezCohorty: 'withoutCohort', nazev: 'title', testeri: 'testers' };
const renameKeys = (o, map) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [map[k] ?? k, v]));

export function fromOldSettings(n) {
  const out = renameKeys(n, OLD_KEYS);
  for (const [key, values] of Object.entries(OLD_VALUES)) if (Object.hasOwn(values, out[key] ?? '')) out[key] = values[out[key]];
  if (out.location) out.location = renameKeys(out.location, OLD_LOCATION);
  if (out.sources) {
    out.sources = Object.fromEntries(Object.entries(out.sources).map(([id, o]) => [OLD_SOURCE_IDS[id] ?? id, renameKeys(o, OLD_OPTIONS)]));
  }
  return out;
}

function writeFile(n) {
  mkdirSync(dirname(SETTINGS), { recursive: true });
  const tempFile = `${SETTINGS}.new`;
  writeFileSync(tempFile, `${JSON.stringify(n, null, 2)}\n`);
  renameSync(tempFile, SETTINGS);
}

export function loadSettings() {
  if (!existsSync(SETTINGS) && !process.env.MERI_SETTINGS && existsSync(OLD_FILE)) {
    try {
      writeFile(fromOldSettings(JSON.parse(readFileSync(OLD_FILE, 'utf8'))));
    } catch {
      // starý soubor nejde přečíst: platí výchozí nastavení, jako by žádný nebyl
    }
  }
  if (!existsSync(SETTINGS)) return { sources: {} };
  try {
    const n = fromOldSettings(JSON.parse(readFileSync(SETTINGS, 'utf8')));
    return { ...n, sources: n.sources ?? {} };
  } catch {
    // Jazyk je v tomhle souboru, takže nejde poznat: hláška je v obou.
    throw new Error(
      `Nastavení ${SETTINGS} nejde přečíst. Oprav ho, nebo ho smaž a platí výchozí. / The settings file cannot be read. Fix it, or delete it to use the defaults.`,
    );
  }
}

// Zapíše změnu (třeba { voice: false }) a vrátí celé nastavení. Přes dočasný soubor, ať se nikdy nerozbije napůl.
export function saveSettings(change) {
  const n = { ...loadSettings(), ...change };
  writeFile(n);
  return n;
}

// Kdo Meri používá: oslovení (tak, jak ho má oslovit, v 5. pádě: „Riki“, „Jano“, „Petře“), rod (male / female,
// čeština podle něj mění tvary: „chtěl jsi“ / „chtěla jsi“), město pro počasí a jestli prošel úvodem.
export function profile(n = loadSettings()) {
  return {
    salutation: String(n.salutation ?? '').trim().slice(0, 40),
    gender: n.gender === 'female' ? 'female' : 'male',
    location: n.location ?? null, // { city, latitude, longitude }
    welcomed: Boolean(n.welcomed),
  };
}

// Tvary pro texty Meri podle rodu.
export const forms = (gender) =>
  gender === 'female'
    ? { towards: 'k ženě', wanted: 'chtěla', accusative: 'ji', dative: 'jí', pronoun: 'ona' }
    : { towards: 'k muži', wanted: 'chtěl', accusative: 'ho', dative: 'mu', pronoun: 'on' };

// Jak často si Meri sama načte nová data, v hodinách (jen s otevřeným oknem, potichu a bez hlasu).
// 0 = jen ručně (R, šipka vpravo nahoře). Bez volby každé 3 hodiny.
export const REFRESH_INTERVALS = [1, 2, 3, 6, 12, 24, 0];
export const getRefreshHours = (n = loadSettings()) => (REFRESH_INTERVALS.includes(n.refreshHours) ? n.refreshHours : 3);
// Merora hned po změně (výchozí zapnuto): s otevřeným oknem se připomínky čtou zvlášť od ostatních dat,
// při otevření a fokusu okna, při ⌥M / Alt+M a každou minutu. Vypnutá se načítá s ostatními podle intervalu.
export const meroraLive = (n = loadSettings()) => n.meroraLive !== false;

// Délka shrnutí (Riccardo 21. 11.): normální 2 až 8 vět (asi půl minuty), krátké 2 až 4 věty (asi 15 s).
export const BRIEF_LENGTHS = {
  normal: { sentences: '2 až 8 vět', maxSentences: 8, total: 400, short: false },
  short: { sentences: '2 až 4 věty', maxSentences: 4, total: 220, short: true },
};
export const getBriefLength = (n = loadSettings()) => (n.briefLength === 'short' ? 'short' : 'normal');
// Má Meri ve shrnutí říkat, kolikrát připomínka zvonila? Výchozí ne, může to znít jako výčitka (Riccardo 21. 11.).
// Na obrazovce v boxu „Dnes“ počet zůstává.
export const shouldMentionRings = (n = loadSettings()) => n.mentionRings === true;
// Box „Dnes“ i se včerejšími nedodělanými (po termínu ze včerejška), nebo jen s dnešními. Výchozí jen dnešní,
// ne každý o včerejšek stojí (Riccardo 22. 11.). Starší než včerejší se neukazují nikdy. Meri o nich nemluví.
export const showYesterday = (n = loadSettings()) => n.showYesterday === true;
// Jazyk Meri a okna (Riccardo 23. 11.: angličtina hned v první veřejné verzi). Bez volby čeština.
export const LANGUAGES = ['cs', 'en'];
export const language = (n = loadSettings()) => (LANGUAGES.includes(n.language) ? n.language : 'cs');
// Má Meri ve shrnutí mluvit o počasí? Výchozí ano, karta počasí zůstává vždycky (Riccardo 22. 11.).
export const shouldMentionWeather = (n = loadSettings()) => n.mentionWeather !== false;
// Chystat zítřek předem, hned po načtení dneška (stojí jedno volání Clauda, kredity ElevenLabs ne). Výchozí ne.
export const preloadTomorrow = (n = loadSettings()) => n.preloadTomorrow === true;

// Vlastní pravidla pro Meri (nastavení › Pravidla, Riccardo 21. 11.): věty, které dostane model u shrnutí, rozhovoru
// a třídění mailů. Pevná pravidla (pravda, soukromí, mazání jen po ano, jen čtení mailů a kalendáře) nepřebijí.
export const MAX_RULES = 10;
export const MAX_RULE = 200;
export const ownRules = (n = loadSettings()) =>
  (Array.isArray(n.rules) ? n.rules : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE))
    .slice(0, MAX_RULES);
export function rulesForModel(n = loadSettings()) {
  const p = ownRules(n);
  if (!p.length) return '';
  const head = language(n) === 'en'
    ? 'Own rules (the user wrote them in settings). Follow them unless they go against the rules above about truth, privacy and what you can do'
    : 'Vlastní pravidla (napsal si je sám uživatel v nastavení). Drž se jich, pokud nejdou proti pravidlům výš o pravdě, soukromí a tom, co umíš';
  return `\n\n${head}:\n${p.map((x) => `- ${x}`).join('\n')}`;
}

// Hlas je placený (ElevenLabs). Bez klíče nebo vypnutý Meri nic nenamlouvá a jen píše do bubliny, zdarma.
export const hasVoiceKey = () => Boolean(loadEnv().ELEVENLABS_API_KEY);
export const voiceEnabled = (n = loadSettings()) => (n.voice ?? true) && hasVoiceKey();
