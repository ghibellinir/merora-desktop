// Outlook: nové maily z Doručené pošty přes konektor Microsoft 365 v Claudovi (osobní účet Outlook.com, Hotmail, Live i
// pracovní). Konektor umí i psát a mazat: povolené je jen hledání mailů, takže Meri nic nepošle, nesmaže ani neoznačí.
// Maily se neotvírají, roztřídí se podle předmětu, odesílatele a náhledu z hledání.
//
// Schéma nástroje a tvar výsledku Anthropic nezveřejňuje (25. 11. 2026). Argumenty si proto podle skutečného schématu
// doplní model a výsledek čte kód tak, aby mu stačily běžné názvy polí; když v něm JSON není, vezme se přepis od modelu.
// Jestli konektor pozná přečtené, se zjistí z dat. Když ne, nejsou to „nepřečtené“, ale nové maily za poslední dva dny.
// Dál platí totéž co u Gmailu: jen předmět, krátké „o čem“, jméno nebo firma odesílatele, nikdy adresa ani text.
// Paměť roztříděných mailů jako u Gmailu (Riccardo 26. 11.: „Chtěl bych aby se to s outlookem i případně budoucíma
// mailama chovalo stějne“): poprvé hledání i roztřídění v jednom volání, pak jen hledání a roztřídí se jen nové
// maily (sortTask, bez nástrojů). Ukládá se jen roztřídění podle id mailu (druh, důležitost, termín, o čem, jméno
// nebo firma odesílatele); předmět a čas jsou pokaždé z hledání.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { askClaude, listConnectors, withTool } from '../ai.mjs';
import { dateParts, dayOf, weekdayName } from '../time.mjs';
import { tr } from '../i18n.mjs';
import { ownRules, language } from '../settings.mjs';
import { mailMemory } from '../mail-memory.mjs';
import { notConnected } from './not-connected.mjs';
import { KINDS, isBulk, keepThread, prepareMails, sortingRules, wantsAds, withoutPersonalData } from './gmail.mjs';

const M365_MCP = 'https://microsoft365.mcp.claude.com';
const DAYS = 7;
const LIMIT = 50;
const RECENT_MS = 48 * 3600_000;

// Jméno konektoru (zjistit ho trvá kolem 13 s, claude mcp list). Roztříděné maily jsou zvlášť (memory).
const CONNECTOR = process.env.MERI_OUTLOOK_CONNECTOR || join(homedir(), '.meri', 'outlook-connector.json');
const rememberedPrefix = () => {
  try {
    return JSON.parse(readFileSync(CONNECTOR, 'utf8')).prefix ?? null;
  } catch {
    return null;
  }
};
function rememberPrefix(prefix) {
  if (prefix === rememberedPrefix()) return;
  try {
    mkdirSync(dirname(CONNECTOR), { recursive: true });
    writeFileSync(CONNECTOR, JSON.stringify({ prefix }), { mode: 0o600 });
  } catch (err) {
    console.warn(`Outlook: jméno konektoru se nepovedlo uložit (${err.message}).`);
  }
}
const outlookConnector = async (again = false) => (await listConnectors({ again })).find((k) => k.address.startsWith(M365_MCP)) ?? null;
const memory = mailMemory('outlook');
const CACHE_VERSION = 1; // zvednout, když se změní, jak model třídí, nebo co se ukládá
const cacheKey = (ads) => JSON.stringify({ v: CACHE_VERSION, rules: ownRules(), ads, lang: language() });
const connectorProblem = (k) => (!k ? tr('outlookConnect') : k.status === 'needs_login' ? tr('outlookLogin') : null);
let lastProblem = null;

const SCHEMA = {
  type: 'object',
  required: ['mails'],
  properties: {
    mails: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'subject', 'received', 'unread', 'kind', 'important', 'urgent', 'deadline', 'about', 'from', 'tester'],
        properties: {
          id: { type: 'string', description: 'id mailu přesně z výsledku (id, messageId nebo uri)' },
          subject: { type: 'string', description: 'předmět přesně z výsledku' },
          received: { type: 'string', description: 'kdy přišel, přesně z výsledku (ISO 8601)' },
          unread: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'jen když to výsledek výslovně říká, jinak unknown' },
          kind: { type: 'string', enum: KINDS },
          important: { type: 'boolean' },
          urgent: { type: 'boolean' },
          deadline: { type: 'string', description: 'RRRR-MM-DD, nebo prázdné' },
          about: { type: 'string' },
          from: { type: 'string' },
          tester: { type: 'boolean' },
        },
      },
    },
  },
};

