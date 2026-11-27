// Merora pod tvým účtem, takže server vrátí a změní jen tvoje připomínky.
//
// Propojení jde jen přes OAuth (od 20. 11. 2026): Merora Desktop je v Meroře samostatná aplikace, stejně jako
// Claude. Veřejný klient s PKCE, souhlas se potvrdí v appce Merora v telefonu (stránka Merory s QR kódem)
// a Merora Desktop je pak v Nastavení › Připojené aplikace, kde jde odpojit. Po každé změně s tímhle tokenem
// pošle Merora telefonům tichou zprávu a appka si sama naplánuje budík (dory-backend main/push.ts), takže
// připomínka z počítače zazvoní i bez otevření appky. Změny chtějí Merora Pro, čtení jde s každým účtem.
// Staré přihlášení kódem z e-mailu (token appky, telefon o změnách nevěděl) je od 21. 11. pryč.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tr } from './i18n.mjs';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Mimo repo, mimo synchronizované složky a jen pro tebe (0600). Tokeny se nikam nevypisují ani neposílají
// do prohlížeče. Obnovovací token je dlouhodobý přístup k připomínkám.
const OAUTH = process.env.MERI_OAUTH || join(homedir(), '.meri', 'merora-oauth.json');
// Zbytek starého přihlášení kódem z e-mailu: po propojení přes OAuth se smaže.
const OLD_LOGIN = join(homedir(), '.meri', 'merora-session.json');

// Klient „Merora Desktop“ v Meroře: veřejný (PKCE S256, bez tajemství), založilo ho vlákno Vývoj aplikace 21. 11.
// (automatická registrace je vypnutá). client_id veřejného klienta není tajemství. Návrat musí přesně sedět s tím,
// co je u klienta v Meroře, proto jen živá appka na 4747. MERORA_OAUTH_CLIENT_ID jen na zkoušky.
const OAUTH_CLIENT = process.env.MERORA_OAUTH_CLIENT_ID || '942bcb9b-ac9d-4e9e-9157-5b71d81296df';
// MERI_OAUTH_RETURN jen na zkoušky proti vymyšlené Meroře na jiném portu.
export const OAUTH_REDIRECT = process.env.MERI_OAUTH_RETURN || 'http://127.0.0.1:4747/oauth/callback';

// Adresy Merory jsou veřejné (stejné má appka v telefonu). Kdo má vedle repo appky (Riccardo, merora-app),
// bere z jeho lib/config.ts verzi rozhraní, ať Meri drží krok s appkou. MERORA_* jen na zkoušky.
const MERORA = 'https://hvormybwggtfgiohmidh.supabase.co';
const APP_CONFIG = join(ROOT, '..', 'merora-app', 'dory-mobile', 'lib', 'config.ts');
// Veřejný (publishable) klíč projektu Merory, stejný jako v appce v telefonu. Ohlásí se jím websocket signálu
// z Merory (tools/realtime.mjs), k připomínkám pustí až token OAuth. MERORA_PUBLISHABLE_KEY jen na zkoušky.
const PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2b3JteWJ3Z2d0Zmdpb2htaWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzA3MzcsImV4cCI6MjA4MDAwNjczN30.Sdzs1xU_A8TrcMga6FP-eXtStyHxAV-PoQ51TU_shTg';
// Funkce Merory má běžet u databáze v Irsku. Bez hlavičky běží nejblíž tomu, kdo volá (z Prahy ve Frankfurtu, z USA
// za oceánem), a každé její spojení do databáze pak trvá déle. Stejnou hlavičku posílá appka i konektor.
const REGION = 'eu-west-1';
function settings() {
  const configSource = existsSync(APP_CONFIG) ? readFileSync(APP_CONFIG, 'utf8') : '';
  const z = (name) => configSource.match(new RegExp(`export const ${name} = "([^"]+)"`))?.[1];
  const supabase = process.env.MERORA_SUPABASE_URL || MERORA;
  return {
    supabase,
    backend: process.env.MERORA_BACKEND_URL || `${supabase}/functions/v1/main`,
    region: process.env.MERORA_BACKEND_URL || process.env.MERORA_SUPABASE_URL ? null : REGION,
    api: z('MERORA_API_VERSION') ?? '7',
    publishable: process.env.MERORA_PUBLISHABLE_KEY || z('SUPABASE_ANON_KEY') || PUBLISHABLE_KEY,
  };
}

