// Paměť roztříděných mailů pro další schránky (Outlook a kdokoli další), jako u Gmailu (tools/sources/gmail.mjs,
// MAIL_CACHE). Riccardo 26. 11.: „tohle by mělo platit pro jakýhokoliv poskytovatele“. Mail, který Meri už
// roztřídila, se při dalším načtení netřídí znovu. Platí jen pro stejná pravidla (klíč), jinak se obsah hned smaže.
// Je jen na tomhle počítači a soubor čte jen uživatel. Co v ní je, rozhoduje schránka; nikdy text mailu ani adresa.
// Gmail má svůj soubor (~/.meri/mail-cache.json), další schránky ~/.meri/mail-cache-<id>.json. MERI_MAIL_CACHE
// (zkoušky) přesměruje i je.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function mailMemory(id) {
  const file = () => (process.env.MERI_MAIL_CACHE || join(homedir(), '.meri', 'mail-cache.json')).replace(/(\.json)?$/, `-${id}.json`);
  const readFile = () => {
    try {
      return JSON.parse(readFileSync(file(), 'utf8'));
    } catch {
      return {};
    }
  };
  function write(key, mails) {
    try {
      mkdirSync(dirname(file()), { recursive: true });
      writeFileSync(file(), JSON.stringify({ key, mails }), { mode: 0o600 });
    } catch (err) {
      console.warn(`Paměť mailů (${id}) se nepovedlo uložit (${err.message}).`);
    }
  }
  return {
    // Roztříděné maily podle id, nebo null (žádná paměť, nebo z jiných pravidel; ta se smaže).
    read(key) {
      const c = readFile();
      if (c.key === key && c.mails && typeof c.mails === 'object') return c.mails;
      if (c.mails && Object.keys(c.mails).length) write(null, {});
      return null;
    },
    write,
  };
}
