// Zdroje ranního shrnutí. Každý zdroj je jeden modul se stejným tvarem:
//   id, title, description, icon   jak se jmenuje a jak ho ukázat v nastavení
//   connection                 jak se připojí: konektor Clauda (services), účet, odkaz v .env, nebo zdarma
//   boxes                      co ukazuje: řádky do „today“, tile s číslem, panel se seznamem, weather
//   defaultOn                  zapnutý, dokud ho uživatel nepřepne (bez defaultOn: false je zapnutý)
//   problem()                  co chybí k připojení (text do nastavení), nebo null
//   options                    výchozí volby, přepíše je ~/.meri/settings.json
//   collect({ now, options, askClaude })  vrátí data pro shrnutí, nebo vyhodí chybu
//   noAI                       sbírá se bez Clauda (kalendář, počasí): obnovuje se zvlášť, zhruba každou čtvrthodinu
//   fingerprint(data)          co z dat se počítá za změnu (bez fingerprint celá data)
// Vypnutý nebo nepropojený zdroj (not-connected.mjs) se nesbírá, Meri o něm nemluví a jeho box na obrazovce není.
// Zdroj, který selže, se jen přeskočí: Meri řekne, že se nenačetl, a v nastavení je u něj „Minule se nenačetl“.
//
// Jádro (Merora Desktop) má Meroru, kalendář, počasí a Gmail. Další zdroje jsou doplňky (Merora DEV):
// moduly ve složce dev/sources vedle jádra (nebo v MERORA_ADDONS), které navíc říkají, co z nich dostane
// model a co se ukáže v okně (dev/README.md). Ve veřejné verzi ta složka není a jádro jede samo.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { askClaude } from '../ai.mjs';
import { getBriefLength, loadSettings, shouldMentionRings, shouldMentionWeather, saveSettings, ownRules, language } from '../settings.mjs';
import { tr } from '../i18n.mjs';
import gmail from './gmail.mjs';
import calendar from './calendar.mjs';
import merora from './merora.mjs';
import weather from './weather.mjs';

const CORE = [merora, calendar, weather, gmail];
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const ADDONS_FOLDER = process.env.MERORA_ADDONS || join(ROOT, 'dev', 'sources');

async function loadAddons(folder) {
  if (!existsSync(folder)) return [];
  const addons = [];
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.mjs')).sort()) {
    try {
      const { default: source } = await import(pathToFileURL(join(folder, file)).href);
      if (!source?.id || typeof source.collect !== 'function') console.warn(`Doplněk ${file} nemá id nebo seber, přeskakuju ho.`);
      else if ([...CORE, ...addons].some((z) => z.id === source.id)) console.warn(`Doplněk ${file}: id „${source.id}“ už má jiný zdroj.`);
      else addons.push({ ...source, addon: true });
    } catch (err) {
      console.warn(`Doplněk ${file} se nenačetl: ${err.message}`);
    }
  }
  return addons.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export const ADDONS = await loadAddons(ADDONS_FOLDER);
export const SOURCES = [...CORE, ...ADDONS];

export const isEnabled = (source, settings) => settings.sources[source.id]?.enabled ?? source.defaultOn !== false;
export const sourceOptions = (source, settings) => {
  const { enabled, ...options } = settings.sources[source.id] ?? {};
  return { ...source.options, ...options };
};

export function enabledSources(settings = loadSettings()) {
  return SOURCES.filter((z) => isEnabled(z, settings));
}

// Zapne nebo vypne zdroj v ~/.meri/settings.json. Vrátí text chyby, nebo null.
export function toggleSource(id, enabled, settings = loadSettings()) {
  if (!SOURCES.some((z) => z.id === id)) return tr('unknownSource');
  if (!enabled && enabledSources(settings).every((z) => z.id === id)) return tr('oneSourceOn');
  saveSettings({ sources: { ...settings.sources, [id]: { ...settings.sources[id], enabled } } });
  return null;
}

// Ze kterého zdroje je box ve shrnutí. Boxy doplňků to mají v poli zdroj. Řádky „dnes“ jádra: r… Merora,
// k… kalendář. Zbytek podle id boxu, i u starších shrnutí a natáčení (chyby a merora tam byly z doplňků).
const BOX_SOURCE = { mails: 'gmail', weather: 'weather', 'reminders-count': 'merora', 'calendar-count': 'calendar', chyby: 'sentry', merora: 'posthog' };
const boxSource = (box) => box.source ?? (/^r\d+$/.test(box.id) ? 'merora' : /^k\d+$/.test(box.id) ? 'calendar' : BOX_SOURCE[box.id]);

// Shrnutí jen se zdroji zapnutými teď: odškrtnutý zdroj zmizí z okna hned, ne až po dalším sběru.
// Monolog zůstává, jak byl, o vypnutém zdroji Meri přestane mluvit po dalším načtení dat.
export function bySettings(data, settings = loadSettings()) {
  const disabled = new Set(SOURCES.filter((z) => !isEnabled(z, settings)).map((z) => z.id));
  if (!disabled.size) return data;
  const boxEnabled = (box) => !disabled.has(boxSource(box));
  return {
    ...data,
    sources: (data.sources ?? SOURCES.map((z) => z.id)).filter((id) => !disabled.has(id)),
    weather: disabled.has('weather') ? null : data.weather,
    today: data.today.filter(boxEnabled),
    tiles: data.tiles.filter(boxEnabled),
    panels: (data.panels ?? []).filter(boxEnabled),
    errors: disabled.has(BOX_SOURCE.chyby) ? [] : data.errors, // jen starší shrnutí a natáčení
    mails: disabled.has('gmail') ? [] : data.mails,
    inbox: disabled.has('gmail') ? undefined : data.inbox,
  };
}

