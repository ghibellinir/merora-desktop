// Místní server Meri: servíruje okno, drží společný čas shrnutí, rozhovor a nastavení. Bez závislostí,
// poslouchá jen na tomhle počítači (127.0.0.1).
//   node server.mjs                         běžná Meri na http://127.0.0.1:4747/
//   node server.mjs --video --port 4748     natáčení: vymyšlený den z data/video.json, skutečná data se nečtou
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askClaude } from './tools/ai.mjs';
import { VIDEO, currentData, tomorrowData, updateBrief, updateTomorrowBrief, writeTomorrowBrief } from './tools/data.mjs';
import { dayOf } from './tools/time.mjs';
import { tomorrowStart, weatherTomorrow, collectTomorrow, composeBrief, mailBoxes } from './tools/brief.mjs';
import { Dialog, wantsRepeat, asksAboutDay } from './tools/dialog.mjs';
import { TAIL, buildTimeline } from './public/timeline.js';
import { loadEnv, addVoice, voiceCatalog, writeEnv } from './tools/elevenlabs.mjs';
import { currentVoice, isVoiced, loadDurations, loadVoiceList, cleanUp, saveVoiceList, makeVoice, voiceKey } from './tools/voice.mjs';
import {
  consentUrl, finishConsent, hasOAuth, oauthAvailable, disconnectOAuth, fetchReminders, remindersWithoutWrites, directAvailable, oauthAccount,
  phoneStatus, writesSoFar,
  OAUTH_CLIENT_ID, realtimeAuth, realtimeConfig,
} from './tools/merora.mjs';
import { meroraSignal } from './tools/realtime.mjs';
import {
  BRIEF_LENGTHS, REFRESH_INTERVALS, MAX_RULES, MAX_RULE, getBriefLength as chosenLength, voiceEnabled, shouldMentionRings, showYesterday, shouldMentionWeather, preloadTomorrow, ownRules, hasVoiceKey, meroraLive, loadSettings, getRefreshHours, profile, language, LANGUAGES,
  saveSettings,
} from './tools/settings.mjs';
import { findCity } from './tools/weather.mjs';
import { SOURCES, isEnabled, fingerprintForSentences, bySettings, toggleSource, collectOnly, sourceOptions } from './tools/sources/index.mjs';
import { MERORA_MCP, prepareReminders } from './tools/sources/merora.mjs';
import { rewriteSource, sentencesStale } from './tools/live.mjs';
import { checkForUpdate, updateInfo, applyUpdate, currentVersion } from './tools/update.mjs';
import { tr } from './tools/i18n.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const portFromArgs = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : null;
const PORT = Number(process.env.PORT || portFromArgs || 4747);
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
};
// Staré české adresy (/jedna, /prihlaseni, /hlasy) zůstávají kvůli aplikaci nainstalované z Chromu před 23. 11. 2026:
// otevírá adresu, se kterou se instalovala (start_url v manifestu té doby).
const ROUTES = {
  '/': '/app.html',
  '/app': '/app.html',
  '/connect': '/login.html',
  '/voices': '/voices.html',
  '/jedna': '/app.html',
  '/prihlaseni': '/login.html',
  '/hlasy': '/voices.html',
};

// mode: „idle“ = čeká, „run“ = shrnutí běží od startAt (ms od epochy, klidně v budoucnu). gen: číslo průběhu.
// rev: když se změní, okno si vezme nová data (nové shrnutí, den, hlas, zdroje); okno v public/app.js vymění jen
// boxy vpravo a věty, bez načtení stránky (takeNewData). label: krátký nápis po přepnutí hlasu.
// preparing: text, dokud se chystá shrnutí, nebo proč se nepovedlo. dialog: rozhovor (Dialog.v), nebo null.
// voice: false = Meri jen píše do bubliny (vypnutý v nastavení, nebo chybí klíč ElevenLabs).
// mic: uživatel zapnul poslech (tlačítko, M, ⌥M / Alt+M). Jen tehdy okno poslouchá, a to bez oslovení.
// Po rozloučení nebo 45 s ticha se sám vypne (Riccardo 19. 11.: nechce, aby poslouchala pořád).
// refreshing: data se načítají (i potichu na pozadí), okno točí šipkou vpravo nahoře. video: natáčecí server.
// lines: box „Dnes“ po změně od posledního načtení okna (živá data, rozhovor), okno ho přepíše na místě.
// weather: karta počasí po čtvrthodinové obnově. Obojí null = jak to okno načetlo.
let state = {
  mode: 'idle', startAt: 0, gen: 0, rev: 0, label: null, preparing: null, dialog: null,
  voice: voiceEnabled(), mic: false, refreshing: false, video: VIDEO, lines: null, weather: null, phone: null,
  day: 'today', // přepínač Dnes / Zítra v okně
  // Aktualizace (tools/update.mjs): verze běžícího serveru (okno se po aktualizaci podle ní načte znovu),
  // update: novější vydání na GitHubu, nebo null; updating: právě se aktualizuje; updateError: proč se nepovedla.
  version: currentVersion(), update: null, updating: false, updateError: null,
  language: language(), // jazyk okna a Meri (cs, en)
};

// --- Dnes / Zítra (Riccardo 21. a 22. 11.) ---
// Okno ukazuje shrnutí dneška, nebo zítřka (tools/brief.mjs --tomorrow, data/brief-tomorrow.json). Pravidla načítání
// (Riccardo 22. 11.): dnešek po spuštění, zítřek při prvním přepnutí na něj, pak oba jen ručně (R, šipka), nebo
// podle intervalu z nastavení. Merora, kalendář a počasí běží živě v obou dnech (bez AI). Věty se přepíšou až
// před přehráním, když se od jejich napsání změnilo něco s časem na ten den. Meri sama nemluví.
const tomorrowDay = () => dayOf(new Date(Date.now() + 24 * 3600 * 1000));
const tomorrowLoaded = (t = tomorrowData()) => Boolean(t) && t.forDay === tomorrowDay();
// Zítřek, jehož věty se před přehráním musí (pře)psat: ještě je nemá, nebo se změnila Merora či kalendář.
const tomorrowNeedsSentences = (t = tomorrowData()) =>
  !tomorrowLoaded(t) || Boolean(t.provisional) || fingerprintForSentences(t.sourceData) !== t.sentencesFingerprint;
// Zítřek starší než interval obnovy z nastavení (0 = jen ručně).
function tomorrowExpired(t = tomorrowData()) {
  const hours = getRefreshHours();
  return tomorrowLoaded(t) && Boolean(hours) && Date.now() - new Date(t.createdAt).getTime() >= hours * 3600_000;
}
// Co okno teď ukazuje a Meri říká. Zítřek, který ještě není, ukáže dnešek, než se načte.
const shownData = () => (state.day === 'tomorrow' ? tomorrowData() ?? currentData() : currentData());
let collectionDay = 'today'; // pro který den běží sběr

// Zítřek po prvním přepnutí (nebo předem): data bez AI (Merora, kalendář, počasí, maily z dneška) jsou v boxu do
// pár vteřin, věty se pak napíšou potichu na pozadí (jedno volání Clauda). Okno se po větách načte znovu, až Meri
// nic neříká.
let loadingTomorrow = null;
function loadTomorrow({ sentences = true } = {}) {
  if (VIDEO || loadingTomorrow) return loadingTomorrow;
  loadingTomorrow = (async () => {
    if (!tomorrowLoaded()) {
      try {
        const start = tomorrowStart();
        const sourceData = await collectTomorrow(start);
        const brief = composeBrief({ today: [], mails: [], sentences: [] }, sourceData, start, { tomorrow: true });
        writeTomorrowBrief({ ...brief, createdAt: new Date().toISOString(), sourceData, sentencesFingerprint: null, provisional: true });
        if (state.day === 'tomorrow') {
          state = { ...state, rev: state.rev + 1 };
          broadcast();
        }
      } catch (err) {
        console.error(`Zítřek bez AI: ${err.message}`);
      }
    }
    if (sentences && tomorrowNeedsSentences() && !collection) prepare(null, { quiet: true, day: 'tomorrow' });
  })().finally(() => {
    loadingTomorrow = null;
  });
  return loadingTomorrow;
}

