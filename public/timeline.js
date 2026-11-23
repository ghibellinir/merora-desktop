// Časová osa shrnutí: kdy která věta zní. Stejnou počítá okno (meri.js) i server (kdy Meri domluví),
// proto je zvlášť a bez závislostí na prohlížeči.
const START = 0.7; // rezerva na načtení zvuku, než zazní první slovo (dřív se na vytíženém Macu usekl začátek)
const GAP = 0.25; // mezi větami (viz merora-pacing)
// Věta bez namluveného zvuku: 2,8 slova za sekundu.
const estimateDuration = (text) => text.trim().split(/\s+/).length / 2.8;

// delky: { [id věty]: sekundy } z namluveného hlasu (audio/<hlas>/durations.json), nebo null.
export function buildTimeline(sentences, durations = null) {
  let t = START;
  const cues = sentences.map((v) => {
    const cue = { ...v, start: t, end: t + (durations?.[v.id] ?? estimateDuration(v.text)) };
    t = cue.end + (v.gap ?? GAP);
    return cue;
  });
  return { start: START, cues, end: cues.at(-1)?.end ?? START };
}

// Věta drží zvýraznění ještě chvíli po dočtení. Do té doby Meri pořád „mluví“.
export const TAIL = 0.5;
