// Řádky v boxu „Dnes“. Přednost mají vždycky dnešní připomínky a události s časem (rozhodl Riccardo
// 20. 11.): jsou nahoře podle času a jen o nich Meri mluví. Za nimi řádky doplňků (Merora DEV, třeba chyby
// v appce) a až pak ostatní (včerejší nedodělané s volbou, bez času jen podle vlastního pravidla), jen když zbude místo.
// Ranní shrnutí podle toho řádky řadí (tools/brief.mjs) a rozhovor je mění hned po přesunu, nové
// nebo smazané připomínce (tools/dialog.mjs).
import { timeOf, weekdayName, dayOf } from './time.mjs';

export const MAX_LINES = 6; // řádků na jednu stránku boxu „Dnes“ (public/meri.css, .app-today)
// Stránky v boxu (Riccardo 22. 11.): když je věcí víc než 6, box je rozdělí po 6, nejvýš na 4 stránky.
// Novou stránku si vynutí jen věci s časem, celodenní, včerejší nedodělané a doplňky. Ostatní (na místo,
// Kdykoli z pravidla) jdou jen na volné řádky stránek, které už jsou.
export const MAX_PAGES = 4;
export const MAX_BOX = MAX_LINES * MAX_PAGES;
export const MAX_TITLE = 28;

// Minuty dnešního času („9:30“ → 570). Null u řádku bez dnešního času („včera 18:00“, „pondělí 9:00“, bez času).
export function minutesToday(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const hasTodayTime = (line) => minutesToday(line.time) !== null;
// Celodenní událost z kalendáře na dnešek (narozeniny, svátek): Meri o ní mluví, v boxu je hned za časovými.
const isAllDay = (line) => !hasTodayTime(line) && Boolean(line.allDay);
// Nedodělané ze včerejška (jen s volbou v nastavení): hned za celodenními, před doplňky a ostatními.
const isYesterday = (line) => !hasTodayTime(line) && !line.allDay && Boolean(line.overdue);
// Řádek doplňku nese zdroj. Starší shrnutí a natáčení ho nemají, tam je to řádek „chyby“.
const isAddon = (line) => Boolean(line.source) || line.id === 'chyby';

// Krátký název na řádek: celé slovo a výpustka, když se nevejde.
export function shorten(text, max = MAX_TITLE) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  // Končí-li výřez celým slovem, nechá se celý. Jinak se useknuté slovo zahodí, když tím moc neubude.
  if (t[max - 1] === ' ') return `${cut.trimEnd()}…`;
  const gap = cut.lastIndexOf(' ');
  return `${(gap > max / 2 ? cut.slice(0, gap) : cut).trimEnd()}…`;
}

// Čas na řádek: dnes jen hodina, jindy i den („pondělí 9:00“).
export const timeForLine = (when, now) => (dayOf(when) === dayOf(now) ? timeOf(when) : `${weekdayName(when)} ${timeOf(when)}`);

// Řádek pro připomínku z Merory, která v boxu ještě není (nová, nebo přesunutá na dnešek).
export function lineForReminder(r, now = new Date()) {
  const when = r.date_time ? new Date(r.date_time) : null;
  return {
    id: `r${r.id}`,
    icon: r.place_id ? 'place' : 'bell',
    tone: 'blue',
    title: shorten(r.task),
    ...(when ? { time: timeForLine(when, now) } : {}),
    meta: '',
  };
}

// Kolik řádků box unese: celé stránky pro věci s přednostmi, nejvýš max. Ostatní stránku nepřidají.
const room = (lines, max) => {
  const main = lines.filter((r) => hasTodayTime(r) || isAllDay(r) || isYesterday(r) || isAddon(r)).length;
  return Math.min(max, Math.max(MAX_LINES, Math.ceil(main / MAX_LINES) * MAX_LINES));
};

// Pořadí podle přednosti: dnešní s časem podle času, doplňky, ostatní v původním pořadí. Navíc se ořízne
// na to, co box unese: nejdřív pryč ostatní od konce, pak doplňky, nakonec nejpozdější dnešní.
export function sortLines(lines, max = MAX_BOX) {
  const timedLines = lines.filter(hasTodayTime).sort((a, b) => minutesToday(a.time) - minutesToday(b.time));
  const allDay = lines.filter(isAllDay);
  const yesterday = lines.filter(isYesterday);
  const rest = (r) => !hasTodayTime(r) && !isAllDay(r) && !isYesterday(r);
  const addons = lines.filter((r) => rest(r) && isAddon(r));
  const others = lines.filter((r) => rest(r) && !isAddon(r));
  const result = [...timedLines, ...allDay, ...yesterday, ...addons, ...others];
  const limit = room(result, max);
  while (result.length > limit) {
    let i = result.findLastIndex((r) => rest(r) && !isAddon(r));
    if (i < 0) i = result.findLastIndex(isAddon);
    if (i < 0) i = result.findLastIndex(isYesterday);
    if (i < 0) i = result.findLastIndex(isAllDay);
    if (i < 0) i = result.length - 1;
    result.splice(i, 1);
  }
  return result;
}

// Nový řádek na své místo podle času. Řádek se stejným id se nahradí.
export function insertLine(lines, line, max = MAX_BOX) {
  const rest = lines.filter((r) => r.id !== line.id);
  if (!hasTodayTime(line)) return sortLines([...rest, line], max);
  const m = minutesToday(line.time);
  const later = rest.findIndex((r) => hasTodayTime(r) && minutesToday(r.time) > m);
  const i = later >= 0 ? later : rest.findLastIndex(hasTodayTime) + 1;
  const result = [...rest.slice(0, i), line, ...rest.slice(i)];
  // Ořezává se jen to, co se nevejde. Pořadí zbytku zůstává, jak ho napsalo shrnutí.
  const limit = room(result, max);
  while (result.length > limit) {
    let j = result.findLastIndex((r) => !hasTodayTime(r) && !isAddon(r) && r.id !== line.id);
    if (j < 0) j = result.findLastIndex(isAddon);
    if (j < 0) j = result.findLastIndex((r) => r.id !== line.id);
    result.splice(j, 1);
  }
  return result;
}

export const removeLine = (lines, id) => lines.filter((r) => r.id !== id);

export const changeLine = (lines, id, change) => lines.map((r) => (r.id === id ? { ...r, ...change } : r));

// Vrátí řádek tam, kde byl (po „vrať to“), případně pod novým id (znovu založená připomínka má nové).
export function restoreLine(lines, { line, index }, id = line.id, max = MAX_BOX) {
  const rest = lines.filter((r) => r.id !== line.id && r.id !== id);
  const result = [...rest.slice(0, index), { ...line, id }, ...rest.slice(index)];
  return result.slice(0, max);
}
