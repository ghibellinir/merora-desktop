// Napojení na ElevenLabs. Klíč je jen v .env (mimo git) a nikam se nevypisuje.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// MERI_ENV: jiný soubor (zkušební servery, ať nepřepíšou skutečné klíče a odkazy).
const ENV = process.env.MERI_ENV || join(ROOT, '.env');
const BASE = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
import { language } from './settings.mjs';

const DEFAULT_MODEL = 'eleven_v4'; // podle dokumentace nejkvalitnější, umí česky

// Klíče v .env, které se do 23. 11. 2026 jmenovaly česky. Čtou se pod novým jménem, zápis starý řádek nahradí.
const OLD_KEYS = { GOOGLE_KALENDAR_ICAL: 'GOOGLE_CALENDAR_ICAL', MERI_POCASI: 'MERI_WEATHER' };

export function loadEnv() {
  if (!existsSync(ENV)) return {};
  const env = {};
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) env[m[1]] = m[2];
  }
  for (const [old, now] of Object.entries(OLD_KEYS)) if (env[old] && !env[now]) env[now] = env[old];
  return env;
}

export function writeEnv(key, amount) {
  const old = Object.keys(OLD_KEYS).find((k) => OLD_KEYS[k] === key);
  const lines = (existsSync(ENV) ? readFileSync(ENV, 'utf8').split('\n') : []).filter((r) => !old || !r.startsWith(`${old}=`));
  const i = lines.findIndex((r) => r.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${amount}`;
  else lines.splice(lines.length && lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${amount}`);
  writeFileSync(ENV, lines.join('\n').replace(/\n*$/, '\n'));
  chmodSync(ENV, 0o600);
}

async function request(route, options = {}) {
  const key = loadEnv().ELEVENLABS_API_KEY;
  if (!key) throw new Error('Chybí klíč ELEVENLABS_API_KEY v souboru .env.');
  const res = await fetch(BASE + route, {
    ...options,
    signal: AbortSignal.timeout(60_000),
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...options.headers },
  });
  if (res.ok) return res;
  let message = res.statusText;
  try {
    const body = await res.json();
    message = body.detail?.message ?? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
  } catch {}
  const error = new Error(`ElevenLabs ${res.status}: ${message}`);
  error.status = res.status;
  throw error;
}

// Ženské hlasy z knihovny v jazyce Meri (cs, en), nejpoužívanější první. Bez hlasů s příplatkem a živou moderací.
export async function voiceCatalog(lang = language()) {
  const q = new URLSearchParams({
    language: lang,
    gender: 'female',
    sort: 'usage_character_count_1y',
    page_size: '40',
    include_custom_rates: 'false',
    include_live_moderated: 'false',
  });
  const { voices = [] } = await (await request(`/v1/shared-voices?${q}`)).json();
  return voices
    .map((v) => {
      const verified = v.verified_languages?.find((l) => l.language === lang);
      return {
        voice_id: v.voice_id,
        public_owner_id: v.public_owner_id,
        name: v.name,
        description: [v.age, v.descriptive, v.use_case].filter(Boolean).join(' · ').replaceAll('_', ' '),
        sample: verified?.preview_url ?? v.preview_url ?? null,
      };
    })
    .filter((v) => v.sample)
    .slice(0, 14);
}

// Hlas z knihovny je potřeba přidat k účtu. Když už tam je, API vrátí chybu, která nevadí.
export async function addVoice(publicOwnerId, voiceId, name) {
  await request(`/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    body: JSON.stringify({ new_name: `Meri ${name}`.slice(0, 80) }),
  });
}

export const usage = { credits: 0 };

// Odpovědi v rozhovoru: rychlejší model ze stejné rodiny jako shrnutí (podle dokumentace asi 100 ms, umí česky),
// takže hlas v rozhovoru nezní jinak. Ušetří pár set ms na větu (22. 11.: 1385 ms proti 1738 ms u eleven_v4).
// Jiný jde nastavit v .env (ELEVENLABS_DIALOG_MODEL).
const DIALOG_MODEL = 'eleven_v4_turbo';
export const dialogVoiceModel = () => loadEnv().ELEVENLABS_DIALOG_MODEL || DIALOG_MODEL;

// Vrátí holé PCM (16 bitů, mono, PCM_HZ). WAV z něj složí voice.mjs v Node, takže není potřeba převodník
// z macOS (afconvert) a funguje to i na Windows. 24 kHz jde na všech plánech, 44,1 kHz PCM chce plán Pro.
// Okolní věty pomáhají plynulé intonaci. Pokud je model nepřijme, zkusí se to bez nich.
export const PCM_HZ = 24_000;
export async function speak(text, voiceId, { previous, next, model = loadEnv().ELEVENLABS_MODEL || DEFAULT_MODEL, lang = language() } = {}) {
  const route = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${PCM_HZ}`;
  const base = { text, model_id: model, language_code: lang };
  const context = { ...(previous ? { previous_text: previous } : {}), ...(next ? { next_text: next } : {}) };
  let res;
  try {
    res = await request(route, { method: 'POST', body: JSON.stringify({ ...base, ...context }) });
  } catch (err) {
    if (![400, 422].includes(err.status) || !Object.keys(context).length) throw err;
    res = await request(route, { method: 'POST', body: JSON.stringify(base) });
  }
  usage.credits += Number(res.headers.get('character-cost') ?? 0);
  return Buffer.from(await res.arrayBuffer());
}