export const oauthAvailable = () => Boolean(OAUTH_CLIENT);
// Propojená s účtem Merora: čte a mění přímo a změny telefon hned dostane.
export const hasOAuth = () => existsSync(OAUTH);
export const isLoggedIn = hasOAuth;
// Merora přístup odmítla (odebraný v appce v telefonu, nebo už nejde obnovit). Platí, dokud požadavek neprojde nebo se
// nepropojí znovu. Okno podle toho nabídne propojit znovu a netvrdí, že je propojeno.
let refused = false;
export const connectionEnded = () => hasOAuth() && refused;
// Bez propojení čte zdroj Merora přes konektor v Claudovi, když ho tam má. MERI_MERORA=connector to vynutí.
export const directAvailable = () => process.env.MERI_MERORA !== 'connector' && hasOAuth();

function saveToken(file, { access_token, refresh_token, expires_in, expires_at }) {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.new`;
  const expires = expires_at ?? Math.floor(Date.now() / 1000) + (expires_in ?? 3600);
  writeFileSync(tempFile, JSON.stringify({ access_token, refresh_token, expires_at: expires }), { mode: 0o600 });
  chmodSync(tempFile, 0o600);
  renameSync(tempFile, file);
}

// --- OAuth: adresa souhlasu → souhlas v appce Merora → /oauth/callback s kódem → tokeny.
// Žádost platí 10 minut (stejně dlouho jako v Meroře) a jen v tomhle běhu serveru.
const pending = new Map(); // state → { verifier, expiresAt }

const base64url = (data) => Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function consentUrl() {
  if (!OAUTH_CLIENT) throw new Error(tr('meroraNotSet'));
  const { supabase } = settings();
  const now = Date.now();
  for (const [key, pendingRequest] of pending) if (pendingRequest.expiresAt < now) pending.delete(key);
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  pending.set(state, { verifier, expiresAt: now + 10 * 60_000 });
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT,
    redirect_uri: OAUTH_REDIRECT,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state,
    scope: 'email offline_access',
  });
  return `${supabase}/auth/v1/oauth/authorize?${query}`;
}

async function oauthToken(params) {
  const { supabase } = settings();
  const res = await fetch(`${supabase}/auth/v1/oauth/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: OAUTH_CLIENT }),
  });
  const answer = await res.json().catch(() => ({}));
  if (res.ok && answer.access_token) return answer;
  const error = new Error(tr('meroraNoAccess', { status: res.status }));
  error.status = res.status;
  throw error;
}

// Kód z návratu na tokeny. Vyhodí chybu s kod: 'vyprselo' | 'selhalo'.
export async function finishConsent({ code, state }) {
  const pendingRequest = pending.get(state ?? '');
  pending.delete(state ?? '');
  if (!pendingRequest || pendingRequest.expiresAt < Date.now()) throw Object.assign(new Error(tr('connectExpired')), { errorCode: 'expired' });
  try {
    if (!code) throw new Error(tr('meroraNoCode'));
    const tokens = await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT, code_verifier: pendingRequest.verifier });
    saveToken(OAUTH, tokens);
    refused = false;
  } catch (err) {
    throw Object.assign(err, { errorCode: 'failed' });
  }
  if (!process.env.MERI_OAUTH) rmSync(OLD_LOGIN, { force: true });
}

// E-mail účtu, se kterým je Merora Desktop propojená (z přístupového tokenu, scope email), jen pro nastavení
// (Účet, jako v telefonu). Null, když propojená není.
export function oauthAccount() {
  if (!hasOAuth()) return null;
  try {
    const { access_token } = JSON.parse(readFileSync(OAUTH, 'utf8'));
    const content = JSON.parse(Buffer.from(String(access_token).split('.')[1], 'base64url').toString('utf8'));
    return { email: typeof content.email === 'string' ? content.email : null };
  } catch {
    return { email: null };
  }
}

// Odpojit na tomhle počítači: tokeny pryč. Úplně se Merora Desktop odebere v appce Merora (Připojené aplikace).
export function disconnectOAuth() {
  rmSync(OAUTH, { force: true });
  refused = false;
}

