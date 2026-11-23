// Kalendář: dnešní události z tajného odkazu ve formátu iCal (Google Kalendář, iCloud, Outlook).
// Odkaz se vkládá v úvodu nebo v nastavení a ukládá se jen do .env na tomhle počítači (GOOGLE_CALENDAR_ICAL).
import { dayOf } from '../time.mjs';
import { loadEnv } from '../elevenlabs.mjs';
import { todayEvents } from '../calendar.mjs';
import { tr } from '../i18n.mjs';

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
  description: 'Dnešní události, jen název a čas',
  en: {
    title: 'Calendar',
    description: "Today's events, just the name and time",
    hint:
      'Google: Calendar on the web › Settings › your calendar › Secret address in iCal format. ' +
      'Apple: Calendar app › right-click the calendar › Share Calendar › Public Calendar › copy the link. ' +
      'Outlook: Outlook.com › Settings › Calendar › Shared calendars › Publish a calendar › ICS link.',
  },
  icon: 'calendar',
  connection: { kind: 'link', env: 'GOOGLE_CALENDAR_ICAL' },
  boxes: ['today'],
  // Bez AI: obnovuje se zvlášť zhruba každou čtvrthodinu (server.mjs), ne až s maily.
  noAI: true,
  // Co se počítá za změnu: název a čas. Id jsou podle pořadí (k1, k2…), po nové události se posunou.
  fingerprint: (events) => events.map((u) => [u.text, u.when]),
  problem: () => (loadEnv().GOOGLE_CALENDAR_ICAL ? null : tr('calendarMissing')),
  hint:
    'Google: Kalendář na webu › Nastavení › tvůj kalendář › Tajná adresa ve formátu iCal. ' +
    'Apple: appka Kalendář › pravým na kalendář › Sdílet kalendář › Veřejný kalendář › zkopírovat odkaz. ' +
    'Outlook: Outlook.com › Nastavení › Kalendář › Sdílené kalendáře › Publikovat kalendář › odkaz ICS.',
  collect: async ({ now }) => prepareCalendar(await todayEvents(dayOf(now))),
};
