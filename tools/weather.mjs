// Počasí z Open-Meteo (zdarma, bez klíče, licence CC-BY 4.0).
import { loadEnv } from './elevenlabs.mjs';
import { profile, language } from './settings.mjs';
import { tr } from './i18n.mjs';

const BASE = process.env.MERI_WEATHER_URL || 'https://api.open-meteo.com';

// Kódy WMO podle dokumentace Open-Meteo.
function description(code) {
  if (code === 0) return tr('clear');
  if (code <= 2) return tr('partlyCloudy');
  if (code === 3) return tr('overcast');
  if (code <= 48) return tr('fog');
  if (code <= 67) return tr('rain');
  if (code <= 77) return tr('snow');
  if (code <= 82) return tr('showers');
  if (code <= 86) return tr('snowShowers');
  return tr('storm');
}

export async function weather() {
  // Město z nastavení (úvod nebo „O tobě“), jinak MERI_WEATHER=šířka,délka v .env, jinak Praha.
  const location = profile().location;
  const [latitude, longitude] = location ? [location.latitude, location.longitude] : (loadEnv().MERI_WEATHER || '50.08,14.44').split(',');
  const q = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', // podle místa, ať dny sedí i mimo Česko
    forecast_days: '2',
  });
  const res = await fetch(`${BASE}/v1/forecast?${q}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Počasí vrátilo chybu ${res.status}.`);
  const { current, daily } = await res.json();
  return {
    temperature: Math.round(current.temperature_2m),
    description: description(current.weather_code),
    lowest: Math.round(daily.temperature_2m_min[0]),
    highest: Math.round(daily.temperature_2m_max[0]),
    precipitation_chance: daily.precipitation_probability_max[0],
    // Zítřek: pro „jaké bude zítra počasí“ v rozhovoru a večerní shrnutí.
    ...(daily.time?.length > 1
      ? {
          tomorrow: {
            description: description(daily.weather_code[1]),
            lowest: Math.round(daily.temperature_2m_min[1]),
            highest: Math.round(daily.temperature_2m_max[1]),
            precipitation_chance: daily.precipitation_probability_max[1],
          },
        }
      : {}),
  };
}

// Město podle názvu přes geokódování Open-Meteo (zdarma, bez klíče). Vrátí { mesto, sirka, delka }, nebo null.
export async function findCity(task) {
  // Hledá se jen název, bez země za čárkou („Brno, Česko“ → „Brno“).
  const title = task.split(',')[0].trim();
  const base = process.env.MERI_GEO_URL || 'https://geocoding-api.open-meteo.com';
  const q = new URLSearchParams({ name: title, count: '10', language: language(), format: 'json' });
  const res = await fetch(`${base}/v1/search?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Hledání města vrátilo chybu ${res.status}.`);
  const results = (await res.json()).results ?? [];
  // „Mělník“ vrátí nejdřív bulharský Melnik (250 obyvatel). Přednost má přesné jméno i s háčky,
  // Česko a Slovensko a větší místo (bez háčků napsaný „Melnik“ tak najde taky Mělník).
  const exact = (m) => m.name.toLowerCase() === title.toLowerCase();
  const body = (m) => (exact(m) ? 1 : 0) + (['CZ', 'SK'].includes(m.country_code) ? 2 : 0) + Math.log10((m.population ?? 0) + 1) / 2;
  const m = results.sort((a, b) => body(b) - body(a))[0];
  if (!m) return null;
  return { city: [m.name, m.country].filter(Boolean).join(', '), latitude: m.latitude, longitude: m.longitude };
}