// Platný přístupový token. Obnova jen jedna najednou: obnovovací token se točí a platí jednou.
const NOT_CONNECTED = () => tr('meroraNotConnected');
let refreshing = null;
async function accessToken() {
  if (!hasOAuth()) throw new Error(NOT_CONNECTED());
  const saved = JSON.parse(readFileSync(OAUTH, 'utf8'));
  if (saved.expires_at - 60 > Date.now() / 1000) return saved.access_token;
  refreshing ??= (async () => {
    try {
      const fresh = await oauthToken({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
      saveToken(OAUTH, { ...fresh, refresh_token: fresh.refresh_token ?? saved.refresh_token });
      return fresh.access_token;
    } catch (err) {
      if (err.status === 400 || err.status === 401) {
        refused = true;
        throw new Error(tr('meroraConnectionEnded'));
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Pro signál z Merory (tools/realtime.mjs): kam se připojit a kterou svou změnu přeskočit.
export const OAUTH_CLIENT_ID = OAUTH_CLIENT;
export const realtimeConfig = () => ({ supabaseUrl: settings().supabase, apikey: settings().publishable });
// Platný token OAuth a id účtu (sub z tokenu), kanál signálu je user:<id>. Token se nikam nevypisuje.
export async function realtimeAuth() {
  const token = await accessToken();
  const content = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString('utf8') || '{}');
  if (typeof content.sub !== 'string' || !content.sub) throw new Error(tr('tokenNoAccount'));
  return { token, userId: content.sub };
}

// Zápisy z tohohle procesu (rozhovor): kolik jich začalo a kolik jich právě běží. Čtení, které se s nějakým
// překrylo, může vrátit stav před ním (remindersWithoutWrites).
let writeCount = 0;
let writesInFlight = 0;
// Kolik z nich se týkalo připomínky, která zvoní (čas nebo místo, před změnou nebo po ní), stejně jako
// `changeRings` v backendu Merory: jen k takové změně pošle Merora do mobilu „Otevři mě“ a jen o ní Meri řekne
// nahlas, že ji mobil nemá (server.mjs watchPhone). Když to volající neví, počítá se, že zvoní.
let ringingWrites = 0;
// Nejbližší čas, kdy taková změna zvoní (nová, přesunutá: nový i starý čas, smazaná, odškrtnutá). U brzkého zvonění
// Meri nečeká na 48 s Merory (server.mjs watchPhone). Bere si ho server (takeSoonestRing).
let soonestRing = null;
export function takeSoonestRing() {
  const at = soonestRing;
  soonestRing = null;
  return at;
}
const ringTime = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// Kolik zápisů do Merory odsud zatím proběhlo. Server podle toho pozná nový zápis a zeptá se telefonu.
export const writesSoFar = () => writeCount;
export const ringingWritesSoFar = () => ringingWrites;

// Převzal telefon poslední změnu? (`GET /devices/status`, jen čtení, Merora ho pouští propojeným aplikacím od
// 22. 11.). Vrací { phone: no_device | idle | confirmed | waiting | not_confirmed, changed_at, synced_at, warned_at }.
export const phoneStatus = () => request('GET', '/devices/status');

// Požadavek na backend Merory pod tvým účtem, stejný jako z appky. Chyba má i krátkou větu pro rozhovor
// (veta), když se dá říct víc než „nepovedlo se“.
async function request(method, route, body, { rings = true, at = [] } = {}) {
  const changes = method !== 'GET' && route !== '/check-for-reminders';
  if (changes) {
    writeCount += 1;
    if (rings) ringingWrites += 1;
    for (const d of (rings ? at : []).map(ringTime).filter((d) => d && d > Date.now())) if (!soonestRing || d < soonestRing) soonestRing = d;
    writesInFlight += 1;
  }
  try {
    return await callIt(method, route, body);
  } finally {
    if (changes) writesInFlight -= 1;
  }
}

async function callIt(method, route, body) {
  const { backend, api, region } = settings();
  const res = await fetch(`${backend}${route}`, {
    method: method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'X-Merora-Api': api,
      'Content-Type': 'application/json',
      ...(region ? { 'x-region': region } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Smazání vrací prázdnou odpověď.
  if (res.ok) {
    refused = false;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const answer = await res.json().catch(() => ({}));
  const withoutPro = res.status === 403 && /Merora Pro/.test(String(answer.error ?? ''));
  // 401: Merora Desktop odebraná v appce (Nastavení › Připojené aplikace). Token tím přestane platit hned, ne až
  // po vypršení, takže se to musí poznat i tady, nejen při obnově tokenu.
  const ended = res.status === 401;
  if (ended) refused = true;
  const error = new Error(
    withoutPro
      ? tr('meroraNeedsPro')
      : ended
        ? tr('meroraConnectionEnded')
        : res.status === 429
          ? tr('meroraTooMany')
          : tr('meroraError', { status: res.status }),
  );
  error.status = res.status;
  error.sentence = withoutPro ? tr('sayNeedsPro') : ended ? tr('sayConnectionEnded') : res.status === 429 ? tr('sayTooMany') : null;
  throw error;
}

// Zvoní připomínka (řádek z Merory)? Má čas nebo místo.
export const reminderRings = (r) => Boolean(r?.date_time || r?.place_id);

// Přesune připomínku stejným požadavkem jako úprava času v appce.
export const moveReminder = (id, destination, { from = null } = {}) =>
  request('PATCH', `/reminders/${encodeURIComponent(id)}`, { date_time: destination.toISOString() }, { at: [from, destination] });

// Založí připomínku stejným požadavkem jako formulář v appce (`POST /reminders`). Vrátí ji i s id.
export async function createReminder({ task, when = null, note = null }) {
  const body = { task: task.trim(), client_request_id: randomUUID() };
  if (!body.task) throw new Error(tr('reminderNeedsText'));
  if (when) body.date_time = when.toISOString();
  if (note?.trim()) body.note = note.trim();
  return request('POST', '/reminders', body, { rings: Boolean(when), at: [when] });
}

// Smaže připomínku stejným požadavkem jako appka (`DELETE /reminders/:id`). U opakované rozsah
// 'occurrence' vynechá jen tenhle výskyt (Merora ho přeskočí) a 'series' smaže celé opakování, historie
// zůstává. Jednorázová se smaže celá. V Meroře to vrátit nejde, rozhovor ji při „vrať to“ založí znovu.
// Rozhovor maže až po výslovném „ano“ (Riccardo, 20. 11.).
export const deleteReminder = (id, scope = null, { rings = true, at = [] } = {}) =>
  request('DELETE', `/reminders/${encodeURIComponent(id)}${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`, undefined, { rings, at });

// Znovu založí smazanou jednorázovou připomínku: text, čas, štítek, poznámka a hlasitost jako předtím.
export function restoreReminder(r) {
  const body = { task: r.task, client_request_id: randomUUID() };
  if (r.date_time) body.date_time = r.date_time;
  if (r.label_id != null) body.label_id = r.label_id;
  if (r.note) body.note = r.note;
  if (typeof r.loud === 'boolean') body.loud = r.loud;
  return request('POST', '/reminders', body, { rings: reminderRings(r), at: [r.date_time] });
}

// Označí připomínku jako hotovou stejným požadavkem jako appka (`POST /mark-done`). U opakované jen tenhle
// výskyt, další zůstává. Rozhovor odškrtává na výslovné přání (Riccardo 22. 11.: „odškrtnout už by měl umět
// ne? Označit jako hotové.“). Seznam se tudy neodškrtává (trvalému by Merora vymazala odškrtnuté věci).
export const markDone = (id, { rings = true, at = [] } = {}) => request('POST', '/mark-done', { id }, { rings, at });

// Vrátí hotovou zpátky mezi otevřené, jako „Vrátit“ v Hotových v appce (`POST /unmark-done`). Propojeným
// aplikacím ji Merora pouští od 22. 11. (s Merora Pro, telefon dostane tichou zprávu). Kdyby vrátila 403,
// rozhovor řekne, ať to člověk vrátí v appce.
export const unmarkDone = (id, { rings = true, at = [] } = {}) => request('POST', '/unmark-done', { id }, { rings, at });

// Hotové připomínky (záložka Hotové v appce), nejnovější první, nejvýš 100. Propásnuté v nich nejsou.
export const doneReminders = () => request('GET', '/reminders/done');

// Položky seznamu stejným požadavkem jako appka (`POST /reminders/:id/steps`): items přidají nebo odeberou
// položku, ops ji odškrtnou nebo znovu otevřou. Meri jen přidává a při „vrať to“ bere zpět svoje přidání
// (tools/lists.mjs). Vrací { reminder, closed }.
export const changeList = (id, { ops = [], items = [] }) =>
  request('POST', `/reminders/${encodeURIComponent(id)}/steps`, { ops, items }, { rings: false });

// Totéž co otevření appky: vrátí otevřené připomínky a server při tom dorovná opakované. Telefonu to nevadí:
// převzetí změny si Merora zapisuje jen u čtení appkou (dory-backend main/index.ts, check-for-reminders).
export const fetchReminders = () => request('POST', '/check-for-reminders');

// Čtení pro živá data (Merora hned po změně). Null, když se během něj odsud něco zapisovalo (rozhovor):
// mohlo by vrátit stav před zápisem a box „Dnes“ by na chvíli ukázal starý čas. Další čtení už ho uvidí.
export async function remindersWithoutWrites() {
  if (writesInFlight) return null;
  const before = writeCount;
  const rows = await fetchReminders();
  return writeCount === before && !writesInFlight ? rows : null;
}
