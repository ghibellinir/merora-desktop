// Namluví věty Meri do public/audio/<hlas>/<věta>.wav a zapíše jejich délky do durations.json (znění do texts.json).
// Každý hlas má vlastní složku a platí se jen za věty, které chybí nebo se změnily.
// Přes ElevenLabs, a dokud není vybraný žádný hlas, na Macu dočasně přes `say`, jinde výchozím hlasem ElevenLabs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentData } from './data.mjs';
import { PCM_HZ, speak, loadEnv, addVoice, usage } from './elevenlabs.mjs';
import { language } from './settings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'audio');
const LIST = join(ROOT, 'data', 'voices.json');
// Bez vybraného hlasu: na Macu hlas počítače přes `say` (Zuzana, anglicky Samantha), jinde Rachel z hotových
// hlasů ElevenLabs (je na každém účtu a modely v3/v4 mluví i česky).
const SAY_VOICES = { zuzana: 'Zuzana', samantha: 'Samantha' };
const fallback = (lang) => (process.platform === 'darwin' ? (lang === 'en' ? 'samantha' : 'zuzana') : '21m00Tcm4TlvDq8ikWAM');

// Každý jazyk má svůj hlas (Riccardo 23. 11.: angličtina jiným hlasem než Jana): česky ELEVENLABS_VOICE_ID,
// anglicky ELEVENLABS_VOICE_ID_EN. Každý hlas má vlastní složku, takže se věty v jazycích nepletou.
export const voiceKey = (lang = language()) => (lang === 'en' ? 'ELEVENLABS_VOICE_ID_EN' : 'ELEVENLABS_VOICE_ID');
export const currentVoice = (lang = language()) => loadEnv()[voiceKey(lang)] || fallback(lang);

