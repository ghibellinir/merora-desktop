// Živá data bez AI a bez hlasu: Merora hned po změně (server.mjs, readMeroraNow) a kalendář s počasím
// zhruba každou čtvrthodinu. Nová data jednoho zdroje se zapíšou do shrnutí (sber), box „Dnes“ a karta
// počasí se podle nich přepíšou a okno je přepíše na místě. Věty zůstávají, jak jsou: přepíšou se až ve
// chvíli, kdy si shrnutí někdo pustí (sentencesStale, tools/brief.mjs --sentences), ať se za hlas platí jen to,
// co opravdu zazní.
import { safeTitle, isSpeakable, weatherForScreen, withDayTiles, mailBoxes, composeBrief } from './brief.mjs';
import { shorten, sortLines, insertLine } from './lines.mjs';
import { tr } from './i18n.mjs';
import { fingerprintForSentences, sourceFingerprint } from './sources/index.mjs';

// Řádky zdroje v boxu: r… Merora, k… kalendář. Kalendář má id podle pořadí (po nové události se posunou),
// proto se páruje podle názvu a času.
const MATCHING = {
  merora: { belongs: (r) => /^r\d+$/.test(r.id), key: (z) => z.id },
  calendar: { belongs: (r) => /^k\d+$/.test(r.id), key: (z) => `${z.text}|${z.when ?? ''}` },
};

const iconForItem = (z) => (z.kind === 'calendar' ? 'calendar' : z.place ? 'place' : z.repeat ? 'repeat' : 'bell');

// Nový řádek bez modelu: krátký text připomínky nebo události, čas a barva ze zdroje.
export const lineForItem = (z) => ({
  id: z.id,
  icon: iconForItem(z),
  tone: z.tone,
  title: safeTitle(shorten(z.text)),
  ...(z.time ? { time: z.time } : {}),
  ...(z.allDay ? { allDay: true } : {}),
  ...(z.kind === 'overdue' ? { overdue: true } : {}),
  meta: z.allDay ? tr('allDayMeta') : '',
});

// Box „Dnes“ po nových datech zdroje. stara: data, ze kterých box vznikl (null u staršího shrnutí bez nich).
// - Řádek, jehož položka zmizela (hotová, smazaná, přesunutá na jiný den), zmizí.
// - Řádek, jehož položka se změnila, dostane nový čas a barvu. Název a meta od modelu zůstávají, dokud se
//   nezmění text (nový název z textu) nebo čas (meta pryč, třeba „zazvonilo 3×“ už neplatí).
// - Dnešní s časem v boxu být musí (jako ve shrnutí), ostatní nové od minula jen na volné místo.
export function rewriteLines(today, id, old, created) {
  const { belongs, key } = MATCHING[id];
  // Bez starých dat kalendář spárovat nejde. Zůstane, jak je, do dalšího načtení všech dat.
  if (id === 'calendar' && !old) return today;
  const byId = new Map((old ?? []).map((z) => [z.id, z]));
  const byKey = new Map(created.map((z) => [key(z), z]));
  const known = new Set((old ?? []).map(key));
  let lines = [];
  for (const r of today) {
    if (!belongs(r)) {
      lines.push(r);
      continue;
    }
    const original = byId.get(r.id) ?? null;
    const z = byKey.get(original ? key(original) : r.id);
    if (!z) continue;
    const otherText = Boolean(original) && original.text !== z.text;
    const otherTime = original ? original.sortKey !== z.sortKey : (r.time ?? null) !== (z.time ?? null);
    const { time, ...withoutTime } = r;
    lines.push({
      ...withoutTime,
      id: z.id,
      tone: z.tone,
      ...(z.time ? { time: z.time } : {}),
      ...(otherText ? { title: safeTitle(shorten(z.text)) } : {}),
      ...(otherText || otherTime ? { meta: '' } : {}),
    });
  }
  for (const z of created) {
    if (lines.some((r) => r.id === z.id)) continue;
    const newSinceLast = Boolean(old) && !known.has(key(z));
    // Kdykoli (jen na vlastní pravidlo) přidává do boxu jen shrnutí, podle pravidla. Živě ne.
    if (z.kind !== 'anytime' && (isSpeakable(z) || z.kind === 'overdue' || newSinceLast)) lines = insertLine(lines, lineForItem(z));
  }
  return sortLines(lines);
}

// Zítřek po novém načtení mailů dneška (Riccardo 23. 11.: Dnes ukazovalo 6 mailů a Zítra 5, zítřek měl kopii
// z doby, kdy vznikl). Přepočítá se dlaždice a panel Maily na zítřek, bez Clauda. Jen u zítřka: dnešek má maily
// ze sběru. Věty zítřka zůstávají, přepíšou se s dalším načtením zítřka.
function mailsForTomorrow(brief, data, now) {
  if (brief.day !== 'tomorrow' || data === undefined) return null;
  if (JSON.stringify(brief.sourceData?.gmail ?? null) === JSON.stringify(data)) return null;
  const box = mailBoxes(data, [], now, { tomorrow: true });
  const tiles = brief.tiles.some((d) => d.id === 'mails') ? brief.tiles.map((d) => (d.id === 'mails' ? box.tile : d)) : brief.tiles;
  return { ...brief, sourceData: { ...brief.sourceData, gmail: data }, tiles, mails: box.mails, importantMails: box.count, mailsHeading: box.heading };
}

