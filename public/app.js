// Okno Merory: vlevo Meri (neuron, bublina, mikrofon), vpravo boxy jen zapnutých zdrojů.
// Box, který chybí, uvolní místo ostatním: bez dlaždic mají řádky víc místa, bez „Dnes“ se panely roztáhnou.
// Prázdný panel (žádná chyba, žádný mail) se neukáže, stačí jeho dlaždice s nulou.
// Dlaždice mají vždycky aspoň třetinu šířky, jedna přes celou šířku by vypadala jako chyba.
import {
  Voice, Listener, Reaction, activeSentence, currentState, breath, dialogPost, esc, icon, hasSource, speaking, onState,
  loadAssets, reveal, controls, params, post, send, prepareImages, fitStage, startLoop, createNeuron, highlighter, onNewData,
} from '/meri.js';
import { settingsWindow, redraw } from '/settings.js';
import { welcome } from '/welcome.js';
import { setLanguage, lang, locale, t } from '/i18n.js';

// Data dne a časování vět. Při nových datech (přepnutí Dnes / Zítra, nové načtení) se vymění bez načtení stránky (takeNewData).
let { data, voiceList, timeline: tl } = await loadAssets();
// Jazyk okna podle nastavení (/data nese language). Statické texty se skládají jednou, takže po změně jazyka se okno
// načte znovu (reloadForLanguage), jen ne během úvodu: ten jazyk přepíná sám a okno se načte až po něm.
setLanguage(data.language ?? 'cs');
const builtLanguage = lang();
let welcomeOpen = false;
const reloadForLanguage = (l) => {
  if (!l || l === builtLanguage || welcomeOpen) return false;
  location.reload();
  return true;
};
const stage = document.getElementById('stage');
fitStage(stage, 1600, 1000);

// Obal .r se odhaluje posunem, karta uvnitř má vlastní přechody při zvýraznění.
const lineMeta = (k) => [k.time ? `<span class="time ${esc(k.tone)}">${esc(k.time)}</span>` : '', esc(k.meta)].filter(Boolean).join(' · ');
const line = (k, page = 0) => `
  <div class="r" data-page="${page}">
  <article class="cd line" data-card="${esc(k.id)}">
    <div class="tile ${esc(k.tone)}">${icon(k.icon, 30)}</div>
    <div class="text">
      <div class="title">${esc(k.title)}</div>
      <div class="meta">${lineMeta(k)}</div>
    </div>
  </article>
  </div>`;

const statTile = (d) => `
  <article class="cd stat-tile" data-card="${esc(d.id)}">
    <div class="header">
      <div class="tile ${esc(d.tone)}">${icon(d.icon, 22)}</div>
      <div class="title">${esc(d.title)}</div>
    </div>
    <div class="value">${esc(d.value)}</div>
    <div class="caption ${esc(d.captionTone ?? '')}">${esc(d.caption)}</div>
    <div class="loading-note" aria-hidden="true"><span class="spinner"></span>${t('loading')}</div>
  </article>`;

const item = (title, meta) => `
  <article class="item">
    <div class="item-title">${esc(title)}</div>
    <div class="meta">${meta}</div>
  </article>`;

const panel = (id, iconName, heading, items) => `
  <section class="cd panel" data-card="${id}" aria-label="${esc(heading)}">
    <div class="heading"><div class="tile blue">${icon(iconName, 20)}</div>${esc(heading)}</div>
    ${items.join('<div class="divider" aria-hidden="true"></div>')}
  </section>`;

// Co se ukáže: jen zapnuté zdroje, a panel jen tehdy, když v něm něco je. Panely doplňků (Merora DEV, třeba
// chyby v appce) jsou v data.panels, starší shrnutí a natáčení mají chyby v data.errors.
const panelsOf = (data) => [
  ...(data.panels ?? []).filter((p) => p.items?.length).map((p) =>
    panel(esc(p.id), p.icon, p.heading, p.items.map((x) => item(x.title, esc(x.meta ?? ''))))),
  data.errors?.length && !(data.panels ?? []).some((p) => p.id === 'chyby') &&
    panel('chyby', 'bug', t('newErrors'), data.errors.map((c) => item(c.title, esc(c.meta)))),
  hasSource(data, 'gmail') && data.mails.length &&
    panel('mails', 'mail', `${data.mailsHeading ?? t('importantMails')}${data.importantMails > data.mails.length ? ` · ${t('mailsOf', { shown: data.mails.length, total: data.importantMails })}` : ''}`, data.mails.map((m) =>
      item(m.subject, `<span>${esc(m.who)}</span><span class="label ${esc(m.tone)}">${esc(m.label)}</span>`))),
].filter(Boolean);
const clock = () => new Date().toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
const weatherContent = (p) => `
          ${icon(p.precipitation ? 'rain' : 'cloud', 32)}
          <span class="temperature">${esc(p.temperature)}</span>
          ${p.precipitation ? `<span class="precipitation">${esc(p.precipitation)}</span>` : ''}`;