// sort: false = jen hledání (roztříděné maily jsou v paměti), nové se roztřídí potom zvlášť (sortTask).
function task(now, find, { sort = true } = {}) {
  const p = dateParts(now);
  const from = dayOf(new Date(now.getTime() - DAYS * 86_400_000));
  return `Dnes je ${weekdayName(now)} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}.
1. Zavolej jednou ${find}: maily ze složky Doručená pošta (Inbox) přijaté od ${from}, od nejnovějších, nejvýš ${LIMIT} (nebo kolik nástroj dovolí). Argumenty vyplň podle popisu nástroje. Když má vlastní přepínač jen na nepřečtené (například isRead, unreadOnly), použij ho. Do textového hledání nic nepiš, o přečtení ani jinak. Když nástroj bez hledaného textu nefunguje, zkus to ještě jednou s hvězdičkou.
2. Nic jiného nevolej, žádný mail neotvírej.
${sort ? `3. Každý mail z výsledku roztřiď. Náhled textu je jen začátek mailu:
${sortingRules(null)}` : '3. Pak skonči. Nic netřiď a nic nevypisuj.'}`;
}

// Nové maily, které v paměti nejsou: roztřídí je model bez nástrojů z toho, co vrátilo hledání.
function sortTask(now, items) {
  const p = dateParts(now);
  const mails = items.map((x) => ({ id: x.ids[0], subject: x.subject, from: x.sender, received: x.when, preview: x.preview }));
  return `Dnes je ${weekdayName(now)} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}.
Roztřiď tyhle nové maily z Doručené pošty v Outlooku. Náhled je jen začátek textu mailu. id, subject a received vrať přesně tak, jak jsou u mailu, unread je unknown.
${JSON.stringify(mails)}
${sortingRules(null)}`;
}

