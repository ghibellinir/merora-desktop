// Ozubené kolečko v rohu okna a okno nastavení: O tobě, hlas, zdroje, načtení nových dat, úvod a instalace.
// Kolečko je vidět, jen když se hýbe myší, jako kurzor. Bez klíče ElevenLabs nebo s vypnutým hlasem Meri jen píše.
// Změna zdrojů se ukáže po zavření okna: okno se načte znovu, až Meri domluví.
import { esc, icon, canInstall, install, post } from '/meri.js';
import { lang, locale, t } from '/i18n.js';

// Řádky zdrojů s přepínači, stejné v nastavení i v úvodu. predpona drží id v dokumentu jedinečná.
// Chybějící odkaz (kalendář) jde vložit rovnou v řádku, účet (Merora) propojit jedním tlačítkem.
export const sourcesHtml = (sources, prefix) =>
  sources
    .map((z) => {
      // Co chybí, má smysl jen u zapnutého zdroje (vypnutý zdroj nového uživatele nezajímá).
      const problem = z.enabled ? z.problem : null;
      const note = problem ?? (z.failed ? t('sourceFailed') : z.connected ? t(z.link ? 'sourceLinked' : 'sourceConnected') : z.connector ? t('sourceConnector') : '');
      const id = `${prefix}-zdroj-${esc(z.id)}`;
      // Propojený a funguje: zeleně, a propojit znovu jen malým odkazem. Tlačítko je jen tam, kde je co udělat.
      const fine = z.connected && !problem && !z.failed;
      // Odkaz: chybějící nebo takový, který se minule nenačetl, má pole rovnou. Uložený jde změnit a odpojit (25. 11.:
      // tester uložil špatný odkaz, pole zmizelo a kalendář už propojit nešel).
      const askLink = !z.connected || z.failed;
      const link =
        z.link && z.enabled
          ? `<div class="link-form"${askLink ? '' : ' hidden'}><div class="link">
              <input type="url" autocomplete="off" placeholder="https://…" aria-label="${esc(t('sourceLink', { title: z.title }))}">
              <button type="button" class="button save-link" data-source="${esc(z.id)}">${t('save')}</button>
            </div><div class="caption warning link-error" role="alert"></div>${guides(z, id)}</div>${
              z.connected
                ? `<div class="link-actions">
              ${askLink ? '' : `<button type="button" class="button secondary edit-link">${t('changeLink')}</button>`}
              <button type="button" class="button secondary remove-link" data-source="${esc(z.id)}">${t('disconnect')}</button>
            </div>`
                : ''
            }`
          : '';
      const checkable = z.checkable
        ? `<button type="button" class="button secondary check" data-source="${esc(z.id)}">${t('check')}</button>`
        : '';
      // Otevře se v prohlížeči (stránka Merory s QR kódem), okno pak samo pozná, že je propojeno.
      const connect = z.connect
        ? `<a class="${fine ? 'quiet-link' : `button${z.connected && !problem ? ' secondary' : ''}`} connect" href="${esc(z.connect.address)}" target="_blank" data-source="${esc(z.id)}">${esc(z.connected ? t('connectAgain') : z.connect.text)}</a>`
        : '';
      return `
      <div class="option source">
        <div class="tile blue">${icon(z.icon, 20)}</div>
        <div class="description">
          <div class="title" id="${id}">${esc(z.title)}</div>
          <div class="caption">${esc(z.description)}${note ? `<br><span class="${problem || z.failed ? 'warning' : fine ? 'done' : ''}">${esc(note)}</span>` : ''}</div>
          ${link}${checkable}${connect}
        </div>
        <button type="button" class="switch" role="switch" data-source="${esc(z.id)}" aria-checked="${z.enabled}" aria-labelledby="${id}"><span class="knob"></span></button>
      </div>`;
    })
    .join('');

// Kde se odkaz vezme: pro každou službu zvlášť, rozbalí se jen ta, kterou člověk má (25. 11.: v jednom odstavci začínal
// „Google:“ a kalendář vypadal, že umí jen Google). Doplněk může mít jen jednu větu (hint).
const guides = (z, id) => {
  if (!z.guides?.length) return z.hint ? `<div class="caption">${esc(z.hint)}</div>` : '';
  return `<div class="guides"><div class="caption">${t('linkWhere')}</div>${z.guides
    .map((g) => `<details name="${id}-guide"><summary>${esc(g.name)}</summary><div class="caption">${esc(g.text)}</div></details>`)
    .join('')}${z.help ? `<a class="quiet-link" href="${esc(z.help)}" target="_blank" rel="noopener">${t('linkHelp')}</a>` : ''}</div>`;
};