// Datum bez počasí: „Čtvrtek 19. 11.“, anglicky „Thursday 19 Nov“.
// Přepínač Dnes / Zítra: okno ukazuje shrnutí dne, který server poslal (data.day). Živá data a rozhovor mění
// jen dnešek, takže u zítřka se box na místě nepřepisuje (zítřek server po změně poskládá znovu).
let tomorrow = data.day === 'tomorrow';
const emptyText = () => (tomorrow ? t('emptyTomorrow') : t('emptyToday'));

// Stránky v boxu „Dnes“ (Riccardo 22. 11.): po 6 řádcích, nejvýš 4 stránky (tools/lines.mjs), puntíky pod boxem.
const PAGE_SIZE = 6;
const pagesOf = (lines) => Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
const pageDots = (n) =>
  n < 2
    ? ''
    : `<nav class="pages r" aria-label="${t('pages')}">${Array.from({ length: n }, (_, i) => `<button type="button" class="dot" data-page-go="${i}" aria-label="${t('pageN', { n: i + 1 })}"></button>`).join('')}</nav>`;
const todayHtml = (lines) =>
  lines.length ? lines.map((k, i) => line(k, Math.floor(i / PAGE_SIZE))).join('') + pageDots(pagesOf(lines)) : `<p class="empty r">${emptyText()}</p>`;

function todayDate() {
  const d = new Date();
  if (lang() === 'en') return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const day = d.toLocaleDateString('cs-CZ', { weekday: 'long' });
  return `${day[0].toUpperCase()}${day.slice(1)} ${d.getDate()}. ${d.getMonth() + 1}.`;
}

// Pravá strana: hlavička, dlaždice, box „Dnes“ a panely. Při nových datech se překreslí jen ona.
function rightHtml() {
  const panels = panelsOf(data);
  const hasToday = data.today.length > 0 || hasSource(data, 'merora') || hasSource(data, 'calendar');
  return `
      <header class="app-head r">
        <div class="greeting">
          <h1>${esc(data.greeting)}</h1>
          <div class="date-row">
            <div class="date">${esc(data.weather?.date ?? todayDate())}</div>
            <div class="day-switch" id="day-switch" role="group" aria-label="${t('daySwitch')}">
              <button type="button" data-day="today" aria-pressed="${!tomorrow}">${t('today')}</button>
              <button type="button" data-day="tomorrow" aria-pressed="${tomorrow}">${t('tomorrow')}</button>
            </div>
          </div>
        </div>
        ${data.weather ? `<div class="cd chip" data-card="${esc(data.weather.id)}">${weatherContent(data.weather)}</div>` : ''}
        <div class="clock" id="clock">${esc(data.time ?? clock())}</div>
      </header>
      ${data.tiles.length
        ? `<section class="app-tiles r${data.tiles.length >= 4 ? ' many' : ''}" aria-label="${t('overview')}" style="grid-template-columns: repeat(${Math.max(data.tiles.length, 3)}, minmax(0, 1fr))">${data.tiles.map(statTile).join('')}</section>`
        : ''}
      <div class="app-body">
        ${hasToday
          ? `<section class="app-today" aria-label="${tomorrow ? t('tomorrow') : t('today')}">${todayHtml(data.today)}</section>`
          : ''}
        ${panels.length ? `<div class="app-panels r${hasToday ? '' : ' wide'}">${panels.join('')}</div>` : ''}
      </div>`;
}
// Věty shrnutí v bublině (ukazuje se vždycky ta, kterou Meri zrovna říká).
const cueSpans = () => tl.cues.map((c) => `<span class="sentence" data-sentence="${esc(c.id)}">${esc(c.text)}</span>`).join('');