// Živá data pro zítřek (Merora po signálu nebo zápisu, kalendář a počasí po čtvrthodině), jen když je zítřek
// načtený. Box a dlaždice zítřka se přepíšou na místě, když je zrovna v okně. Věty se přepíšou před přehráním.
function writeLiveTomorrow(id, data) {
  if (VIDEO || data == null || (collection && collectionDay === 'tomorrow') || !tomorrowLoaded()) return false;
  const brief = updateTomorrowBrief((b) => rewriteSource(b, id, data, tomorrowStart()));
  if (!brief) return false;
  if (state.day === 'tomorrow') {
    const shown = bySettings(brief);
    state = { ...state, lines: shown.today, tiles: shown.tiles, linesDay: 'tomorrow', ...(id === 'weather' && brief.weather ? { weather: brief.weather } : {}) };
    // Panel s maily okno na místě nepřepisuje: vezme si nová data (bez načtení stránky, public/app.js takeNewData).
    if (id === 'gmail' && !isBusy()) state = { ...state, rev: state.rev + 1 };
    broadcast();
  }
  console.log(`Živá data zítřka: ${id} se změnil`);
  return true;
}
const clients = new Set();
let collection = null; // běžící sběr (proces), při namlouvání videa true
let signalDuringCollection = false; // signál z Merory přišel během sběru: načte se po něm
let signalSeen = false; // už došla aspoň jedna změna ze signálu (log)
let quietCollection = false; // sběr běží potichu na pozadí (samo obnovování), nic nepřerušuje
let afterCollection = null; // co udělat, až bude shrnutí nachystané
let generatingVoice = false; // namlouvá se jiný hlas ze stránky /voices
let preparingVoice = false; // před přehráním se namlouvají nové věty shrnutí
let staleWindow = false; // po tiché obnově jsou na disku novější data, než ukazuje okno
let nextQuietAttempt = 0; // po nepovedené tiché obnově se další zkouší až za čtvrt hodiny
let sentencesOnly = false; // běžící sběr jen přepisuje věty nad uloženými daty (tools/brief.mjs --sentences)
let failedSentences = null; // otisk dat, nad kterými se nové věty nepovedly: ty se přehrají staré, znovu se nezkouší

const LABEL_MS = 6000;
const AFTER_LOAD_MS = 2500; // čas na znovunačtení okna po novém shrnutí nebo hlasu
const label = (text) => ({ text, to: Date.now() + LABEL_MS });

