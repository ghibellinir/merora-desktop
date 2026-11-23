// Seznamy v Meroře (nákupní, na hory…). Meri do nich jen přidává, a to podle stejných pravidel jako hlas
// v appce (dory-backend main/voiceList.ts, rozhodnuto 26. 10.): do seznamu jen se slovem seznam nebo jménem
// seznamu („kup chleba“ zůstane připomínka), nejmenovaný seznam jen když je jediný a seznam, který uživatel
// nemá, Meri nezakládá. Stejnou věc podruhé nepřidá: neodškrtnutá tam už je, odškrtnutá se znovu otevře
// (jako update_list v MCP Merory). Repo appky se jen čte, tady jsou ta pravidla přepsaná.
import { randomBytes } from 'node:crypto';
import { language } from './settings.mjs';

export const MAX_ITEMS = 50; // MAX_STEPS v Meroře
const MAX_TEXT = 200; // MAX_STEP_TEXT
const MAX_FROM_SENTENCE = 20; // MAX_VOICE_ITEMS

// Bez diakritiky a velikosti písmen (foldText v Meroře).
export const withoutDiacritics = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

// Slova, podle kterých věta mluví o seznamu (jazykové balíčky cs-CZ a en, voicePrompt.ts).
const LIST_WORDS = {
  cs: ['seznam', 'nákupní seznam', 'seznam na', 'přidej do seznamu', 'přidej na seznam', 'dej na seznam', 'napiš na seznam', 'přidej do nákupu'],
  en: ['list', 'shopping list', 'add to the list', 'add to my list', 'put on the list', 'put on my list', 'add to shopping'],
};

export const mentionsList = (sentence) => {
  const t = withoutDiacritics(sentence);
  return LIST_WORDS[language()].map(withoutDiacritics).some((s) => t.includes(s));
};

// Věta jmenuje seznam: začátek slova jména na začátku slova věty („do nákupu“ ↔ Nákupní seznam,
// „na hory“ ↔ Na hory). Kmen bez koncovky, ať projde i skloňování.
export function namesList(sentence, title) {
  const t = withoutDiacritics(sentence);
  return withoutDiacritics(title)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .some((w) => new RegExp(`(^|[^a-z0-9])${w.slice(0, Math.min(5, Math.max(3, w.length - 2)))}`).test(t));
}

// Otevřené seznamy z připomínek: za opakování jen nejbližší výskyt (položky mají výskyty společné),
// nejnovější seznam první. Stejně jako OPEN_LISTS_SQL v Meroře.
export function listsFromRows(rows) {
  const when = (r) => (r.date_time ? Date.parse(r.date_time) : -Infinity);
  const series = new Map();
  for (const r of [...rows].sort((a, b) => when(a) - when(b) || a.id - b.id)) {
    if (r.steps?.kind !== 'list' || r.chain_waiting) continue;
    const key = r.series_id ?? -r.id;
    if (!series.has(key)) series.set(key, r);
  }
  return [...series.values()]
    .sort((a, b) => b.id - a.id)
    .map((r) => {
      const status = r.step_state?.items ?? {};
      return {
        id: r.id,
        title: r.task,
        place: r.place_name ?? null,
        items: (r.steps.items ?? []).map((i) => {
          const s = status[i.id]?.s ?? null;
          return { id: i.id, text: i.text, status: s, finished: s === 'done' || s === 'skipped' };
        }),
      };
    });
}

// Věci z věty jako na plátně appky („Mléko“): jeden řádek, velké první písmeno, bez prázdných a opakování.
export function itemsFromSentence(texts) {
  if (!Array.isArray(texts)) return [];
  const seen = new Set();
  const result = [];
  for (const t of texts) {
    const clean = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!clean) continue;
    const text = clean.charAt(0).toLocaleUpperCase('cs-CZ') + clean.slice(1);
    const key = withoutDiacritics(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= MAX_FROM_SENTENCE) break;
  }
  return result;
}

// Seznam, do kterého věci patří (pickVoiceList v Meroře). Seznam od modelu platí jen tehdy, když věty
// seznam zmiňují slovem seznam nebo jeho jménem, jinak je „nezmíněný“ a Meri se zeptá. Bez seznamu od
// modelu, se slovem seznam a s jediným otevřeným seznamem je to on. vety: co řekl (a na co odpovídal).
export function pickList(fromModel, lists, sentences) {
  const mentions = sentences.some(mentionsList);
  const id = Number(String(fromModel ?? '').replace(/^[sr]/, ''));
  const byId = fromModel && Number.isInteger(id) ? lists.find((s) => s.id === id) : null;
  if (byId) {
    const names = mentions || sentences.some((v) => namesList(v, byId.title));
    return { list: byId, unnamed: !names };
  }
  if (mentions && lists.length === 1) return { list: lists[0], unnamed: false };
  return { list: null, unnamed: false };
}

// Krátké stálé id položky jako v appce (malá písmena a číslice), m na začátku = přidala Meri.
const newId = () => `m${randomBytes(6).readUIntBE(0, 6).toString(36).padStart(9, '0').slice(-9)}`;

// Co poslat do Merory (`POST /reminders/:id/steps`): nová věc se přidá, odškrtnutá se znovu otevře,
// neodškrtnutá tam už je. pridane a otevrene vrátí „vrať to“.
export function planAdding(list, texts, now = new Date()) {
  const at = now.toISOString();
  const plan = { ops: [], items: [], added: [], opened: [], alreadyThere: [] };
  for (const text of texts) {
    const same = list.items.find((p) => withoutDiacritics(p.text) === withoutDiacritics(text));
    if (same?.finished) {
      plan.ops.push({ step_id: same.id, status: 'open', at });
      plan.opened.push({ id: same.id, text: same.text, originally: same.status });
    } else if (same) {
      plan.alreadyThere.push(same.text);
    } else {
      const id = newId();
      plan.items.push({ step_id: id, op: 'add', text });
      plan.added.push({ id, text });
    }
  }
  plan.full = list.items.length + plan.added.length > MAX_ITEMS;
  return plan;
}

// Totéž bez Merory (ve videu): seznam v paměti po změně.
export function afterChange(line, plan) {
  const items = [...(line.steps?.items ?? [])];
  const status = { ...(line.step_state?.items ?? {}) };
  for (const i of plan.items) {
    if (i.op === 'add' && !items.some((x) => x.id === i.step_id)) items.push({ id: i.step_id, text: i.text });
    if (i.op === 'remove') {
      const where = items.findIndex((x) => x.id === i.step_id);
      if (where >= 0) items.splice(where, 1);
      delete status[i.step_id];
    }
  }
  for (const o of plan.ops) status[o.step_id] = { s: o.status, at: o.at };
  return { ...line, steps: { ...line.steps, items }, step_state: { items: status } };
}

// „chleba“, „chleba a mléko“, „chleba, mléko a máslo“ (anglicky „bread, milk and butter“). Velké písmeno jen
// u první věty, ne uprostřed.
export function joinWords(texts) {
  const male = texts.map((t) => (/^\p{Lu}\p{Ll}/u.test(t) ? t.charAt(0).toLocaleLowerCase('cs-CZ') + t.slice(1) : t));
  const and = language() === 'en' ? 'and' : 'a';
  return male.length <= 1 ? (male[0] ?? '') : `${male.slice(0, -1).join(', ')} ${and} ${male.at(-1)}`;
}