stage.innerHTML = `
  <div class="app">
    <section class="app-left">
      <div class="app-neuron" id="neuron" role="img" aria-label="${t('neuron')}"></div>
      <div class="bubble" id="bubble">
        <span class="tail" aria-hidden="true"></span>
        ${cueSpans()}
        <span class="sentence" id="dialog-sentence"></span>
        <span class="sentence hint" id="hint"></span>
      </div>
      <div class="phone-status" id="phone-status" role="status" aria-live="polite"></div>
      <button type="button" class="mic" id="mic" aria-pressed="false">
        <span class="icon-on">${icon('mic', 30)}</span>
        <span class="icon-off">${icon('micOff', 30)}</span>
        <span class="what" id="mic-text">${t('micOff')}</span>
        <span class="key" aria-hidden="true">M</span>
      </button>
    </section>
    <section class="app-right" id="app-right">${rightHtml()}</section>
  </div>`;

const $ = (id) => document.getElementById(id);
const neuron = createNeuron($('neuron'));
const bubble = $('bubble');
const collectSentences = () => Object.fromEntries([...bubble.querySelectorAll('[data-sentence]')].map((el) => [el.dataset.sentence, el]));
let sentences = collectSentences();
const dialogSentence = $('dialog-sentence'); // co Meri říká v rozhovoru
const hintEl = $('hint'); // než Meri mluví: jak ji zavolat, nebo že se chystá
const micEl = $('mic');
const micText = $('mic-text');
let revealed = [...stage.querySelectorAll('.r')];
const highlightCards = highlighter(stage);
const reaction = new Reaction();
if (!data.time) setInterval(() => { $('clock').textContent = clock(); }, 5000);

// Mikrofon zapíná a vypíná jen uživatel: tlačítko dole, M, nebo ⌥M / Alt+M odkudkoli.
// Esc přeskočí zbytek shrnutí, v rozhovoru ho ukončí.
let showing = { cue: null, d: null };
micEl.addEventListener('click', () => {
  micEl.blur(); // ať mezerník dál pouští Meri, ne tohle tlačítko
  send({ cmd: 'mic' });
});

const voice = new Voice({ silence: params.has('silent') });
if (voiceList) await voice.load(tl.cues.map((c) => c.id));
await prepareImages(stage);
$('neuron').style.opacity = '1'; // až s načtenými obrázky, ať se neskládá po kouscích

// Co rozpoznávání řeči slyšelo, jde rovnou do rozhovoru. Na obrazovce se neukazuje: píše to nepřesně,
// ale Meri pochopí, co chceš.
const onText = (text, finished) => dialogPost('heard', { text, finished });
const listener = new Listener({ onText, onProblem: (code) => dialogPost('problem', { code }) });
const withoutMic = params.has('nomic'); // jen pro zkoušky
// Zkoušky bez mikrofonu: window.__meri.heard('jak to dnes vypadá')
window.__meri = { get tl() { return tl; }, voice, reaction, heard: (text, finished = true) => onText(text, finished) };

// Zvuk a poslech podle stavu serveru, ne podle snímků: fungují i v okně schovaném za jinou aplikací.
let run = null;
let playedTurn = null;
function byState(s) {
  const d = s.dialog ?? null;
  voice.mute(s.voice === false);
  // Věty shrnutí se plánují znovu jen při změně průběhu (start, posun, přeskočení, zpět).
  const key = `${s.mode}|${s.startAt}|${s.gen}`;
  if (key !== run) {
    run = key;
    voice.schedule(tl, s.mode === 'run' ? (Date.now() - s.startAt) / 1000 : null);
  }
  // Odpověď v rozhovoru zazní hned. S koncem rozhovoru (Esc, vypnutý mikrofon) utichne.
  if (!d) voice.cancelAnswer();
  else if (d.sound && d.turn !== playedTurn) {
    playedTurn = d.turn;
    voice.playAnswer(d.sound).catch((err) => console.warn(err));
  }
  // Chrome poslouchá, jen když je mikrofon zapnutý a Meri zrovna poslouchá (nemluví ani nepřemýšlí).
  if (s.mic && !withoutMic && d?.status === 'listening') listener.turnOn();
  else listener.turnOff();
}
// Zvuk zamčený do první klávesy nebo kliknutí: po odemčení se věty naplánují znovu.
const unlock = () =>
  voice.unlock().then((unlocked) => {
    if (!unlocked) return;
    run = null;
    byState(currentState());
  });
