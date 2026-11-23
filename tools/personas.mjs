// Zkušební sada (PRAVIDLA.md, část 8): vymyšlení lidé ze složky personas/. Na každém se nanečisto napíše shrnutí
// skutečným Claudem a pustí pár vět rozhovoru (jen rozhodnutí modelu, nic se nikam nezapisuje). Výsledek se
// zkontroluje proti pravidlům. Pouští se před každým vydáním a po změně pokynů pro model.
//   npm test                 všichni
//   npm test -- student      jen ti, jejichž soubor obsahuje „student“
// Každý člověk běží ve vlastním procesu s vlastním nastavením (MERI_SETTINGS v dočasné složce). Skutečná data,
// Merora ani hlas se nepoužijí. Stojí to jen limity Clauda (shrnutí Opus, rozhovor Sonnet).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = join(ROOT, 'personas');
const AT_ONCE = 3; // tolik lidí najednou, víc Claude zbytečně brzdí
const RESULT = 'VÝSLEDEK ';

// Bez diakritiky a malými písmeny, ať „Káji“ najde i „kaji“.
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// --- Jeden člověk (dětský proces) ---
async function runOne(file) {
  const { pragueToInstant, dialogItems, listsForDialog, systemPrompt, SCHEMA, wantsMails, localTime, calendarForDialog } = await import('./dialog.mjs');
  const { writeBrief, problems, sameText } = await import('./brief.mjs');
  const { prepareReminders } = await import('./sources/merora.mjs');
  const { prepareCalendar } = await import('./sources/calendar.mjs');
  const { prepareMails } = await import('./sources/gmail.mjs');
  const { isSpeakable } = await import('./sources/index.mjs');
  const { BRIEF_LENGTHS, getBriefLength, profile, shouldMentionRings, language } = await import('./settings.mjs');
  const { MAX_LINES, MAX_BOX } = await import('./lines.mjs');
  const { askClaude } = await import('./ai.mjs');
  const { weekdayName } = await import('./time.mjs');

  const person = JSON.parse(readFileSync(file, 'utf8'));
  const instant = (s) => {
    const d = pragueToInstant(s);
    if (!d) throw new Error(`Neplatný čas „${s}“ v ${file}.`);
    return d;
  };
  const now = instant(person.now);

  // Připomínky ve tvaru, jaký vrací Merora (stejně je pak zpracuje zdroj i rozhovor).
  const rows = (person.sources.merora ?? []).map((p) => ({
    id: p.id,
    task: p.text,
    date_time: p.when ? instant(p.when).toISOString() : null,
    trigger_count: p.rang ?? 0,
    ...(p.place ? { place_id: p.id, place_name: p.place, geo_direction: 'arrival' } : {}),
    ...(p.repeat ? { recurrence_type: p.repeat } : {}),
    ...(p.list ? { steps: { kind: 'list', items: p.list.map((text, i) => ({ id: i + 1, text })) } } : {}),
    ...(p.routine ? { steps: { kind: 'routine', items: p.routine.map((text, i) => ({ id: i + 1, text })) } } : {}),
  }));
  const z = person.sources;
  const sourceData = {};
  if ('merora' in z) sourceData.merora = z.merora === null ? null : prepareReminders(rows, now);
  if ('calendar' in z) sourceData.calendar = z.calendar === null ? null : prepareCalendar(z.calendar);
  if ('weather' in z) sourceData.weather = z.weather;
  if ('gmail' in z) {
    sourceData.gmail = z.gmail === null ? null : prepareMails({ ...z.gmail, mails: z.gmail.mails.map((m) => ({ ...m, when: instant(m.when).toISOString() })) }, now);
  }

  const checks = [];
  const check = (title, ok, detail = '') => checks.push({ title, ok: Boolean(ok), detail });
  let brief;
  try {
    brief = await writeBrief(sourceData, now);
  } catch (err) {
    check('shrnutí se napsalo', false, err.message);
    return { person: person.title, checks, sentences: [], lines: [], conversation: [] };
  }
  const sentences = brief.sentences.slice(1).map((v) => v.text);
  const spoken = plain(sentences.join(' '));
  const o = person.expected ?? {};

  // Pravidla ze shrnutí (PRAVIDLA.md, část 2, 5 a 6).
  const hard = problems(brief).filter((p) => !p.startsWith('drobnost: ') && !p.startsWith('věta mluví o'));
  check('obrazovka a soukromí (pojistka za modelem)', !hard.length, hard.join('; '));
  // Událost z kalendáře, která je i v Meroře, má být v boxu jednou (podle Merory).
  const inMerora = (k) => (sourceData.merora ?? []).some((m) => m.time === k.time && sameText(m.text, k.text));
  const speakable = [...(sourceData.merora ?? []), ...(sourceData.calendar ?? []).filter((k) => !inMerora(k))].filter(isSpeakable);
  const inBox = new Set(brief.today.map((r) => r.id));
  const missing = speakable.filter((p) => !inBox.has(p.id));
  // Když je dnešních s časem víc, než se vejde na všechny stránky, box je plný jen jimi.
  const fullOfToday = brief.today.length === MAX_BOX && brief.today.every((r) => speakable.some((p) => p.id === r.id));
  check('dnešní s časem jsou v boxu Dnes', !missing.length || fullOfToday, missing.map((p) => p.text).join(', '));
  check(`box Dnes má nejvýš ${MAX_BOX} řádků`, brief.today.length <= MAX_BOX, `${brief.today.length}`);
  // Víc stránek: Meri mluví o něčem z každé stránky, na které jsou věci s časem (okno ji pak ukáže).
  if (o.everyPage) {
    const highlighted = new Set(brief.sentences.flatMap((v) => v.highlight ?? []));
    for (let i = 0; i * MAX_LINES < brief.today.length; i++) {
      const page = brief.today.slice(i * MAX_LINES, (i + 1) * MAX_LINES);
      if (!page.some((r) => speakable.some((p) => p.id === r.id))) continue;
      check(`mluví o něčem ze stránky ${i + 1}`, page.some((r) => highlighted.has(r.id)));
    }
  }
  const limit = BRIEF_LENGTHS[getBriefLength()];
  const maxSentences = Math.min(limit.maxSentences, o.maxSentences ?? limit.maxSentences);
  check(`délka (${getBriefLength()}): nejvýš ${maxSentences} vět`, sentences.length <= maxSentences, `${sentences.length} vět`);
  const chars = sentences.reduce((s, v) => s + v.length, 0);
  check(`délka: nejvýš ${limit.total} znaků`, chars <= limit.total, `${chars} znaků`);
  const english = language() === 'en';
  const nagging = english ? /!|don'?t forget|make sure|(?<!\p{L})above all(?!\p{L})/iu : /!|(?<!\p{L})(nezapomeň|hlavně)(?!\p{L})/iu;
  check('bez vykřičníků a napomínání', !nagging.test(sentences.join(' ')));
  const rings = english ? /(?<!\p{L})(rang|rung|ringing|rings)(?!\p{L})/iu : /zvonil|zvoněn|zazvon/iu;
  if (!shouldMentionRings()) check('neříká, kolikrát připomínka zvonila', !rings.test(sentences.join(' ')));
  if (english) check('mluví anglicky', !/[ěščřžůú]/iu.test(sentences.join(' ')), sentences.join(' '));
  if (o.greeting) check(`pozdrav „${o.greeting}“`, brief.sentences[0].text.startsWith(o.greeting), brief.sentences[0].text);
  for (const { what, words } of o.mention ?? []) {
    check(`zmíní: ${what}`, words.some((s) => spoken.includes(plain(s))));
  }
  // Panel s maily ukazuje všechny důležité (nejvýš 4), ať sedí s číslem na dlaždici.
  if (sourceData.gmail) {
    const important = sourceData.gmail.mails.filter((m) => m.important || m.urgent || m.tester).length;
    check(`panel ukazuje důležité maily (${Math.min(important, 4)})`, brief.mails.length === Math.min(important, 4), `${brief.mails.length}`);
  }
  for (const id of o.inBox ?? []) check(`v boxu Dnes: ${id}`, inBox.has(id));
  for (const id of o.notInBox ?? []) check(`není v boxu Dnes: ${id}`, !inBox.has(id));
  for (const word of o.notMention ?? []) {
    check(`nezmíní: ${word}`, !spoken.includes(plain(word)));
  }

  // Rozhovor: jen rozhodnutí modelu nad stejnými daty, jako je dostává skutečná Meri (tools/dialog.mjs, zprava).
  const conversation = [];
  // Kalendář jako v rozhovoru (calendarForDialog): dnešek z dat člověka a další dny z calendarAhead.
  const today = person.now.slice(0, 10);
  const events = 'calendar' in z && z.calendar
    ? [...z.calendar.map((e) => ({ day: today, title: e.title, time: e.time ?? null })), ...(z.calendarAhead ?? [])]
    : null;
  const calendar = calendarForDialog(events, brief.today.filter((r) => r.id.startsWith('k')), now);
  for (const { say, action, id, answerMentions } of person.conversation ?? []) {
    const briefForModel = {
      today: brief.today.map((r) => ({ id: r.id, title: r.title, time: r.time ?? null, meta: r.meta ?? '' })),
      tiles: brief.tiles.map((p) => ({ id: p.id, title: p.title, value: p.value, caption: p.caption })),
      panels: [],
      mails: brief.mails.map((m) => ({ subject: m.subject, who: m.who, label: m.label })),
      weather: brief.weather ? { temperature: brief.weather.temperature, precipitation: brief.weather.precipitation ?? null } : null,
      weather_tomorrow: brief.weather ? sourceData.weather?.tomorrow ?? null : null,
      inbox: brief.inbox
        ? wantsMails(say)
          ? { unread: brief.inbox.count, mails: brief.inbox.mails }
          : { unread: brief.inbox.count, mails: language() === 'en' ? 'details come with a question about mails' : 'podrobnosti přijdou s otázkou na maily' }
        : null,
      you_said: sentences,
    };
    const message = {
      user_said: say,
      now: `${weekdayName(now)} ${localTime(now)}`,
      items: [...dialogItems(rows), ...calendar],
      lists: listsForDialog(rows),
      last_change: null,
      you_said_last: sentences.at(-1) ?? null,
      brief: briefForModel,
    };
    try {
      const proposal = await askClaude({
        model: process.env.MERI_MODEL_DIALOG || 'sonnet',
        system: systemPrompt(profile()),
        schema: SCHEMA,
        prompt: JSON.stringify(message),
      });
      const mentioned = !answerMentions || answerMentions.some((w) => plain(proposal.answer).includes(plain(w)));
      const ok = action.includes(proposal.action) && (!id || proposal.id === id) && mentioned;
      conversation.push({ say, proposal: `${proposal.action}${proposal.id ? ` ${proposal.id}` : ''}: „${proposal.answer}“` });
      check(`rozhovor „${say}“ → ${action.join(' / ')}${id ? ` ${id}` : ''}`, ok, `${proposal.action}${proposal.id ? ` ${proposal.id}` : ''}`);
    } catch (err) {
      check(`rozhovor „${say}“`, false, err.message);
    }
  }
  return {
    person: person.title,
    checks,
    sentences: brief.sentences.map((v) => v.text),
    lines: brief.today.map((r) => `${r.time ?? '     '} ${r.title}${r.meta ? ` · ${r.meta}` : ''}`),
    conversation,
  };
}