// Co se mění jen s časem, i když se v Meroře ani v kalendáři nic nezměnilo (Riccardo 23. 11.: připomínka
// z 10:05 svítila v okně modře ještě odpoledne, v telefonu už oranžově): barva řádku připomínky, která už
// proběhla, a dlaždice („Zbývá 1“, „Další v 10:50“). Věty kvůli tomu nezastarají (otisk vět je jen název a čas).
// Vrátí shrnutí s novými daty zdroje, nebo null, když se na obrazovce nic nemění.
function byTime(brief, id, data, now) {
  if (id !== 'merora' && id !== 'calendar') return null;
  const tones = new Map((id === 'merora' ? data ?? [] : []).map((z) => [z.id, z.tone]));
  const today = brief.today.map((r) => (tones.has(r.id) && tones.get(r.id) !== r.tone ? { ...r, tone: tones.get(r.id) } : r));
  const sourceData = { ...brief.sourceData, [id]: data };
  const tiles = withDayTiles(brief.tiles, sourceData, now, { tomorrow: brief.day === 'tomorrow' });
  if (JSON.stringify(today) === JSON.stringify(brief.today) && JSON.stringify(tiles) === JSON.stringify(brief.tiles)) return null;
  return { ...brief, sourceData, today, tiles };
}

// Den, který se teprve načítá (tools/pending.mjs), dostal data dalšího zdroje: složí se znovu z toho, co už je, a co
// ještě není, má dál kolečko. data null: zdroj se nenačetl. data undefined: zdroj už propojený není, z okna zmizí.
const CORE_TILE = { merora: 'reminders-count', calendar: 'calendar-count', gmail: 'mails' };
export function fillPending(brief, id, data, now = new Date()) {
  const tomorrow = brief.day === 'tomorrow';
  const pending = brief.pending.filter((x) => x !== id);
  if (data === undefined) {
    return {
      ...brief,
      pending,
      sources: brief.sources.filter((x) => x !== id),
      tiles: brief.tiles.filter((d) => d.id !== CORE_TILE[id] && d.source !== id),
      weather: id === 'weather' ? null : brief.weather,
    };
  }
  const sourceData = { ...brief.sourceData, [id]: data };
  const fresh = composeBrief({ today: [], mails: [], sentences: [] }, sourceData, now, { tomorrow });
  return {
    ...brief,
    ...fresh,
    createdAt: new Date().toISOString(),
    sources: brief.sources,
    // Řádky skládá jen Merora a kalendář: maily a doplňky nesmí vrátit, co se mezitím změnilo v rozhovoru.
    today: MATCHING[id] ? fresh.today : brief.today,
    weather: fresh.weather ?? brief.weather,
    tiles: brief.tiles.map((d) => fresh.tiles.find((x) => x.id === d.id) ?? d),
    mailsHeading: fresh.mailsHeading ?? brief.mailsHeading,
    sourceData,
    sentencesFingerprint: null,
    provisional: true,
    pending,
  };
}

// Odpojený zdroj (odkaz na kalendář): jeho řádky, dlaždice a data zmizí hned, bez nového načtení.
export function withoutSource(brief, id) {
  if (brief.sample || !(brief.sources ?? []).includes(id)) return null;
  const { [id]: _, ...sourceData } = brief.sourceData ?? {};
  return {
    ...brief,
    sources: brief.sources.filter((x) => x !== id),
    failed: (brief.failed ?? []).filter((x) => x !== id),
    ...(brief.pending ? { pending: brief.pending.filter((x) => x !== id) } : {}),
    sourceData,
    today: MATCHING[id] ? brief.today.filter((r) => !MATCHING[id].belongs(r)) : brief.today,
    tiles: brief.tiles.filter((d) => d.id !== CORE_TILE[id] && d.source !== id),
    weather: id === 'weather' ? null : brief.weather,
  };
}

// Shrnutí s novými daty jednoho zdroje (merora, kalendar, pocasi), nebo null, když se nic nezměnilo.
// Zdroj, který ve shrnutí není (byl vypnutý, když vznikalo), počká na další načtení všech dat.
export function rewriteSource(brief, id, data, now = new Date()) {
  if (brief.sample || !(brief.sources ?? []).includes(id)) return null;
  if (brief.pending?.includes(id)) return fillPending(brief, id, data, now);
  if (id === 'gmail') return mailsForTomorrow(brief, data, now);
  const old = brief.sourceData?.[id];
  if (brief.sourceData && sourceFingerprint(id, old) === sourceFingerprint(id, data)) return byTime(brief, id, data, now);
  const fresh = {
    ...brief,
    sourceData: { ...brief.sourceData, [id]: data },
    failed: (brief.failed ?? []).filter((x) => x !== id),
  };
  // Zdroj, který se při posledním načtení nenačetl (null), nemá na obrazovce nic: všechno je nové.
  if (MATCHING[id]) fresh.today = rewriteLines(brief.today, id, brief.sourceData ? old ?? [] : null, data);
  if (id === 'weather' && brief.weather) fresh.weather = weatherForScreen(data, now);
  // Dlaždice Připomínky a Kalendář počítají z dat zdrojů, po změně Merory nebo kalendáře se přepočítají.
  if (id === 'merora' || id === 'calendar') fresh.tiles = withDayTiles(brief.tiles, fresh.sourceData, now, { tomorrow: brief.day === 'tomorrow' });
  return fresh;
}

// Změnilo se od napsání vět to, o čem Meri mluví (dnešní připomínky a události s časem, fingerprintForSentences)? Pak se
// věty před přehráním přepíšou. Starší shrnutí bez otisku vět se nepřepisuje, nová data přinese další načtení.
export const sentencesStale = (brief) => Boolean(brief?.sentencesFingerprint) && fingerprintForSentences(brief.sourceData) !== brief.sentencesFingerprint;
