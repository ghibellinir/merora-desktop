// Události ze soukromého odkazu Google Kalendáře: dnešní pro shrnutí, týden dopředu pro rozhovor. Odkaz umí jen číst.
// Bere se jen název a čas. Místo, popis a hosté se ani nečtou.
import { loadEnv } from './elevenlabs.mjs';

import { ZONE } from './time.mjs'; // časové pásmo počítače
import { ianaZone } from './zones.mjs';
const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const formats = new Map(); // jedno na pásmo: Outlook má pásmo u každé události a nové Intl je pomalé
function zoneFormat(zone) {
  if (!formats.has(zone)) {
    formats.set(
      zone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formats.get(zone);
}
function vZone(instant, zone = ZONE) {
  const p = Object.fromEntries(
    zoneFormat(zone)
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

const formatDay = (c) => `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
const formatTime = (c) => `${c.hour}:${String(c.minute).padStart(2, '0')}`;

// Čas z kalendáře převedený do Prahy: { den: 'RRRR-MM-DD', cas: 'H:MM' nebo null u celodenních }.
function icsTime(amount, zone) {
  const m = amount.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [r, monthNum, d, h, minuteNum, s] = m.slice(1, 7).map(Number);
  if (m[4] === undefined) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  let instant = Date.UTC(r, monthNum - 1, d, h, minuteNum, s);
  if (!m[7]) {
    const z = ianaZone(zone) ?? ZONE;
    if (z === ZONE) return { day: `${m[1]}-${m[2]}-${m[3]}`, time: `${h}:${m[5]}` };
    // Místní čas jiné zóny: posun se dopočítá z toho, co by tahle zóna ukazovala.
    const c = vZone(new Date(instant), z);
    instant -= Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - instant;
  }
  const c = vZone(new Date(instant));
  return { day: formatDay(c), time: formatTime(c) };
}

function parseLine(line) {
  // Dvojtečka v uvozovkách (např. TZID) ještě není konec názvu.
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ':' && !inQuotes) {
      const [name, ...params] = line.slice(0, i).split(';');
      const icsParams = Object.fromEntries(params.map((p) => p.split('=', 2)));
      return { name, icsParams, amount: line.slice(i + 1) };
    }
  }
  return null;
}

const unescape = (s) => s.replace(/\\([,;\\])/g, '$1').replace(/\\[nN]/g, ' ');

function parseIcs(ics) {
  const events = [];
  let e = null;
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') e = { exdates: new Set() };
    else if (line === 'END:VEVENT') {
      if (e) events.push(e);
      e = null;
    } else if (e) {
      const r = parseLine(line);
      if (!r) continue;
      if (r.name === 'UID') e.uid = r.amount;
      else if (r.name === 'SUMMARY') e.title = unescape(r.amount).trim();
      else if (r.name === 'STATUS') e.status = r.amount;
      else if (r.name === 'RRULE') e.rule = Object.fromEntries(r.amount.split(';').map((p) => p.split('=', 2)));
      else if (r.name === 'DTSTART') e.start = icsTime(r.amount, r.icsParams.TZID);
      else if (r.name === 'DTEND') e.end = icsTime(r.amount, r.icsParams.TZID);
      else if (r.name === 'RECURRENCE-ID') e.exceptionOf = icsTime(r.amount, r.icsParams.TZID)?.day;
      else if (r.name === 'EXDATE') {
        for (const h of r.amount.split(',')) {
          const c = icsTime(h, r.icsParams.TZID);
          if (c) e.exdates.add(c.day);
        }
      }
    }
  }
  return events;
}

const utc = (day) => new Date(`${day}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
const nextDay = (day) => new Date(utc(day).getTime() + DAY_MS).toISOString().slice(0, 10);

function dayMatches(p, start, day) {
  const S = utc(start);
  const D = utc(day);
  const interval = Number(p.INTERVAL ?? 1);
  const byDays = p.BYDAY?.split(',') ?? null;
  const thisDay = WEEKDAYS[D.getUTCDay()];
  const daysInMonth = new Date(Date.UTC(D.getUTCFullYear(), D.getUTCMonth() + 1, 0)).getUTCDate();

  const dayOfMonth = () => {
    if (p.BYMONTHDAY) {
      return p.BYMONTHDAY.split(',').some((x) => D.getUTCDate() === (+x > 0 ? +x : daysInMonth + +x + 1));
    }
    if (byDays) {
      // Např. 2TH = druhý čtvrtek, -1FR = poslední pátek.
      return byDays.some((x) => {
        const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/);
        if (!m || m[2] !== thisDay) return false;
        if (!m[1]) return true;
        const n = Number(m[1]);
        return n > 0 ? Math.ceil(D.getUTCDate() / 7) === n : Math.ceil((daysInMonth - D.getUTCDate() + 1) / 7) === -n;
      });
    }
    return D.getUTCDate() === S.getUTCDate();
  };

  if (p.FREQ === 'DAILY') return daysBetween(start, day) % interval === 0 && (!byDays || byDays.includes(thisDay));
  if (p.FREQ === 'WEEKLY') {
    const first = WEEKDAYS.indexOf(p.WKST ?? 'MO');
    const weekStart = (x) => x.getTime() - ((x.getUTCDay() - first + 7) % 7) * DAY_MS;
    const weeks = Math.round((weekStart(D) - weekStart(S)) / (7 * DAY_MS));
    return weeks % interval === 0 && (byDays ?? [WEEKDAYS[S.getUTCDay()]]).includes(thisDay);
  }
  if (p.FREQ === 'MONTHLY') {
    const monthCount = (D.getUTCFullYear() - S.getUTCFullYear()) * 12 + D.getUTCMonth() - S.getUTCMonth();
    return monthCount % interval === 0 && dayOfMonth();
  }
  if (p.FREQ === 'YEARLY') {
    const months = p.BYMONTH ? p.BYMONTH.split(',').map(Number) : [S.getUTCMonth() + 1];
    return (D.getUTCFullYear() - S.getUTCFullYear()) % interval === 0 && months.includes(D.getUTCMonth() + 1) && dayOfMonth();
  }
  return false;
}

function ruleApplies(p, start, day) {
  if (day < start) return false;
  if (p.UNTIL) {
    const untilDay = icsTime(p.UNTIL)?.day;
    if (untilDay && day > untilDay) return false;
  }
  if (!dayMatches(p, start, day)) return false;
  if (!p.COUNT) return true;
  let count = 0;
  for (let d = start; d < day; d = nextDay(d)) {
    if (dayMatches(p, start, d) && ++count >= Number(p.COUNT)) return false;
  }
  return true;
}

// Události daného dne ('RRRR-MM-DD') v pražském čase, nejdřív celodenní a pak podle času.
// ics je text kalendáře, nebo už rozebrané události (víc dní z jednoho stažení, eventsAhead).
export function eventsOfDay(ics, day) {
  const events = typeof ics === 'string' ? parseIcs(ics) : ics;
  // Přesunutý nebo zrušený výskyt opakované události je samostatný záznam se stejným UID.
  const exceptions = new Map();
  for (const e of events) {
    if (!e.exceptionOf) continue;
    if (!exceptions.has(e.uid)) exceptions.set(e.uid, new Set());
    exceptions.get(e.uid).add(e.exceptionOf);
  }

  const today = [];
  for (const e of events) {
    if (e.status === 'CANCELLED' || !e.start || !e.title) continue;
    let applies;
    if (e.rule && !e.exceptionOf) {
      applies = ruleApplies(e.rule, e.start.day, day) && !e.exdates.has(day) && !exceptions.get(e.uid)?.has(day);
    } else if (e.start.day === day) {
      applies = true;
    } else {
      // Vícedenní: u celodenní je konec už mimo, u časované se počítá i poslední den.
      const last = e.end?.time && e.end.time !== '0:00' ? nextDay(e.end.day) : e.end?.day;
      applies = e.start.day < day && Boolean(last) && day < last;
    }
    if (!applies) continue;
    const startsToday = e.start.day === day || Boolean(e.rule);
    today.push({ title: e.title, time: startsToday ? e.start.time : null });
  }

  const key = (u) => (u.time ? Number(u.time.split(':')[0]) * 60 + Number(u.time.split(':')[1]) : -1);
  return today.sort((a, b) => key(a) - key(b));
}

// Stáhne kalendář. V chybě nesmí být odkaz, je tajný: fetch ho u špatné adresy dává do textu chyby, proto
// vlastní hláška. Každé stažení se pamatuje pro rozhovor (eventsAhead).
const ICS_MAX_AGE_MS = 15 * 60_000;
let lastIcs = null; // { link, when, work: Promise<text> }
function download(link) {
  const work = (async () => {
    let res;
    try {
      res = await fetch(link, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error('Kalendář se nepodařilo stáhnout.');
    }
    if (!res.ok) throw new Error(`Kalendář vrátil chybu ${res.status}.`);
    return res.text();
  })();
  lastIcs = { link, when: Date.now(), work };
  work.catch(() => {
    if (lastIcs?.work === work) lastIcs = null; // chyba se nepamatuje
  });
  return work;
}

// Nový odkaz z úvodu nebo nastavení se před uložením stáhne a přečte, ať se neuloží něco, co kalendář není (25. 11.: tester
// s odkazem, který nešel přečíst, zůstal bez kalendáře). Outlook dává vedle sebe odkaz HTML a ICS: HTML se převede.
// Vrací { link } s tím, co se má uložit, nebo { problem }: unreachable (i se stavem), notIcal. Odkaz v chybě není.
const OUTLOOK_HTML = /^(https:\/\/outlook\.(?:live|office365|office)\.com\/.+)\/(?:index|calendar)\.html$/i;
export async function verifyLink(address) {
  const link = address.replace(OUTLOOK_HTML, '$1/calendar.ics');
  let res;
  try {
    res = await fetch(link, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return { problem: 'unreachable' };
  }
  if (!res.ok) return { problem: 'unreachable', status: res.status };
  const text = await res.text().catch(() => '');
  if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)) return { problem: 'notIcal' };
  try {
    parseIcs(text);
  } catch {
    return { problem: 'notIcal' };
  }
  return { link };
}

// Shrnutí a živá data (každou čtvrthodinu) stahují pokaždé znovu.
export async function todayEvents(day) {
  const link = loadEnv().GOOGLE_CALENDAR_ICAL;
  if (!link) return null;
  return eventsOfDay(await download(link), day);
}

// Rozhovor: události od firstDay na `days` dní ({ day, title, time }, celodenní s time null), ať Meri na
// „co mě čeká zítra“ odpoví i z kalendáře. Kalendář se stahuje nejvýš jednou za čtvrthodinu, jinak z paměti.
// Bez odkazu null.
export async function eventsAhead(firstDay, days = 8) {
  const link = loadEnv().GOOGLE_CALENDAR_ICAL;
  if (!link) return null;
  const fresh = lastIcs?.link === link && Date.now() - lastIcs.when < ICS_MAX_AGE_MS;
  const events = parseIcs(await (fresh ? lastIcs.work : download(link)));
  const out = [];
  for (let i = 0, day = firstDay; i < days; i++, day = nextDay(day)) {
    for (const e of eventsOfDay(events, day)) out.push({ day, ...e });
  }
  return out;
}
