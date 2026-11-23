// Počasí z Open-Meteo, zdarma a bez klíče. Místo je MERI_WEATHER=šířka,délka v .env, výchozí Praha.
import { weather } from '../weather.mjs';

export default {
  id: 'weather',
  title: 'Počasí',
  description: 'Teplota a šance na srážky',
  en: { title: 'Weather', description: 'Temperature and chance of rain' },
  icon: 'cloud',
  connection: { kind: 'free' },
  boxes: ['weather'],
  noAI: true, // obnovuje se zvlášť zhruba každou čtvrthodinu (server.mjs)
  collect: () => weather(),
};