// Kliknutí v řádcích zdrojů (nastavení i úvod): přepínač, uložení odkazu, kontrola nebo propojení účtu.
// Vrací { ok, data, changed, connecting, keep } (changed = okno se po zavření načte znovu, connecting = id zdroje,
// na jehož propojení se čeká, keep = řádky nepřekreslovat, ať nezmizí vložený odkaz), nebo null, když není co dělat.
export async function clickOnSource(e) {
  const connect = e.target.closest('.connect[data-source]');
  // Propojený účet znovu (malý odkaz): jen se otevře stránka, není na co čekat.
  if (connect) return connect.classList.contains('quiet-link') ? null : { ok: true, data: {}, changed: false, connecting: connect.dataset.source };
  const toggle = e.target.closest('.switch[data-source]');
  if (toggle) {
    const { ok, data } = await post('/api/settings', {
      source: toggle.dataset.source,
      enabled: toggle.getAttribute('aria-checked') !== 'true',
    });
    return { ok, data, changed: ok };
  }
  const saveButton = e.target.closest('.save-link');
  if (saveButton) {
    // Server odkaz nejdřív zkusí stáhnout. Když to kalendář není, pole zůstane, jak je, ať jde opravit.
    saveButton.disabled = true;
    saveButton.textContent = t('checking');
    const { ok, data } = await post('/api/source/link', { source: saveButton.dataset.source, link: saveButton.previousElementSibling.value });
    saveButton.disabled = false;
    saveButton.textContent = t('save');
    // Proč to nejde, je hned pod polem. Zdroje se nepřekreslují, ať odkaz v poli zůstane.
    saveButton.closest('.link-form').querySelector('.link-error').textContent = ok ? '' : data.error ?? t('saveFailed');
    return { ok, data, changed: ok, keep: !ok };
  }
  const edit = e.target.closest('.edit-link');
  if (edit) {
    const form = edit.closest('.description').querySelector('.link-form');
    form.hidden = false;
    edit.remove();
    form.querySelector('input').focus();
    return null;
  }
  const remove = e.target.closest('.remove-link');
  if (remove) {
    // Druhé kliknutí potvrzuje, jako u odpojení účtu.
    if (remove.dataset.sure === undefined) {
      remove.dataset.sure = '';
      remove.textContent = t('reallyDisconnect');
      return null;
    }
    const { ok, data } = await post('/api/source/link', { source: remove.dataset.source, remove: true });
    return { ok, data, changed: ok };
  }
  const checkable = e.target.closest('.check');
  if (checkable) {
    checkable.disabled = true;
    checkable.textContent = t('checking');
    const { ok, data } = await post('/api/source/check', { source: checkable.dataset.source });
    return { ok, data, changed: false };
  }
  return null;
}

// Texty podle jazyka okna (public/i18n.js), proto funkce: moduly se načtou dřív, než okno jazyk zná.
const SOURCES_NOTE = () => t('sourcesNote');
export const CONNECT_NOTE = () => t('connectNote');

// Výběr jazyka v nastavení (O tobě) i v úvodu. Popisek a jména jazyků jsou v obou jazycích stejné, ať se v nich
// vyzná každý.
const LANGUAGE_NAMES = { cs: 'Čeština', en: 'English' };
export const languageField = (id, selected = lang()) => `
  <label class="field"><span>Jazyk / Language</span>
    <select id="${id}">${Object.entries(LANGUAGE_NAMES)
      .map(([value, name]) => `<option value="${value}" lang="${value}"${value === selected ? ' selected' : ''}>${name}</option>`)
      .join('')}</select></label>`;
// Po přepnutí jazyka v nastavení se okno načte znovu a nastavení se otevře na stejném místě (jen pohodlí).
const REOPEN_STORAGE = 'merora-settings-reopen';

