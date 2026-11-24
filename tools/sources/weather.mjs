// Počasí z Open-Meteo, zdarma a bez klíče. Místo je město z nastavení, jinak MERI_WEATHER=šířka,délka v .env. Bez nich
// se počasí neukazuje (Riccardo 24. 11.).
import { weather, place } from '../weather.mjs';
import { tr } from '../i18n.mjs';
import { notConnected } from './not-connected.mjs';

export default {
  id: 'weather',
  title: 'Počasí',
  description: 'Teplota a šance na srážky',
  en: { title: 'Weather', description: 'Temperature and chance of rain' },
  icon: 'cloud',
  connection: { kind: 'free' },
  boxes: ['weather'],
  noAI: true, // obnovuje se zvlášť zhruba každou čtvrthodinu (server.mjs)
  problem: () => (place() ? null : tr('weatherMissing')),
  collect: async () => {
    if (!place()) throw notConnected(tr('weatherMissing'));
    return weather();
  },
};
