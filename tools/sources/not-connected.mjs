// Zdroj, který člověk ještě nepropojil (kalendář bez odkazu, počasí bez města, Merora nebo Gmail bez konektoru).
// Není to chyba: sběr ho vynechá, jako by byl vypnutý (bez boxu a bez „nenačetlo se“). Co chybí, řekne problem().
export const notConnected = (message) => Object.assign(new Error(message), { notConnected: true });