onState(byState);
unlock();
controls({
  onAny: unlock,
  esc: () => {
    if (showing.cue) send({ cmd: 'skip' });
    else if (showing.d) send({ cmd: 'mic', enable: false });
  },
  // Šipky během shrnutí posouvají řeč o sekundu, jinak listují stránkami boxu „Dnes“.
  arrow: (by) => !showing.cue && goToPage((manualPage?.page ?? shownPage) + by),
});
settingsWindow();

const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

// Vlevo nahoře hlas: jedno kliknutí zapne, druhé vypne (bez hlasu Meri jen píše a ElevenLabs nic nestojí).
// Vpravo nahoře vedle kolečka nová data, stejně jako R. Jako kolečko jsou vidět, jen když se hýbe myší,
// šipka i bez myši, dokud se data načítají.
const voiceButton = document.createElement('button');
voiceButton.type = 'button';
voiceButton.className = 'corner voice-button';
voiceButton.innerHTML = `<span class="icon-on">${icon('speaker', 24)}</span><span class="icon-off">${icon('speakerOff', 24)}</span><span class="tooltip"></span>`;
const refreshButton = document.createElement('button');
refreshButton.type = 'button';
refreshButton.className = 'corner refresh';
refreshButton.innerHTML = `${icon('refresh', 22)}<span class="tooltip"></span>`;
document.body.append(voiceButton, refreshButton);
const voiceLabel = voiceButton.querySelector('.tooltip');
const refreshLabel = refreshButton.querySelector('.tooltip');
const createdTime = () => (data.createdAt ? new Date(data.createdAt).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) : null);
let lastTime = createdTime();
let voiceError = null; // na chvíli místo popisku, třeba když chybí klíč ElevenLabs

function byButtons(s) {
  if (!s) return;
  const aloud = s.voice !== false;
  voiceButton.classList.toggle('enabled', aloud);
  voiceButton.setAttribute('aria-pressed', String(aloud));
  voiceButton.setAttribute('aria-label', aloud ? t('voiceOnAria') : t('voiceOffAria'));
  setText(voiceLabel, voiceError ?? (aloud ? t('voiceOn') : t('voiceOff')));
  voiceLabel.classList.toggle('shown', Boolean(voiceError));
  refreshButton.hidden = Boolean(s.video); // video má vymyšlený den
  refreshButton.classList.toggle('spinning', Boolean(s.refreshing));
  const doing = s.refreshing ? t('loadingNewData') : lastTime ? t('newDataLast', { time: lastTime }) : t('newData');
  refreshButton.setAttribute('aria-label', doing);
  setText(refreshLabel, doing);
}
onState(byButtons);

voiceButton.addEventListener('click', async () => {
  voiceButton.blur(); // ať mezerník dál pouští Meri
  const { ok, data: answer } = await post('/api/settings', { voice: currentState()?.voice === false });
  if (ok) return;
  voiceError = answer.error ? t('addKeyInSettings', { error: answer.error }) : t('voiceToggleFailed');
  byButtons(currentState());
  setTimeout(() => {
    voiceError = null;
    byButtons(currentState());
  }, 4000);
});
refreshButton.addEventListener('click', () => {
  refreshButton.blur();
  send({ cmd: 'refresh' });
});

function hint({ t: at, d, preparing, mic }) {
  if (d) return null;
  if (preparing) return preparing;
  if (mic) return t('hintMicOn');
  // Před shrnutím i po rozhovoru: mikrofon je vypnutý, dokud ho uživatel nezapne.
  return at === null ? (tomorrow ? t('hintTomorrow') : t('hintStart')) : t('hintAfter');
}

// V rozhovoru bublina ukazuje jen to, co říká Meri. Tvoje věta se nevypisuje (viz onText).
function dialogText(d) {
  if (d.problem) return d.problem;
  if (d.status === 'speaking') return d.text;
  if (d.status === 'thinking') return '…';
  return t('listening');
}