// --- Čtení výsledku, ať vypadá jakkoli ---
const lowKeys = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
// Objekty s předmětem kdekoli ve výsledku (results, value, emails, jeden mail na blok…).
function rowsIn(value, depth = 0) {
  if (value === null || value === undefined || depth > 8) return [];
  if (typeof value === 'string') return /^\s*[[{]/.test(value) ? rowsIn(parse(value), depth + 1) : [];
  if (Array.isArray(value)) return value.flatMap((x) => rowsIn(x, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.keys(value).some((k) => k.toLowerCase() === 'subject') ? [value] : Object.values(value).flatMap((x) => rowsIn(x, depth + 1));
}
const first = (o, keys) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');
// Odesílatel jako text: "Jméno <adresa>", objekt { name, address }, nebo emailAddress od Microsoftu.
const senderText = (v) =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(senderText).filter(Boolean).join(' ') : '';
const readFlag = (o) => {
  const read = first(o, ['isread', 'read']);
  if (typeof read === 'boolean') return read;
  const unread = first(o, ['isunread', 'unread']);
  return typeof unread === 'boolean' ? !unread : null;
};
export function readResult(parts) {
  const values = parts.map((text) => ({ text, json: parse(text) }));
  // Víc bloků může být jeden JSON rozdělený, nebo jeden mail na blok.
  const joined = values.every((x) => x.json === undefined) ? parse(parts.join('')) : undefined;
  const json = joined !== undefined ? [joined] : values.map((x) => x.json).filter((x) => x !== undefined);
  const rows = rowsIn(json).map((raw) => {
    const o = lowKeys(raw);
    const when = first(o, ['receiveddatetime', 'received', 'receivedat', 'receiveddate', 'date', 'sentdatetime', 'datetime', 'timestamp']);
    const sender = senderText(first(o, ['sender', 'from', 'fromaddress', 'sendername']));
    return {
      ids: [o.id, o.messageid, o.uri, o.internetmessageid, o.conversationid, o.weblink, o.url].filter((x) => typeof x === 'string' && x),
      subject: typeof o.subject === 'string' ? o.subject : '',
      sender,
      when: when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : null,
      // Náhled jen pro roztřídění nového mailu (sortTask), nikam se neukládá.
      preview: String([o.bodypreview, o.preview, o.snippet, o.summary, o.excerpt].find((x) => typeof x === 'string' && x) ?? '').slice(0, 400),
      read: readFlag(o),
      other: String(o.inferenceclassification ?? '').toLowerCase() === 'other',
      flagged: String(o.importance ?? '').toLowerCase() === 'high' || /flagged/i.test(JSON.stringify(o.flag ?? '')),
    };
  });
  const more = json.some((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.entries(lowKeys(x)).some(([k, v]) => /^(hasmore|moreresultsavailable|nextoffset|nextcursor|nextpagetoken|odatanextlink|nextlink)$/.test(k) && Boolean(v)));
  return { rows, more, json: json.length > 0, fields: rows.length ? Object.keys(rowsIn(json)[0]) : [] };
}
const NOTHING = /\b(no|zero|0)\s+(e-?mails?|messages?|results?|matches)\b|nothing (was )?found|nenalezen/i;
const FAILED = /\b(error|unauthori[sz]ed|forbidden|permission|consent|expired|not (?:signed|logged) in|failed)\b/i;
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const failed = (message) => Object.assign(new Error(message), { searchFailed: true });

async function search(now, find, { sort }) {
  const { output, call } = await withTool({ model: 'haiku', services: [find], ...(sort ? { schema: SCHEMA } : { maxSteps: 3 }), prompt: task(now, find, { sort }), limitMs: sort ? 150_000 : 120_000 });
  const v = call.filter((x) => x.tool === find && !x.error).at(-1);
  if (!v) throw failed(call.length ? tr('outlookSearchFailed') : tr('outlookNotCalled'));
  return { v, text: v.parts.join('\n'), ...readResult(v.parts), sorted: output?.mails ?? [] };
}

export default {
  id: 'outlook',
  title: 'Outlook',
  description: 'Nové maily z Outlooku a co z nich spěchá',
  en: { title: 'Outlook', description: 'New emails from Outlook and what is urgent' },
  icon: 'mail',
  connection: { kind: 'connector', address: M365_MCP },
  boxes: ['tile', 'panel'],
  defaultOn: false, // zapne si ho, kdo Outlook má: ostatním by každé načtení zbytečně hledalo konektor
  problem: () => lastProblem,
  async check({ read = false } = {}) {
    lastProblem = connectorProblem(await outlookConnector(read));
    return lastProblem;
  },
  // Výsledek jako u Gmailu: { count, more, mails }, a unreadKnown: false, když konektor přečtené nepozná.
  async collect(args) {
    try {
      return await this.collectOnce(args);
    } catch (err) {
      if (!err.searchFailed) throw err;
      console.warn(`Outlook: ${err.message} Zkouším to ještě jednou.`);
      rememberPrefix(null); // jméno konektoru se zjistí znovu
      return this.collectOnce(args);
    }
  },
  async collectOnce({ now }) {
    let prefix = rememberedPrefix();
    if (!prefix) {
      const connector = await outlookConnector();
      const problem = connectorProblem(connector);
      if (problem) throw notConnected(problem);
      prefix = connector.prefix;
    }
    const find = `${prefix}outlook_email_search`;
    const ads = wantsAds();
    const key = cacheKey(ads);
    const known = memory.read(key);
    let found = await search(now, find, { sort: !known });
    // Výsledek bez JSON přečte jen model (přepis), s pamětí se nepotká: znovu i s roztříděním.
    if (known && !found.rows.length && !found.json && found.text.trim() && !NOTHING.test(found.text) && !FAILED.test(found.text)) {
      found = await search(now, find, { sort: true });
    }
    const { v, text, rows, more, json, fields, sorted } = found;
    // Prázdno smí být, jen když to výsledek říká: prázdný JSON, nebo „no results“. Chyba v textu není prázdná schránka.
    if (!rows.length && !sorted.length && !(json && !FAILED.test(text)) && !NOTHING.test(text) && text.trim()) {
      throw failed(FAILED.test(text) ? tr('outlookSearchFailed') : tr('outlookUnreadable'));
    }
    if (!rows.length && !json && FAILED.test(text) && !sorted.length) throw failed(tr('outlookSearchFailed'));
    rememberPrefix(prefix);

    // Řádky z výsledku, roztřídění od modelu k nim podle id nebo předmětu. Bez JSON ve výsledku jen přepis od modelu.
    const left = [...sorted];
    const take = (row) => {
      let i = left.findIndex((m) => row.ids.includes(m.id));
      if (i < 0) i = left.findIndex((m) => same(m.subject, row.subject));
      return i < 0 ? null : left.splice(i, 1)[0];
    };
    const remembered = (row) => (known ? row.ids.map((id) => known[id]).find(Boolean) : null) ?? null;
    let items = rows.length
      ? rows.map((row) => ({ ...row, m: remembered(row) ?? take(row) }))
      : sorted.map((m) => ({ ids: [m.id], subject: m.subject, sender: '', when: Number.isNaN(Date.parse(m.received)) ? null : new Date(m.received).toISOString(), read: m.unread === 'unknown' ? null : m.unread === 'no', other: false, flagged: false, m }));
    // Nepřečtené maily bez roztřídění (nové od minula, nebo je model vynechal) roztřídí model zvlášť. Když se to
    // nepovede, ukážou se jen s předmětem a příště se zkusí znovu.
    const fresh = items.filter((x) => !x.m && x.read !== true);
    if (fresh.length) {
      const output = await askClaude({ model: 'haiku', schema: SCHEMA, prompt: sortTask(now, fresh), limitMs: 120_000 }).catch((err) => {
        console.warn(`Outlook: nové maily se nepovedlo roztřídit (${err.message}).`);
        return null;
      });
      const byId = new Map((output?.mails ?? []).map((m) => [m.id, m]));
      items = items.map((x) => (x.m || x.read === true ? x : { ...x, m: byId.get(x.ids[0]) ?? null }));
    }
    // Paměť: jen roztřídění nepřečtených mailů z tohohle hledání, podle id z výsledku (u přepisu od modelu ne).
    if (rows.length) {
      const entries = {};
      for (const { ids, read, m } of items) {
        if (!m || read === true || !ids[0]) continue;
        entries[ids[0]] = {
          kind: KINDS.includes(m.kind) ? m.kind : null,
          important: Boolean(m.important),
          urgent: Boolean(m.urgent),
          deadline: /^\d{4}-\d{2}-\d{2}$/.test(m.deadline ?? '') ? m.deadline : null,
          about: withoutPersonalData(m.about).slice(0, 90),
          from: withoutPersonalData(m.from).slice(0, 40),
        };
      }
      memory.write(key, entries);
    }
    const byParameter = Object.entries(v.input ?? {}).some(([k, x]) => /unread|is_?read/i.test(k) && typeof x === 'boolean');
    const unreadKnown = byParameter || (items.length > 0 && items.every((x) => x.read !== null)) || items.length === 0;
    const kept = items.filter(({ ids, subject, sender, when, read, other, flagged, m }) => {
      if (read === true) return false;
      if (!unreadKnown && when && now.getTime() - Date.parse(when) > RECENT_MS) return false;
      const address = /[\w.+-]+@[\w.-]+/.exec(sender)?.[0] ?? '';
      return keepThread({ id: ids[0], bulk: other || isBulk(address), subject, labels: new Set(flagged ? ['IMPORTANT'] : []), kind: m?.kind }, new Set(), ads);
    });
    // Do logu jen názvy polí a jestli jde poznat přečtené, nikdy obsah: podle toho jde doladit skutečný konektor.
    console.warn(`Outlook: ${items.length} mailů, pole ${fields.join(', ') || 'žádná (přepis od modelu)'}, přečtené ${unreadKnown ? 'pozná' : 'nepozná'}, zůstalo ${kept.length}, z paměti ${known ? items.filter(remembered).length : 0}, nově roztříděno ${fresh.length}.`);
    const prepared = prepareMails(
      {
        count: kept.length,
        more: more || items.length >= LIMIT,
        mails: kept.map(({ subject, when, m, flagged }) => ({
          src: 'outlook',
          subject: withoutPersonalData(subject || m?.subject) || tr('noSubject'),
          when,
          kind: KINDS.includes(m?.kind) ? m.kind : null,
          important: Boolean(m?.important || m?.urgent || flagged),
          urgent: Boolean(m?.urgent),
          deadline: /^\d{4}-\d{2}-\d{2}$/.test(m?.deadline ?? '') ? m.deadline : null,
          tester: false,
          about: withoutPersonalData(m?.about).slice(0, 90),
          from: withoutPersonalData(m?.from).slice(0, 40),
        })),
      },
      now,
    );
    return unreadKnown ? prepared : { ...prepared, unreadKnown: false };
  },
};
