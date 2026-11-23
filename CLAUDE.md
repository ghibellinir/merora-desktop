# CLAUDE.md

Pokyny pro Clauda, který v tomhle repu pracuje nebo Meroru Desktop instaluje. Uživatelský popis, příkazy a zdroje dat jsou v `README.md`, chování Meri v `PRAVIDLA.md`.

## Co je Merora Desktop

Merora na počítači: shrnutí dne a rozhovor. Appka se jmenuje **Merora Desktop**, v Docku a v okně **Merora**; **Meri** je neuron, který v ní mluví. V textech pro uživatele: appka, okno, server a instalace = Merora / Merora Desktop; kdo mluví, poslouchá a odpovídá = Meri; účet a telefon = appka Merora v telefonu. K Meroře se připojuje jako připojená aplikace (OAuth), funguje i bez ní. Mluví česky nebo anglicky.

## Instalace pro uživatele

Když tě někdo požádá, ať mu Meroru Desktop nainstaluješ, řiď se částí **Pokyny pro Clauda** v `README.md`. Klíče, hesla a odkazy na kalendář za něj nevkládej, neopisuj a nevypisuj: vkládá je sám v úvodu nebo v nastavení.

## Pravidla

- **Tajné věci nikdy ven.** Soubor `.env` (klíč ElevenLabs, odkaz na kalendář), `~/.meri` (tokeny Merory, nastavení, paměť mailů), `data/brief.json`, `data/brief-tomorrow.json` a `public/audio` nepatří do gitu, do chatu ani do logů.
- **Připomínky v Meroře jsou skutečné a zvoní.** Nezakládej, nepřesouvej, neodškrtávej ani nemaž je bez výslovného přání uživatele. Meri v rozhovoru maže jen po výslovném „ano“ a tohle pravidlo se neobchází.
- S Merorou Meri umí jen: číst, přesunout čas, založit, přidat do seznamu, který už existuje, smazat (po „ano“) a odškrtnout. Další druhy změn nepřidávej.
- **Když měníš chování Meri**, uprav ve stejném commitu `PRAVIDLA.md` a pokyny pro model (`tools/brief.mjs`, `tools/dialog.mjs`, v obou jazycích) a pusť zkušební sadu `npm test`.
- Názvy v kódu, příkazy, přepínače, adresy a proměnné prostředí jsou anglicky. Komentáře a dokumentace jsou česky. Texty pro uživatele jsou česky i anglicky: okno v `public/i18n.js`, server v `tools/i18n.mjs`, pevné odpovědi Meri v `tools/dialog.mjs`.
- Když změníš chování, příkaz nebo zdroj dat, uprav ve stejném commitu `README.md`.
- Commitové zprávy anglicky v konvenčním stylu (`feat: …`, `fix: …`, `docs: …`).

## Příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run setup` | celá instalace na Macu i Windows: kontrola Node a Clauda, server na pozadí, klávesa, otevře Meroru v Chromu (`tools/install.mjs`) |
| `npm start` | server a okno na `http://127.0.0.1:4747` (po instalaci běží na pozadí, druhý se nespustí) |
| `npm test [-- slovo]` | zkušební sada (`tools/personas.mjs`, lidé v `personas/*.json`): shrnutí a rozhovor nanečisto se skutečným Claudem proti `PRAVIDLA.md`. Pusť ji po každé změně pokynů pro model a před vydáním. |
| `npm run brief` | shrnutí do `data/brief.json` bez hlasu (`--dry-run` jen vypíše, `-- --sentences` jen nové věty nad uloženými daty) |
| `npm run voice` | namluví věty hlasy z `data/voices.json` (platí se v ElevenLabs) |
| `npm run reminder -- "Text" --when "RRRR-MM-DD HH:MM" [--note "…"] [--dry-run]` | založí připomínku v Meroře (místní čas, bez `--when` do Kdykoli) |
| `npm run background` | jen server na pozadí od přihlášení (Mac launchd, Windows složka Po spuštění; `-- --uninstall` odinstaluje) |
| `npm run hotkey` | jen klávesa pro mikrofon odkudkoli (Mac ⌥M, Windows Alt+M; `-- --uninstall` odinstaluje) |
| `npm run video` | natáčení: druhý server na `http://127.0.0.1:4748` s vymyšleným dnem z `data/video.json` |

Restart serveru po změně kódu na Macu: `launchctl kickstart -k gui/$(id -u)/app.merora.meri`. Logy: `~/.meri/server.log` a `~/.meri/hotkey.log`. Otevřená okna se po změně souborů v `public/` sama nenačtou (jen po nové verzi), dej v nich Cmd+R.

Zkušební servery: `MERI_DATA` (jiné shrnutí jen ke čtení), `MERI_BRIEF` (jiné shrnutí, které smí rozhovor přepsat), `MERI_SETTINGS` (jiný soubor nastavení), `MERI_ENV` (jiný `.env`), `MERI_MERORA=connector` (Merora přes konektor v Claudovi), `MERI_CLAUDE=/usr/bin/false` (bez Clauda), `PORT`.

Když Merora hlásí, že propojení vypršelo, uživatel se propojí znovu tlačítkem v nastavení nebo na `http://127.0.0.1:4747/connect`. Za něj to nedělej.

**Vydání nové verze:** zvedni `version` v `package.json`, commitni, označ `vX.Y.Z` a na GitHubu z toho udělej vydání s popisem, co je nového. Popis se lidem ukáže v nastavení › O aplikaci a nabídne jim Aktualizovat (`tools/update.mjs`).

## Soubory

- `PRAVIDLA.md`: pravidla chování Meri pro každého (co čte, o čem mluví, co umí a co ne, soukromí, tón, volby). Pokyny pro model se jimi řídí.
- `server.mjs`: místní HTTP server, společný stav pro okno (SSE `/events`), příkazy (`/cmd`), nastavení a API pro rozhovor.
- `public/app.js`: okno (`/`, `/app`). Základ okna je `public/meri.js` (spojení se serverem, smyčka, neuron, hlas, poslech v Chromu, klávesy; poslouchá vždycky jen jedno okno), časová osa `public/timeline.js`, nastavení `public/settings.js`, úvod `public/welcome.js`, texty `public/i18n.js`.
- `tools/brief.mjs`: sestavení shrnutí a pojistka `problems()` proti osobním údajům na obrazovce.
- `tools/dialog.mjs`: rozhovor s Meri, rychlá cesta bez modelu (česky přesun slovy, v obou jazycích rozloučení, „vrať to“, zopakování, ano/ne na smazání).
- `tools/merora.mjs`: propojení s Merorou (OAuth) a volání jejího backendu, `tools/realtime.mjs`: signál o změnách z Merory.
- `tools/lines.mjs`: řádky plánu dne a jejich přednost, `tools/live.mjs`: živá data bez AI.
- `tools/sources/`: zdroje (Merora, kalendář, počasí, Gmail) a načítání doplňků (`docs/addons.md`), `tools/settings.mjs`: volby z `~/.meri/settings.json`.
- `tools/elevenlabs.mjs`, `tools/voice.mjs`: hlas, každý jazyk svůj (`data/voices.json`).
- `tools/install.mjs`, `tools/hotkey.swift`, `tools/hotkey-windows.ps1`, `tools/watchdog.mjs`: instalace, klávesa a server na pozadí. `tools/update.mjs`: aktualizace z GitHub Releases.
- `tools/personas.mjs` a `personas/`: zkušební sada s vymyšlenými lidmi.
- `data/`: hlasy (`voices.json`), ukázkový den (`sample.json`), natáčení (`video.json`).
