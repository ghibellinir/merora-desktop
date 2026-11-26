// Úvod při prvním otevření: oslovení a rod, město, Claude Code, Merora, zdroje, hlas, aplikace v Docku.
// Projde se jednou (uvitano v ~/.meri/settings.json), znovu jde spustit z nastavení („Projít úvod znovu“).
// Ve videu se neukazuje.
import { esc, icon, isInstalled, canInstall, install, post } from '/meri.js';
import { CONNECT_NOTE, waitForConnection, clickOnSource, sourcesHtml, languageField } from '/settings.js';
import { setLanguage, lang, t } from '/i18n.js';

const onMac = /Mac/i.test(navigator.platform || navigator.userAgent);
const onWindows = /Win/i.test(navigator.platform || navigator.userAgent);
// Klávesa odkudkoli (npm run hotkey): Mac ⌥M, Windows Alt+M, jinde jen M v okně.
const hotkeyAnywhere = onMac ? '⌥M' : onWindows ? 'Alt+M' : null;

// Kde úvod skončil: okno otevřené znovu (zavřený Chrome, nainstalovaná aplikace) v něm pokračuje a nezačíná od začátku
// (25. 11.: tester musel úvod projít dvakrát). Jen pohodlí v tomhle prohlížeči, bez úložiště začne od začátku.
const PROGRESS = 'merora-welcome-step';
const progress = {
  get: () => {
    try {
      return Number(localStorage.getItem(PROGRESS)) || 0;
    } catch {
      return 0;
    }
  },
  set: (value) => {
    try {
      if (value === null) localStorage.removeItem(PROGRESS);
      else localStorage.setItem(PROGRESS, String(value));
    } catch {}
  },
};

