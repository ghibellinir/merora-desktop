# Merora Desktop

Merora na počítači. Každé ráno ti Meri, neuron z Merory, projde připomínky z Merory, kalendář, maily a počasí a řekne ti, co tě čeká. Pak se jí můžeš na cokoli z toho zeptat, nebo jí říct, ať něco přesune nebo připomene. Běží u tebe na počítači (Mac i Windows) v jednom okně Chromu, přemýšlí přes Claude Code z tvého předplatného a hlas z ElevenLabs je nepovinný. Funguje i bez účtu Merora. Mluví česky nebo anglicky (Merora Desktop also speaks English: Settings › Account › About you › Jazyk / Language).

> Merora Desktop je prototyp a je zdarma. Můžou se v něm objevit chyby, hlavní pozornost teď patří appce Merora v telefonu. Když něco nefunguje nebo máš nápad, napiš to přes **Zpětná vazba** v nastavení (nástěnka [Merora Desktop](https://merora.userjot.com/feedback/merora-desktop)).

## Co potřebuješ

- Mac nebo Windows a Google Chrome.
- Claude s předplatným (Pro nebo vyšší) a [Claude Code](https://claude.com/claude-code), do kterého se jednou přihlásíš.
- Nepovinné: účet **Merora** (Meri čte tvoje připomínky, s Merora Pro je i mění; propojení se potvrzuje v appce Merora 1.3.0 nebo novější) a účet u **ElevenLabs** (Meri mluví nahlas, jinak jen píše).

## Instalace

**Nejjednodušší je říct to Claudovi.** Otevři Claude Code a napiš:

> Nainstaluj mi Merora Desktop z https://github.com/ghibellinir/merora-desktop

Claude stáhne repo, doinstaluje, co chybí, a spustí instalaci (pokyny pro něj jsou dole v části Pokyny pro Clauda). Ručně: nainstaluj [Node.js](https://nodejs.org) 20 nebo novější, stáhni repo a v jeho složce spusť `npm run setup`.

Instalace pustí Merora Desktop na pozadí, nastaví klávesu pro mikrofon odkudkoli a otevře Meroru v Chromu. Tam tě provede úvod: jazyk (předvyplněný podle prohlížeče), jak ti má říkat, město pro počasí, zkouška Clauda, propojení Merory, zdroje, hlas a nakonec tlačítko **Nainstalovat Meroru jako aplikaci** (vlastní ikona v Docku nebo na hlavním panelu). Při prvním poslechu se Chrome zeptá na mikrofon.

## Propojení

Všechno jde i později v nastavení (ozubené kolečko vpravo nahoře, ukáže se, když pohneš myší). Nastavení má vlevo části: **Účet** (s jakým účtem Merora je propojená, Odpojit, jazyk, jak ti má říkat), **Shrnutí** (délka, počet zazvonění, nová data), **Hlas**, **Propojení** (zdroje), **Pravidla** (pevná pravidla a tvoje vlastní, třeba „Maily od účetní jsou vždycky důležité“) a **O aplikaci** (verze a aktualizace, nahlášení problému, úvod znovu, licence). Poslední položka **Zpětná vazba** otevře nástěnku Merora Desktop v UserJotu.

**Aktualizace:** Merora Desktop se jednou denně podívá na GitHub, jestli je nová verze. Když ano, nahoře v okně se ukáže **Nová verze … · Co je nového** a v nastavení v části O aplikaci co je nového a tlačítko **Aktualizovat**. To stáhne novou verzi (při instalaci přes git posune složku na nové vydání, jinak rozbalí archiv vydání) a Merora se sama restartuje, okno se načte znovu. Klíče, nastavení a data zůstávají. Kdo má ve složce vlastní úpravy, dostane jen upozornění, ať aktualizuje ručně (`git pull`).

- **Merora:** v úvodu nebo v nastavení u Merory klikni na **Propojit s účtem Merora**. V prohlížeči se otevře stránka Merory s QR kódem, naskenuješ ho telefonem a propojení potvrdíš v appce Merora. Okno Merory to pak samo pozná a načte nová data. Merora Desktop najdeš v appce v Nastavení › Připojené aplikace, kde jde odpojit, a změny z počítače telefon dostane hned. Opačně taky: připomínka přidaná nebo smazaná v telefonu (nebo přes Clauda) se v okně ukáže hned, protože Merora dá Desktopu o každé změně vědět, a kdyby zpráva nedošla, nejpozději do minuty (volba Merora hned po změně v nastavení). Číst jde s každým účtem, měnit s Merora Pro.
- **Gmail:** v Claudovi Nastavení › Konektory › Gmail. Meri v něm jen hledá a čte, nic nepošle, nesmaže ani neoznačí jako přečtené.
- **Kalendář:** odkaz na kalendář ve formátu iCal vlož v úvodu nebo v nastavení u Kalendáře. Kdo odkaz má, vidí kalendář, tak ho nikomu neposílej.
  - Google: Kalendář na webu › Nastavení › tvůj kalendář › Tajná adresa ve formátu iCal.
  - Apple (iCloud): v appce Kalendář na Macu pravým na kalendář › Sdílet kalendář › zaškrtni Veřejný kalendář › zkopíruj odkaz (začíná webcal://). Na iCloud.com totéž přes ikonu sdílení u kalendáře.
  - Outlook: Outlook.com › Nastavení › Kalendář › Sdílené kalendáře › Publikovat kalendář › Může zobrazit všechny podrobnosti › Publikovat › odkaz ICS. U firemního účtu to může mít správce vypnuté.
- **Počasí:** stačí město v úvodu.
- **Hlas:** založ si účet u [ElevenLabs](https://elevenlabs.io) (Starter stačí), vytvoř API klíč s právy na Text to Speech a Voices a vlož ho v úvodu nebo v nastavení. Meri pak mluví svým hlasem: česky Jana, anglicky Hope (obě z ElevenLabs). Hlas se přepne s jazykem. Kredity stojí jen věty, které si opravdu pustíš: data se načítají bez hlasu a namluví se, až si shrnutí pustíš. Hlas vypneš a zapneš i reproduktorem vlevo nahoře.

Klíče a odkazy zůstávají jen na tvém počítači (soubor `.env` ve složce Merora Desktop), nastavení v `~/.meri/settings.json`.

## Jak se používá

Otevři Meroru (ikona aplikace Merora, nebo `http://127.0.0.1:4747/`). Otevřená aplikace si nachystá dnešní shrnutí: mladší než 3 hodiny se použije hned, starší se nejdřív posbírá (minuta až dvě, bublina mezitím píše „Chystám tvoje ráno…“). Než vznikne první shrnutí, ukazuje Meri ukázkový den.

Ve shrnutí Meri mluví jen o připomínkách a událostech s časem na dnešek, ty jsou v plánu dne nahoře podle času. Připomínky bez času (Kdykoli, jen s místem, seznamy) v plánu dne nejsou, včerejší nedodělané jen s volbou pod nimi, a Meri o nich nemluví. Zeptat se na ně jde vždycky.

Když je v plánu dne víc než 6 věcí, rozdělí se na stránky po 6 (nejvýš 4 stránky, 24 věcí) a pod plánem dne jsou puntíky. Okno ukazuje stránku s nejbližší další věcí, jinou ukáže klik na puntík nebo šipka ←/→ a po 30 s se vrátí. Během shrnutí Meri projde všechny stránky: z každé řekne asi dvě nejdůležitější věci (stránka se při tom ukáže), řekne, že je toho víc, a co nezaznělo, okno po shrnutí ukáže po 3 s.

- **Mezerník** pustí shrnutí od začátku. Když od napsání shrnutí něco s časem na dnešek přibylo, zmizelo nebo se přesunulo (v Meroře nebo v kalendáři), Meri nejdřív napíše nové věty nad aktuálními daty (pár vteřin, maily se znovu nenačítají). S hlasem se pak namluví jen nové věty, po třech naráz.
- **Délka shrnutí:** v nastavení v části Shrnutí normální (2 až 8 vět, asi půl minuty) nebo krátké (2 až 4 věty, asi 15 vteřin, jen dnešek s časem, co z mailů spěchá a počasí, když z něj něco plyne). Platí od dalšího přehrání: věty se před ním přepíšou. Pod tím **V plánu dne ukazovat**: jen dnešní věci, nebo i včerejší nedodělané (hned za dnešními, Meri o nich nemluví, starší se neukazují). A volba **Říkat, kolikrát připomínka zvonila** (výchozí vypnutá: Meri jen řekne, že to ještě hotové není, počet zůstane v plánu dne). Jak se Meri chová, co umí a co ne, je v [PRAVIDLA.md](PRAVIDLA.md).
- **Nová data:** když je okno otevřené, Meri si je načte sama, potichu a bez hlasu. Připomínky z Merory hned po změně: Merora pošle zprávu o každé změně a okno ji ukáže během vteřiny. Pro jistotu se čtou i při otevření okna, když se k němu vrátíš z jiné aplikace nebo do něj klikneš, při ⌥M / Alt+M a jinak každou minutu, s fungující zprávou z Merory každých pět minut (volba **Merora hned po změně** v nastavení, výchozí zapnutá, jde jen s propojeným účtem). Kalendář a počasí zhruba každou čtvrthodinu. Maily a ostatní podle nastavení každou hodinu až jednou denně, nebo jen ručně (pak i kalendář a počasí jen ručně). Ručně kdykoli **R** nebo šipkou vpravo nahoře. Plán dne a počasí se přepíšou na místě a nic nepřeruší, ani mluvící Meri, ani rozhovor. S časem se přepíše i barva připomínky, která už zazvonila (oranžová podle stejného pravidla jako v appce: čas proběhl nebo už zazvonila, kromě připomínky s časem i místem, dokud na místo nedorazíš, a seznamu, ve kterém nic nezbývá), a dlaždice „Zbývá“ a „Další v …“. Když si během načítání pustíš shrnutí, Meri počká na nová data.
- **Mikrofon zapínáš ty:** tlačítko vlevo dole, **M** v okně, nebo **⌥M** (Mac) / **Alt+M** (Windows) v jakékoli aplikaci. Bez otevřeného okna ho klávesa otevře, nachystá dnešní shrnutí a pak zapne mikrofon. Řekni „Jak to dnes vypadá?“ a Meri řekne shrnutí.
- **Po shrnutí se zapnutým mikrofonem** Meri poslouchá a můžeš s ní mluvit. Rozloučení („díky“, „to je vše“, „takhle vše“, „zatím nic“, „stačí“, „konec“, „ahoj“, „dobrou noc“, anglicky „thanks“, „that's all“, „bye“) nebo 45 s ticha mikrofon vypne.
- **Esc** přeskočí zbytek shrnutí, v rozhovoru ho ukončí a vypne mikrofon.

| Klávesa | Co dělá |
|---|---|
| Mezerník | shrnutí od začátku |
| R | načíst nová data (při natáčení zpět na začátek) |
| M | mikrofon zapnout / vypnout |
| Esc | přeskočit shrnutí, ukončit rozhovor |
| ← / → | během shrnutí o sekundu zpět / dopředu, jinak stránky plánu dne |
| F | celá obrazovka |

Zvuk i poslech běží i v okně schovaném za jinou aplikací. Když máš Meroru otevřenou ve dvou oknech, poslouchá jen jedno (Chrome pustí rozpoznávání řeči jen jednomu): to, do kterého jsi naposledy klikl, a po jeho zavření to druhé. Kurzor, kolečko nastavení, šipka nových dat a reproduktor zmizí, když se myš chvíli nehýbe.

### Dnes a Zítra

V hlavičce okna vedle data je přepínač **Dnes / Zítra**. Zítra ukáže připomínky a události na zítřek, předpověď počasí a co z mailů spěchá. Plán zítřka je po přepnutí hned, co Meri řekne, se chystá na pozadí (asi 20 s). Meri sama nemluví: shrnutí pustí mezerník. Zítřek se pak obnovuje jako dnešek (ručně nebo podle intervalu), Merora, kalendář a počasí živě. V nastavení (Shrnutí) jde zapnout **Chystat i zítřek předem** a **Mluvit o počasí**. Nové okno začíná dneškem.

V plánu dne jsou připomínky (i s místem) a události s časem na ten den, celodenní a volitelně včerejší nedodělané. Kdykoli, připomínky jen s místem, prázdné seznamy a rutiny bez času v plánu dne nejsou, ledaže si věc z Kdykoli přeješ vlastním pravidlem v nastavení („Cvičení mi zobrazuj každý den, i když ho mám v Kdykoli“). Nahoře jsou dlaždice Připomínky, Kalendář a Maily (s doplňky nejvýš 5), co se načítá, má kolečko.

### Co Meri umí v rozhovoru

Na otázky typu „co mě čeká zítra“ odpovídá z Merory i z kalendáře na dnešek a dalších 7 dní (kalendář se pro rozhovor stahuje nejvýš jednou za čtvrthodinu).

- **odpovědět na otázku k připomínkám a ke shrnutí:** „co mám zítra?“, „kdy mám zubaře?“, „co jsem včera udělal?“, „jaké je počasí?“, „kolik bylo chyb?“. Meri vidí všechny otevřené připomínky na kterýkoli den a posledních sto hotových;
- **říct víc o mailech:** „a co ty ostatní?“, „od koho je ten o Androidu?“, „co píše Dropbox?“, ze všech nepřečtených, které Meri ráno prošla;
- **přesunout připomínku:** „přesuň mi natáčení na třetí hodinu“, „vrať to“;
- **založit novou připomínku:** „připomeň mi zítra v devět zavolat mámě“, „vrať to“ ji zase smaže;
- **smazat připomínku:** „smaž zubaře“. Meri se nejdřív zeptá („Mám smazat zubaře v pondělí v deset?“) a smaže až po „ano“, u opakované se zeptá, jestli jen tuhle, nebo celé opakování. „Vrať to“ smazanou jednorázovou založí znovu. Seznamy a navázané úkoly se mažou jen v appce;
- **po každé změně z počítače** (přesun, nová, smazaná, odškrtnutá) se nad mikrofonem ukáže, jestli ji telefon převzal: „Posílám do telefonu…“, pak „V telefonu ✓“. Když ji telefon nepřevezme (appka v mobilu vyhozená z přepínače), Meri napíše „Telefon změnu nepřevzal, otevři Meroru v mobilu“ a telefonu přijde upozornění, ať Meroru otevřeš;
- **odškrtnout připomínku:** „odškrtni zubaře“, „volání tátovi je hotové“. Meri ji hned označí jako hotovou (u opakované jen dnešní výskyt) a z plánu dne zmizí, telefon to dostane hned. Celý seznam neodškrtává. „vrať to“ ji vrátí mezi otevřené a zpátky do plánu dne (jako Vrátit v Hotových v appce);
- **přidat do seznamu, který v Meroře máš:** „přidej do nákupního seznamu chleba a máslo“, „dej na seznam Vánoce dárek pro mámu“, „vrať to“, a zeptat se, co v něm je. Pravidla jsou stejná jako u hlasu v appce Merora: do seznamu jen se slovem seznam nebo jeho jménem („kup lepenku“ je připomínka), co tam už je, se podruhé nepřidá, odškrtnutá věc se znovu otevře. Nový seznam Meri nezakládá, ten si založ v appce;
- **zopakovat:** „zopakuj mi to poslední“, „co jsi říkala?“ zopakuje poslední odpověď (hned po shrnutí jeho poslední větu), „zopakuj to od začátku“ pustí znovu celé shrnutí;
- **pustit shrnutí:** „jak to dnes vypadá?“ (když jsou data starší než interval z nastavení, nejdřív načte nová).

Každá změna (přesun, nová, smazaná) se hned ukáže v okně v plánu dne, stejně jako změny z telefonu. Meri v rozhovoru vidí aktuální připomínky, i ty přidané v telefonu během něj. Přesun, nová připomínka, smazání a seznamy jdou přes propojení s účtem Merora a potřebují Merora Pro. Přes konektor v Claudovi Meri jen čte.

## Soukromí

- Merora Desktop běží jen na tvém počítači a server poslouchá jen na 127.0.0.1.
- Mikrofon zapínáš ty. Poslouchá rozpoznávání řeči v Chromu, takže zvuk jde Googlu, ale jen se zapnutým mikrofonem a jen když Meri zrovna nemluví. Co slyšelo, se na obrazovce nevypisuje.
- Shrnutí a odpovědi píše Claude přes tvoje Claude Code. Dostane jen to, co je potřeba: názvy a časy připomínek, počasí a u mailů předmět, jméno nebo firmu odesílatele a krátce, o čem jsou. Maily nejdřív projde rychlý model, který je jen roztřídí; adresy ani celý text mailu dál nejdou a jména lidí Meri ve shrnutí neříká, jen když se zeptáš. Řádek na obrazovce musí vycházet z dat a pojistka v `tools/brief.mjs` odmítne e-maily, odkazy, telefony, adresy a tokeny.
- Hlas namlouvá ElevenLabs, dostane jen věty, které Meri řekne.

## Pokyny pro Clauda

Když tě uživatel požádá o instalaci Merora Desktop:

1. Zjisti systém a zkontroluj `node --version` (potřeba je 20 nebo novější). Když Node chybí, nainstaluj ho: Mac `brew install node` (bez Homebrew mu dej odkaz na instalátor z nodejs.org), Windows `winget install OpenJS.NodeJS.LTS`. Zkontroluj, že má Google Chrome.
2. Stáhni repo do jeho domovské složky: `git clone https://github.com/ghibellinir/merora-desktop ~/merora-desktop`. Bez gitu stáhni a rozbal `https://github.com/ghibellinir/merora-desktop/archive/refs/heads/main.zip`.
3. Ve složce merora-desktop spusť `npm run setup` a počkej, až otevře Chrome.
4. Řekni mu, ať v Chromu projde úvod. Meroru propojí v úvodu tlačítkem Propojit s účtem Merora (QR kód, potvrzení v telefonu), Gmail v Claudovi (Nastavení › Konektory), kalendář a klíč ElevenLabs vloží sám v úvodu. Klíče, hesla a odkazy nikam neopisuj, nevkládej je za něj a nevypisuj je.
5. Když instalace hlásí chybu, přečti `~/.meri/server.log` a oprav jen to, co se týká instalace.

## Pro vývojáře

**Vydání nové verze:** zvedni `version` v `package.json`, commitni, označ `vX.Y.Z` a na GitHubu z toho udělej vydání s popisem, co je nového (`gh release create vX.Y.Z --notes "…"`). Popis vydání se lidem ukáže v nastavení. Aktualizace bere vydání z repa, odkud je instalace (`git remote origin`), jinak z `ghibellinir/merora-desktop` (`tools/update.mjs`, na zkoušky `MERI_UPDATE_API`, `MERI_UPDATE_REPO`, `MERI_UPDATE_STATE`).

| Příkaz | Co dělá |
|---|---|
| `npm start` | server a okno na `http://127.0.0.1:4747` (po instalaci běží na pozadí, druhý se nespustí) |
| `npm run setup` | kontrola Node a Clauda, server na pozadí, klávesa, otevře Meroru v Chromu |
| `npm test` | zkušební sada: vymyšlení lidé ze složky `personas/`, shrnutí a rozhovor nanečisto proti pravidlům (`PRAVIDLA.md`), jen limity Clauda |
| `npm run background` | jen server na pozadí (Mac launchd `app.merora.meri`, Windows složka Po spuštění s hlídačem `tools/watchdog.mjs`), `-- --uninstall` odinstaluje |
| `npm run hotkey` | jen klávesa pro mikrofon (Mac ⌥M přes `tools/hotkey.swift`, potřebuje Command Line Tools; Windows Alt+M přes `tools/hotkey-windows.ps1`), `-- --uninstall` odinstaluje |
| `npm run brief` | ranní shrnutí do `data/brief.json` (mimo git) bez hlasu, `--dry-run` jen vypíše, `-- --sentences` jen nové věty nad uloženými daty (kalendář, počasí a Merora načtené znovu, maily a doplňky z minula) |
| `npm run voice` | namluví věty všemi hlasy z `data/voices.json` (platí se v ElevenLabs) |
| `npm run video` | natáčení: druhý server na `http://127.0.0.1:4748/` s vymyšleným dnem z `data/video.json`, skutečná data se nečtou |
| `npm run reminder -- "Text" --when "RRRR-MM-DD HH:MM"` | připomínka do Merory přes propojení s účtem (tlačítko v nastavení) |

Restart serveru po změně kódu na Macu: `launchctl kickstart -k gui/$(id -u)/app.merora.meri`. Logy: `~/.meri/server.log` a `~/.meri/hotkey.log`.

### Zdroje

| Zdroj (`id`) | Co | Přístup | Výchozí |
|---|---|---|---|
| Merora (`merora`) | otevřené připomínky, seznamy a hotové | propojení s účtem (OAuth, tlačítko v nastavení), bez něj konektor Merory v Claudovi | zapnutý |
| Kalendář (`calendar`) | dnešní události, jen název a čas, obnova zhruba každou čtvrthodinu | tajný odkaz iCal, uložený jako `GOOGLE_CALENDAR_ICAL` v `.env` | zapnutý |
| Počasí (`weather`) | teplota a šance na srážky z Open-Meteo (CC-BY 4.0), obnova zhruba každou čtvrthodinu | bez klíče, město z nastavení, jinak Praha | zapnutý |
| Gmail (`gmail`) | nepřečtené maily za 7 dní v Doručené poště bez Propagace, Sociálních sítí, Fór a hromadné pošty (odkaz na odhlášení, newsletter, přehled; s hvězdičkou nebo označené jako důležité zůstanou): kolik jich je, co spěchá a co je důležité, ostatní na doptání | konektor Gmail v Claudovi, jen hledání a čtení vláken | zapnutý |

Konektory se hledají podle adresy serveru v `claude mcp list` (každý si je může pojmenovat jinak) a výsledek nástroje se čte přímo z proudu událostí Claude Code (`withTool` a `callTool` v `tools/ai.mjs`), ne z převyprávění modelem. Zdroj, který selže, se přeskočí a v nastavení je u něj „Minule se nenačetl“; shrnutí nevznikne, jen když selžou všechny. Každý zdroj je jeden modul v `tools/sources/` (tvar popisuje `tools/sources/index.mjs`), volby jdou přepsat v `~/.meri/settings.json`, třeba `"gmail": { "enabled": false }`.

Zdroj s `noAI: true` (kalendář, počasí) se obnovuje zvlášť, bez Clauda, zhruba každou čtvrthodinu. Merora přes propojení s účtem se čte zvlášť ještě častěji (`readMeroraNow` v `server.mjs`): hned po signálu z Merory (`tools/realtime.mjs`, Supabase Realtime, soukromý kanál `user:<id účtu>`, událost `changed`; vlastní klient WebSocket bez závislostí, Node 20 ho nemá) a jako záloha po minutě, se signálem po pěti minutách. Nová data takového zdroje přepíšou plán dne a kartu počasí na místě (`tools/live.mjs`) a věty se přepíšou, až si shrnutí někdo pustí. Co se počítá za změnu, říká `fingerprint(data)` zdroje.

Další zdroje jdou přidat jako doplňky ([docs/addons.md](docs/addons.md)): moduly ve složce `dev/sources` (nebo v `MERORA_ADDONS`), které jádro načte samo a které navíc řeknou, co z nich dostane model a co se ukáže v okně (dlaždice, panel, řádek do Dnes). Jádro nic z doplňků nepotřebuje a bez nich jede dál. Kdo je propojený s účtem Merora, čte přímo; `MERI_MERORA=connector` to vypne a čte se přes konektor.

### Jak je to poskládané

- `server.mjs`: místní server bez závislostí. Drží společný stav (průběh shrnutí, rozhovor, mikrofon) a posílá ho oknu přes `/events`. Podle časové osy (`public/timeline.js`) ví, kdy Meri dořekne shrnutí, a se zapnutým mikrofonem pak sám otevře rozhovor.
- `public/app.js`: okno. `public/meri.js` je jeho základ: spojení se serverem, smyčka, neuron, přehrávání (věty naplánované na hodiny zvuku), poslech v Chromu a klávesy. `public/settings.js` je nastavení, `public/welcome.js` úvod.
- `tools/brief.mjs` ranní shrnutí (a s `--sentences` jen nové věty), `tools/live.mjs` živá data (plán dne a počasí po nových datech jednoho zdroje), `tools/dialog.mjs` rozhovor, `tools/ai.mjs` volání `claude -p` (na Windows `claude.exe`) a konektory, `tools/voice.mjs` a `tools/elevenlabs.mjs` hlas.
- `data/brief.json` (nebo ukázkové `data/sample.json`, při natáčení `data/video.json`) je všechno, co se smí objevit na obrazovce. Navíc v něm jsou data zdrojů, ze kterých vzniklo (`sourceData`, a `sentencesFingerprint`, otisk dat, nad kterými vznikly věty): podle nich server pozná změnu a napíše nové věty bez nového sběru. Okno je nedostane.

**Jazyky:** čeština a angličtina (`language` v `~/.meri/settings.json`, `LANGUAGES` v `tools/settings.mjs`). Texty serveru, dlaždic, hlášek a pevných odpovědí Meri jsou v `tools/i18n.mjs` (`tr`, odpovědi rozhovoru přidává `tools/dialog.mjs` přes `addTexts`), texty okna v `public/i18n.js` (`t`). Pokyny pro model jsou v obou jazycích vedle sebe (`briefSystemEn` v `tools/brief.mjs`, `conversationSystemEn` v `tools/dialog.mjs`), třídění mailů píše popisy v jazyce Meri. Rychlá cesta rozhovoru bez modelu umí anglicky jen rozloučení, „undo“, zopakování a ano/ne na smazání, přesun slovy jen česky. Každý jazyk má svůj hlas: `ELEVENLABS_VOICE_ID` (čeština) a `ELEVENLABS_VOICE_ID_EN` v `.env`, výchozí je první hlas jazyka v `data/voices.json` (`language`, bez něj čeština). Rozpoznávání řeči v Chromu `cs-CZ` / `en-US`, datum a čas `cs-CZ` / `en-GB`, časové pásmo podle počítače (`MERI_TZ` přepíše). Zkušební sada má anglické lidi (`personas/9-*`, `10-*`).

Na zkoušky: `?t=14.5` zastaví okno v daném čase, `?silent=1` ztiší zvuk, `?nomic=1` nikdy neposlouchá a v konzoli `__meri.heard('jak to dnes vypadá')` pošle větu, jako by ji slyšel mikrofon. Server jde pustit s jiným shrnutím (`MERI_DATA`), nastavením (`MERI_SETTINGS`), souborem `.env` (`MERI_ENV`) a bez Clauda (`MERI_CLAUDE=/usr/bin/false`).

## Licence

Kód je pod licencí [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0) (soubor `LICENSE`). Smíš ho stáhnout, používat (i v práci) a upravovat. Nesmíš s ním ale nabízet nic, co konkuruje Meroře, a to ani zdarma, takže ani upravenou kopii ke stažení nebo na prodej. Neuron Merory a ikony (`public/mascot/`, `public/icon-*.png`) pod licenci nespadají a smí se používat jen jako součást Merora Desktop. Licence nedává žádná práva ke jménům Merora a Meri.