// Hlasy z data/voices.json pro jazyk (bez language = čeština), první je výchozí.
const readList = () => (existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')) : []);
export const loadVoiceList = (lang = language()) => readList().filter((h) => (h.language ?? 'cs') === lang);
// Uloží hlasy jednoho jazyka, hlasy ostatních jazyků zůstanou.
export const saveVoiceList = (list, lang = language()) => {
  const others = readList().filter((h) => (h.language ?? 'cs') !== lang);
  const mine = list.map((h) => (lang === 'cs' ? h : { ...h, language: lang }));
  writeFileSync(LIST, `${JSON.stringify([...others, ...mine], null, 2)}\n`);
};

// Do 22. 11. 2026 se soubory jmenovaly hlas.json a texty.json. Při startu se jednou přejmenují, ať se nic
// nenamlouvá znovu (platí se za každou větu).
for (const folder of existsSync(OUT) ? readdirSync(OUT) : []) {
  for (const [oldName, newName] of [['hlas.json', 'durations.json'], ['texty.json', 'texts.json']]) {
    const from = join(OUT, folder, oldName);
    if (existsSync(from) && !existsSync(join(OUT, folder, newName))) renameSync(from, join(OUT, folder, newName));
  }
}

const loadTexts = (voiceId) => {
  const file = join(OUT, voiceId, 'texts.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

export const loadDurations = (voiceId) => {
  const file = join(OUT, voiceId, 'durations.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

// Hlas je namluvený, jen když má aktuální znění všech vět, které se teď mají říct.
export function isVoiced(voiceId, data = currentData()) {
  if (!existsSync(join(OUT, voiceId, 'durations.json'))) return false;
  const texts = loadTexts(voiceId);
  return data.sentences.every((v) => texts[v.id] === (v.spoken ?? v.text));
}

// Po novém shrnutí pryč se starými větami. Ukázkové věty a pozdrav zůstávají.
export function cleanUp(voiceId, data) {
  const folder = join(OUT, voiceId);
  const valid = new Set(data.sentences.map((v) => `${v.id}.wav`));
  const texts = loadTexts(voiceId);
  const before14Days = Date.now() - 14 * 86_400_000;
  for (const file of readdirSync(folder)) {
    // Odpovědi z rozhovoru se chvíli drží, protože se opakují a platí se jen jednou.
    if (file.startsWith('o-') && statSync(join(folder, file)).mtimeMs < before14Days) rmSync(join(folder, file));
    if (!file.startsWith('v-') || valid.has(file)) continue;
    rmSync(join(folder, file));
    delete texts[file.replace(/\.wav$/, '')];
  }
  writeFileSync(join(folder, 'texts.json'), JSON.stringify(texts, null, 2));
  const durations = loadDurations(voiceId);
  for (const id of Object.keys(durations)) if (!existsSync(join(folder, `${id}.wav`))) delete durations[id];
  writeFileSync(join(folder, 'durations.json'), JSON.stringify(durations, null, 2));
}

// Délka z hlavičky WAV: velikost bloku "data" / bajtů za sekundu z bloku "fmt ".
export function wavSeconds(file) {
  const b = readFileSync(file);
  let byteRate = 0;
  for (let i = 12; i + 8 <= b.length; ) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = b.readUInt32LE(i + 16);
    if (id === 'data') return size / byteRate;
    i += 8 + size + (size % 2);
  }
  throw new Error(`Ve WAV chybí blok data: ${file}`);
}

// Jen hlas počítače na Macu (AIFF ze `say`). ElevenLabs jde přes pcmToWav.
export function toWav(input, wav) {
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', input, wav]);
  rmSync(input);
  trimSilence(wav);
}

// Holé PCM z ElevenLabs (16 bitů, mono) uloží jako WAV a ořízne ticho. Bez externích nástrojů.
export function pcmToWav(pcm, wav, rate = PCM_HZ) {
  writeFileSync(wav, Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  trimSilence(wav);
}

function wavHeader(duration, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + duration, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(duration, 40);
  return h;
}

// Ořízne ticho na začátku a konci věty. Mezery mezi větami pak určuje jen časová osa,
// jinak by se k nim přičetlo až 0,7 s ticha z nahrávky (viz merora-pacing: 0,2–0,35 s).
function trimSilence(file, leadSec = 0.02, tailSec = 0.08) {
  const b = readFileSync(file);
  let rate = 44100;
  let pcm = null;
  for (let i = 12; i + 8 <= b.length; ) {
    const id = b.toString('ascii', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(i + 12);
    if (id === 'data') pcm = b.subarray(i + 8, i + 8 + size);
    i += 8 + size + (size % 2);
  }
  if (!pcm) throw new Error(`Ve WAV chybí blok data: ${file}`);

  const samples = Math.floor(pcm.length / 2);
  const windowSize = Math.round(rate * 0.02);
  const strengths = [];
  for (let z = 0; z + windowSize <= samples; z += windowSize) {
    let sum = 0;
    for (let i = z; i < z + windowSize; i++) sum += pcm.readInt16LE(i * 2) ** 2;
    strengths.push(Math.sqrt(sum / windowSize));
  }
  const peak = Math.max(0, ...strengths);
  if (peak === 0) return; // úplné ticho nemá co ořezávat
  const threshold = peak * 0.03;
  const first = strengths.findIndex((s) => s > threshold);
  const last = strengths.findLastIndex((s) => s > threshold);
  const from = Math.max(0, first * windowSize - Math.round(leadSec * rate));
  const endSample = Math.min(samples, (last + 1) * windowSize + Math.round(tailSec * rate));

  const segment = Buffer.from(pcm.subarray(from * 2, endSample * 2));
  // Krátké zeslabení na krajích, aby střih neprasknul.
  const rampUp = Math.min(Math.round(rate * 0.005), Math.floor(segment.length / 4));
  const total = segment.length / 2;
  for (let i = 0; i < rampUp; i++) {
    const k = i / rampUp;
    segment.writeInt16LE(Math.round(segment.readInt16LE(i * 2) * k), i * 2);
    const zK = total - 1 - i;
    segment.writeInt16LE(Math.round(segment.readInt16LE(zK * 2) * k), zK * 2);
  }

  writeFileSync(file, Buffer.concat([wavHeader(segment.length, rate), segment]));
}

// Kolik vět se namlouvá naráz. ElevenLabs Starter pustí tři požadavky najednou, víc vrátí 429.
// Shrnutí s osmi větami pak trvá zhruba třetinu času, kredity stojí stejně.
const AT_ONCE = Math.max(1, Number(process.env.MERI_VOICE_AT_ONCE || 3));

// Práce po několika naráz. První chyba zastaví další (rozběhnuté doběhnou) a vyhodí se, až skončí všechny.
async function atOnce(items, howMany, work) {
  let next = 0;
  let error = null;
  const thread = async () => {
    while (!error && next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch (err) {
        error ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(howMany, items.length) }, thread));
  if (error) throw error;
}

// 429 (moc požadavků naráz, třeba když zrovna mluví i rozhovor): chvíli počkat a zkusit znovu.
async function withRepeat(fn, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status !== 429 || attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

export async function makeVoice(voiceId = currentVoice(), data = currentData()) {
  const folder = join(OUT, voiceId);
  mkdirSync(folder, { recursive: true });
  const textsFile = join(folder, 'texts.json');
  const texts = loadTexts(voiceId);
  const wav = (sentence) => join(folder, `${sentence.id}.wav`);

  // Jen věty, které chybí nebo se změnily. Každá je zvláštní požadavek s okolními větami pro intonaci,
  // takže na pořadí nezáleží a jdou naráz.
  const newOnes = data.sentences
    .map((sentence, i) => ({ sentence, i, text: sentence.spoken ?? sentence.text }))
    .filter(({ sentence, text }) => texts[sentence.id] !== text || !existsSync(wav(sentence)));
  await atOnce(newOnes, SAY_VOICES[voiceId] ? 1 : AT_ONCE, async ({ sentence, i, text }) => {
    // Hotová věta se nahradí až po úspěchu. Chyba v půlce nic nerozbije a zaplacené věty zůstanou.
    const fresh = join(folder, `${sentence.id}.new.wav`);
    if (SAY_VOICES[voiceId]) {
      const aiff = join(folder, `${sentence.id}.aiff`);
      execFileSync('say', ['-v', SAY_VOICES[voiceId], '-r', '195', '-o', aiff, text]);
      toWav(aiff, fresh);
    } else {
      const surroundings = { previous: data.sentences[i - 1]?.text, next: data.sentences[i + 1]?.text };
      pcmToWav(await withRepeat(() => speak(text, voiceId, surroundings)), fresh);
    }
    const duration = wavSeconds(fresh);
    if (duration < 0.2) {
      rmSync(fresh);
      throw new Error(`Věta „${sentence.id}“ vyšla jen na ${duration.toFixed(3)} s, nahrávka je špatně.`);
    }
    renameSync(fresh, wav(sentence));
    texts[sentence.id] = text;
    writeFileSync(textsFile, JSON.stringify(texts, null, 2));
  });

  const manifest = Object.fromEntries(data.sentences.map((sentence) => [sentence.id, Number(wavSeconds(wav(sentence)).toFixed(3))]));
  // Délky drží věty ostré Meri i videa, ať přepnutí mezi nimi nerozhodí časování.
  // Vrací se jen věty, které se teď mají říct.
  writeFileSync(join(folder, 'durations.json'), JSON.stringify({ ...loadDurations(voiceId), ...manifest }, null, 2));
  return { manifest, newOnes: newOnes.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const current = currentVoice();
  const voiceList = loadEnv().ELEVENLABS_API_KEY ? loadVoiceList() : [];
  if (!voiceList.some((h) => h.voice_id === current)) voiceList.push({ voice_id: current, name: current });
  for (const h of voiceList) {
    if (h.public_owner_id && !existsSync(join(OUT, h.voice_id))) {
      // Hlas už na účtu být může. Když to je jiný problém, ukáže se při namlouvání.
      await addVoice(h.public_owner_id, h.voice_id, h.name).catch((err) => console.warn(`${h.name}: ${err.message}`));
    }
    const { manifest, newOnes } = await makeVoice(h.voice_id);
    const total = Object.values(manifest).reduce((a, b) => a + b, 0);
    console.log(`${h.name}: ${total.toFixed(1)} s řeči, nově namluveno vět: ${newOnes}`);
  }
  console.log(`Utraceno kreditů: ${usage.credits}`);
  // Běžící okno se načte s novým časováním. Když server neběží, nevadí to.
  await fetch(`http://127.0.0.1:${process.env.PORT || 4747}/cmd`, {
    method: 'POST',
    body: JSON.stringify({ cmd: 'reload' }),
  }).catch(() => {});
}
