// Aktualizace Merora Desktop (Riccardo 21. 11.: „ano, s upozorněním“). Server jednou denně zjistí na GitHubu
// nejnovější vydání (GitHub Releases, značka vX.Y.Z, popis = co je nového). Když je novější než verze
// v package.json, okno ukáže upozornění a v nastavení tlačítko Aktualizovat. Aktualizace:
// - instalace přes git (složka .git): git fetch a posun na značku vydání jen dopředu (merge --ff-only). Kdo má
//   ve složce vlastní úpravy, dostane jen upozornění, ať aktualizuje ručně (nic se mu nepřepíše);
// - instalace ze ZIPu: stáhne archiv vydání a rozbalí ho přes složku (tar umí Mac i Windows 10+).
// Klíče (.env), shrnutí a hlas jsou mimo git, aktualizace na ně nesahá. Po aktualizaci se server restartuje
// (server.mjs) a okno se samo načte znovu. Na GitHub jde jen dotaz na vydání, s obecným User-Agentem.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATE = process.env.MERI_UPDATE_STATE || join(homedir(), '.meri', 'update.json');
const API = process.env.MERI_UPDATE_API || 'https://api.github.com';
const DEFAULT_REPO = 'ghibellinir/merora-desktop';
const DAY_MS = 24 * 3600 * 1000;
const HEADERS = { 'User-Agent': 'merora-desktop', Accept: 'application/vnd.github+json' };

export const currentVersion = () => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
};

// a > b podle čísel verze (1.10.0 > 1.9.2). Přípony jako -beta se neberou v potaz.
export function newer(a, b) {
  const parts = (v) => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const isGit = () => existsSync(join(ROOT, '.git'));
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

// Odkud brát vydání: z adresy repa, ze kterého je instalace (git), jinak veřejné repo Merora Desktop.
function repoName() {
  if (process.env.MERI_UPDATE_REPO) return process.env.MERI_UPDATE_REPO;
  if (isGit()) {
    try {
      const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(git(['remote', 'get-url', 'origin']));
      if (m) return m[1];
    } catch {}
  }
  return DEFAULT_REPO;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}
function writeState(state) {
  try {
    mkdirSync(dirname(STATE), { recursive: true });
    writeFileSync(STATE, JSON.stringify(state, null, 2));
  } catch {}
}

// Má instalace vlastní úpravy? Jen změněné soubory v gitu (nové soubory jako .env nebo data ne).
export function ownChanges() {
  if (!isGit()) return false;
  try {
    return git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0;
  } catch {
    return false;
  }
}

// Zjistí nejnovější vydání. Nejvýš jednou denně (force: hned, tlačítko v nastavení). Repo bez vydání nebo
// soukromé repo (vývoj) vrátí 404: pak žádná aktualizace. Chyba sítě nic nemaže, zkusí se to příště.
export async function checkForUpdate({ force = false } = {}) {
  const saved = readState();
  if (!force && saved.checkedAt && Date.now() - Date.parse(saved.checkedAt) < DAY_MS) return saved;
  try {
    const res = await fetch(`${API}/repos/${repoName()}/releases/latest`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    let latest = null;
    if (res.ok) {
      const r = await res.json();
      latest = {
        version: String(r.tag_name ?? '').replace(/^v/, ''),
        tag: r.tag_name,
        notes: String(r.body ?? '').trim().slice(0, 2000),
        url: r.html_url ?? null,
        tarball: r.tarball_url ?? null,
        publishedAt: r.published_at ?? null,
      };
    } else if (res.status !== 404) {
      throw new Error(`GitHub odpověděl ${res.status}`);
    }
    const state = { checkedAt: new Date().toISOString(), latest };
    writeState(state);
    return state;
  } catch (err) {
    return { ...saved, error: err.message };
  }
}

// Co ukázat v okně: novější vydání, nebo null.
export function updateInfo() {
  const latest = readState().latest;
  const current = currentVersion();
  if (!latest?.version || !newer(latest.version, current)) return null;
  return { version: latest.version, current, notes: latest.notes ?? '', url: latest.url ?? null, ownChanges: ownChanges() };
}

const fileHash = (file) => {
  try {
    return createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
  } catch {
    return null;
  }
};
const hotkeyFiles = () => ['tools/hotkey.swift', 'tools/hotkey-windows.ps1'].map(fileHash).join('|');

// Stáhne a nainstaluje nejnovější vydání. Vrátí novou verzi, nebo vyhodí chybu s větou pro okno.
export async function applyUpdate() {
  const info = updateInfo();
  if (!info) throw new Error('Máš nejnovější verzi.');
  const { latest } = readState();
  const hotkeyBefore = hotkeyFiles();
  if (isGit()) {
    if (ownChanges()) throw new Error('Ve složce máš vlastní úpravy. Aktualizuj ručně: git pull.');
    try {
      git(['fetch', '--tags', '--force', 'origin']);
      git(['merge', '--ff-only', `refs/tags/${latest.tag}`]);
    } catch (err) {
      throw new Error(`Aktualizace přes git se nepovedla (${String(err.stderr || err.message).trim().split('\n')[0]}). Aktualizuj ručně: git pull.`);
    }
  } else {
    if (!latest.tarball) throw new Error('Vydání nemá archiv ke stažení.');
    const dir = mkdtempSync(join(tmpdir(), 'merora-update-'));
    try {
      const res = await fetch(latest.tarball, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`stažení: ${res.status}`);
      const archive = join(dir, 'release.tar.gz');
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
      const unpacked = spawnSync('tar', ['-xzf', archive, '-C', dir], { windowsHide: true });
      if (unpacked.status !== 0) throw new Error('rozbalení archivu');
      const top = readdirSync(dir, { withFileTypes: true }).find((d) => d.isDirectory());
      if (!top) throw new Error('archiv je prázdný');
      cpSync(join(dir, top.name), ROOT, { recursive: true, force: true });
    } catch (err) {
      throw new Error(`Aktualizace se nepovedla (${err.message}). Zkus to později.`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // Nová klávesa pro mikrofon se musí znovu nainstalovat (na Macu se pomocník překládá ze zdrojáku).
  if (hotkeyFiles() !== hotkeyBefore) {
    spawnSync(process.execPath, [join(ROOT, 'tools', 'install.mjs'), 'hotkey'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  }
  return currentVersion();
}