// Změny z rozhovoru (přesun, nová, smazaná připomínka) a z Merory mimo rozhovor (třeba nová připomínka
// v telefonu, kalendář) se ukážou hned v boxu „Dnes“. Stejné řádky ve stejném pořadí se jen přepíšou
// (řádek, který svítí, svítí dál), jinak se box překreslí. Box z rozhovoru má přednost.
let linesSignature = JSON.stringify(data.today);
function showLines(lines) {
  if (!lines) return;
  const signature = JSON.stringify(lines);
  if (signature === linesSignature) return;
  linesSignature = signature;
  const box = stage.querySelector('.app-today');
  if (!box) return;
  const cards = [...box.querySelectorAll('[data-card]')];
  currentLines = lines;
  if (cards.length === lines.length && lines.every((r, i) => cards[i].dataset.card === r.id)) {
    lines.forEach((r, i) => {
      cards[i].querySelector('.tile').className = `tile ${r.tone}`;
      cards[i].querySelector('.title').textContent = r.title;
      cards[i].querySelector('.meta').innerHTML = lineMeta(r);
    });
    return;
  }
  box.innerHTML = todayHtml(lines);
  for (const el of box.querySelectorAll('.r')) el.style.opacity = '1';
  shownPage = -1; // nové řádky: stránka se rozdělí znovu
  showPage(lastChoice);
  highlightCards.again();
}

// --- Stránky v boxu „Dnes“ ---
// Bez mluvení je vidět stránka s nejbližší další věcí (u zítřka první). Během shrnutí stránka věci, o které Meri
// zrovna mluví; věta bez věci z boxu (pozdrav, maily, počasí) ukáže stránku, která ještě vidět nebyla, a co nebylo
// vidět ani tak, projde se po shrnutí po 3 s, ať má přehled i ten, kdo neslyšel všechno. Rozhovor ukáže stránku
// řádku, který mění. Klik na puntík nebo šipka ←/→ (mimo shrnutí) přepne ručně, po 30 s bez dotyku zpátky na „teď“.
// Živé změny řádky posunou, okno zůstane na stránce s tím, co je teď.
let currentLines = data.today;
let shownPage = -1;
let lastChoice = 0;
let manualPage = null; // { page, until }
let briefPages = null; // během shrnutí: { visited, cue, page, last }
let tour = []; // stránky, které se po shrnutí ještě ukážou
let tourUntil = 0;
const MANUAL_MS = 30_000;
const TOUR_MS = 3000;
const minutesOf = (time) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
function nowPage() {
  if (tomorrow) return 0;
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  const i = currentLines.findIndex((r) => minutesOf(r.time) !== null && minutesOf(r.time) > now);
  return i >= 0 ? Math.floor(i / PAGE_SIZE) : 0;
}
function pageOf(ids) {
  for (const id of ids ?? []) {
    const i = currentLines.findIndex((r) => r.id === id);
    if (i >= 0) return Math.floor(i / PAGE_SIZE);
  }
  return null;
}
function showPage(p) {
  const box = stage.querySelector('.app-today');
  const next = Math.min(Math.max(p, 0), pagesOf(currentLines) - 1);
  if (!box || next === shownPage) return;
  const turned = shownPage !== -1;
  shownPage = next;
  for (const el of box.querySelectorAll('.r[data-page]')) el.hidden = Number(el.dataset.page) !== next;
  for (const b of box.querySelectorAll('[data-page-go]')) b.setAttribute('aria-current', String(Number(b.dataset.pageGo) === next));
  if (turned) {
    box.classList.remove('turn');
    void box.offsetWidth; // ať se animace pustí znovu
    box.classList.add('turn');
  }
}
function goToPage(p) {
  const count = pagesOf(currentLines);
  if (count < 2) return false;
  manualPage = { page: Math.min(Math.max(p, 0), count - 1), until: Date.now() + MANUAL_MS };
  tour = [];
  return true;
}
stage.addEventListener('click', (e) => {
  const b = e.target.closest('[data-page-go]');
  if (!b) return;
  b.blur(); // ať mezerník dál pouští Meri
  goToPage(Number(b.dataset.pageGo));
});
function choosePage(cue, d) {
  const count = pagesOf(currentLines);
  const all = [...Array(count).keys()];
  const dialogPage = d?.id ? pageOf([d.id]) : null;
  if (dialogPage !== null) return dialogPage;
  if (cue) {
    manualPage = null;
    tour = [];
    briefPages ??= { visited: new Set(), cue: null, page: 0, last: false };
    if (cue.id !== briefPages.cue) {
      briefPages.cue = cue.id;
      briefPages.page = pageOf(cue.highlight) ?? all.find((p) => !briefPages.visited.has(p)) ?? briefPages.page;
      briefPages.visited.add(briefPages.page);
      briefPages.last = cue === tl.cues.at(-1);
    }
    return briefPages.page;
  }
  if (briefPages) {
    // Shrnutí skončilo. Co nebylo vidět, projde se, jen když doběhlo do konce (po Esc ne).
    if (briefPages.last) tour = all.filter((p) => !briefPages.visited.has(p));
    tourUntil = Date.now() + TOUR_MS;
    briefPages = null;
  }
  if (manualPage && manualPage.until > Date.now()) return manualPage.page;
  manualPage = null;
  while (tour.length && Date.now() >= tourUntil) {
    tour.shift();
    tourUntil = Date.now() + TOUR_MS;
  }
  return tour.length ? tour[0] : nowPage();
}
showPage(nowPage());

