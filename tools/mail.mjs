// Maily z víc schránek (Gmail, Outlook): každá je svůj zdroj, okno a Meri je ukazují dohromady jako jednu poštu.
// Bez dalších modulů, ať si ho může vzít kdokoli (tools/pending.mjs, tools/sources/index.mjs).
export const MAIL_SOURCES = ['gmail', 'outlook'];
export const isMail = (id) => MAIL_SOURCES.includes(id);
export const hasMail = (sourceData) => MAIL_SOURCES.some((id) => id in (sourceData ?? {}));
export const importantMail = (m) => Boolean(m.important || m.urgent || m.tester);

export const MAILBOX_NAMES = { gmail: 'Gmail', outlook: 'Outlook' };

// Pořadí v poště: spěchající, od testerů a důležité první, pak nejnovější (at je čas přijetí).
export const mailWeight = (m) => (m.urgent ? 4 : 0) + (m.tester ? 2 : 0) + (m.important ? 1 : 0);

// Pošta z dat zdrojů: { count, more, mails }, null když se žádná schránka nenačetla, undefined když žádná není.
// missing: schránky, které se nenačetly, když jiná ano. unreadKnown: false = aspoň jedna schránka nepozná přečtené (Outlook přes konektor), takže to nejsou jen nepřečtené.
export function inboxOf(sourceData) {
  if (!hasMail(sourceData)) return undefined;
  const loaded = MAIL_SOURCES.map((id) => [id, sourceData[id]]).filter(([, box]) => box);
  if (!loaded.length) return null;
  // Která schránka se nenačetla, když jiná ano: okno ani Meri nesmí tvrdit, že to je celá pošta.
  const missing = MAIL_SOURCES.filter((id) => sourceData[id] === null);
  if (loaded.length === 1) return missing.length ? { ...loaded[0][1], missing } : loaded[0][1];
  return {
    count: loaded.reduce((sum, [, box]) => sum + box.count, 0),
    more: loaded.some(([, box]) => box.more),
    ...(loaded.some(([, box]) => box.unreadKnown === false) ? { unreadKnown: false } : {}),
    mails: loaded
      .flatMap(([id, box]) => box.mails.map((m) => ({ ...m, src: m.src ?? id })))
      .sort((a, b) => mailWeight(b) - mailWeight(a) || (b.at ?? 0) - (a.at ?? 0))
      .map((m, i) => ({ ...m, id: `m${i + 1}` })),
  };
}

// Kolik mailů je z které schránky (po vypnutí jedné z nich okno odečte její).
export const mailCounts = (sourceData) => Object.fromEntries(MAIL_SOURCES.filter((id) => sourceData[id]).map((id) => [id, sourceData[id].count]));
