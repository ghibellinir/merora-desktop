// Merora: dnešní připomínky, po termínu, na místo a Kdykoli. Hlavní zdroj dne.
// Čte se přímo přes propojení s účtem (OAuth, tools/merora.mjs). Kdo propojený není, ale má Meroru jako konektor
// v Claudovi, čte přes něj.
import { listConnectors, callTool } from '../ai.mjs';
import { timeOf, dayOf, pastWhenForScreen } from '../time.mjs';
import { hasOAuth, fetchReminders, directAvailable, connectionEnded } from '../merora.mjs';
import { showYesterday, ownRules } from '../settings.mjs';
import { tr } from '../i18n.mjs';
import { notConnected } from './not-connected.mjs';

// Veřejná adresa MCP Merory. Kdo ji v Claudovi propojil dřív, má konektor na původní adrese, platí obě.
export const MERORA_MCP = 'https://mcp.merora.app/mcp';
const MERORA_ADDRESSES = ['https://mcp.merora.app', 'https://hvormybwggtfgiohmidh.supabase.co/functions/v1/mcp'];

// Konektor Merory podle adresy. Null, když v Claudovi propojený není.
async function meroraConnector(again = false) {
  return (await listConnectors({ again })).find((k) => MERORA_ADDRESSES.some((a) => k.address.startsWith(a))) ?? null;
}

// Co uživateli chybí k propojení (text do úvodu a nastavení), nebo null. cist: zkusit i přečíst připomínku,
// to jediné pozná, že chybí Merora Pro. Výsledek se pamatuje pro nastavení, hledání trvá pár vteřin.
let lastCheck = null;
export async function checkMerora({ read = false } = {}) {
  // Propojená s účtem: konektor se nezkouší, takže po odpojení neplatí nic z dřívějška (řádek hlásil „Přes konektor“).
  if (directAvailable()) {
    lastCheck = null;
    return null;
  }
  let problem = null;
  const connector = await meroraConnector(read);
  if (!connector) problem = tr('meroraNotLinkedButton');
  else if (connector.status === 'needs_login') problem = tr('meroraLoginClaude');
  else if (connector.status !== 'ok') problem = tr('meroraConnectorDown');
  else if (read) {
    try {
      await callTool({ tool: `${connector.prefix}list_reminders`, extraArgs: { view: 'today', limit: 1 } });
    } catch (err) {
      problem = /Merora Pro/.test(err.message)
        ? tr('meroraProMissing')
        : tr('meroraReadFailed');
    }
  }
  lastCheck = { problem };
  return problem;
}

// Připomínky z konektoru (list_reminders) do stejného tvaru, jaký vrací přímé přihlášení.
export function fromConnector({ reminders = [] }) {
  return reminders.map((r) => ({
    id: r.id,
    task: r.title,
    date_time: r.when ?? null,
    place_id: r.place?.id ?? null,
    place_name: r.place?.name ?? null,
    geo_direction: r.place ? (r.place.on === 'leaving' ? 'exit' : 'arrival') : null,
    recurrence_type: r.repeat ?? null,
    label_name: r.label ?? null,
    steps: r.type === 'list' || r.type === 'routine' ? { kind: r.type, items: r.items ?? r.steps ?? [] } : null,
    chain_waiting: Boolean(r.chain?.waiting_for_previous),
  }));
}

// Všechny otevřené připomínky (přes propojení, jinak konektor). Bere i shrnutí zítřka (tools/brief.mjs --tomorrow).
export async function load() {
  if (directAvailable()) return fetchReminders();
  const connector = await meroraConnector();
  if (!connector) throw notConnected(tr('meroraNotInClaude'));
  return fromConnector(await callTool({ tool: `${connector.prefix}list_reminders`, extraArgs: { view: 'all', limit: 200 } }));
}