let lastRev = 0;
function broadcast() {
  // Okno se při změně rev načte znovu, takže pak ukazuje to, co je na disku.
  if (state.rev !== lastRev) {
    lastRev = state.rev;
    staleWindow = false;
    state = { ...state, lines: null, weather: null, tiles: null, linesDay: null }; // okno si načte, co je teď na disku
  }
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Box „Dnes“ z rozhovoru zůstává ve stavu i po jeho konci, ať ho okno nevrátí na starší živá data.
const dialog = new Dialog(
  (v) => {
    state = { ...state, dialog: v, ...(v?.lines && state.day === 'today' ? { lines: v.lines, linesDay: 'today' } : {}) };
    broadcast();
  },
  () => afterConversation(),
);

// Rozhovor skončil sám (rozloučení, ticho): mikrofon se vypne, boxy zůstávají na obrazovce.
function afterConversation() {
  if (!state.mic) return;
  state = { ...state, mic: false };
  broadcast();
}

// Za kolik sekund od startu Meri dořekne shrnutí. Stejná časová osa jako v okně (public/timeline.js),
// délky vět z namluveného hlasu, bez něj odhad.
function briefDuration() {
  return buildTimeline(shownData().sentences, loadDurations(currentVoice())).end + TAIL;
}

const isPlaying = () => state.mode === 'run' && Date.now() < state.startAt + briefDuration() * 1000;
// Tichá obnova na pozadí Meri nezaměstnává: mluvit s ní jde, mezerník jen počká na nová data.
const isBusy = () => (Boolean(collection) && !quietCollection) || preparingVoice || isPlaying() || dialog.speakingOrThinking;
// Shrnutí stačí, dokud není starší než interval obnovy z nastavení. Jen ručně: stačí vždycky, nová data
// načte až R nebo šipka. Ukázková data (po instalaci) nestačí nikdy.
function isFresh() {
  const data = currentData();
  if (data.sample) return false;
  const hours = getRefreshHours();
  return !hours || Date.now() - new Date(data.createdAt).getTime() < hours * 3600 * 1000;
}

// Se zapnutým mikrofonem Meri poslouchá, kdykoli zrovna nic nechystá ani neříká. S ukázkovými daty
// (po instalaci ještě žádné shrnutí) nejdřív nachystá a řekne skutečné ráno, to po ní člověk na začátku chce.
function listenWhenPossible() {
  if (!state.mic || dialog.v || isBusy()) return;
  if (!VIDEO && currentData().sample) prepare(() => play());
  else dialog.open();
}

// Po dočtení shrnutí se zapnutým mikrofonem Meri hned poslouchá. Hlídá to server, ne okno:
// okno schované za jinou aplikací se nevykresluje. Volá se při každé změně průběhu.
let endTimer = null;
function watchEnd() {
  clearTimeout(endTimer);
  if (state.mode !== 'run') return;
  const remaining = state.startAt + briefDuration() * 1000 - Date.now();
  endTimer = setTimeout(listenWhenPossible, Math.max(remaining, 0) + 50);
}

// Tlačítko mikrofonu, M nebo ⌥M / Alt+M. Zapnutý otevře rozhovor, jakmile Meri nic nechystá ani neříká.
// Vypnutý rozhovor ukončí.
function toggleMic(enable) {
  if (enable === state.mic) return;
  state = { ...state, mic: enable };
  broadcast();
  if (!enable) dialog.close();
  else listenWhenPossible();
}

// Co uživatel řekl v rozhovoru. „Jak to dnes vypadá?“ pustí shrnutí (když je staré, nejdřív posbírá nové),
// „zopakuj to od začátku“ ho pustí znovu tak, jak je.
function toConversation(text, finished) {
  if (finished && dialog.v?.status === 'listening') {
    const sentence = String(text ?? '');
    if (asksAboutDay(sentence)) {
      dialog.close();
      prepare(() => play());
      return;
    }
    if (wantsRepeat(sentence) === 'brief') {
      dialog.close();
      if (collection) prepare(() => play());
      else play();
      return;
    }
  }
  dialog.hear(text, finished);
}

// Meri začne říkat shrnutí. Rozhovor po něm je jen se zapnutým mikrofonem, proto se jen tehdy chystá předem.
function startBrief(delay = 0) {
  state = { ...state, mode: 'run', startAt: Date.now() + delay * 1000, gen: state.gen + 1, preparing: null };
  broadcast();
  watchEnd();
  dialog.forgetAnswer(); // „zopakuj to poslední“ teď myslí konec shrnutí
  if (state.mic) dialog.prepareDialog();
}

// Shrnutí od začátku (mezerník, Z, „Jak to dnes vypadá?“). S hlasem se nejdřív namluví věty, které ještě
// namluvené nejsou: data se obnovují bez hlasu a platí se jen to, co si člověk opravdu pustí. Okno se pak
// načte znovu, ať má nové zvuky, a stejně tak po tiché obnově, ať neukazuje starší data, než Meri říká.
// Když se od napsání vět změnilo něco s časem na dnešek v Meroře nebo v kalendáři (živá data), nejdřív se
// napíšou nové věty nad uloženými daty ostatních zdrojů (bez nového sběru mailů) a namluví se jen ty nové.
// Každé pouštění má číslo: když se mezitím pustí jiné (přepnutí Dnes / Zítra, mezerník), staré po namluvení
// hlasu už nic nespouští a přehraje se jen to poslední.
let playToken = 0;
function play(delay = 0) {
  const token = ++playToken;
  if (state.day === 'tomorrow' && !VIDEO && tomorrowNeedsSentences()) {
    prepare(() => play(delay), { day: 'tomorrow' });
    return;
  }
  if (sentencesToRewrite()) {
    prepare(() => play(delay), { sentences: true });
    return;
  }
  if (VIDEO || !state.voice || shownData().sample || isVoiced(currentVoice(), shownData())) {
    if (!staleWindow) {
      startBrief(delay);
      return;
    }
    state = { ...state, rev: state.rev + 1 };
    startBrief(delay + AFTER_LOAD_MS / 1000);
    return;
  }
  preparingVoice = true;
  state = { ...state, mode: 'idle', startAt: 0, gen: state.gen + 1, preparing: tr('preparingVoice') };
  broadcast();
  voiceBrief(shownData())
    .catch((err) => {
      // Bez hlasu Meri aspoň píše do bubliny. Došlé kredity (limit klíče v ElevenLabs) se řeknou zvlášť,
      // jinak to vypadá jako chyba appky.
      console.error(`Hlas: ${err.message}`);
      const credits = /quota|credits/i.test(err.message);
      state = { ...state, label: label(tr(credits ? 'creditsOut' : 'voiceFailed')) };
    })
    .finally(() => {
      if (token !== playToken) return; // mezitím se pustilo jiné (přepnutí dne): to se postará samo
      preparingVoice = false;
      state = { ...state, rev: state.rev + 1 };
      startBrief(delay + AFTER_LOAD_MS / 1000);
    });
}

// Namlouvání shrnutí aktuálním hlasem. Jedno namlouvání naráz, ať se stejné věty neplatí dvakrát: pro stejné
// shrnutí se počká na běžící, pro jiné (přepnutí Dnes / Zítra) se namluví až po něm.
let voicing = null;
let voicingFor = null;
function voiceBrief(data) {
  const key = `${data.day ?? 'today'} ${data.createdAt}`;
  if (!voicing || voicingFor !== key) {
    const voice = currentVoice();
    const before = voicing ?? Promise.resolve();
    voicingFor = key;
    // Úklid starých vět jen u dneška: zítřek má jiné věty a dnešní by se jinak smazaly a platily znovu.
    const mine = before
      .catch(() => {})
      .then(() => makeVoice(voice, data))
      .then(() => (data.day === 'tomorrow' ? null : cleanUp(voice, data)))
      .finally(() => {
        if (voicing === mine) {
          voicing = null;
          voicingFor = null;
        }
      });
    voicing = mine;
  }
  return voicing;
}

// Shrnutí na dnešek: čerstvé se jen použije, staré nebo žádné se nejdřív posbírá (ve videu namluví).
// andThen: co udělat, až bude nachystané (pustit shrnutí po „Jak to dnes vypadá?“). again: posbírat i čerstvé.
// quiet: na pozadí, bez nápisu v bublině a bez přerušení (samo obnovování, otevření okna).
// sentences: jen nové věty nad uloženými daty (před přehráním, když se změnila Merora nebo kalendář).
function prepare(andThen = null, { again = false, quiet = false, sentences = false, day = state.day } = {}) {
  if (collection) {
    if (andThen) afterCollection = andThen;
    // Tichá obnova zrovna běží a teď na ni někdo čeká: bublina ukáže, že se data chystají.
    if (quietCollection && !quiet) {
      quietCollection = false;
      const text = tr(collectionDay === 'tomorrow' ? 'preparingTomorrow' : andThen ? 'preparingMorning' : 'loadingNewData');
      state = { ...state, mode: 'idle', startAt: 0, gen: state.gen + 1, preparing: text };
      broadcast();
    }
    return;
  }
  const tomorrow = day === 'tomorrow' && !VIDEO;
  if (!again && !sentences && (VIDEO ? !state.voice || isVoiced(currentVoice()) : tomorrow ? !tomorrowNeedsSentences() : isFresh())) {
    andThen?.();
    return;
  }
  afterCollection = andThen;
  quietCollection = quiet;
  sentencesOnly = sentences;
  collectionDay = tomorrow ? 'tomorrow' : 'today';
  // Co se načítá, má v okně kolečko (maily a doplňky jdou přes Clauda a trvají déle). Ne u nových vět.
  const writeBrief = tr(tomorrow ? 'preparingTomorrow' : sentences ? 'preparingBrief' : again ? 'loadingNewData' : 'preparingMorning');
  const loading = sentences || tomorrow ? null : collectionDay;
  state = quiet
    ? { ...state, refreshing: true, loading, loadedTiles: [] }
    : { ...state, mode: 'idle', startAt: 0, gen: state.gen + 1, preparing: writeBrief, refreshing: !sentences, loading, loadedTiles: [] };
  broadcast();
  if (VIDEO) voiceVideo();
  else if (tomorrow) runCollection(['--tomorrow']);
  else runCollection(sentences ? ['--sentences'] : []);
}

// Sběr skončil. Povedený: okno se načte s novým shrnutím a pak se udělá, na co se čekalo, nebo Meri
// poslouchá, když mezitím uživatel zapnul mikrofon. Nepovedený: v bublině zůstane proč a mikrofon se vypne,
// rozhovor bez shrnutí nemá smysl.
// Tichá obnova: chyba se jen zapíše a zkusí se to znovu za čtvrt hodiny, staré shrnutí zůstává. Nová data
// okno ukáže, až Meri nic neříká a nikdo s ní nemluví.
// Nové věty se nepovedly: Meri řekne ty staré a nad stejnými daty to znovu nezkouší.
function afterPrepare(error) {
  const quiet = quietCollection;
  const sentences = sentencesOnly;
  collection = null;
  quietCollection = false;
  sentencesOnly = false;
  const andThen = afterCollection;
  afterCollection = null;
  state = { ...state, loading: null, loadedTiles: [] };
  if (sentences && error) {
    console.error(`Nové věty: ${error}`);
    failedSentences = fingerprintForSentences(currentData().sourceData);
    state = { ...state, preparing: null, refreshing: false };
    broadcast();
    andThen?.();
    return;
  }
  if (signalDuringCollection) {
    signalDuringCollection = false;
    setTimeout(() => readMeroraNow('signal', { immediate: true }), 0);
  }
  // Celé načtení přineslo i kalendář a počasí, další čtvrthodinová obnova až za čtvrt hodiny.
  if (!error && !sentences) lastWithoutAI = Date.now();
  // Nové maily dneška přepočítají i maily zítřka (dlaždice a panel Maily na zítřek), ať Zítra sedí s Dnes.
  if (!error && !sentences && collectionDay === 'today') {
    const gmail = currentData()?.sourceData?.gmail;
    if (gmail !== undefined) writeLiveTomorrow('gmail', gmail);
  }
  if (quiet) {
    if (error) {
      console.error(`Obnova dat: ${error}`);
      nextQuietAttempt = Date.now() + 15 * 60_000;
    } else if (collectionDay === state.day) {
      staleWindow = true; // okno ukazuje tenhle den: načte se znovu, až Meri nic neříká
    }
    state = { ...state, refreshing: false };
    broadcast();
    if (!error) showNewData();
    return;
  }
  // Zítřek se nepovedl: okno se vrátí na dnešek a řekne proč, ať přepínač nevisí na Zítra bez dat.
  if (error && collectionDay === 'tomorrow' && state.day === 'tomorrow') {
    console.error(`Zítřek: ${error}`);
    state = { ...state, day: 'today', mode: 'idle', startAt: 0, gen: state.gen + 1, rev: state.rev + 1, preparing: null, refreshing: false, label: label(tr('tomorrowFailed')) };
    broadcast();
    return;
  }
  if (error) {
    dialog.close();
    state = { ...state, mic: false, refreshing: false, preparing: tr('spacePlaysLast', { error }) };
    broadcast();
    return;
  }
  state = { ...state, mode: 'idle', startAt: 0, gen: state.gen + 1, rev: state.rev + 1, preparing: null, refreshing: false };
  broadcast();
  setTimeout(() => (andThen ? andThen() : listenWhenPossible()), AFTER_LOAD_MS);
}

function showNewData(attempt = 0) {
  if (!staleWindow) return; // okno se mezitím načetlo samo (shrnutí, nový hlas)
  if ((isBusy() || dialog.v) && attempt < 600) {
    setTimeout(() => showNewData(attempt + 1), 3000);
    return;
  }
  state = { ...state, mode: 'idle', startAt: 0, gen: state.gen + 1, rev: state.rev + 1 };
  broadcast();
}

// Samo obnovování: s otevřeným oknem podle intervalu v nastavení, potichu a bez hlasu. Ne s ukázkovými
// daty (první načtení spouští člověk, třeba až po úvodu) a ne, když Meri mluví nebo se s ní mluví.
// Zdroje bez AI jdou zvlášť: Merora každou minutu jako záloha signálu z Merory (s připojeným signálem po pěti
// minutách), kalendář a počasí zhruba každou čtvrthodinu. Ty nic nepřerušují, okno je přepíše na místě.
// Převzal telefon změnu z počítače? Po každém zápisu do Merory (rozhovor) se server několikrát zeptá
// (`GET /devices/status`) a okno ukáže „V telefonu ✓“, nebo radu otevřít Meroru v mobilu (Riccardo 21. 11.).
// Telefon obvykle potvrdí do 3 s, „nepřevzal“ Merora hlásí asi po 48 s; telefonu pak sama pošle „Otevři mě“.
// phone ve stavu: null, nebo { status: waiting | confirmed | not_confirmed, at }.
const PHONE_ASK_S = [1.5, 3, 5, 8, 12, 20, 30, 40, 50, 60];
let writesSeen = writesSoFar();
let phoneTimer = null;
function setPhone(status) {
  state = { ...state, phone: status ? { status, at: Date.now() } : null };
  broadcast();
}
function watchPhone() {
  const n = writesSoFar();
  if (n === writesSeen) return;
  writesSeen = n;
  // Po zápisu z rozhovoru se Merora hned přečte znovu: změna se tak propíše i do zítřka (dnešek už má).
  setTimeout(() => readMeroraNow('write', { immediate: true }), 1500);
  if (VIDEO || !directAvailable()) return;
  clearTimeout(phoneTimer);
  const started = Date.now();
  setPhone('waiting');
  const ask = async (i) => {
    let phone = null;
    try {
      phone = (await phoneStatus())?.phone ?? null;
    } catch (err) {
      console.error(`Telefon: ${err.message}`);
    }
    if (writesSoFar() !== writesSeen) return; // mezitím další zápis, ptá se už nové sledování
    if (phone === 'confirmed' || phone === 'not_confirmed') return setPhone(phone);
    // Bez telefonu (no_device), nebo když se nic nezměnilo ani po 12 s (idle), nic neukazovat.
    if (phone === 'no_device' || (phone === 'idle' && Date.now() - started > 12_000) || i + 1 >= PHONE_ASK_S.length) return setPhone(null);
    phoneTimer = setTimeout(() => ask(i + 1), (PHONE_ASK_S[i + 1] - PHONE_ASK_S[i]) * 1000);
  };
  phoneTimer = setTimeout(() => ask(0), PHONE_ASK_S[0] * 1000);
}
setInterval(watchPhone, 1000);

setInterval(() => {
  watchSignal();
  readMeroraNow('minute');
  refreshWithoutAI();
  if (VIDEO || collection || !clients.size || isBusy() || dialog.v || Date.now() < nextQuietAttempt) return;
  if (currentData().sample) return;
  // Interval z nastavení: dnešek, pak zítřek, když je načtený (nebo se chystá předem) a je starší.
  if (!isFresh()) prepare(null, { again: true, quiet: true, day: 'today' });
  else if (tomorrowExpired()) prepare(null, { again: true, quiet: true, day: 'tomorrow' });
  else if (preloadTomorrow() && tomorrowNeedsSentences()) loadTomorrow();
}, 60_000);

// --- Živá data: bez AI, bez hlasu, nic nepřerušují ---
// Nová data jednoho zdroje (Merora, kalendář, počasí) do shrnutí. Box „Dnes“ a karta počasí se v okně
// přepíšou na místě (stav radky a pocasi), rozhovor dostane nový box taky. Věty zůstávají, jak jsou:
// přepíšou se, až si shrnutí někdo pustí (prehraj). Během sběru ne: ten přinese data všech zdrojů sám.
function writeLive(id, data) {
  if (VIDEO || collection) return false;
  const brief = updateBrief((b) => rewriteSource(b, id, data));
  if (!brief) return false;
  const shown = bySettings(brief);
  const lines = shown.today;
  // Box dneška se v okně přepíše, jen když je v něm dnešek (zítřek má vlastní živá data).
  if (state.day === 'today') {
    state = { ...state, lines, tiles: shown.tiles, linesDay: 'today', ...(id === 'weather' && brief.weather ? { weather: brief.weather } : {}) };
  }
  dialog.refreshLines(lines);
  broadcast();
  console.log(`Živá data: ${id} se změnil${sentencesStale(brief) ? ', věty se přepíšou při přehrání' : ''}`);
  return true;
}

// Věty napsané nad staršími dnešními připomínkami a událostmi se před přehráním přepíšou (kromě těch, které
// se nepovedly).
function sentencesToRewrite() {
  if (VIDEO || state.day === 'tomorrow') return false;
  const data = currentData();
  return sentencesStale(data) && fingerprintForSentences(data.sourceData) !== failedSentences;
}

// „Načti Meroru teď“: připomínky z Merory hned, bez AI a bez hlasu. Volá se po signálu z Merory, při otevření
// okna a jeho fokusu, při ⌥M / Alt+M, po zapnutí volby a jako záloha každou minutu, s připojeným signálem každých
// 5 minut (doručení signálu není zaručené). Jen s otevřeným oknem, ne při natáčení, jen se zapnutou volbou
// „Merora hned po změně“ a s propojeným účtem (konektor v Claudovi by stál AI). Chyba jde jen do logu, staré
// údaje zůstávají. Nikdy nevyhodí.
// Fokus okna chodí často, Merora pustí 120 volání za minutu. Minutové čtení se kvůli čtení při fokusu
// nevynechá (jinak by změna mohla čekat skoro dvě minuty), přeskočí jen čtení z posledních 10 s.
const READ_GAP_MS = 10_000;
const SIGNAL_FALLBACK_MS = 5 * 60_000;
let readingMerora = null;
let readAgain = false;
let lastRead = 0;
let readError = null;
let readPause = 0;

// Smí Merora živě (bez ohledu na to, jestli zrovna běží sběr): podle toho se drží i kanál signálu.
function meroraLiveAllowed() {
  if (VIDEO || process.env.MERI_DATA || !clients.size) return false;
  const n = loadSettings();
  const merora = SOURCES.find((z) => z.id === 'merora');
  return meroraLive(n) && isEnabled(merora, n) && directAvailable() && !currentData().sample;
}
// Během sběru ne: ten Meroru čte sám. Signál, který přijde mezitím, se načte po něm (afterPrepare).
const canReadMerora = () => !collection && meroraLiveAllowed();

function readMeroraNow(why = '', { immediate = false } = {}) {
  if (!canReadMerora() || Date.now() < readPause) return Promise.resolve(false);
  // Signál uprostřed čtení: to mohlo začít před změnou, takže se po něm čte ještě jednou.
  if (readingMerora) {
    if (immediate) readAgain = true;
    return readingMerora;
  }
  const sinceLast = Date.now() - lastRead;
  if (!immediate && sinceLast < READ_GAP_MS) return Promise.resolve(false);
  if (why === 'minute' && signal.live && sinceLast < SIGNAL_FALLBACK_MS) return Promise.resolve(false);
  lastRead = Date.now();
  readingMerora = (async () => {
    try {
      const rows = await remindersWithoutWrites();
      if (readError) console.log('Merora živě: čtení zase funguje');
      readError = null;
      // Během čtení se odsud zapisovalo (rozhovor): výsledek může být starší, další čtení ho dožene.
      if (!rows) return false;
      dialog.newRows(rows);
      writeLiveTomorrow('merora', prepareReminders(rows, tomorrowStart(), { yesterday: false }));
      return writeLive('merora', prepareReminders(rows, new Date()));
    } catch (err) {
      if (err.status === 429) readPause = Date.now() + 2 * 60_000;
      // Při výpadku sítě by se stejná chyba psala každou minutu, stačí jednou.
      if (err.message !== readError) console.error(`Merora živě (${why}): ${err.message}`);
      readError = err.message;
      return false;
    } finally {
      readingMerora = null;
      if (readAgain) {
        readAgain = false;
        setTimeout(() => readMeroraNow(why, { immediate: true }), 0);
      }
    }
  })();
  return readingMerora;
}

// Signál z Merory „připomínky se změnily“ (tools/realtime.mjs, soukromý kanál user:<id účtu>). Vlastní změny
// Merory Desktop přeskakuje, ty box ukáže sám. Kanál je připojený, jen když se Merora smí číst živě.
const signal = meroraSignal({
  ...realtimeConfig(),
  getAuth: realtimeAuth,
  skipBy: OAUTH_CLIENT_ID,
  onChanged: (by) => {
    // První došlá změna jde do logu (jednou za běh), ať jde příjem ověřit i zpětně. Další už ne.
    if (!signalSeen) console.log(`Signál z Merory: první změna došla (od ${by ?? 'neznámo'})`);
    signalSeen = true;
    if (collection) signalDuringCollection = true;
    else readMeroraNow('signal', { immediate: true });
  },
});
function watchSignal() {
  if (meroraLiveAllowed()) signal.start();
  else signal.stop();
}

// Kalendář a počasí (bez AI) zhruba každou čtvrthodinu, s otevřeným oknem. Ne při „jen ručně“: tam nová
// data načítá jen člověk. Zdroj, který se nenačte, má na obrazovce data z minula.
const NO_AI_MS = 15 * 60_000;
let lastWithoutAI = 0;
let refreshingWithoutAI = false;
async function refreshWithoutAI() {
  if (VIDEO || process.env.MERI_DATA || !clients.size || collection || refreshingWithoutAI || !getRefreshHours()) return;
  if (Date.now() - lastWithoutAI < NO_AI_MS) return;
  const data = currentData();
  if (data.sample) return;
  const n = loadSettings();
  const ids = SOURCES.filter((z) => z.noAI && isEnabled(z, n) && !z.problem?.(sourceOptions(z, n)) && data.sources?.includes(z.id)).map((z) => z.id);
  lastWithoutAI = Date.now();
  if (!ids.length) return;
  refreshingWithoutAI = true;
  try {
    const fresh = await collectOnly(ids, new Date(), n);
    for (const [id, v] of Object.entries(fresh)) if (v !== null) writeLive(id, v);
    // Zítřek, když je načtený: počasí z téže předpovědi, kalendář na zítřejší den.
    if (tomorrowLoaded()) {
      if (fresh.weather) writeLiveTomorrow('weather', weatherTomorrow(fresh.weather));
      if (ids.includes('calendar')) {
        const { calendar } = await collectOnly(['calendar'], tomorrowStart(), n);
        if (calendar) writeLiveTomorrow('calendar', calendar);
      }
    }
  } catch (err) {
    console.error(`Obnova kalendáře a počasí: ${err.message}`);
  } finally {
    refreshingWithoutAI = false;
  }
}

function runCollection(extraArgs = []) {
  let reason = tr('briefFailed');
  let ended = false;
  const end = (error) => {
    if (ended) return;
    ended = true;
    afterPrepare(error);
  };
  collection = spawn(process.execPath, [join(ROOT, 'tools', 'brief.mjs'), ...extraArgs], {
    cwd: ROOT,
    env: { ...process.env, MERI_FROM_SERVER: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], // na výstupu jsou tvoje připomínky, do logu jdou jen chyby
    windowsHide: true,
  });
  // Maily jsou hotové dřív než celé shrnutí: dlaždice se přepíše hned a kolečko u ní zmizí.
  collection.on('message', (msg) => {
    if (msg?.source !== 'gmail' || collectionDay !== 'today' || msg.data == null) return;
    const tile = mailBoxes(msg.data, [], new Date()).tile;
    const tiles = state.day === 'today' ? (state.linesDay === 'today' && state.tiles ? state.tiles : bySettings(currentData()).tiles) : null;
    state = {
      ...state,
      loadedTiles: [...new Set([...(state.loadedTiles ?? []), 'mails'])],
      ...(tiles ? { tiles: tiles.map((d) => (d.id === 'mails' ? tile : d)), linesDay: 'today' } : {}),
    };
    broadcast();
  });
  collection.stderr.on('data', (d) => {
    const text = String(d);
    process.stderr.write(text);
    const m = text.match(/(?:Ranní sběr selhal|Nové věty selhaly): (.*)/);
    if (m) reason = m[1];
  });
  collection.on('error', (err) => end(tr('collectionCannotStart', { error: err.message })));
  collection.on('close', (code) => end(code === 0 ? null : reason));
}

// Vymyšlený den se namluví jen jednou. Žádná skutečná data se k tomu nečtou.
function voiceVideo() {
  collection = true;
  makeVoice(currentVoice(), currentData())
    .then(() => afterPrepare(null))
    .catch((err) => afterPrepare(`Hlas se nenamluvil: ${err.message}`));
}

// R, šipka vpravo nahoře nebo tlačítko v nastavení: posbírá znovu hned, i čerstvé. Co Meri zrovna říká, utne.
// Hlas se nenamlouvá, takže to ElevenLabs nic nestojí (namluví se, až si shrnutí pustíš).
function refresh() {
  if (VIDEO) return tr('videoNoData');
  if (preparingVoice) return tr('voicePreparing');
  dialog.close();
  prepare(null, { again: true });
  return null;
}

// Po změně zdrojů se okno načte znovu, ať ukazuje jen zapnuté. Ne uprostřed řeči: pak vrátí false
// a okno to zkusí znovu za chvíli.
function redraw() {
  if (isBusy()) return false;
  state = { ...state, rev: state.rev + 1 };
  broadcast();
  return true;
}

// Po zapnutí hlasu nebo vložení klíče se dnešní shrnutí namluví hned (ukázková data ne, ta by stála kredity
// zbytečně). Okno se pak načte znovu, ať má zvuk, až Meri nic nechystá ani neříká.
function fillVoice() {
  // Věty, které se před přehráním stejně přepíšou, se namlouvat nebudou.
  if (VIDEO || !state.voice || currentData().sample || isVoiced(currentVoice()) || sentencesToRewrite()) return;
  const redrawWhenPossible = (attempt = 0) => {
    if (!redraw() && attempt < 100) setTimeout(() => redrawWhenPossible(attempt + 1), 3000);
  };
  voiceBrief(currentData()).then(() => redrawWhenPossible(), (err) => console.error(`Hlas: ${err.message}`));
}

// Bez vybraného hlasu by Meri mluvila hlasem počítače nebo anglickou Rachel. S novým klíčem (a po přepnutí jazyka)
// proto rovnou vybere první hlas jazyka ze seznamu (data/voices.json) a přidá ho k účtu ElevenLabs. Jen pro jazyk,
// kterým Meri mluví, ať nezabírá místo na hlasy v účtu zbytečně. Jiný jde vybrat na /voices.
async function defaultVoice() {
  const key = voiceKey();
  const env = loadEnv();
  if (env[key] || !env.ELEVENLABS_API_KEY) return;
  const voice = loadVoiceList()[0];
  if (!voice) return;
  await addVoice(voice.public_owner_id, voice.voice_id, voice.name).catch((err) => {
    console.warn(`Přidání hlasu: ${err.message}`); // na účtu už může být
  });
  writeEnv(key, voice.voice_id);
}

// Přepne na hlas z klávesy 1–9 (seznam z /voices) a pustí shrnutí od začátku, ať jde hlasy porovnat.
function switchVoice(order) {
  const voice = loadVoiceList()[order - 1];
  if (!voice || !isVoiced(voice.voice_id)) {
    state = { ...state, label: label(voice ? tr('voiceNotReady', { name: voice.name }) : tr('noVoiceOnKey', { order })) };
    broadcast();
    return;
  }
  writeEnv(voiceKey(), voice.voice_id);
  dialog.close();
  state = {
    ...state,
    mode: 'run',
    startAt: Date.now() + AFTER_LOAD_MS,
    gen: state.gen + 1,
    rev: state.rev + 1,
    label: label(`${order} · ${voice.name}`),
  };
  broadcast();
  watchEnd();
}

// Co ukazuje okno nastavení: hlas, zdroje s tím, co jim chybí, „O tobě“, a kdy a za kolik se naposledy načítalo.
function settingsState() {
  const n = loadSettings();
  const data = currentData();
  const { salutation, gender, location, welcomed } = profile(n);
  return {
    voice: state.voice,
    hasKey: hasVoiceKey(),
    // Zdroj může mít anglické texty v en (title, description, hint, connectText), jinak zůstanou jeho.
    sources: SOURCES.map((z) => ({
      id: z.id,
      title: (language(n) === 'en' && z.en?.title) || z.title,
      description: (language(n) === 'en' && z.en?.description) || z.description,
      icon: z.icon,
      connector: z.connection.kind === 'connector',
      link: z.connection.kind === 'link', // odkaz (kalendář) se vkládá přímo v okně
      hint: (language(n) === 'en' && z.en?.hint) || z.hint || null,
      checkable: typeof z.check === 'function' && !z.connect, // jde ověřit, že je propojený
      // Propojení s účtem jedním tlačítkem (Merora: stránka s QR kódem, souhlas v telefonu).
      connect: z.connect ? { ...z.connect, ...(language(n) === 'en' && z.en?.connectText ? { text: z.en.connectText } : {}) } : null,
      connected: z.connected?.() ?? false,
      enabled: isEnabled(z, n),
      problem: z.problem?.(sourceOptions(z, n)) ?? null,
      failed: Boolean(data.failed?.includes(z.id)),
    })),
    meroraAddress: MERORA_MCP,
    profile: { salutation, gender, city: location?.city ?? null, welcomed },
    last: VIDEO ? null : data.createdAt ?? null,
    refreshHours: getRefreshHours(n),
    meroraLive: meroraLive(n),
    briefLength: chosenLength(n),
    mentionRings: shouldMentionRings(n),
    mentionWeather: shouldMentionWeather(n),
    preloadTomorrow: preloadTomorrow(n),
    showYesterday: showYesterday(n),
    rules: ownRules(n),
    // Účet Merora jako v telefonu: s jakým e-mailem je propojená. Při natáčení se neukazuje.
    account: VIDEO ? null : { connected: hasOAuth(), email: oauthAccount()?.email ?? null },
    meroraLiveAvailable: directAvailable(), // živé čtení jde jen přes propojení s účtem, konektor by stál AI
    loading: Boolean(collection),
    video: VIDEO,
    version: currentVersion(),
    update: state.update,
    // Jazyk okna a Meri; languageChosen: false = ještě nevybraný (úvod předvyplní jazyk prohlížeče).
    language: language(n),
    languageChosen: Boolean(n.language),
  };
}

// { voice }, { refreshHours }, { meroraLive }, { briefLength }, { mentionRings }, { showYesterday }, { rules }, { profile: { salutation, gender, city } },
// { welcomed: true }, nebo { source, enabled }.
// Vrací chybu, nebo null.
async function changeSettings(change) {
  if (typeof change.meroraLive === 'boolean') {
    saveSettings({ meroraLive: change.meroraLive });
    if (change.meroraLive) readMeroraNow('settings', { immediate: true });
    watchSignal();
    return null;
  }
  // Délka shrnutí: věty se přepíšou před dalším přehráním (otisk vět nese délku, tools/sources/index.mjs).
  // Vlastní pravidla pro Meri: platí od dalšího přehrání a dalšího rozhovoru (otisk vět je nese taky).
  if (Array.isArray(change.rules)) {
    if (change.rules.length > MAX_RULES) return tr('tooManyRules', { max: MAX_RULES });
    if (change.rules.some((p) => typeof p !== 'string' || p.length > MAX_RULE)) return tr('ruleTooLong', { max: MAX_RULE });
    saveSettings({ rules: ownRules({ rules: change.rules }) });
    return null;
  }
  // Počet zazvonění ve shrnutí: taky až od dalšího přehrání (otisk vět nese i tuhle volbu).
  // Včerejší nedodělané v boxu Dnes: box se přepíše hned po čtení Merory (živá data), jinak s dalším načtením.
  if (typeof change.showYesterday === 'boolean') {
    saveSettings({ showYesterday: change.showYesterday });
    readMeroraNow('settings', { immediate: true });
    return null;
  }
  // Počasí ve shrnutí: věty se přepíšou před dalším přehráním (otisk vět nese i tuhle volbu).
  if (typeof change.mentionWeather === 'boolean') {
    saveSettings({ mentionWeather: change.mentionWeather });
    return null;
  }
  // Zítřek předem: zapnutí ho rovnou nachystá (data hned, věty na pozadí).
  if (typeof change.preloadTomorrow === 'boolean') {
    saveSettings({ preloadTomorrow: change.preloadTomorrow });
    if (change.preloadTomorrow && clients.size) loadTomorrow();
    return null;
  }
  if (typeof change.mentionRings === 'boolean') {
    saveSettings({ mentionRings: change.mentionRings });
    return null;
  }
  if ('briefLength' in change) {
    if (!Object.hasOwn(BRIEF_LENGTHS, change.briefLength)) return tr('unknownLength');
    saveSettings({ briefLength: change.briefLength });
    return null;
  }
  if ('refreshHours' in change) {
    if (!REFRESH_INTERVALS.includes(change.refreshHours)) return tr('unknownInterval');
    saveSettings({ refreshHours: change.refreshHours });
    return null;
  }
  if (typeof change.voice === 'boolean') {
    if (change.voice && !hasVoiceKey()) return tr('voiceNeedsKey');
    saveSettings({ voice: change.voice });
    state = { ...state, voice: voiceEnabled() };
    broadcast();
    fillVoice();
    return null;
  }
  // Jazyk: okno se načte znovu (public/app.js) a data se potichu načtou znovu, ať jsou dlaždice, pozdrav a věty
  // v novém jazyce (věty by se přepsaly i samy, otisk vět nese jazyk).
  if (typeof change.language === 'string') {
    if (!LANGUAGES.includes(change.language)) return tr('unknownLanguage');
    const changed = change.language !== language();
    saveSettings({ language: change.language });
    state = { ...state, language: change.language };
    broadcast();
    // Hlas nového jazyka: první ze seznamu, když žádný vybraný není (namluví se až při přehrání).
    if (changed) defaultVoice().catch((err) => console.error(`Hlas: ${err.message}`));
    if (changed && !VIDEO && !process.env.MERI_DATA) prepare(null, { again: true, quiet: true });
    return null;
  }
  if (change.profile && typeof change.profile === 'object') {
    // Oslovení a rod se projeví v textech od dalšího načtení dat.
    const { salutation, gender, city } = change.profile;
    const save = {};
    if (typeof salutation === 'string') save.salutation = salutation.trim().slice(0, 40);
    if (gender === 'male' || gender === 'female') save.gender = gender;
    // Uložené město („Mělník, Česko“) se znovu nehledá, jen nové.
    const newCity = typeof city === 'string' ? city.trim().slice(0, 80) : '';
    if (newCity && newCity !== profile().location?.city) {
      const location = await findCity(newCity).catch(() => null);
      if (!location) return tr('cityNotFound');
      save.location = location;
    }
    saveSettings(save);
    return null;
  }
  if (change.welcomed === true) {
    saveSettings({ welcomed: true });
    return null;
  }
  if (typeof change.source === 'string' && typeof change.enabled === 'boolean') return toggleSource(change.source, change.enabled);
  return tr('unknownSetting');
}

// Přepínač Dnes / Zítra: okno se načte s tím dnem a Meri ho hned řekne. Zítřek se nejdřív poskládá, když ještě
// není nebo je starší než hodina. Běžící chystání (zítřka, nebo dneška) se přepne na tiché a doběhne na pozadí.
let dayTimer = null;
function switchDay(wanted) {
  if (VIDEO) return true;
  const day = wanted === 'tomorrow' ? 'tomorrow' : 'today';
  if (day === state.day) return true;
  dialog.close();
  if (collection && !quietCollection) {
    quietCollection = true;
    afterCollection = null;
  }
  preparingVoice = false;
  playToken += 1; // namlouvání pro druhý den už nic nespustí
  state = { ...state, day, mode: 'idle', startAt: 0, gen: state.gen + 1, rev: state.rev + 1, lines: null, weather: null, preparing: null };
  broadcast();
  // Meri sama nemluví (Riccardo 22. 11.), shrnutí pustí mezerník nebo otázka. Zítřek, který ještě není, se načte.
  clearTimeout(dayTimer);
  if (day === 'tomorrow' && tomorrowNeedsSentences()) dayTimer = setTimeout(() => loadTomorrow(), 0);
  return true;
}

function applyCommand(cmd) {
  // Otevřelo se okno nainstalované aplikace (nebo ho otevřela klávesa ⌥M / Alt+M): nachystá dnešní shrnutí,
  // když se zrovna nic neděje.
  if (cmd.cmd === 'window') {
    // Nově otevřené okno začíná dneškem.
    if (state.day === 'tomorrow') {
      state = { ...state, day: 'today', rev: state.rev + 1 };
      broadcast();
    }
    if (!isBusy() && !dialog.v) prepare(null, { quiet: true, day: 'today' });
    readMeroraNow('window');
    dialog.warmUp(); // ⌥M / Alt+M hned zapíná mikrofon: Claude ať už běží
    return true;
  }
  if (cmd.cmd === 'mic') {
    toggleMic(typeof cmd.enable === 'boolean' ? cmd.enable : !state.mic);
    readMeroraNow('mic');
    if (state.mic) dialog.warmUp();
    return true;
  }
  // Okno dostalo fokus (přepnutí z jiné aplikace): Merora hned, nic dalšího se neděje.
  if (cmd.cmd === 'merora') {
    readMeroraNow('focus');
    return true;
  }
  // Během sběru, na který se čeká, se okno načte znovu až s novým shrnutím, nic jiného ho nesmí přerušit.
  // Stejně tak, když se před přehráním namlouvá hlas. Tichá obnova na pozadí nepřekáží.
  // Přepínač Dnes / Zítra jde vždycky, i když se zrovna chystá zítřek nebo namlouvá hlas (dřív se klik
  // během chystání ztratil a přepínač vypadal zaseknutý). Chystání druhého dne doběhne potichu na pozadí.
  if (cmd.cmd === 'day') return switchDay(cmd.day);
  if ((collection && !quietCollection) || preparingVoice) return true;
  const gen = state.gen + 1;
  switch (cmd.cmd) {
    case 'voice':
      switchVoice(Number(cmd.order));
      break;
    // Mezerník a S (za 10 s, natáčení): shrnutí od začátku. Při tiché obnově počká na nová data. (Z je od 22. 11. pryč.)
    case 'start':
    case 'replay': {
      dialog.close();
      const delay = Math.min(Math.max(Number(cmd.delay) || 0, 0), 60);
      if (collection) prepare(() => play(delay));
      else play(delay);
      break;
    }
    // R: nová data. Při natáčení zpátky na začátek, video má vymyšlený den.
    case 'refresh':
      if (!VIDEO) {
        refresh();
        return true;
      }
    // falls through
    case 'reset':
      // Zpátky na začátek, i s vypnutým mikrofonem. Video se načte znovu, ať je všechno jako před záběrem.
      dialog.close();
      state = { ...state, mode: 'idle', startAt: 0, gen, mic: false, ...(VIDEO ? { rev: state.rev + 1 } : {}) };
      broadcast();
      break;
    case 'skip':
      // Esc: zbytek shrnutí se přeskočí. Se zapnutým mikrofonem pak Meri hned poslouchá.
      if (!isPlaying()) return true;
      state = { ...state, startAt: Date.now() - briefDuration() * 1000, gen };
      broadcast();
      watchEnd();
      break;
    case 'seek': {
      if (state.mode !== 'run') return true;
      dialog.close();
      const by = Math.min(Math.max(Number(cmd.by) || 0, -60), 60);
      state = { ...state, startAt: state.startAt - by * 1000, gen };
      broadcast();
      watchEnd();
      break;
    }
    case 'reload':
      // Nové shrnutí z `npm run brief`: okno se načte znovu.
      dialog.close();
      state = { ...state, mode: 'idle', startAt: 0, gen, rev: state.rev + 1 };
      broadcast();
      break;
    default:
      return false;
  }
  listenWhenPossible();
  return true;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) throw new Error('body too large');
  }
  return JSON.parse(body || '{}');
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

