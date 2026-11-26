// Kalendář: dnešní události z tajného odkazu ve formátu iCal (Google Kalendář, iCloud, Outlook).
// Odkaz se vkládá v úvodu nebo v nastavení a ukládá se jen do .env na tomhle počítači (GOOGLE_CALENDAR_ICAL).
import { dayOf } from '../time.mjs';
import { loadEnv } from '../elevenlabs.mjs';
import { todayEvents, verifyLink } from '../calendar.mjs';
import { tr } from '../i18n.mjs';
import { notConnected } from './not-connected.mjs';

export function prepareCalendar(events) {
  return (events ?? []).slice(0, 12).map((u, i) => ({
    id: `k${i + 1}`,
    text: u.title,
    kind: 'calendar',
    when: u.time,
    time: u.time,
    ...(u.time ? {} : { allDay: true }),
    tone: 'blue',
  }));
}

export default {
  id: 'calendar',
  title: 'Kalendář',
  description: 'Google, Apple, Outlook a každý další s odkazem iCal. Dnešní události, jen název a čas',
  en: {
    title: 'Calendar',
    description: "Google, Apple, Outlook and any other with an iCal link. Today's events, just the name and time",
    guides: [
      { name: 'Google', text: 'Calendar on the web › Settings › your calendar › Secret address in iCal format.' },
      { name: 'Apple (iCloud)', text: 'Calendar app on a Mac › right-click the calendar › Share Calendar › Public Calendar › copy the link.' },
      { name: 'Outlook', text: 'Outlook.com › Settings › Calendar › Shared calendars › Publish a calendar › ICS link.' },
      { name: 'Another calendar', text: 'Look in its settings for sharing with a link in iCal (ICS) format. It starts with https:// or webcal://.' },
    ],
  },
  icon: 'calendar',
  connection: { kind: 'link', env: 'GOOGLE_CALENDAR_ICAL' },
  boxes: ['today'],
  // Bez AI: obnovuje se zvlášť zhruba každou čtvrthodinu (server.mjs), ne až s maily.
  noAI: true,
  // Co se počítá za změnu: název a čas. Id jsou podle pořadí (k1, k2…), po nové události se posunou.
  fingerprint: (events) => events.map((u) => [u.text, u.when]),
  problem: () => (loadEnv().GOOGLE_CALENDAR_ICAL ? null : tr('calendarMissing')),
  // Odkaz je uložený (okno ho nabídne změnit nebo odpojit).
  connected: () => Boolean(loadEnv().GOOGLE_CALENDAR_ICAL),
  // Zkouška nového odkazu před uložením: { link }, nebo { error } s textem pro člověka.
  verify: async (address) => {
    const { link, problem, status } = await verifyLink(address);
    if (link) return { link };
    return { error: problem === 'notIcal' ? tr('calendarNotIcal') : status ? tr('calendarStatus', { status }) : tr('calendarUnreachable') };
  },
  guides: [
    { name: 'Google', text: 'Kalendář na webu › Nastavení › tvůj kalendář › Tajná adresa ve formátu iCal.' },
    { name: 'Apple (iCloud)', text: 'Appka Kalendář na Macu › pravým na kalendář › Sdílet kalendář › Veřejný kalendář › zkopírovat odkaz.' },
    { name: 'Outlook', text: 'Outlook.com › Nastavení › Kalendář › Sdílené kalendáře › Publikovat kalendář › odkaz ICS.' },
    { name: 'Jiný kalendář', text: 'V jeho nastavení hledej sdílení odkazem ve formátu iCal (ICS). Začíná https:// nebo webcal://.' },
  ],
  // Část Kalendář v README (česky).
  help: 'https://github.com/ghibellinir/merora-desktop#kalend%C3%A1%C5%99',
  collect: async ({ now }) => {
    const events = await todayEvents(dayOf(now));
    if (events === null) throw notConnected(tr('calendarMissing'));
    return prepareCalendar(events);
  },
};