// Posbírá zapnuté zdroje najednou. Výsledek: { [id]: data, nebo null, když zdroj selhal }.
// Vypnutý a nepropojený zdroj ve výsledku vůbec není. Když selžou všechny, shrnutí nemá z čeho vzniknout.
// onSource(id, data): zdroj je hotový (třeba maily, ať okno ukáže jejich dlaždici dřív než celé shrnutí).
export async function collectSources(now = new Date(), settings = loadSettings(), { onSource = null } = {}) {
  const enabledOnes = enabledSources(settings);
  if (!enabledOnes.length) throw new Error(tr('noSourceOn'));
  // Doplňky dostanou askClaude (Claude s konektory), ať nemusí sahat do souborů jádra.
  const results = await Promise.allSettled(
    enabledOnes.map(async (z) => {
      const data = await z.collect({ now, options: sourceOptions(z, settings), askClaude });
      try {
        onSource?.(z.id, data);
      } catch {}
      return data;
    }),
  );
  const sourceData = {};
  enabledOnes.forEach((z, i) => {
    const v = results[i];
    if (v.status === 'fulfilled') {
      sourceData[z.id] = v.value;
      return;
    }
    if (v.reason?.notConnected) return;
    console.warn(`${z.title}: ${v.reason?.message}`);
    sourceData[z.id] = null;
  });
  if (!Object.keys(sourceData).length) throw new Error(tr('nothingConnected'));
  if (Object.values(sourceData).every((v) => v === null)) {
    throw new Error(tr('noSourceLoaded', { names: enabledOnes.filter((z) => z.id in sourceData).map((z) => z.title).join(', ') }));
  }
  return sourceData;
}

// Posbírá jen tyhle zdroje (zapnuté), bez shrnutí. Výsledek: { [id]: data, nebo null, když zdroj selhal }.
// Pro obnovu bez AI (kalendář, počasí) a pro přepis vět nad uloženými daty (tools/brief.mjs --sentences).
export async function collectOnly(ids, now = new Date(), settings = loadSettings()) {
  const selected = enabledSources(settings).filter((z) => ids.includes(z.id));
  const results = await Promise.allSettled(selected.map((z) => z.collect({ now, options: sourceOptions(z, settings), askClaude })));
  const sourceData = {};
  selected.forEach((z, i) => {
    const v = results[i];
    if (v.reason?.notConnected) return;
    if (v.status === 'rejected') console.warn(`${z.title}: ${v.reason?.message}`);
    sourceData[z.id] = v.status === 'fulfilled' ? v.value : null;
  });
  return sourceData;
}

// Otisk dat zdroje: stejný otisk = beze změny. Null, když data nejsou (zdroj se nenačetl nebo je vypnutý).
export function sourceFingerprint(id, data) {
  if (data === null || data === undefined) return null;
  const source = SOURCES.find((z) => z.id === id);
  return createHash('sha1').update(JSON.stringify(source?.fingerprint ? source.fingerprint(data) : data)).digest('hex').slice(0, 12);
}

// Připomínka nebo událost s časem na dnešek: jen o těch Meri mluví a v boxu jsou první (Riccardo, 20. 11.).
// Navíc celodenní události z kalendáře: zapsal si je člověk sám (něčí narozeniny, svátek), Meri je zmíní jednou
// větou (Riccardo 21. 11.). Obecné kalendáře svátků v odkazu na vlastní kalendář nejsou.
export const isSpeakable = (z) =>
  z.kind === 'today' || z.kind === 'today_past' || (z.kind === 'calendar' && (Boolean(z.time) || Boolean(z.allDay)));

// Otisk toho, o čem Meri mluví v monologu: dnešní připomínky a události s časem (název a čas). Když se změní,
// věty shrnutí se přepíšou, až si ho někdo pustí (server.mjs, prehraj). Věc přidaná do seznamu nebo do
// Kdykoli, jiný den a počasí věty nemění, za nové věty a kredity nestojí. Box „Dnes“ se přepíše i tak.
const SENTENCE_SOURCES = ['merora', 'calendar'];
// Krátké shrnutí má v otisku navíc značku: po přepnutí délky v nastavení se věty před dalším přehráním přepíšou.
// Normální značku nemá, ať se shrnutí z doby před volbou nepřepisují zbytečně.
export const fingerprintForSentences = (
  sourceData, briefLength = getBriefLength(), mentionRings = shouldMentionRings(), rules = ownRules(), weather = shouldMentionWeather(), lang = language(),
) =>
  SENTENCE_SOURCES.map((id) => {
    const data = sourceData?.[id];
    if (!Array.isArray(data)) return '-';
    return createHash('sha1').update(JSON.stringify(data.filter(isSpeakable).map((z) => [z.text, z.when]))).digest('hex').slice(0, 12);
  }).join('.') +
  (briefLength === 'short' ? '.kratke' : '') +
  (mentionRings ? '.zvoni' : '') +
  (weather ? '' : '.bezpocasi') +
  (lang === 'cs' ? '' : `.${lang}`) +
  (rules.length ? `.${createHash('sha1').update(JSON.stringify(rules)).digest('hex').slice(0, 6)}` : '');