// Jen z tohohle počítače: cizí stránka v prohlížeči nesmí spouštět příkazy ani utrácet kredity.
function isLocal(req) {
  const hosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!hosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || hosts.some((h) => origin === `http://${h}`);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

async function pickVoice(req, res) {
  if (generatingVoice) return json(res, 409, { error: 'Hlas se zrovna generuje.' });
  const { voice_id, public_owner_id, name } = await readBody(req);
  if (!ID.test(voice_id ?? '') || !ID.test(public_owner_id ?? '')) return json(res, 400, { error: tr('invalidVoice') });
  generatingVoice = true;
  const short = String(name ?? '').split(' - ')[0].trim();
  try {
    await addVoice(public_owner_id, voice_id, short).catch((err) => {
      // Hlas už na účtu být může. Když to je jiný problém, ukáže se při namlouvání.
      console.warn(`Přidání hlasu: ${err.message}`);
    });
    const { manifest } = await makeVoice(voice_id);
    const list = loadVoiceList();
    let order = list.findIndex((h) => h.voice_id === voice_id) + 1;
    if (!order) {
      list.push({ voice_id, public_owner_id, name: short });
      saveVoiceList(list);
      order = list.length;
    }
    switchVoice(order);
    return json(res, 200, { order, duration: Object.values(manifest).reduce((a, b) => a + b, 0) });
  } catch (err) {
    return json(res, 502, { error: err.message });
  } finally {
    generatingVoice = false;
  }
}

// Odpovědi API. Vrací true, když cestu obsloužilo.
async function api(req, res, pathname) {
  const post = req.method === 'POST';
  if (pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => {
      clients.delete(res);
      // Bez okna kanál pryč. Znovunačtení okna se připojí hned zpátky, proto s malým odkladem.
      if (!clients.size) setTimeout(watchSignal, 10_000);
    });
    watchSignal();
    readMeroraNow('window'); // otevřené okno ukáže, co je v Meroře teď
    dialog.warmUp(); // rozhovor pak nečeká na start Clauda (tools/dialog.mjs)
    return true;
  }
  if (pathname === '/cmd' && post) {
    res.writeHead(applyCommand(await readBody(req)) ? 204 : 400).end();
    return true;
  }
  if (pathname === '/data') {
    // Seznam všech nepřečtených mailů je jen pro rozhovor, data zdrojů (sourceData) jen pro server, okno je nepotřebuje.
    const data = shownData();
    const { inbox, sourceData: _, sentencesFingerprint, ...forWindow } = bySettings(data);
    json(res, 200, { ...forWindow, day: data.day === 'tomorrow' ? 'tomorrow' : 'today', language: language() });
    return true;
  }
  // Je okno Meri otevřené? Klávesa ⌥M / Alt+M podle toho jen přepne mikrofon, nebo Meri otevře.
  if (pathname === '/api/status') {
    json(res, 200, { windowOpen: clients.size > 0 });
    return true;
  }
  if (pathname === '/api/settings') {
    if (!post) {
      json(res, 200, settingsState());
      return true;
    }
    const error = await changeSettings(await readBody(req));
    json(res, error ? 409 : 200, error ? { error, ...settingsState() } : settingsState());
    return true;
  }
  // Aktualizace: tlačítko Aktualizovat a Zkontrolovat aktualizace v nastavení (O aplikaci).
  if (pathname === '/api/update' && post) {
    if (VIDEO) return json(res, 409, { error: tr('videoNoUpdate') }), true;
    const error = await runUpdate();
    json(res, error ? 409 : 202, error ? { error } : { ok: true });
    return true;
  }
  if (pathname === '/api/update/check' && post) {
    const checked = await lookForUpdate(true);
    json(res, 200, { update: state.update, error: checked.error ?? null, version: currentVersion() });
    return true;
  }
  if (pathname === '/api/refresh' && post) {
    const error = refresh();
    json(res, error ? 409 : 202, error ? { error } : { ok: true });
    return true;
  }
  if (pathname === '/api/redraw' && post) {
    res.writeHead(redraw() ? 204 : 409).end();
    return true;
  }
  // Úvod: funguje Claude Code na tomhle počítači? Krátký dotaz na nejlevnější model, jinak by Meri nic nesebrala.
  if (pathname === '/api/claude' && post) {
    try {
      const { ok } = await askClaude({
        model: 'haiku',
        limitMs: 60_000,
        schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
        prompt: 'Vrať ok: true.',
      });
      json(res, 200, { ok: Boolean(ok) });
    } catch (err) {
      json(res, 200, { ok: false, error: err.message });
    }
    return true;
  }
  // Odkaz zdroje (tajný odkaz na kalendář) z úvodu nebo nastavení. Ukládá se jen do .env na tomhle počítači.
  if (pathname === '/api/source/link' && post) {
    const { source, link } = await readBody(req);
    const z = SOURCES.find((x) => x.id === source && x.connection.kind === 'link');
    const address = String(link ?? '').trim().replace(/^webcal:\/\//i, 'https://');
    if (!z || !/^https:\/\/\S+$/.test(address) || address.length > 1500) {
      json(res, 400, { error: tr('notCalendarLink'), ...settingsState() });
      return true;
    }
    writeEnv(z.connection.env, address);
    json(res, 200, settingsState());
    return true;
  }
  // Je zdroj opravdu propojený (konektor Merory v Claudovi)? Trvá pár vteřin.
  if (pathname === '/api/source/check' && post) {
    const { source } = await readBody(req);
    const z = SOURCES.find((x) => x.id === source && x.check);
    if (!z) {
      json(res, 400, { error: 'Tenhle zdroj se nekontroluje.', ...settingsState() });
      return true;
    }
    await z.check({ read: true }).catch((err) => console.error(`Kontrola ${z.id}: ${err.message}`));
    json(res, 200, settingsState());
    return true;
  }
  // Klíč ElevenLabs z nastavení nebo úvodu. Ukládá se jen do .env na tomhle počítači.
  if (pathname === '/api/key' && post) {
    const { key } = await readBody(req);
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(key.trim())) {
      json(res, 400, { error: tr('notElevenKey') });
      return true;
    }
    writeEnv('ELEVENLABS_API_KEY', key.trim());
    await defaultVoice();
    state = { ...state, voice: voiceEnabled() };
    broadcast();
    fillVoice();
    json(res, 200, settingsState());
    return true;
  }
  if (pathname === '/api/voices') {
    const env = loadEnv();
    if (!env.ELEVENLABS_API_KEY) {
      json(res, 200, { hasKey: false, voiceList: [] });
      return true;
    }
    try {
      json(res, 200, { hasKey: true, selected: env[voiceKey()] ?? null, mine: loadVoiceList(), voiceList: await voiceCatalog() });
    } catch (err) {
      json(res, 502, { hasKey: true, error: err.message, voiceList: [] });
    }
    return true;
  }
  if (pathname === '/api/voice' && post) {
    await pickVoice(req, res);
    return true;
  }
  // Rozhovor: okno posílá, co rozpoznávání řeči slyšelo, a co mu nejde (třeba povolení mikrofonu).
  if (pathname === '/api/dialog/heard' && post) {
    const { text, finished } = await readBody(req);
    toConversation(text, Boolean(finished));
    json(res, 200, {});
    return true;
  }
  if (pathname === '/api/dialog/problem' && post) {
    const { code } = await readBody(req);
    dialog.problem(String(code ?? '').slice(0, 40));
    json(res, 200, {});
    return true;
  }
  // Připojení k Meroře přes OAuth (stránka /connect): souhlas v appce Merora, pak návrat sem s kódem.
  // Chyby jdou na stránku jen jako kód, ať cizí odkaz nemůže na stránku Meri napsat vlastní text.
  if (pathname === '/oauth/start') {
    let destination = '/connect?error=not_configured';
    try {
      destination = consentUrl();
    } catch (err) {
      console.error(`Merora: ${err.message}`);
    }
    res.writeHead(302, { Location: destination, 'Cache-Control': 'no-store' }).end();
    return true;
  }
  if (pathname === '/oauth/callback') {
    const query = new URL(req.url, `http://${HOST}`).searchParams;
    let destination;
    if (query.get('error')) {
      destination = `/connect?error=${query.get('error') === 'access_denied' ? 'denied' : 'failed'}`;
    } else {
      try {
        await finishConsent({ code: query.get('code'), state: query.get('state') });
        // Rovnou ověřit, že se opravdu dá číst. Ven jde jen počet.
        destination = `/connect?connected=${(await fetchReminders()).length}`;
        console.log('Merora: Merora Desktop je propojená s účtem přes OAuth');
        watchSignal();
        // Ať okno hned ukáže připomínky z Merory: nová data potichu na pozadí, jako samo obnovování.
        if (!VIDEO && !isBusy() && !dialog.v) prepare(null, { again: true, quiet: true });
      } catch (err) {
        console.error(`Merora: připojení nedokončené: ${err.message}`);
        destination = `/connect?error=${err.errorCode ?? 'failed'}`;
      }
    }
    res.writeHead(302, { Location: destination, 'Cache-Control': 'no-store' }).end();
    return true;
  }
  // Odpojit od účtu Merora na tomhle počítači (nastavení › Účet). Úplně se odebere v appce Merora.
  if (pathname === '/api/merora/disconnect' && post) {
    if (VIDEO) {
      json(res, 409, { error: tr('videoNoAccount'), ...settingsState() });
      return true;
    }
    disconnectOAuth();
    watchSignal();
    console.log('Merora: propojení s účtem odpojené v nastavení');
    json(res, 200, settingsState());
    return true;
  }
  // Je propojená s účtem Merora? Úvod a nastavení se ptají, dokud se na stránce Merory nepotvrdí souhlas.
  if (pathname === '/api/merora/status') {
    json(res, 200, { connected: hasOAuth(), oauthConnection: oauthAvailable() });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${HOST}`);
  try {
    if (!isLocal(req)) {
      res.writeHead(403).end();
      return;
    }
    if (await api(req, res, pathname)) return;
    // /audio/… vede do složky právě vybraného hlasu, okno o výběru vědět nemusí.
    const route = pathname.startsWith('/audio/')
      ? `/audio/${currentVoice()}/${pathname.slice('/audio/'.length)}`
      : ROUTES[pathname] ?? pathname;
    const file = resolve(PUBLIC, `.${route}`);
    if (!file.startsWith(PUBLIC + sep)) {
      res.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch (err) {
    if (res.headersSent) res.end();
    else res.writeHead(err.code === 'ENOENT' ? 404 : 500).end();
  }
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} už používá jiný server (nejspíš Merora Desktop na pozadí).` : err.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Merora Desktop běží: http://${HOST}:${PORT}/${VIDEO ? ' (natáčení, vymyšlený den)' : ''}`);
  // Při natáčení se vymyšlený den namluví hned (jen nové věty, pár kreditů), ať S i mezerník mluví.
  if (VIDEO) prepare();
  // Jinak se zjistí, které konektory jsou v Claudovi propojené, ať úvod a nastavení vědí, co chybí.
  else for (const z of SOURCES) z.check?.().catch(() => {});
  // Nová verze na GitHubu: po startu a pak každou hodinu se zeptá, jestli už je den od poslední kontroly.
  if (!VIDEO) {
    state = { ...state, update: updateInfo() };
    setTimeout(lookForUpdate, 30_000);
    setInterval(lookForUpdate, 3600_000);
  }
});