// Vrátí se, až se úvod zavře (hned, když se neukazuje). Hodnota: přepnul se v úvodu nějaký zdroj?
export async function welcome({ again = false } = {}) {
  let snapshot = await (await fetch('/api/settings')).json();
  if (snapshot.video || (!again && snapshot.profile.welcomed) || document.querySelector('.welcome')) return;
  let sourcesChanged = false;
  // Jazyk úvodu: uložený, a když ho nový uživatel ještě nevybral, podle prohlížeče (čeština a slovenština česky,
  // jinak anglicky). Výběr v prvním kroku přepne texty hned; uloží se s prvním krokem nebo při zavření úvodu.
  const fromBrowser = /^(cs|sk)\b/i.test(navigator.language ?? '') ? 'cs' : 'en';
  setLanguage(snapshot.languageChosen === false && !snapshot.profile.welcomed ? fromBrowser : snapshot.language ?? lang());

  const overlay = document.createElement('div');
  overlay.className = 'settings welcome';
  overlay.innerHTML = `
    <div class="dialog-box" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header>
        <h2 id="welcome-title"></h2>
        <button type="button" class="close" aria-label="${t('welcomeClose')}">${icon('cross', 22)}</button>
      </header>
      <div class="step" id="welcome-step"></div>
      <p class="caption error" id="welcome-error" role="alert"></p>
      <footer>
        <div class="dots" id="welcome-dots" aria-hidden="true"></div>
        <button type="button" class="button secondary" id="welcome-back">${t('back')}</button>
        <button type="button" class="button" id="welcome-next">${t('next')}</button>
      </footer>
    </div>`;
  document.body.append(overlay);
  const $ = (id) => overlay.querySelector(`#${id}`);
  const error = (text = '') => {
    $('welcome-error').textContent = text;
  };
  // Jazyk na server, když se liší od uloženého, nebo ho nový uživatel ještě nevybral (předvyplněný z prohlížeče).
  const saveLanguage = async () => {
    if (snapshot.language === lang() && snapshot.languageChosen !== false) return true;
    const { ok, data } = await post('/api/settings', { language: lang() });
    if (!ok) return error(data.error ?? t('saveFailed')), false;
    snapshot = data;
    return true;
  };

  const steps = [
    {
      title: () => t('welcomeHiTitle'),
      body: () => `
        <p>${t('welcomeHi')}</p>
        <p class="caption">${t('welcomeHiNote')}</p>
        ${languageField('welcome-language')}`,
      // Jiný jazyk: texty úvodu hned v něm (na server až s Další nebo zavřením).
      onAny: () => {
        $('welcome-language').addEventListener('change', (e) => {
          setLanguage(e.target.value);
          render();
          $('welcome-language').focus();
        });
      },
      next: saveLanguage,
    },
    {
      title: () => t('welcomeNameTitle'),
      body: () => `
        <label class="field"><span>${t('salutationField')}</span>
          <input id="welcome-salutation" maxlength="40" autocomplete="off" value="${esc(snapshot.profile.salutation)}"></label>
        <p class="caption">${t('salutationNote')}</p>
        <fieldset class="field"><legend>${t('genderLabel')}</legend>
          <label class="option-row"><input type="radio" name="welcome-gender" value="male" ${snapshot.profile.gender !== 'female' ? 'checked' : ''}> ${t('genderMale')}</label>
          <label class="option-row"><input type="radio" name="welcome-gender" value="female" ${snapshot.profile.gender === 'female' ? 'checked' : ''}> ${t('genderFemale')}</label>
        </fieldset>`,
      next: async () => {
        const gender = overlay.querySelector('input[name="welcome-gender"]:checked')?.value ?? 'male';
        const { ok, data } = await post('/api/settings', { profile: { salutation: $('welcome-salutation').value, gender } });
        if (!ok) return error(data.error ?? t('saveFailed')), false;
        snapshot = data;
        return true;
      },
    },
    {
      title: () => t('welcomeCityTitle'),
      body: () => `
        <label class="field"><span>${t('cityLabel')}</span>
          <input id="welcome-city" maxlength="80" autocomplete="off" value="${esc(snapshot.profile.city ?? '')}"></label>
        <p class="caption" id="welcome-city-note">${t('cityNote')}</p>`,
      // Prázdné pole je prázdné (25. 11.: šedý příklad „Praha“ vypadal vyplněně) a tlačítko řekne, co se tím stane.
      button: () => ($('welcome-city').value.trim() ? t('next') : t('nextWithoutCity')),
      onAny: () => {
        $('welcome-city').addEventListener('input', () => {
          $('welcome-next').textContent = steps[i].button();
        });
      },
      // Nalezené město se ukáže k potvrzení: druhé „Další“ pokračuje, jiný název se hledá znovu.
      next: async () => {
        const city = $('welcome-city').value.trim();
        if (city === (snapshot.profile.city ?? '')) return true;
        const { ok, data } = await post('/api/settings', { profile: { city } });
        if (!ok) return error(data.error ?? t('saveFailed')), false;
        snapshot = data;
        if (!city) return true; // smazané město: bez počasí
        $('welcome-city').value = snapshot.profile.city;
        $('welcome-city-note').textContent = t('cityFound', { city: snapshot.profile.city });
        return false;
      },
    },
    {
      title: () => t('welcomeClaudeTitle'),
      body: () => `
        <p>${t('welcomeClaude')}</p>
        <button type="button" class="button" id="welcome-claude">${t('tryClaude')}</button>
        <p class="caption" id="welcome-claude-note" role="status"></p>`,
      onAny: () => {
        $('welcome-claude').addEventListener('click', async () => {
          const caption = $('welcome-claude-note');
          caption.className = 'caption';
          caption.textContent = t('trying');
          const { data } = await post('/api/claude');
          caption.className = data.ok ? 'caption done' : 'caption warning';
          caption.textContent = data.ok ? t('claudeWorks') : t('claudeFailed');
        });
      },
    },
    {
      title: () => t('welcomeMeroraTitle'),
      body: () => {
        // Propojená: hlavní je, že je hotovo, propojit znovu jde jen malým odkazem (25. 11.: tester s velkým
        // tlačítkem propojoval dál, protože to vypadalo nedokončeně).
        const merora = snapshot.sources.find((z) => z.id === 'merora');
        if (merora?.connected && !merora.problem) {
          return `
        <p class="connected" role="status">${icon('check', 24)}<span>${t('meroraConnected')}</span></p>
        <p>${t('meroraConnectedNext')}</p>
        <a class="quiet-link" href="/oauth/start" target="_blank">${t('connectAgain')}</a>`;
        }
        return `
        <p>${t('welcomeMerora')}</p>
        <ol class="steps">
          <li>${t('welcomeMeroraStep1')}</li>
          <li>${t('welcomeMeroraStep2')}</li>
        </ol>
        <a class="button" id="welcome-merora" href="/oauth/start" target="_blank">${t('connectMerora')}</a>
        <p class="caption" id="welcome-merora-note" role="status"></p>
        <p class="caption">${t('welcomeMeroraNote')}</p>`;
      },
      onAny: () => {
        $('welcome-merora')?.addEventListener('click', () => {
          $('welcome-merora-note').textContent = CONNECT_NOTE();
          waitForConnection('merora', (fresh) => {
            snapshot = fresh;
            if ($('welcome-merora-note')) render(); // jinak je úvod už jinde
          });
        });
      },
    },
    {
      title: () => t('welcomeSourcesTitle'),
      body: () => `
        <div id="welcome-sources">${sourcesHtml(snapshot.sources, 'welcome')}</div>
        <p class="caption">${t('welcomeSourcesNote')}</p>`,
      onAny: () => {
        $('welcome-sources').addEventListener('click', async (e) => {
          const result = await clickOnSource(e);
          if (!result) return;
          if (result.connecting) {
            error('');
            waitForConnection(result.connecting, (fresh) => {
              snapshot = fresh;
              if ($('welcome-sources')) $('welcome-sources').innerHTML = sourcesHtml(snapshot.sources, 'welcome');
            });
            return;
          }
          if (result.data.sources) snapshot = result.data;
          if (result.changed) sourcesChanged = true;
          if (result.keep) return error('');
          $('welcome-sources').innerHTML = sourcesHtml(snapshot.sources, 'welcome');
          error(result.ok ? '' : result.data.error);
        });
      },
    },
    {
      title: () => t('welcomeVoiceTitle'),
      body: () =>
        snapshot.hasKey
          ? `<div class="option">
              <div class="description"><div class="title" id="welcome-voice-title">${t('speakAloud')}</div>
              <div class="caption">${t('welcomeVoiceNote')}</div></div>
              <button type="button" class="switch" id="welcome-voice" role="switch" aria-checked="${snapshot.voice}" aria-labelledby="welcome-voice-title"><span class="knob"></span></button>
            </div>`
          : `<p>${t('welcomeNoKey')}</p>
            <label class="field"><span>${t('keyOptional')}</span>
              <input id="welcome-key" type="password" autocomplete="off" placeholder="sk_…"></label>
            <p class="caption">${t('keyLocal')}</p>`,
      onAny: () => {
        $('welcome-voice')?.addEventListener('click', async () => {
          const { data } = await post('/api/settings', { voice: $('welcome-voice').getAttribute('aria-checked') !== 'true' });
          if (data.sources) snapshot = data;
          $('welcome-voice').setAttribute('aria-checked', String(snapshot.voice));
        });
      },
      next: async () => {
        const key = $('welcome-key')?.value.trim();
        if (!key) return true;
        const { ok, data } = await post('/api/key', { key });
        if (!ok) return error(data.error ?? t('keySaveFailed')), false;
        snapshot = data;
        return true;
      },
    },
    {
      title: () => t('welcomeDoneTitle'),
      body: () => `
        <ul class="keys">
          <li>${t('keysMic', { anywhere: hotkeyAnywhere ? t('keysMicAnywhere', { key: hotkeyAnywhere }) : '' })}</li>
          <li>${t('keysSpace')}</li>
          <li>${t('keysRefresh')}</li>
          ${snapshot.voice ? `<li>${t('keysVoice')}</li>` : ''}
        </ul>
        ${!isInstalled() ? `<div class="install">
          <button type="button" class="button" id="welcome-install">${t('installMerora')}</button>
          <p class="caption" id="welcome-install-note">${onMac ? t('installNoteMac') : t('installNoteOther')}</p>
        </div>` : ''}`,
      onAny: () => {
        const button = $('welcome-install');
        if (!button) return;
        button.addEventListener('click', async () => {
          if (canInstall()) {
            if (await install()) $('welcome-install-note').textContent = t('installed');
            return;
          }
          $('welcome-install-note').textContent = t('installHow');
        });
      },
      button: () => t('start'),
    },
  ];

  let i = again ? 0 : Math.min(Math.max(progress.get(), 0), steps.length - 1);
  const render = () => {
    const k = steps[i];
    if (!again) progress.set(i);
    // Na posledním kroku je úvod hotový: okno nainstalované aplikace ho už neukáže znovu.
    if (i === steps.length - 1) post('/api/settings', { welcomed: true });
    $('welcome-title').textContent = k.title();
    $('welcome-step').innerHTML = k.body();
    k.onAny?.();
    error();
    $('welcome-back').hidden = i === 0;
    // Pevné části okna znovu: jazyk se v prvním kroku může přepnout.
    $('welcome-back').textContent = t('back');
    overlay.querySelector('.close').setAttribute('aria-label', t('welcomeClose'));
    $('welcome-next').textContent = k.button?.() ?? (i === 0 ? t('letsGo') : t('next'));
    $('welcome-dots').innerHTML = steps.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('');
    (overlay.querySelector('input:not([type="radio"])') ?? $('welcome-next')).focus();
  };
  let closed;
  // Esc zavře úvod, ať je ohnisko kdekoli (klik do textu ho z okna úvodu vezme).
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  };
  const close = async () => {
    removeEventListener('keydown', onKey);
    await saveLanguage(); // i po zavření v prvním kroku, ať server mluví jazykem, který byl vidět
    await post('/api/settings', { welcomed: true });
    progress.set(null);
    overlay.remove();
    closed(sourcesChanged);
  };

  $('welcome-back').addEventListener('click', () => {
    i = Math.max(0, i - 1);
    render();
  });
  $('welcome-next').addEventListener('click', async () => {
    const button = $('welcome-next');
    button.disabled = true;
    try {
      if (steps[i].next && !(await steps[i].next())) return;
      if (i === steps.length - 1) return close();
      i += 1;
      render();
    } finally {
      button.disabled = false;
    }
  });
  overlay.querySelector('.close').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input:not([type="radio"])')) return;
    // V řádku zdroje Enter uloží odkaz, jinde pokračuje na další krok.
    (e.target.closest('.link')?.querySelector('.save-link') ?? $('welcome-next')).click();
  });
  addEventListener('keydown', onKey);
  render();
  return new Promise((finished) => {
    closed = finished;
  });
}
