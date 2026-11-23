# Doplňky

Merora Desktop umí kromě Merory, kalendáře, počasí a Gmailu načíst i vlastní zdroje: doplňky. Jádro je samo načte ze složky `dev/sources` (nebo z cesty v `MERORA_ADDONS`), když tam jsou, a bez nich jede dál. Doplněk se zapíná a vypíná v nastavení jako ostatní zdroje (výchozí je vypnutý) a volby má v `~/.meri/settings.json`. Hodí se třeba pro vývojáře: chyby z Sentry, uživatelé z PostHogu, úkoly z Notionu.

## Tvar doplňku

Jeden soubor `dev/sources/<id>.mjs` (nebo ve složce z `MERORA_ADDONS`) s `export default` objektem. Stejně jako zdroje jádra (`tools/sources/index.mjs`):

| Pole | Co je to |
|---|---|
| `id`, `title`, `description`, `icon` | jméno a popis v nastavení, `id` se nesmí krýt s jiným zdrojem |
| `connection` | jak se připojuje, třeba konektor Clauda: `{ kind: 'connector', services: ['mcp__…'] }` |
| `defaultOn` | `false`, ať je u nových lidí vypnutý |
| `order` | pořadí v nastavení a na dlaždicích (maily mají 20) |
| `options`, `problem(options)` | výchozí volby a co chybí k připojení (text do nastavení), nebo `null` |
| `collect({ now, options, askClaude })` | data pro shrnutí, nebo vyhodí chybu; `askClaude` je Claude s konektory (`tools/ai.mjs`) |

A navíc pro ranní shrnutí (`tools/brief.mjs`):

| Pole | Co je to |
|---|---|
| `key`, `forModel(data)` | pod jakým klíčem a v jakém tvaru data dostane model (bez `forModel` celá) |
| `instructions` | věta nebo dvě pro model: co s daty dělat a jaké id smí ve větách zvýraznit |
| `schema` | vlastní pole, která má model vrátit (třeba lidsky přepsané chyby) |
| `screen({ data, texts, now, options, time })` | co se ukáže: `{ lines, tiles, panels }`; `data` je `null`, když se doplněk nenačetl |

Řádek do „Dnes“ (`lines`) má tvar řádku shrnutí (`id`, `icon`, `tone`, `title`, `meta`) a jde za dnešní připomínky s časem. Dlaždice (`tiles`) má `id`, `icon`, `tone`, `title`, `value`, `caption`. Panel (`panels`) má `id`, `icon`, `heading` a `items: [{ title, meta }]`. Každý box dostane `source` sám, okno ho podle něj schová, když se doplněk vypne. Texty na obrazovce hlídá stejná pojistka jako zbytek shrnutí (žádné e-maily, odkazy, telefony, tokeny).

Doplňky nesahají do souborů jádra: co potřebují (Claude, čas), dostanou v argumentech. Složka `dev/` je v `.gitignore`, takže doplňky můžou žít ve vlastním repu (naklonovaném do `dev/`, nebo kdekoli jinde s `MERORA_ADDONS`).
