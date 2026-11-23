// Základ okna Merory: čas shrnutí, časová osa, spojení se serverem, neuron, hlas, poslech a klávesy.
// Okno samo je v app.js, nastavení v settings.js, úvod ve welcome.js.

import { TAIL, buildTimeline } from '/timeline.js';
import { lang } from '/i18n.js';

export const params = new URLSearchParams(location.search);
// ?t=14.5 zastaví okno v daném čase, ?silent=1 ztiší zvuk, ?nomic=1 nikdy neposlouchá (zkoušky).
const frozenT = params.has('t') ? Number(params.get('t')) : null;

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (p) => 1 - (1 - p) ** 3;

const ICONS = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clapper: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  basket: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0"/><path d="M12 18.5V21"/>',
  micOff: '<path d="M2 2l20 20"/><path d="M15 9.34V6a3 3 0 0 0-5.68-1.33"/><path d="M9 9v2a3 3 0 0 0 5.12 2.12"/><path d="M17.66 16.66A7 7 0 0 1 5 11.5"/><path d="M19 11.5a7 7 0 0 1-.11 1.23"/><path d="M12 18.5V21"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  place: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  cross: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  // Části nastavení (Lucide).
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  text: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  rules: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  speaker: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
  speakerOff: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
};

export const icon = (name, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Je zdroj zapnutý? Shrnutí ho má v „zdroje“. Starší shrnutí a ukázky ho nemají, tam platí všechny.
export const hasSource = (data, id) => !data.sources || data.sources.includes(id);

// POST s JSON tělem. Vrací { ok, status, data }; když server neodpoví, ok je false a status 0.
export async function post(route, body = {}) {
  try {
    const res = await fetch(route, { method: 'POST', body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  } catch (err) {
    console.warn(`${route}: ${err.message}`);
    return { ok: false, status: 0, data: {} };
  }
}
export const send = (command) => post('/cmd', command);
export const dialogPost = (route, body) => post(`/api/dialog/${route}`, body);

// --- Instalace jako aplikace Chromu: Chrome pošle „beforeinstallprompt“, úvod a nastavení ho pak použijí ---
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches;
export const canInstall = () => Boolean(installPrompt) && !isInstalled();
export async function install() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  return outcome === 'accepted';
}

// --- Data a časová osa ---
export async function loadAssets() {
  const data = await (await fetch('/data')).json();
  const res = await fetch('/audio/durations.json');
  const voiceList = res.ok ? await res.json() : null;
  return { data, voiceList, timeline: buildTimeline(data.sentences, voiceList) };
}

// Věta, která platí pro zvýraznění. Drží se i v krátké mezeře po ní.
export function activeSentence(tl, t) {
  if (t === null) return null;
  let cur = null;
  for (const c of tl.cues) if (t >= c.start - 0.04) cur = c;
  if (cur === tl.cues.at(-1) && t > cur.end + TAIL) return null;
  return cur;
}

export const speaking = (cue, t) => Boolean(cue) && t >= cue.start && t < cue.end;

// --- Spojení se serverem ---
// Štítek s hlasem: jen pár vteřin po přepnutí hlasu klávesou.
let labelUntil = 0;
function showLabel(label) {
  const remaining = (label?.to ?? 0) - Date.now();
  if (remaining <= 0 || label.to === labelUntil) return;
  labelUntil = label.to;
  document.querySelector('.voice-label')?.remove();
  const el = document.createElement('div');
  el.className = 'voice-label';
  el.textContent = label.text;
  document.body.append(el);
  setTimeout(() => el.remove(), remaining);
}

let state = { mode: 'idle', startAt: 0, gen: 0 };
const subscribers = [];
// Volá fn s každým novým stavem ze serveru, hned i se současným. Zprávy chodí i do okna schovaného
// za jinou aplikací, které se nevykresluje: zvuk a poslech proto řídí stav, ne smyčka.
export function onState(fn) {
  subscribers.push(fn);
  fn(state);
}
export const currentState = () => state;
// Okno, které umí nová data převzít samo (app.js: vymění jen boxy a věty), se kvůli nim nenačítá znovu.
let takeNewData = null;
export const onNewData = (fn) => {
  takeNewData = fn;
};
if (frozenT === null) {
  let rev = null;
  let swapping = false;
  let again = false;
  const notify = () => {
    showLabel(state.label);
    for (const fn of subscribers) fn(state);
  };
  // Během výměny se stav jen ukládá; po ní dostane okno ten nejnovější. Další nová data během výměny = ještě jedna.
  const swap = async () => {
    swapping = true;
    try {
      do {
        again = false;
        await takeNewData();
      } while (again);
    } catch (err) {
      console.warn(err);
      location.reload();
      return;
    }
    swapping = false;
    notify();
  };
  new EventSource('/events').onmessage = (e) => {
    state = JSON.parse(e.data);
    // Nové shrnutí, den, hlas nebo zdroje: okno si vezme nová data a časování (bez takeNewData se načte znovu).
    if (rev !== null && state.rev !== rev) {
      rev = state.rev;
      if (!takeNewData) {
        location.reload();
        return;
      }
      if (swapping) again = true;
      else swap();
      return;
    }
    rev = state.rev;
    if (!swapping) notify();
  };
}

// Hlavní smyčka: vykreslení je funkce času, takže jde skákat a zastavit. Zvuk a poslech v ní nejsou (viz onState).
export function startLoop(render) {
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    let t = frozenT;
    if (frozenT === null && state.mode === 'run') {
      const x = (Date.now() - state.startAt) / 1000;
      t = x >= 0 ? x : null;
    }
    render({
      t,
      dt,
      time: now / 1000,
      dialog: state.dialog ?? null,
      voice: state.voice !== false,
      mic: Boolean(state.mic),
      preparing: state.preparing ?? null,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// --- Poslech přes rozpoznávání řeči v Chromu ---
// Zvuk jde Googlu, ale jen se zapnutým mikrofonem a jen když Meri zrovna nemluví (zapni/vypni řídí okno).
// Poslouchá vždycky jen jedno okno: Chrome pustí rozpoznávání jen jednomu, dvě otevřená okna Merory se zapnutým
// mikrofonem si ho navzájem rušila (start a hned konec dokola) a neslyšelo ani jedno (Riccardo 23. 11.). Okno
// poslouchá, jen když drží zámek (Web Locks, společný pro okna Merory). Okno, které člověk zrovna používá (fokus),
// si zámek vezme, ostatní čekají ve frontě a převezmou ho, až ho první pustí (vypnutý mikrofon, zavřené okno).
const LISTENER_LOCK = 'merora-listener';

export class Listener {
  constructor({ onText, onProblem }) {
    this.onText = onText;
    this.onProblem = onProblem;
    this.enabled = false;
    this.r = null;
    this.dead = false;
    this.holding = false; // drží zámek, smí poslouchat
    this.release = null; // pustí držený zámek
    this.waiting = null; // AbortController žádosti o zámek ve frontě
    addEventListener('focus', () => {
      if (this.enabled && !this.holding) this.claim(true);
    });
  }

  turnOn() {
    if (this.enabled) return;
    this.enabled = true;
    this.dead = false;
    this.claim(document.hasFocus());
  }

  turnOff() {
    this.enabled = false;
    this.stopRecognition();
    this.waiting?.abort();
    this.waiting = null;
    this.holding = false;
    this.release?.();
    this.release = null;
  }

  // Požádá o zámek poslechu. steal: vezme ho oknu, které ho drží (to přestane poslouchat a zařadí se do fronty).
  claim(steal = false) {
    if (!navigator.locks) {
      this.holding = true;
      this.startListening();
      return;
    }
    this.waiting?.abort();
    const waiting = steal ? null : new AbortController();
    this.waiting = waiting;
    const options = steal ? { steal: true } : { signal: waiting.signal };
    navigator.locks
      .request(LISTENER_LOCK, options, () => {
        if (this.waiting === waiting) this.waiting = null;
        if (!this.enabled) return undefined; // mezitím vypnutý: zámek hned pustí
        this.holding = true;
        this.startListening();
        return new Promise((resolve) => {
          this.release = resolve;
        });
      })
      .catch(() => {
        // Zámek vzalo jiné okno (fokus), nebo se žádost zrušila. Vzaté okno přestane poslouchat a čeká.
        if (this.waiting === waiting && waiting?.signal.aborted) return;
        if (!this.holding) return;
        this.holding = false;
        this.release = null;
        this.stopRecognition();
        if (this.enabled) this.claim(false);
      });
  }

  startListening() {
    this.ensureMic().then((ok) => {
      if (!this.enabled || !this.holding || this.r) return;
      if (!ok) {
        this.dead = true;
        this.onProblem('not-allowed');
        return;
      }
      this.startService();
    });
  }

  stopRecognition() {
    const r = this.r;
    this.r = null;
    r?.abort();
  }

  // Nejdřív povolení mikrofonu, pak teprve rozpoznávání. Jinak hlásí „not-allowed“ ve chvíli, kdy se Chrome
  // teprve ptá. Když povolení přijde později, poslech se pustí sám a hláška zmizí (kód „ok“).
  async ensureMic() {
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      if (!this.watchingPermission) {
        this.watchingPermission = true;
        p.onchange = () => {
          if (p.state !== 'granted') return;
          this.onProblem('ok');
          if (this.enabled && this.holding && (this.dead || !this.r)) {
            this.dead = false;
            this.startService();
          }
        };
      }
      if (p.state === 'granted') return true;
      if (p.state === 'denied') return false;
    } catch {
      return true; // prohlížeč bez Permissions API: zkusí se rovnou rozpoznávání
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  startService() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      this.onProblem('unsupported');
      return;
    }
    const r = new SR();
    r.lang = lang() === 'en' ? 'en-US' : 'cs-CZ'; // jazyk okna (public/i18n.js)
    r.interimResults = true;
    r.onresult = (e) => {
      if (this.r !== r) return;
      let text = '';
      let finished = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finished = true;
      }
      this.onText(text.trim(), finished);
    };
    r.onerror = (e) => {
      // Ticho a vlastní vypnutí nejsou chyba. Ostatní se bez změny samo nespraví.
      if (this.r !== r || e.error === 'no-speech' || e.error === 'aborted') return;
      this.dead = true;
      this.onProblem(e.error);
    };
    r.onend = () => {
      // Chrome po každé větě skončí, poslech jede dál, dokud je zapnutý.
      if (this.r !== r || this.dead) return;
      setTimeout(() => {
        if (this.r === r) this.startService();
      }, 200);
    };
    this.r = r;
    try {
      r.start();
    } catch (err) {
      console.warn(err);
    }
  }
}

// --- Klávesy a myš ---
// Mezerník = shrnutí od začátku, S = shrnutí za 10 s (natáčení), R = nová data (při natáčení zpět na začátek),
// M = mikrofon, Esc = co dělá okno (esc), šipky = o sekundu (mimo shrnutí stránky boxu „Dnes“), F = celá obrazovka.
// onAny: volá se při každé klávese a kliknutí (odemkne zvuk).
// arrow(by): okno může šipku použít samo (stránky boxu „Dnes“); vrátí true, když ji použilo, jinak posun o sekundu.
export function controls({ onAny = () => {}, esc = () => {}, arrow = () => false } = {}) {
  addEventListener('keydown', (e) => {
    if (e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    // Otevřené nastavení a úvod mají klávesy pro sebe (pole, tlačítka, Esc je zavře).
    if (document.querySelector('.settings:not([hidden])')) return;
    // Tlačítko v ohnisku si mezerník a Enter vezme samo, pole všechny klávesy.
    const targetEl = e.target instanceof Element ? e.target : null;
    if (targetEl?.closest('input, select, textarea') || (targetEl?.closest('button') && (e.key === ' ' || e.key === 'Enter'))) return;
    onAny();
    const k = e.key.toLowerCase();
    // Čísla 1–9 hlas už nepřepínají: Meri má zatím jen jeden hlas (Riccardo 22. 11.), jiný jen na /voices pro vývoj.
    if (k === ' ') send({ cmd: 'start', delay: 0 });
    else if (k === 's') send({ cmd: 'start', delay: 10 });
    else if (k === 'r') send({ cmd: 'refresh' });
    else if (e.code === 'KeyM') send({ cmd: 'mic' });
    else if (k === 'escape') esc();
    else if (k === 'arrowleft') {
      if (!arrow(-1)) send({ cmd: 'seek', by: -1 });
    } else if (k === 'arrowright') {
      if (!arrow(1)) send({ cmd: 'seek', by: 1 });
    }
    else if (k === 'f') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch((err) => console.warn(err));
    }
  });
  addEventListener('pointerdown', onAny);

  // Kurzor (a s ním kolečko nastavení, šipka obnovení a tlačítko hlasu) zmizí, když se myš chvíli nehýbe.
  // Kvůli natáčení.
  let timer;
  const show = () => {
    document.body.classList.remove('no-cursor');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.add('no-cursor'), 1500);
  };
  addEventListener('pointermove', show);
  show();
}

// --- Plátno a efekty ---
export function fitStage(stage, w, h) {
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  const fit = () => {
    const s = Math.min(innerWidth / w, innerHeight / h);
    stage.style.transform = `translate(${(innerWidth - w * s) / 2}px, ${(innerHeight - h * s) / 2}px) scale(${s})`;
  };
  addEventListener('resize', fit);
  fit();
}

// Zvýraznění karet podle věty: o čem Meri mluví, svítí, ostatní ztmavne.
// again(): po překreslení části okna (nové nebo smazané řádky) najde karty znovu a zvýraznění použije.
export function highlighter(root) {
  let cards = [...root.querySelectorAll('[data-card]')];
  let last = null;
  const highlight = (ids) => {
    const key = ids.join('|');
    if (key === last) return;
    last = key;
    for (const el of cards) {
      const on = ids.includes(el.dataset.card);
      el.classList.toggle('on', on);
      el.classList.toggle('dim', ids.length > 0 && !on);
    }
  };
  highlight.again = () => {
    cards = [...root.querySelectorAll('[data-card]')];
    const ids = last ? last.split('|') : [];
    last = null;
    highlight(ids);
  };
  return highlight;
}

// Místo nuly: okem to není vidět, ale prohlížeč prvek vykreslí předem a v efektní chvíli se nezasekne.
const INVISIBLE = 0.002;

export async function prepareImages(root) {
  await Promise.allSettled([...root.querySelectorAll('img')].map((img) => img.decode()));
}

// Plynulé odhalení prvku podle času.
export function reveal(el, t, start, duration = 0.45) {
  const p = t === null ? 0 : easeOut(clamp((t - start) / duration));
  const key = p.toFixed(3);
  if (el._reveal === key) return;
  el._reveal = key;
  el.style.opacity = Math.max(p, INVISIBLE).toFixed(3);
  el.style.transform = p < 1 ? `translateY(${(1 - p) * 18}px)` : '';
}

// --- Neuron --- geometrie podle appky (components/onboarding/mascot/geometry.ts)
const NODES = {
  n1: { c: [0.4958, 0.1979], r: 0.0556, crop: [0.3828, 0.0859, 0.2266, 0.3438] },
  n2: { c: [0.7269, 0.2847], r: 0.0639, crop: [0.5234, 0.1562, 0.3281, 0.3203] },
  n3: { c: [0.7879, 0.5027], r: 0.0605, crop: [0.5703, 0.3828, 0.3359, 0.2422] },
  n4: { c: [0.6946, 0.7075], r: 0.0614, crop: [0.5156, 0.5234, 0.3047, 0.3047] },
  n5: { c: [0.4963, 0.7998], r: 0.0682, crop: [0.3594, 0.5703, 0.2734, 0.3672] },
  n6: { c: [0.2977, 0.7091], r: 0.0616, crop: [0.1719, 0.5234, 0.3125, 0.3125] },
  n7: { c: [0.2044, 0.5033], r: 0.0603, crop: [0.0859, 0.3828, 0.3438, 0.2422] },
  n8: { c: [0.2965, 0.2949], r: 0.0654, crop: [0.1641, 0.1641, 0.3203, 0.3203] },
};
const NODE_IDS = Object.keys(NODES);
const pct = (v) => `${(v * 100).toFixed(2)}%`;

export function createNeuron(host) {
  const art = document.createElement('div');
  art.className = 'mn-art';
  const base = new Image();
  base.src = '/mascot/base-l.webp';
  base.alt = '';
  base.style.cssText = 'left:0;top:0;width:100%;height:100%';
  art.append(base);

  const ends = {};
  for (const id of NODE_IDS) {
    const { c, r, crop } = NODES[id];
    const tip = new Image();
    // n5 (spodní konec) má od 15. 11. vlastní originál v PNG bez velké červené záře, jakou má v appce.
    tip.src = id === 'n5' ? '/mascot/n5-l.png' : `/mascot/${id}-l.webp`;
    tip.alt = '';
    tip.style.cssText = `left:${pct(crop[0])};top:${pct(crop[1])};width:${pct(crop[2])};height:${pct(crop[3])};opacity:0`;
    const d = 3.4 * r;
    const glow = new Image();
    glow.src = '/mascot/glow.png';
    glow.alt = '';
    glow.style.cssText = `left:${pct(c[0] - d / 2)};top:${pct(c[1] - d / 2)};width:${pct(d)};height:${pct(d)};opacity:0`;
    art.append(tip, glow);
    ends[id] = { tip, glow, v: -1 };
  }
  host.append(art);

  return {
    scale(s) {
      art.style.transform = `scale(${s.toFixed(4)})`;
    },
    ends(values) {
      for (const id of NODE_IDS) {
        const k = ends[id];
        const v = Math.round(values[id] * 100) / 100;
        if (v === k.v) continue;
        k.v = v;
        k.tip.style.opacity = Math.max(v, INVISIBLE);
        k.glow.style.opacity = Math.max(v * 0.8, INVISIBLE);
      }
    },
  };
}

// Klidné dýchání jako v appce: 4,2 s, až o 2,2 %.
export const breath = (time) => 1 + 0.011 * (1 - Math.cos((time * 2 * Math.PI) / 4.2));

// Pořadí, ve kterém se frekvenční pásma mapují na konce, aby se střídaly po celém neuronu.
const ZONE_AT_END = ['n3', 'n7', 'n1', 'n5', 'n2', 'n6', 'n8', 'n4'];

function hashSlot(n) {
  const x = Math.sin(n * 127.1 + 11.7) * 43758.5453;
  return x - Math.floor(x);
}

// Reakce neuronu na řeč. Se zvukem jede z analýzy, bez zvuku z náhradního průběhu.
const THINK_STEP = 0.12; // s na jeden koneček, celé kolo zhruba za vteřinu

export class Reaction {
  constructor() {
    this.level = 0;
    this.values = Object.fromEntries(NODE_IDS.map((id) => [id, 0]));
    this.peak = new Array(8).fill(40);
  }

  // thinking: Meri přemýšlí nebo hledá (rozhovor „…“). Konečky se rozsvěcují jeden po druhém po směru hodinových
  // ručiček, jako když se něco načítá (Riccardo 23. 11.: dřív zůstaly svítit dva a vypadalo to jako zaseknutí).
  // NODE_IDS jdou od horního konečku po směru hodinových ručiček. Dohasínání (tau 0,13 s) dělá za světlem stopu.
  update(dt, { speaking, thinking = false, sound, fixedEnds = [], all = false, t = 0 }) {
    let targetEl = 0;
    const lit = new Set(fixedEnds);
    if (all) NODE_IDS.forEach((id) => lit.add(id));
    if (thinking && !speaking) {
      lit.add(NODE_IDS[Math.floor(t / THINK_STEP) % NODE_IDS.length]);
      targetEl = 0.18 + 0.08 * Math.sin(t * 4);
    } else if (speaking) {
      if (sound) {
        targetEl = sound.level;
        if (targetEl > 0.05) {
          const order = sound.zones
            .map((v, i) => {
              this.peak[i] = Math.max(v, this.peak[i] * 0.998, 40);
              return { i, ratio: v / this.peak[i] };
            })
            .filter((p) => p.ratio > 0.62)
            .sort((a, b) => b.ratio - a.ratio)
            .slice(0, 2);
          for (const p of order) lit.add(ZONE_AT_END[p.i]);
        }
      } else {
        const slot = Math.floor(t / 0.42);
        targetEl = 0.2 + 0.6 * Math.abs(Math.sin(t * 6.1)) * (0.5 + 0.5 * Math.sin(t * 1.7 + slot));
        lit.add(ZONE_AT_END[Math.floor(hashSlot(slot) * 8)]);
        if (hashSlot(slot + 0.5) > 0.5) lit.add(ZONE_AT_END[Math.floor(hashSlot(slot + 0.25) * 8)]);
      }
    }
    this.level += (targetEl - this.level) * (1 - Math.exp(-dt / (targetEl > this.level ? 0.035 : 0.15)));
    for (const id of NODE_IDS) {
      const want = lit.has(id) ? 1 : 0;
      const tau = want > this.values[id] ? 0.03 : 0.13;
      this.values[id] += (want - this.values[id]) * (1 - Math.exp(-dt / tau));
    }
  }
}

// --- Přehrávání a analýza hlasu ---
// Věty shrnutí se plánují dopředu na hodiny zvuku (AudioContext), ne po snímcích: zní přesně podle časové osy
// i v okně schovaném za jinou aplikací, které se nevykresluje. Odpověď v rozhovoru zazní, jakmile ji server pošle.
export class Voice {
  constructor({ silence }) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.output = this.ctx.createGain();
    this.silence = silence;
    this.output.gain.value = silence ? 0 : 1;
    this.analyser.connect(this.output).connect(this.ctx.destination);
    this.timed = new Float32Array(this.analyser.fftSize);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.buffers = {};
    this.sentences = []; // naplánované věty shrnutí: { src, from, to } v čase AudioContextu
    this.answer = null; // právě hraná odpověď v rozhovoru
    this.turn = 0; // zahodí odpověď, která se dočetla až po konci rozhovoru nebo po novější
    // Pásma od 180 Hz do 6 kHz, logaritmicky.
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.zones = Array.from({ length: 8 }, (_, i) => {
      const from = 180 * (6000 / 180) ** (i / 8);
      const upTo = 180 * (6000 / 180) ** ((i + 1) / 8);
      return [Math.floor(from / binHz), Math.max(Math.ceil(upTo / binHz), Math.floor(from / binHz) + 1)];
    });
  }

  async load(ids) {
    await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`/audio/${id}.wav`);
        if (!res.ok) return;
        this.buffers[id] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      }),
    );
  }

  // Hlas vypnutý v nastavení: nic nezní, Meri jen píše do bubliny.
  mute(yes) {
    const g = this.silence || yes ? 0 : 1;
    if (this.output.gain.value !== g) this.output.gain.value = g;
  }

  // Chrome pustí zvuk až po první klávese nebo kliknutí (nainstalovaná aplikace hned). True = právě odemčeno.
  async unlock() {
    if (this.ctx.state !== 'suspended') return false;
    await this.ctx.resume();
    return this.ctx.state === 'running';
  }

  source(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    return src;
  }

  // Naplánuje věty shrnutí. t: kde v průběhu jsme teď (s, před startem záporné), null = nic nehraje.
  schedule(tl, t) {
    for (const v of this.sentences) v.src.stop();
    this.sentences = [];
    if (t === null || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    for (const cue of tl.cues) {
      const buffer = this.buffers[cue.id];
      const after = cue.start - t; // za kolik sekund věta začne, záporné = už běží
      if (!buffer || after + buffer.duration <= 0) continue;
      const src = this.source(buffer);
      src.start(now + Math.max(after, 0), Math.max(-after, 0));
      this.sentences.push({ src, from: now + after, to: now + after + buffer.duration });
    }
  }

  cancelAnswer() {
    this.turn += 1;
    this.answer?.stop();
    this.answer = null;
  }

  async playAnswer(id) {
    this.cancelAnswer();
    const turn = this.turn;
    const res = await fetch(`/audio/${id}.wav`);
    if (!res.ok) return;
    const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
    if (turn !== this.turn) return;
    const src = this.source(buffer);
    src.onended = () => {
      if (this.answer === src) this.answer = null;
    };
    src.start();
    this.answer = src;
  }

  playing() {
    const now = this.ctx.currentTime;
    return Boolean(this.answer) || this.sentences.some((v) => now >= v.from && now < v.to);
  }

  // Aktuální síla zvuku. Null znamená, že zvuk neběží a je potřeba náhrada.
  readLevel() {
    if (!this.playing()) return null;
    this.analyser.getFloatTimeDomainData(this.timed);
    let sum = 0;
    for (const v of this.timed) sum += v * v;
    // Hlasitost vůči nedávnému vrcholu, aby dýchání fungovalo s každým hlasem a neplácalo se u stropu.
    const rms = Math.sqrt(sum / this.timed.length);
    this.peakRms = Math.max(rms, (this.peakRms ?? 0.05) * 0.9995, 0.05);
    const level = clamp(rms / this.peakRms) ** 1.6;
    this.analyser.getByteFrequencyData(this.freq);
    const zones = this.zones.map(([from, upTo]) => {
      let s = 0;
      for (let i = from; i < upTo; i++) s += this.freq[i];
      return s / (upTo - from);
    });
    return { level, zones };
  }
}