// Karta počasí po čtvrthodinové obnově (bez AI): jen se přepíše, okno se kvůli tomu nenačítá znovu.
let weatherSignature = JSON.stringify(data.weather ?? null);
function showWeather(p) {
  const card = stage.querySelector('.chip[data-card="weather"]');
  if (!p || !card || JSON.stringify(p) === weatherSignature) return;
  weatherSignature = JSON.stringify(p);
  card.innerHTML = weatherContent(p);
}

// Přepínač je v hlavičce, která se s novými daty překreslí: kliky se chytají na celém okně.
stage.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-day]');
  if (b && b.getAttribute('aria-pressed') !== 'true') send({ cmd: 'day', day: b.dataset.day });
});

// Převzal telefon změnu z počítače (server se po zápisu ptá Merory)? „V telefonu ✓“ zmizí po pár vteřinách,
// rada otevřít Meroru zůstane dvě minuty, nebo do další změny.
const phoneEl = $('phone-status');
let phoneHide = null;
function showPhone(p) {
  clearTimeout(phoneHide);
  const texts = {
    waiting: ['waiting', t('phoneWaiting')],
    confirmed: ['ok', t('phoneConfirmed')],
    not_confirmed: ['warn', t('phoneNotConfirmed')],
  };
  const [kind, text] = texts[p?.status] ?? [];
  const keep = p?.status === 'confirmed' ? 6000 : p?.status === 'not_confirmed' ? 120_000 : null;
  const left = keep ? p.at + keep - Date.now() : 1;
  if (!kind || left <= 0) {
    phoneEl.classList.remove('visible');
    return;
  }
  phoneEl.className = `phone-status visible ${kind}`;
  phoneEl.innerHTML = `${icon('phone', 18)}<span>${esc(text)}</span>`;
  if (keep) phoneHide = setTimeout(() => phoneEl.classList.remove('visible'), left);
}

// Podle stavu, ne podle snímků: přepíše se i v okně schovaném za jinou aplikací.
let phoneSignature = null;

// Nová verze (tools/update.mjs): nenápadné upozornění nahoře, klik otevře nastavení › O aplikaci. Po aktualizaci
// se server restartuje s jinou verzí a okno se načte znovu, ať má nový kód.
const updatePill = document.createElement('button');
updatePill.type = 'button';
updatePill.className = 'update-pill';
updatePill.hidden = true;
document.body.append(updatePill);
updatePill.addEventListener('click', () => {
  updatePill.blur();
  dispatchEvent(new CustomEvent('meri-settings', { detail: { section: 'app' } }));
});
let loadedVersion = null;
onState((s) => {
  if (s.version) {
    if (loadedVersion === null) loadedVersion = s.version;
    else if (s.version !== loadedVersion) location.reload();
  }
  updatePill.hidden = !s.update || Boolean(s.video);
  if (s.update) setText(updatePill, s.updating ? t('updatingMerora') : t('updatePill', { version: s.update.version }));
});
// Dlaždice po živé změně (Připomínky, Kalendář). Stejné dlaždice ve stejném pořadí se jen přepíšou.
let tilesSignature = JSON.stringify(data.tiles ?? []);
function showTiles(tiles) {
  if (!tiles) return;
  const signature = JSON.stringify(tiles);
  const box = stage.querySelector('.app-tiles');
  if (signature === tilesSignature || !box) return;
  tilesSignature = signature;
  box.style.gridTemplateColumns = `repeat(${Math.max(tiles.length, 3)}, minmax(0, 1fr))`;
  box.classList.toggle('many', tiles.length >= 4);
  box.innerHTML = tiles.map(statTile).join('');
  for (const el of box.querySelectorAll('.cd')) el.style.opacity = '1';
}

