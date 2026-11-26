// Den, který se teprve načítá (Riccardo 25. 11. 2026: po otevření okno ukázalo včerejšek, než se dnešek načetl).
// Uložené shrnutí jiného dne se nikdy neukáže: okno má hned dnešní (zítřejší) datum a pozdrav, a co ještě není, má
// kolečko „Načítám…“. Připomínky, kalendář a počasí se doplní samy během pár vteřin (server.mjs, loadToday),
// maily a doplňky jdou přes Clauda a přijdou až se shrnutím.
// pending: zdroje, které se ještě nenačetly. provisional: ještě nemá věty od Meri.
import { dateForScreen, dayOf, greeting } from './time.mjs';
import { tr } from './i18n.mjs';
import { profile } from './settings.mjs';
import { isMail, MAIL_SOURCES } from './mail.mjs';

// Dlaždice, než přijdou data: ikona a název zůstanou, místo čísla je kolečko.
const waiting = ({ id, icon, tone, title, source }) => ({ id, icon, tone, title, value: '', caption: '', ...(source ? { source } : {}), loading: true });

// Dlaždice mailů zítřka, dokud se načítají maily dneška (zítřek je má z něj).
export const waitingMails = ({ tomorrow = false } = {}) => waiting({ id: 'mails', icon: 'mail', tone: 'blue', title: tr(tomorrow ? 'mailsTomorrow' : 'unreadMails') });

const coreTiles = (sources, tomorrow) =>
  [
    sources.includes('merora') && { id: 'reminders-count', icon: 'bell', tone: 'blue', title: tr('reminders') },
    sources.includes('calendar') && { id: 'calendar-count', icon: 'calendar', tone: 'blue', title: tr('calendar') },
    sources.some(isMail) && { id: 'mails', icon: 'mail', tone: 'blue', title: tr(tomorrow ? 'mailsTomorrow' : 'unreadMails') },
  ].filter(Boolean);

// previous: poslední uložené shrnutí dneška, podle něj je vidět, které zdroje a dlaždice člověk má.
export function pendingDay(previous, now, { tomorrow = false } = {}) {
  // Doplňky (Merora DEV) jsou jen o dnešku a noci.
  const core = ['merora', 'calendar', 'weather', ...MAIL_SOURCES];
  const sources = (previous.sources ?? ['merora', 'calendar', 'weather', 'gmail']).filter((id) => !tomorrow || core.includes(id));
  const { salutation } = profile();
  const hello = tomorrow ? `${tr('tomorrowHere')}${salutation ? `, ${salutation}` : ''}.` : greeting(now, salutation);
  const mine = coreTiles(sources, tomorrow);
  // Pořadí dlaždic jako minule (dlaždice doplňků jsou mezi nimi), texty jádra v jazyce, který je nastavený teď.
  const tiles = tomorrow || !previous.tiles?.length ? mine : previous.tiles.map((d) => mine.find((x) => x.id === d.id) ?? d);
  return {
    sample: false,
    createdAt: null,
    sources,
    failed: [],
    greeting: hello,
    day: tomorrow ? 'tomorrow' : 'today',
    forDay: dayOf(now),
    weather: sources.includes('weather') ? { id: 'weather', temperature: '', date: dateForScreen(now), loading: true } : null,
    today: [],
    tiles: tiles.map(waiting),
    panels: [],
    mails: [],
    mailsHeading: tr(tomorrow ? 'mailsTomorrow' : 'importantMails'),
    sentences: [{ id: 'rano', text: hello }],
    sourceData: {},
    sentencesFingerprint: null,
    provisional: true,
    pending: sources,
  };
}

// Patří uložené shrnutí dni, pro který se bere? Shrnutí z doby před přepínačem Dnes / Zítra den nemá, platí podle vzniku.
export const isForDay = (brief, day) => (brief.forDay ?? (brief.createdAt ? dayOf(new Date(brief.createdAt)) : null)) === day;
