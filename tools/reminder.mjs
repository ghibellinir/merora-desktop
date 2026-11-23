// Založí připomínku v Meroře pod tvým přihlášením z Meri.
//   npm run reminder -- "Text připomínky" --when "2026-11-10 09:00" [--note "…"] [--dry-run]
// Čas je místní (časové pásmo počítače). Bez --when se připomínka uloží do Kdykoli.
import { hasOAuth, createReminder } from './merora.mjs';

function params(argv) {
  const out = { task: null, when: null, note: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--when') out.when = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (!a.startsWith('--') && out.task == null) out.task = a;
    else throw new Error(`Neznámý parametr: ${a}`);
  }
  return out;
}

// "2026-11-10 09:00" v pražském čase → Date (bez závislostí, přes posun zóny v ten den).
function pragueTime(text) {
  const m = text?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) throw new Error('Čas zadej jako "RRRR-MM-DD HH:MM", např. "2026-11-10 09:00".');
  const [, r, monthNum, d, h, minuteNum] = m.map(Number);
  const utcGuess = Date.UTC(r, monthNum - 1, d, h, minuteNum);
  const shift = (date) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const c = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
    return Date.UTC(+c.year, +c.month - 1, +c.day, +c.hour, +c.minute) - date.getTime();
  };
  let when = new Date(utcGuess - shift(new Date(utcGuess)));
  when = new Date(utcGuess - shift(when));
  if (when.getTime() < Date.now()) throw new Error('Ten čas už byl.');
  return when;
}

try {
  const p = params(process.argv.slice(2));
  if (!p.task) throw new Error('Chybí text připomínky. Příklad: npm run reminder -- "Zavolat tátovi" --when "2026-11-10 18:00"');
  const when = p.when ? pragueTime(p.when) : null;
  if (p.dryRun) {
    console.log(JSON.stringify({ task: p.task, date_time: when?.toISOString() ?? null, note: p.note ?? null }));
    process.exit(0);
  }
  const result = await createReminder({ task: p.task, when, note: p.note });
  const id = result?.id ?? result?.reminder?.id ?? '?';
  const whenText = when ? when.toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' }) : 'Kdykoli';
  console.log(`Připomínka založená (id ${id}): „${p.task}“, ${whenText}`);
  // Telefon si budík naplánuje, až se o připomínce dozví (tools/merora.mjs).
  if (when && !hasOAuth()) console.log('Telefon se o ní dozví, až otevřeš Meroru v mobilu: Merora Desktop není propojená přes OAuth (http://127.0.0.1:4747/connect).');
  else if (when && when.getTime() - Date.now() < 5 * 60_000) console.log('Je to za pár minut: otevři Meroru v mobilu, ať to stihne zazvonit.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