// Po kliknutí na Propojit: každé 2 s se zeptá, jestli už je zdroj propojený (nejvýš 10 minut, tolik platí
// žádost v Meroře). hotovo dostane nový stav nastavení.
let pollTimer = null;
export function waitForConnection(id, finished) {
  clearInterval(pollTimer);
  const end = Date.now() + 10 * 60_000;
  pollTimer = setInterval(async () => {
    if (Date.now() > end) return clearInterval(pollTimer);
    const snapshot = await (await fetch('/api/settings')).json().catch(() => null);
    // Propojení, které skončilo (problem), se počítá až po novém souhlasu.
    const source = snapshot?.sources?.find((z) => z.id === id);
    if (!source?.connected || source.problem) return;
    clearInterval(pollTimer);
    finished(snapshot);
  }, 2000);
}

// Okno se načte znovu (třeba se zdroji, které se právě přepnuly), až Meri nic nechystá ani neříká.
// Do té doby se to zkouší každé 3 s, nejvýš 5 minut.
export async function redraw(attempt = 0) {
  const { status } = await post('/api/redraw');
  if (status === 409 && attempt < 100) setTimeout(() => redraw(attempt + 1), 3000);
}

// Zpětná vazba z počítače jde na vlastní nástěnku v UserJotu (Merora Desktop), z telefonu na nástěnku Merora.
// Riccardo tak vidí, odkud hlášení je, a lidi nic psát nemusí (rozhodnuto 21. 11.).
const BOARD = 'https://merora.userjot.com/feedback/merora-desktop';

// Části nastavení vlevo, jako v nastavení Clauda (Riccardo 21. 11.).
// title: klíč textu v public/i18n.js.
const SECTIONS = [
  { id: 'account', title: 'sectionAccount', icon: 'user' },
  { id: 'brief', title: 'sectionBrief', icon: 'text' },
  { id: 'voice', title: 'sectionVoice', icon: 'speaker' },
  { id: 'connections', title: 'sectionConnections', icon: 'plug' },
  { id: 'rules', title: 'sectionRules', icon: 'rules' },
  { id: 'app', title: 'sectionApp', icon: 'info' },
];

// Pevná pravidla z PRAVIDLA.md: vlastní pravidlo je nepřebije a hlídá je i kód. Klíče textů v public/i18n.js.
const FIXED_RULES = ['fixedRuleTimed', 'fixedRuleData', 'fixedRuleDelete', 'fixedRuleReadOnly', 'fixedRulePrivate', 'fixedRuleInstructions'];
const SECTION_STORAGE = 'merora-settings-section';

// „dnes 7:05“, jinak „18. 11. 7:05“ (anglicky „today at 7:05“, „18 Nov at 7:05“).
function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t('whenToday', { time });
  return t('whenDate', { day: d.getDate(), month: d.getMonth() + 1, monthName: d.toLocaleDateString('en-GB', { month: 'short' }), time });
}

