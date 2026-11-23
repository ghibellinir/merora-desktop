// Čas pro sběr, zdroje i rozhovor: časové pásmo počítače (Riccardo 23. 11.: Merora Desktop i pro lidi mimo Česko),
// na zkoušky MERI_TZ. Dřív napevno Praha.
import { tr, locale } from './i18n.mjs';
import { language } from './settings.mjs';

export const ZONE = process.env.MERI_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Prague';

export function dateParts(d) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
}
export const dayOf = (d) => {
  const p = dateParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
export const timeOf = (d) => {
  const p = dateParts(d);
  return `${Number(p.hour)}:${p.minute}`;
};
export const weekdayName = (d, lang = language()) => new Intl.DateTimeFormat(locale(lang), { timeZone: ZONE, weekday: 'long' }).format(d);
export const daysAgo = (d, now) => Math.round((Date.parse(dayOf(now)) - Date.parse(dayOf(d))) / 86_400_000);

// „Pondělí 23. 11.“, anglicky „Monday 23 Nov“.
export function dateForScreen(now, lang = language()) {
  const p = dateParts(now);
  const day = weekdayName(now, lang);
  if (lang === 'en') return `${day} ${Number(p.day)} ${new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, month: 'short' }).format(now)}`;
  return `${day[0].toUpperCase()}${day.slice(1)} ${Number(p.day)}. ${Number(p.month)}.`;
}

// Pozdrav podle denní doby: „Dobré ráno, Riki.“ Bez oslovení jen „Dobré ráno.“
export function greeting(now, salutation = '') {
  const h = Number(dateParts(now).hour);
  const base = tr(h < 10 ? 'goodMorning' : h < 12 ? 'goodForenoon' : h < 18 ? 'goodAfternoon' : 'goodEvening');
  return salutation ? `${base}, ${salutation}.` : `${base}.`;
}

// „včera 18:00“, „pondělí 18:00“, „23. 10.“
export function pastWhenForScreen(d, now) {
  const back = daysAgo(d, now);
  if (back === 1) return tr('yesterdayAt', { time: timeOf(d) });
  if (back < 7) return `${weekdayName(d)} ${timeOf(d)}`;
  const p = dateParts(d);
  return language() === 'en' ? `${Number(p.day)} ${new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, month: 'short' }).format(d)}` : `${Number(p.day)}. ${Number(p.month)}.`;
}