// Co se zrovna načítá přes Clauda (maily, doplňky), má na dlaždici kolečko a „Načítám…“. Připomínky,
// kalendář a počasí jsou rychlé, ty kolečko nemají.
const FAST_TILES = ['reminders-count', 'calendar-count'];
// loaded: dlaždice, jejichž data už během načítání dorazila (maily dřív než celé shrnutí).
function showLoading(loading, loaded = []) {
  const on = loading === (tomorrow ? 'tomorrow' : 'today');
  for (const el of stage.querySelectorAll('.stat-tile')) el.classList.toggle('loading', on && !FAST_TILES.includes(el.dataset.card) && !loaded.includes(el.dataset.card));
}

onState((s) => {
  if (reloadForLanguage(s.language)) return; // jazyk přepnutý jinde (jiné okno, nastavení)
  // Živé změny jen pro den, který okno ukazuje: box a dlaždice zítřka se nemíchají s dneškem.
  const mine = (s.linesDay ?? 'today') === (tomorrow ? 'tomorrow' : 'today');
  if (!tomorrow && s.dialog?.lines) showLines(s.dialog.lines);
  else if (mine) showLines(s.lines);
  if (mine) {
    showWeather(s.weather);
    showTiles(s.tiles);
  }
  showLoading(s.loading, s.loadedTiles ?? []);
  // Přepínač ukazuje den, který chce server (při chystání zítřka už Zítra, než se okno načte).
  const daySwitch = $('day-switch');
  for (const b of daySwitch?.querySelectorAll('button') ?? []) b.setAttribute('aria-pressed', String(b.dataset.day === (s.day ?? 'today')));
  if (daySwitch) daySwitch.hidden = Boolean(s.video);
  const signature = JSON.stringify(s.phone ?? null);
  if (signature !== phoneSignature) {
    phoneSignature = signature;
    showPhone(s.phone);
  }
});

// Okno se otevřelo znovu, dostalo fokus (přepnutí z jiné aplikace) nebo do něj člověk klikl: server hned
// přečte Meroru, ať je vidět, co se mezitím změnilo v telefonu. Klik je potřeba, protože okno mohlo mít
// fokus celou dobu (připomínka přidaná v telefonu, Mac se ani nedotkl). Čte se nejvýš jednou za 10 s (server).
const readMeroraOnFocus = () => {
  if (document.visibilityState === 'visible') send({ cmd: 'merora' });
};
addEventListener('focus', readMeroraOnFocus);
addEventListener('pointerdown', readMeroraOnFocus);
document.addEventListener('visibilitychange', readMeroraOnFocus);

// Popisek mikrofonu (ve smyčce je t čas, proto zvlášť).
const micLabel = (hearingNow, mic) => (hearingNow ? t('listening') : mic ? t('micOn') : t('micOff'));