export function settingsWindow() {
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'gear';
  gear.setAttribute('aria-label', t('settings'));
  gear.innerHTML = icon('gear', 24);
  const overlay = document.createElement('div');
  overlay.className = 'settings';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="dialog-box section-window" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header>
        <h2 id="settings-title">${t('settings')}</h2>
        <button type="button" class="close" aria-label="${t('close')}">${icon('cross', 22)}</button>
      </header>
      <div class="content-body">
        <nav class="menu" aria-label="${t('settingsSections')}">
          ${SECTIONS.map((s) => `<button type="button" class="menu-item" data-section="${s.id}">${icon(s.icon, 18)}<span>${t(s.title)}</span></button>`).join('')}
          <a class="menu-item menu-link" href="${BOARD}" target="_blank" rel="noopener">${icon('message', 18)}<span>${t('feedback')}</span><span class="external" aria-hidden="true">${icon('external', 14)}</span></a>
        </nav>
        <div class="content">
          <section data-section="account">
            <h3 class="first">${t('meroraAccount')}</h3>
            <div class="account">
              <div class="tile blue">${icon('user', 20)}</div>
              <div class="description">
                <div class="title" id="account-title"></div>
                <div class="caption" id="account-note"></div>
              </div>
            </div>
            <div class="row" id="account-buttons">
              <a class="button connect" id="account-connect" href="/oauth/start" target="_blank" data-source="merora">${t('connectMerora')}</a>
              <button type="button" class="button secondary" id="account-disconnect" hidden>${t('disconnect')}</button>
            </div>
            <h3>${t('aboutYou')}</h3>
            ${languageField('profile-language')}
            <label class="field"><span>${t('salutationLabel')}</span><input id="profile-salutation" maxlength="40" autocomplete="off"></label>
            <div class="caption">${t('salutationNote')}</div>
            <label class="field"><span>${t('genderLabel')}</span>
              <select id="profile-gender"><option value="male">${t('genderMale')}</option><option value="female">${t('genderFemale')}</option></select></label>
            <label class="field"><span>${t('cityLabel')}</span><input id="profile-city" maxlength="80" autocomplete="off"></label>
            <div class="caption">${t('cityExample')}</div>
            <div class="row"><button type="button" class="button" id="profile-save">${t('save')}</button><span class="caption" id="profile-note" role="status"></span></div>
          </section>
          <section data-section="brief" hidden>
            <h3 class="first">${t('sectionBrief')}</h3>
            <label class="field"><span>${t('lengthLabel')}</span>
              <select id="brief-length">
                <option value="normal">${t('lengthNormal')}</option>
                <option value="short">${t('lengthShort')}</option>
              </select></label>
            <div class="caption" id="length-note">${t('lengthNote')}</div>
            <label class="field"><span>${t('showInPlan')}</span>
              <select id="show-yesterday">
                <option value="today">${t('showToday')}</option>
                <option value="yesterday">${t('showYesterday')}</option>
              </select></label>
            <div class="caption" id="yesterday-note">${t('yesterdayNote')}</div>
            <div class="option">
              <div class="description">
                <div class="title" id="mention-rings-title">${t('mentionRings')}</div>
                <div class="caption">${t('mentionRingsNote')}</div>
              </div>
              <button type="button" class="switch" id="mention-rings" role="switch" aria-checked="false" aria-labelledby="mention-rings-title"><span class="knob"></span></button>
            </div>
            <div class="option">
              <div class="description">
                <div class="title" id="mention-weather-title">${t('mentionWeather')}</div>
                <div class="caption">${t('mentionWeatherNote')}</div>
              </div>
              <button type="button" class="switch" id="mention-weather" role="switch" aria-checked="true" aria-labelledby="mention-weather-title"><span class="knob"></span></button>
            </div>
            <div class="option">
              <div class="description">
                <div class="title" id="preload-tomorrow-title">${t('preloadTomorrow')}</div>
                <div class="caption">${t('preloadTomorrowNote')}</div>
              </div>
              <button type="button" class="switch" id="preload-tomorrow" role="switch" aria-checked="false" aria-labelledby="preload-tomorrow-title"><span class="knob"></span></button>
            </div>
            <h3>${t('newDataHeading')}</h3>
            <label class="field"><span>${t('refreshLabel')}</span>
              <select id="refresh-interval">
                <option value="1">${t('every1')}</option>
                <option value="2">${t('every2')}</option>
                <option value="3">${t('every3')}</option>
                <option value="6">${t('every6')}</option>
                <option value="12">${t('every12')}</option>
                <option value="24">${t('every24')}</option>
                <option value="0">${t('manualOnly')}</option>
              </select></label>
            <div class="option">
              <div class="description">
                <div class="title" id="merora-live-title">${t('meroraLive')}</div>
                <div class="caption" id="merora-live-note"></div>
              </div>
              <button type="button" class="switch" id="merora-live" role="switch" aria-checked="true" aria-labelledby="merora-live-title"><span class="knob"></span></button>
            </div>
            <div class="refresh-block">
              <button type="button" class="button" id="refresh">${t('loadNow')}</button>
              <div class="caption" id="refresh-note"></div>
            </div>
          </section>
          <section data-section="voice" hidden>
            <h3 class="first">${t('sectionVoice')}</h3>
            <div class="option">
              <div class="description">
                <div class="title" id="voice-title">${t('speakAloud')}</div>
                <div class="caption" id="voice-note"></div>
              </div>
              <button type="button" class="switch" id="voice-switch" role="switch" aria-checked="false" aria-labelledby="voice-title"><span class="knob"></span></button>
            </div>
            <div class="row" id="key-field" hidden>
              <input id="key" type="password" autocomplete="off" placeholder="${t('keyPlaceholder')}" aria-label="${t('keyLabel')}">
              <button type="button" class="button" id="key-save">${t('saveKey')}</button>
            </div>
          </section>
          <section data-section="connections" hidden>
            <h3 class="first">${t('sectionConnections')}</h3>
            <div class="caption">${t('connectionsNote')}</div>
            <div id="sources"></div>
            <p class="note" id="sources-note">${SOURCES_NOTE()}</p>
          </section>
          <section data-section="rules" hidden>
            <h3 class="first">${t('fixedRules')}</h3>
            <ul class="fixed">${FIXED_RULES.map((p) => `<li>${icon('lock', 16)}<span>${esc(t(p))}</span></li>`).join('')}</ul>
            <div class="caption">${t('rulesLengthNote', { link: `<button type="button" class="section-link" data-go="brief">${t('sectionBrief')}</button>` })}</div>
            <h3>${t('ownRules')}</h3>
            <div class="caption">${t('ownRulesNote')}</div>
            <ul class="own" id="rules-list"></ul>
            <div class="row">
              <input id="rule-new" maxlength="200" autocomplete="off" placeholder="${t('newRulePlaceholder')}" aria-label="${t('newRule')}">
              <button type="button" class="button" id="rule-add">${t('add')}</button>
            </div>
            <div class="caption" id="rules-note" role="status"></div>
          </section>
          <section data-section="app" hidden>
            <h3 class="first">Merora Desktop</h3>
            <div class="caption">${t('appAbout')}</div>
            <div class="update-box" id="update-box"></div>
            <div class="row">
              <a class="button" href="${BOARD}" target="_blank" rel="noopener">${t('reportIssue')}</a>
              <button type="button" class="button secondary" id="welcome-again">${t('welcomeAgain')}</button>
              <button type="button" class="button secondary" id="install" hidden>${t('installApp')}</button>
            </div>
            <h3>${t('license')}</h3>
            <div class="caption">${t('licenseNote')}</div>
          </section>
        </div>
      </div>
    </div>`;
  document.body.append(gear, overlay);
  const $ = (id) => overlay.querySelector(`#${id}`);
  let snapshot = null;
  let sourcesChanged = false;
  let waitingForAccount = false; // po kliknutí na Propojit v části Účet, dokud se propojení nepotvrdí
  let confirmDisconnect = 0; // čas, do kdy platí druhé kliknutí na Odpojit

  function renderAccount() {
    const u = snapshot.account;
    $('account-buttons').hidden = !u;
    if (!u) {
      $('account-title').textContent = t('accountHiddenVideo');
      $('account-note').textContent = '';
      return;
    }
    $('account-title').textContent = u.connected ? u.email ?? t('connected') : t('notConnected');
    const merora = snapshot.sources.find((z) => z.id === 'merora');
    const ended = u.connected && merora?.problem;
    if (!waitingForAccount) {
      $('account-note').textContent = ended || (u.connected ? t('accountConnectedNote') : t('accountNotConnectedNote'));
      $('account-note').classList.toggle('warning', Boolean(ended));
    }
    const connect = $('account-connect');
    const fine = u.connected && !ended && !merora?.failed;
    connect.textContent = u.connected ? t('connectAgain') : t('connectMerora');
    connect.className = `${fine ? 'quiet-link' : `button${u.connected && !ended ? ' secondary' : ''}`} connect`;
    $('account-disconnect').hidden = !u.connected;
  }

  function renderRules() {
    const rules = snapshot.rules ?? [];
    $('rules-list').innerHTML = rules
      .map((p, i) => `<li><span>${esc(p)}</span><button type="button" class="delete-rule" data-i="${i}" aria-label="${t('deleteRule')}">${icon('cross', 16)}</button></li>`)
      .join('');
    $('rule-add').disabled = snapshot.video || rules.length >= 10;
    $('rule-new').disabled = snapshot.video || rules.length >= 10;
  }

  function showSection(id) {
    const section = SECTIONS.some((s) => s.id === id) ? id : 'account';
    for (const el of overlay.querySelectorAll('section[data-section]')) el.hidden = el.dataset.section !== section;
    for (const el of overlay.querySelectorAll('.menu-item')) el.setAttribute('aria-current', String(el.dataset.section === section));
    overlay.querySelector('.content').scrollTop = 0;
    try {
      localStorage.setItem(SECTION_STORAGE, section);
    } catch {}
  }

  // Aktualizace (tools/update.mjs): verze, a když je nová, co je nového a tlačítko Aktualizovat.
  function renderUpdate(note = '') {
    const u = snapshot.update;
    $('update-box').innerHTML = u
      ? `<div class="update-title">${esc(t('updateAvailable', { version: u.version, current: u.current }))}</div>
         ${u.notes ? `<div class="update-notes">${esc(u.notes)}</div>` : ''}
         ${u.ownChanges ? `<div class="caption">${t('updateOwnChanges')}</div>` : `<div class="row"><button type="button" class="button" id="update-run">${t('updateRun')}</button></div>`}
         <div class="caption" id="update-note" role="status">${esc(note)}</div>`
      : `<div class="caption">${esc(t('versionN', { version: snapshot.version ?? '' }))} <button type="button" class="link-button" id="update-check">${t('checkUpdates')}</button></div>
         <div class="caption" id="update-note" role="status">${esc(note)}</div>`;
  }

  function render() {
    renderAccount();
    renderRules();
    renderUpdate();
    $('key-field').hidden = snapshot.hasKey;
    $('install').hidden = !canInstall();
    $('voice-switch').setAttribute('aria-checked', String(snapshot.voice));
    $('voice-note').textContent = !snapshot.hasKey ? t('voiceNoteNoKey') : snapshot.voice ? t('voiceNoteOn') : t('voiceNoteOff');
    $('sources').innerHTML = sourcesHtml(snapshot.sources, 'settings');

    const refresh = $('refresh');
    const last = when(snapshot.last);
    $('brief-length').value = snapshot.briefLength ?? 'normal';
    $('brief-length').disabled = snapshot.video;
    $('show-yesterday').value = snapshot.showYesterday ? 'yesterday' : 'today';
    $('show-yesterday').disabled = snapshot.video;
    $('mention-rings').setAttribute('aria-checked', String(Boolean(snapshot.mentionRings)));
    $('mention-rings').disabled = snapshot.video;
    $('mention-weather').setAttribute('aria-checked', String(snapshot.mentionWeather !== false));
    $('mention-weather').disabled = snapshot.video;
    $('preload-tomorrow').setAttribute('aria-checked', String(Boolean(snapshot.preloadTomorrow)));
    $('preload-tomorrow').disabled = snapshot.video;
    $('refresh-interval').value = String(snapshot.refreshHours);
    $('refresh-interval').disabled = snapshot.video;
    refresh.disabled = snapshot.video || snapshot.loading;
    refresh.textContent = snapshot.loading ? t('loading') : t('loadNow');
    const whenLoading = snapshot.refreshHours ? t('refreshAuto') : t('refreshManual');
    $('merora-live').setAttribute('aria-checked', String(snapshot.meroraLive));
    $('merora-live').disabled = snapshot.video;
    $('merora-live-note').textContent = snapshot.video
      ? t('meroraLiveVideo')
      : !snapshot.meroraLive
        ? t('meroraLiveOff')
        : snapshot.meroraLiveAvailable
          ? t('meroraLiveOn')
          : t('meroraLiveUnavailable');
    $('refresh-note').textContent = snapshot.video
      ? t('refreshVideo')
      : `${whenLoading} ${t('refreshCost')}${last ? ` ${t('refreshLast', { when: last })}` : ''}`;
  }

  // Pole „O tobě“ se plní jen při otevření okna a po uložení, ať se nepřepíše, co uživatel zrovna píše.
  function fillProfile() {
    $('profile-language').value = snapshot.language ?? lang();
    $('profile-salutation').value = snapshot.profile.salutation ?? '';
    $('profile-gender').value = snapshot.profile.gender ?? 'male';
    $('profile-city').value = snapshot.profile.city ?? '';
  }

  // Změna nastavení na serveru. Odpověď nese celý nový stav, i když se změna nepovedla.
  async function applyChange(route, body) {
    const { ok, data } = await post(route, body);
    if (data.sources) snapshot = data;
    render();
    return { ok, error: data.error };
  }

  const blink = (el) => {
    el.classList.remove('flash');
    void el.offsetWidth; // znovu spustit zablikání
    el.classList.add('flash');
  };

  function close() {
    overlay.hidden = true;
    // Ohnisko nezůstane na kolečku: mezerník po zavření pouští Meri, ne znovu nastavení.
    document.activeElement?.blur();
    if (sourcesChanged) redraw();
    sourcesChanged = false;
  }

  // Kolečko, nebo upozornění na novou verzi v okně (událost meri-settings s částí, třeba app).
  gear.addEventListener('click', () => openSettings());
  addEventListener('meri-settings', (e) => openSettings(e.detail?.section));
  async function openSettings(section = null) {
    snapshot = await (await fetch('/api/settings')).json();
    $('sources-note').textContent = SOURCES_NOTE();
    $('profile-note').textContent = '';
    waitingForAccount = false;
    $('rules-note').textContent = '';
    fillProfile();
    render();
    let last = 'account';
    try {
      last = localStorage.getItem(SECTION_STORAGE) ?? 'account';
    } catch {}
    showSection(section ?? last);
    overlay.hidden = false;
    overlay.querySelector('.menu-item[aria-current="true"]')?.focus();
  }

  $('profile-save').addEventListener('click', async () => {
    const profile = { salutation: $('profile-salutation').value, gender: $('profile-gender').value, city: $('profile-city').value };
    const { ok, error } = await applyChange('/api/settings', { profile });
    if (ok) fillProfile(); // město tak, jak ho našlo hledání („mělník“ → „Mělník“)
    $('profile-note').textContent = ok ? t('savedNextLoad') : error ?? t('saveFailed');
    $('profile-note').classList.toggle('warning', !ok);
  });

  // Jazyk se uloží hned a okno se načte znovu (statické texty jsou v jazyce okna). Nastavení se pak otevře zase
  // v části Účet. Data v novém jazyce server načte potichu sám.
  $('profile-language').addEventListener('change', async (e) => {
    const language = e.target.value;
    try {
      sessionStorage.setItem(REOPEN_STORAGE, 'account');
    } catch {}
    const { ok, error } = await applyChange('/api/settings', { language });
    if (ok) return location.reload();
    try {
      sessionStorage.removeItem(REOPEN_STORAGE);
    } catch {}
    fillProfile();
    $('profile-note').textContent = error ?? t('saveFailed');
    $('profile-note').classList.add('warning');
  });

  $('key-save').addEventListener('click', async () => {
    const key = $('key').value;
    $('key').value = '';
    const { ok, error } = await applyChange('/api/key', { key });
    if (!ok) $('voice-note').textContent = error ?? t('keySaveFailed');
  });

  $('welcome-again').addEventListener('click', () => {
    close();
    dispatchEvent(new Event('meri-welcome'));
  });

  $('install').addEventListener('click', async () => {
    await install();
    render();
  });

  overlay.querySelector('.close').addEventListener('click', close);

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) return close();
    if (e.target.closest('#update-run')) {
      e.target.closest('#update-run').disabled = true;
      $('update-note').textContent = t('updating');
      const { ok, data: answer } = await post('/api/update');
      if (!ok) {
        e.target.closest('#update-run').disabled = false;
        $('update-note').textContent = answer?.error ?? t('updateFailed');
      }
      return;
    }
    if (e.target.closest('#update-check')) {
      $('update-note').textContent = t('updateChecking');
      const { data: answer } = await post('/api/update/check');
      snapshot = { ...snapshot, update: answer?.update ?? null, version: answer?.version ?? snapshot.version };
      renderUpdate(answer?.error ? t('updateCheckFailed') : answer?.update ? '' : t('upToDate'));
      return;
    }
    // Zpětná vazba v menu je odkaz na nástěnku v UserJotu (Riccardo 23. 11.), ne část nastavení.
    const section = e.target.closest('.menu-item:not(.menu-link), .section-link');
    if (section) return showSection(section.dataset.section ?? section.dataset.go);
    if (e.target.closest('#account-connect:not(.quiet-link)') && snapshot?.account) {
      waitingForAccount = true;
      $('account-note').classList.remove('warning');
      $('account-note').textContent = CONNECT_NOTE();
      waitForConnection('merora', (fresh) => {
        snapshot = fresh;
        waitingForAccount = false;
        sourcesChanged = true;
        render();
        $('account-note').textContent = t('connectedLoading');
      });
      return;
    }
    if (e.target.closest('#account-disconnect') && snapshot) {
      // Odpojení chce druhé kliknutí do 5 s: propojit znovu jde, ale zase přes QR kód v telefonu.
      if (Date.now() > confirmDisconnect) {
        confirmDisconnect = Date.now() + 5000;
        $('account-disconnect').textContent = t('reallyDisconnect');
        setTimeout(() => {
          if (Date.now() > confirmDisconnect) $('account-disconnect').textContent = t('disconnect');
        }, 5100);
        return;
      }
      confirmDisconnect = 0;
      $('account-disconnect').textContent = t('disconnect');
      const { ok, error } = await applyChange('/api/merora/disconnect', {});
      if (ok) sourcesChanged = true;
      $('account-note').textContent = ok ? t('disconnected') : error ?? t('disconnectFailed');
      return;
    }
    const doDelete = e.target.closest('.delete-rule');
    if (doDelete && snapshot) {
      const rules = (snapshot.rules ?? []).filter((_, i) => i !== Number(doDelete.dataset.i));
      const { ok, error } = await applyChange('/api/settings', { rules });
      $('rules-note').textContent = ok ? t('ruleDeleted') : error ?? t('saveFailed');
      return;
    }
    if (e.target.closest('#rule-add') && snapshot) return addRule();
    if (e.target.closest('#mention-weather') && snapshot) {
      await applyChange('/api/settings', { mentionWeather: snapshot.mentionWeather === false });
      return;
    }
    if (e.target.closest('#preload-tomorrow') && snapshot) {
      await applyChange('/api/settings', { preloadTomorrow: !snapshot.preloadTomorrow });
      return;
    }
    if (e.target.closest('#mention-rings') && snapshot) {
      await applyChange('/api/settings', { mentionRings: !snapshot.mentionRings });
      return;
    }
    if (e.target.closest('#merora-live') && snapshot) {
      await applyChange('/api/settings', { meroraLive: !snapshot.meroraLive });
      return;
    }
    if (!e.target.closest('#voice-switch') || !snapshot) return;
    const wanted = $('voice-switch').getAttribute('aria-checked') !== 'true';
    if (wanted && !snapshot.hasKey) return blink($('voice-note'));
    await applyChange('/api/settings', { voice: wanted });
  });

  // Zdroje: přepínač, odkaz na kalendář, propojení Merory.
  $('sources').addEventListener('click', async (e) => {
    const result = await clickOnSource(e);
    if (!result) return;
    if (result.connecting) {
      $('sources-note').textContent = CONNECT_NOTE();
      waitForConnection(result.connecting, (fresh) => {
        snapshot = fresh;
        sourcesChanged = true;
        render();
        $('sources-note').textContent = t('connectedLoading');
      });
      return;
    }
    if (result.data.sources) snapshot = result.data;
    if (result.keep) return;
    render();
    if (result.changed) sourcesChanged = true;
    $('sources-note').textContent = result.ok ? SOURCES_NOTE() : result.data.error ?? t('failed');
    if (!result.ok) blink($('sources-note'));
  });

  async function addRule() {
    const text = $('rule-new').value.replace(/\s+/g, ' ').trim();
    if (!text) return $('rule-new').focus();
    const { ok, error } = await applyChange('/api/settings', { rules: [...(snapshot.rules ?? []), text] });
    if (ok) $('rule-new').value = '';
    $('rules-note').textContent = ok ? t('ruleSaved') : error ?? t('saveFailed');
  }
  $('rule-new').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addRule();
  });

  $('show-yesterday').addEventListener('change', async (e) => {
    const { ok, error } = await applyChange('/api/settings', { showYesterday: e.target.value === 'yesterday' });
    if (!ok) $('yesterday-note').textContent = error ?? t('saveFailed');
  });
  $('brief-length').addEventListener('change', async (e) => {
    const { ok, error } = await applyChange('/api/settings', { briefLength: e.target.value });
    if (!ok) $('length-note').textContent = error ?? t('saveFailed');
  });
  $('refresh-interval').addEventListener('change', async (e) => {
    const { ok, error } = await applyChange('/api/settings', { refreshHours: Number(e.target.value) });
    if (!ok) $('refresh-note').textContent = error ?? t('saveFailed');
  });

  $('refresh').addEventListener('click', async () => {
    const { ok, data } = await post('/api/refresh');
    if (ok) return close();
    snapshot = await (await fetch('/api/settings')).json();
    render();
    $('refresh-note').textContent = data.error ?? t('refreshFailed');
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || overlay.hidden) return;
    e.preventDefault(); // controls() v meri.js pak Esc nechá být a nepřeskočí shrnutí
    close();
  });

  // Po přepnutí jazyka (okno se načetlo znovu) se nastavení otevře zase tam, kde bylo.
  let reopen = null;
  try {
    reopen = sessionStorage.getItem(REOPEN_STORAGE);
    sessionStorage.removeItem(REOPEN_STORAGE);
  } catch {}
  if (reopen) openSettings(reopen);
}