async function lookForUpdate(force = false) {
  const checked = await checkForUpdate({ force });
  const update = updateInfo();
  if (JSON.stringify(update) !== JSON.stringify(state.update)) {
    state = { ...state, update };
    broadcast();
    if (update) console.log(`Aktualizace: je tu verze ${update.version} (máš ${update.current}).`);
  }
  return checked;
}

// Aktualizovat (tlačítko v nastavení): stáhne vydání, pak se server restartuje. Na Macu ho znovu pustí launchd,
// na Windows hlídač (tools/watchdog.mjs, MERI_SUPERVISED). Server puštěný ručně (npm start) se pustí sám.
async function runUpdate() {
  if (state.updating) return null;
  state = { ...state, updating: true, updateError: null };
  broadcast();
  try {
    const version = await applyUpdate();
    console.log(`Aktualizace: nainstalovaná verze ${version}, restartuju.`);
    setTimeout(restartServer, 1000);
    return null;
  } catch (err) {
    state = { ...state, updating: false, updateError: err.message };
    broadcast();
    return err.message;
  }
}

function restartServer() {
  const supervised = /^app\.merora\.meri/.test(process.env.XPC_SERVICE_NAME ?? '') || process.env.MERI_SUPERVISED === '1' || process.env.MERI_POD_DOHLEDEM === '1'; // druhé: hlídač spuštěný před 23. 11. 2026
  if (!supervised) {
    server.close();
    spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  process.exit(0);
}