let openedAt = performance.now() / 1000;
let sentence = null;
let swapping = false; // během výměny dat se věty shrnutí nevybírají (časování patří starým větám)
startLoop(({ t, dt, time, dialog: d, voice: aloud, preparing, mic }) => {
  const cue = d || swapping ? null : activeSentence(tl, t);
  const speakingNow = speaking(cue, t);

  // Před první větou neuron žije (probouzí se) a na její začátek se rozsvítí celý.
  // Když přemýšlí, konečky běží dokola, aby to nevypadalo jako zaseknutí. Bez hlasu se hýbe sám, ne podle zvuku.
  const wakingUp = t !== null && t < tl.start;
  const dialogSpeaking = d?.status === 'speaking';
  // Přemýšlení má vlastní pohyb (konečky dokola). Mimo shrnutí běží čas okna, ne časová osa, ať se nezasekne.
  reaction.update(dt, {
    speaking: speakingNow || dialogSpeaking || wakingUp,
    thinking: d?.status === 'thinking',
    sound: aloud && (speakingNow || dialogSpeaking) ? voice.readLevel() : null,
    fixedEnds: cue?.ends ?? [],
    all: t !== null && t >= tl.start - 0.3 && t < tl.start + 0.4,
    t: t ?? time,
  });
  neuron.scale(breath(time) + 0.05 * reaction.level);
  neuron.ends(reaction.values);

  // Boxy jsou vidět hned po otevření okna, Meri je pak jen zvýrazňuje, když o nich mluví.
  revealed.forEach((el, i) => reveal(el, time - openedAt, 0.2 + i * 0.05));
  highlightCards(d?.id ? [d.id] : cue?.highlight ?? []);
  lastChoice = choosePage(cue, d);
  showPage(lastChoice);

  // Bublina: shrnutí, rozhovor, nebo rada.
  dialogSentence.classList.toggle('on', Boolean(d));
  if (d) setText(dialogSentence, dialogText(d));
  showing = { cue, d };
  const advice = cue ? null : hint({ t, d, preparing, mic });
  hintEl.classList.toggle('on', Boolean(advice));
  if (advice) setText(hintEl, advice);
  bubble.classList.toggle('visible', Boolean(cue || d || advice));
  if (cue?.id !== sentence) {
    if (sentence) sentences[sentence]?.classList.remove('on');
    if (cue) sentences[cue.id].classList.add('on');
    sentence = cue?.id ?? null;
  }

  // Tlačítko mikrofonu: vypnutý, zapnutý (čeká, až Meri domluví), nebo poslouchá.
  const hearingNow = mic && d?.status === 'listening';
  micEl.classList.toggle('active', hearingNow);
  micEl.classList.toggle('enabled', mic);
  micEl.setAttribute('aria-pressed', String(mic));
  setText(micText, micLabel(hearingNow, mic));
});

// Nová data (přepnutí Dnes / Zítra, nové načtení, jiné zdroje nebo hlas) bez načtení stránky: vymění se jen
// boxy vpravo a věty v bublině, boxy se ukážou postupně jako po otevření. Neuron, bublina, mikrofon a tlačítka
// v rozích zůstanou, jak jsou (Riccardo 22. 11.: při přepnutí dne problikne všechno). meri.js mezitím drží stav
// ze serveru a pošle ho až po výměně; když výměna selže, načte stránku znovu.
async function takeNewData() {
  const assets = await loadAssets();
  if (reloadForLanguage(assets.data.language ?? 'cs')) return; // jiný jazyk: statické texty se musí složit znovu
  if (assets.voiceList) await voice.load(assets.timeline.cues.map((c) => c.id));
  swapping = true;
  ({ data, voiceList, timeline: tl } = assets);
  tomorrow = data.day === 'tomorrow';
  lastTime = createdTime();
  for (const el of bubble.querySelectorAll('[data-sentence]')) el.remove();
  dialogSentence.insertAdjacentHTML('beforebegin', cueSpans());
  sentences = collectSentences();
  sentence = null;
  $('app-right').innerHTML = rightHtml();
  revealed = [...stage.querySelectorAll('.r')];
  openedAt = performance.now() / 1000;
  linesSignature = JSON.stringify(data.today);
  tilesSignature = JSON.stringify(data.tiles ?? []);
  weatherSignature = JSON.stringify(data.weather ?? null);
  currentLines = data.today;
  shownPage = -1;
  manualPage = null;
  briefPages = null;
  tour = [];
  showPage(nowPage());
  highlightCards.again();
  run = null; // věty shrnutí se naplánují znovu podle nového časování
  byButtons(currentState());
  swapping = false;
}
onNewData(takeNewData);

// Při prvním otevření úvod. Až se zavře, nainstalovaná aplikace (start_url má ?app=1) nachystá dnešní shrnutí,
// ne po znovunačtení okna (to dělá server sám po novém shrnutí nebo změně zdrojů).
// Zdroje přepnuté v úvodu se ukážou po znovunačtení okna, až Meri nic nechystá ani neříká. Jazyk přepnutý
// v úvodu načte okno znovu hned (se zdroji i jazykem).
const afterWelcome = (sourcesChanged) => {
  welcomeOpen = false;
  if (reloadForLanguage(lang()) || reloadForLanguage(currentState().language)) return;
  if (sourcesChanged) redraw();
};
addEventListener('meri-welcome', () => {
  welcomeOpen = true;
  welcome({ again: true }).then(afterWelcome);
});
welcomeOpen = true;
const sourcesChanged = await welcome();
if (params.has('app') && performance.getEntriesByType('navigation')[0]?.type !== 'reload') await send({ cmd: 'window' });
afterWelcome(sourcesChanged);