// Do dalšího kroku jde jen to, co je potřeba: bez poznámek, položek seznamů a souřadnic.
// Po termínu jen ze včerejška a jen s volbou „i včerejší nedodělané“ (showYesterday), starší nikdy.
// Rozhovor bere připomínky zvlášť (všechny), tohle je jen pro shrnutí a box.
// Kdykoli jen na vlastní pravidlo (Riccardo 22. 11.: „Cvičení mi zobrazuj každý den, i když ho mám v Kdykoli“).
// Do dat projde položka, o které některé pravidlo mluví (slovo z názvu, i v jiném tvaru), nebo všechny, když pravidlo
// mluví o Kdykoli celkově. Jestli ji opravdu ukázat, rozhodne model podle pravidla. Bez pravidel se nic nemění.
const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function wantedByRule(text, rules) {
  if (!rules.length) return false;
  const said = plain(rules.join(' '));
  if (/kdykoli|bez casu/.test(said)) return true;
  const words = plain(text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return words.some((w) => said.includes(w.length > 5 ? w.slice(0, w.length - 2) : w.slice(0, 4)));
}

// Oranžová (zazvonila) stejně jako v appce Merora (dory-mobile lib/fireState.ts, 23. 11.): čas proběhl, nebo už
// zazvonila a čas není v budoucnosti. Ne: čekající krok řetězu, seznam, ve kterém nic nezbývá, a připomínka
// s časem i místem, dokud na místo nedorazíš (geo_satisfied). Kdykoli a jen s místem sem nechodí.
const remainingInList = (r) => {
  const marks = r.step_state?.items ?? {};
  return (r.steps.items ?? []).filter((item) => !['done', 'skipped'].includes(marks[item.id]?.s)).length;
};
export function firedLikeApp(r, when, now) {
  if (r.chain_waiting) return false;
  if (r.steps?.kind === 'list' && remainingInList(r) === 0) return false;
  const due = when <= now;
  const waitingForPlace = due && Boolean(r.place_id) && r.geo_satisfied !== true;
  const future = when > now;
  return (due && !waitingForPlace) || (Boolean(r.last_triggered_at) && !future);
}

export function prepareReminders(rows, now, { yesterday = showYesterday(), rules = ownRules() } = {}) {
  const today = dayOf(now);
  const dayBefore = dayOf(new Date(now.getTime() - 24 * 3600 * 1000));
  const output = [];
  for (const r of rows) {
    if (r.chain_waiting) continue;
    const when = r.date_time ? new Date(r.date_time) : null;
    let kind;
    // Do shrnutí a boxu jen připomínky s časem na ten den, s místem i bez (Riccardo 23. 11.: „Musí tam být čas
    // dneška nebo zítřka“). Kdykoli a připomínky jen s místem ne: seznam na místo neznamená, že tam ten den
    // půjdeš, a přiřadit ho k úkolu („jít nakoupit“) by mohlo ukázat jiný seznam (drogerie, jídlo). Najdeš je
    // v appce, rozhovor je vidí dál. Bez času projde jen to, o čem mluví vlastní pravidlo (viz wantedByRule),
    // prázdný seznam nikdy.
    if (r.steps?.kind === 'list' && !(r.steps.items?.length > 0)) continue;
    if (!when) {
      if (!wantedByRule(r.task, rules)) continue;
      kind = 'anytime';
    }
    else if (dayOf(when) < today) {
      if (!yesterday || dayOf(when) !== dayBefore) continue;
      kind = 'overdue';
    }
    else if (dayOf(when) === today) kind = firedLikeApp(r, when, now) ? 'today_past' : 'today';
    else continue; // budoucnost dnes nikoho nezajímá

    const late = kind === 'today_past' || (kind === 'overdue' && firedLikeApp(r, when, now));
    const list = r.steps?.kind === 'list';
    output.push({
      id: `r${r.id}`,
      text: r.task,
      kind,
      when: when ? (kind === 'overdue' ? pastWhenForScreen(when, now) : timeOf(when)) : null,
      ...(r.place_id ? { place: r.place_name ?? tr('place'), direction: r.geo_direction ?? 'arrival' } : {}),
      ...(r.recurrence_type ? { repeat: r.recurrence_type } : {}),
      ...(r.label_name ? { label: r.label_name } : {}),
      ...(r.steps?.kind ? { steps: { kind: list ? 'list' : 'routine', count: r.steps.items?.length ?? 0 } } : {}),
      // Otevření seznamu počítadlo taky zvedá, takže číslo platí jen u obyčejné připomínky.
      ...(!list && r.trigger_count > 0 ? { rang: r.trigger_count } : {}),
      // Pro obrazovku, jde mimo text.
      time: when ? (kind === 'overdue' ? pastWhenForScreen(when, now) : timeOf(when)) : null,
      tone: late ? 'fired' : 'blue',
      sortKey: when ? when.getTime() : Number.MAX_SAFE_INTEGER,
    });
  }
  const order = { overdue: 0, today_past: 1, today: 2, place: 3, anytime: 4 };
  return output.sort((a, b) => order[a.kind] - order[b.kind] || a.sortKey - b.sortKey).slice(0, 30);
}

export default {
  id: 'merora',
  title: 'Merora',
  description: 'Připomínky na dnešek, po termínu a na místo',
  en: { title: 'Merora', description: 'Reminders for today, overdue and at places', connectText: 'Connect your Merora account' },
  icon: 'bell',
  connection: { kind: 'connector', address: MERORA_MCP },
  boxes: ['today'],
  // Propojení s účtem jedním tlačítkem: stránka Merory s QR kódem, souhlas v appce v telefonu.
  connect: { address: '/oauth/start', text: 'Propojit s účtem Merora' },
  connected: () => hasOAuth(),
  // Co se počítá za změnu v Meroře: text, čas, místo, opakování, štítek a seznam. Ne to, co se mění
  // jen s časem (druh, „zazvonilo“), jinak by se shrnutí přepisovalo, i když se v Meroře nic nestalo.
  fingerprint: (items) => items.map((z) => [z.id, z.text, z.sortKey, z.place ?? null, z.direction ?? null, z.repeat ?? null, z.label ?? null, z.steps ?? null]),
  problem: () => (directAvailable() ? (connectionEnded() ? tr('meroraEnded') : null) : lastCheck ? lastCheck.problem : tr('meroraNotLinked')),
  check: (options) => checkMerora(options),
  collect: async ({ now }) => prepareReminders(await load(), now),
};