// --- Všichni (hlavní proces) ---
function runChild(file, tempDir) {
  const person = JSON.parse(readFileSync(file, 'utf8'));
  const settings = join(tempDir, `${person.id}.json`);
  writeFileSync(settings, JSON.stringify({ welcomed: true, ...person.settings, ...(person.rules ? { rules: person.rules } : {}), sources: {} }));
  return new Promise((finished) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--one', file], {
      cwd: ROOT,
      env: { ...process.env, MERI_SETTINGS: settings, MERI_BRIEF: join(tempDir, `${person.id}-brief.json`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    p.stdout.on('data', (d) => (output += d));
    p.stderr.on('data', (d) => (errors += d));
    p.on('close', () => {
      const line = output.split('\n').find((r) => r.startsWith(RESULT));
      if (line) return finished(JSON.parse(line.slice(RESULT.length)));
      finished({ person: person.title, checks: [{ title: 'běh', ok: false, detail: (errors || output).trim().slice(-400) }], sentences: [], lines: [], conversation: [] });
    });
  });
}

function listOut(v) {
  const wrong = v.checks.filter((k) => !k.ok);
  console.log(`\n${wrong.length ? '✗' : '✓'} ${v.person} (${v.checks.length - wrong.length}/${v.checks.length})`);
  for (const r of v.lines) console.log(`    [Dnes] ${r}`);
  for (const t of v.sentences) console.log(`    „${t}“`);
  for (const r of v.conversation) console.log(`    ${r.say} → ${r.proposal}`);
  for (const k of wrong) console.log(`    ✗ ${k.title}${k.detail ? `: ${k.detail}` : ''}`);
}

if (process.argv[2] === '--one') {
  const result = await runOne(process.argv[3]).catch((err) => ({
    person: process.argv[3],
    checks: [{ title: 'běh', ok: false, detail: err.message }],
    sentences: [],
    lines: [],
    conversation: [],
  }));
  console.log(`${RESULT}${JSON.stringify(result)}`);
} else {
  const filter = process.argv[2] ?? '';
  const files = readdirSync(FOLDER).filter((f) => f.endsWith('.json') && f.includes(filter)).sort().map((f) => join(FOLDER, f));
  if (!files.length) {
    console.error(`Ve složce personas/ není nikdo${filter ? ` se slovem „${filter}“` : ''}.`);
    process.exit(1);
  }
  console.log(`Zkouším ${files.length} ${files.length === 1 ? 'člověka' : 'lidí'}, každý zabere asi minutu…`);
  const tempDir = mkdtempSync(join(tmpdir(), 'merora-personas-'));
  const start = Date.now();
  const results = [];
  const queue = [...files];
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
      while (queue.length) {
        const v = await runChild(queue.shift(), tempDir);
        listOut(v);
        results.push(v);
      }
    }),
  );
  rmSync(tempDir, { recursive: true, force: true });
  const all = results.flatMap((v) => v.checks);
  const wrong = all.filter((k) => !k.ok).length;
  console.log(`\n${wrong ? `✗ Neprošlo ${wrong} z ${all.length} kontrol` : `✓ Prošlo všech ${all.length} kontrol`} (${Math.round((Date.now() - start) / 1000)} s).`);
  process.exit(wrong ? 1 : 0);
}
