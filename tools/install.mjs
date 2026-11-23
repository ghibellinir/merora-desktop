// Instalace Meri na Mac i Windows. Jeden příkaz, který spustí i agent podle návodu v README.
//   npm run setup                        kontrola (Node, Claude Code), server na pozadí, klávesa, otevře Meroru v Chromu
//   npm run background [-- --uninstall]  jen server na pozadí od přihlášení
//   npm run hotkey [-- --uninstall]      jen klávesa pro mikrofon odkudkoli (Mac ⌥M, Windows Alt+M)
// Mac: služby launchd v ~/Library/LaunchAgents. Windows: skripty ve složce Po spuštění, bez okna a bez práv správce.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudePath } from './ai.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MERI = join(homedir(), '.meri');
const PORT = 4747;
// ?app=1: po úvodu se nachystá první skutečné shrnutí (stejně jako po otevření nainstalované aplikace).
const MERI_URL = `http://127.0.0.1:${PORT}/app?app=1`;
const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const disable = process.argv.includes('--uninstall');

const matches = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/data`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};
const wait = (ms) => new Promise((finished) => setTimeout(finished, ms));
async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    if (await matches()) return true;
    await wait(400);
  }
  return false;
}

// --- Mac: launchd ---
const domain = () => `gui/${process.getuid()}`;
const plistPath = (service) => join(homedir(), 'Library', 'LaunchAgents', `${service}.plist`);
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function launchdStop(service) {
  spawnSync('launchctl', ['bootout', `${domain()}/${service}`], { stdio: 'ignore' });
}
async function launchdStart(service, { program, workDir, environment = {}, throttle = 10, log }) {
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const env = Object.entries(environment)
    .map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`)
    .join('');
  writeFileSync(
    plistPath(service),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${service}</string>
  <key>ProgramArguments</key><array>${program.map((p) => `<string>${xml(p)}</string>`).join('')}</array>
  ${workDir ? `<key>WorkingDirectory</key><string>${xml(workDir)}</string>` : ''}
  ${env ? `<key>EnvironmentVariables</key><dict>${env}</dict>` : ''}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${throttle}</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`,
  );
  execFileSync('plutil', ['-lint', plistPath(service)], { stdio: 'ignore' });
  launchdStop(service);
  // Hned po zastavení launchd službu chvíli ještě uklízí, tak to zkusí víckrát.
  for (let i = 0; i < 10; i++) {
    if (spawnSync('launchctl', ['bootstrap', domain(), plistPath(service)], { stdio: 'ignore' }).status === 0) return;
    await wait(500);
  }
  throw new Error(`Službu ${service} nejde spustit.`);
}

// Server puštěný ručně (npm start) by službě blokoval port.
function stopManualServer() {
  if (WIN) {
    windowsStop('server.mjs');
    return;
  }
  const pids = spawnSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  for (const pid of pids) {
    const command = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout;
    if (command.includes('server.mjs')) process.kill(Number(pid));
  }
}

// --- Windows: složka Po spuštění ---
const afterStart = () => join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
// VBScript spustí příkaz bez okna. UTF-16 s BOM, ať projdou i cesty s diakritikou.
function windowsLauncher(name, command) {
  const file = join(afterStart(), `${name}.vbs`);
  const line = command.map((p) => `""${p}""`).join(' ');
  const text = `' ${name}: spouští se po přihlášení (npm run setup). Smazáním souboru se vypne.\r\nCreateObject("WScript.Shell").Run "${line}", 0, False\r\n`;
  mkdirSync(afterStart(), { recursive: true });
  writeFileSync(file, Buffer.from(`\ufeff${text}`, 'utf16le'));
  spawn('wscript.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return file;
}
function windowsStop(pattern) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${pattern}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}

// --- Server na pozadí ---
async function background() {
  mkdirSync(MERI, { recursive: true });
  if (MAC) {
    if (disable) {
      launchdStop('app.merora.meri');
      rmSync(plistPath('app.merora.meri'), { force: true });
      return console.log('Server Merora Desktop už na pozadí neběží. Ručně ho pustíš příkazem npm start.');
    }
    stopManualServer();
    // Vedle Node je i claude, který ranní sběr potřebuje. Launchd jinak dává jen systémovou PATH.
    const route = [join(process.execPath, '..'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    await launchdStart('app.merora.meri', {
      program: [process.execPath, join(ROOT, 'server.mjs')],
      workDir: ROOT,
      environment: { PATH: route },
      log: join(MERI, 'server.log'),
    });
  } else if (WIN) {
    const file = join(afterStart(), 'Meri server.vbs');
    windowsStop('watchdog.mjs');
    windowsStop('server.mjs');
    if (disable) {
      rmSync(file, { force: true });
      return console.log('Server Merora Desktop už na pozadí neběží.');
    }
    windowsLauncher('Meri server', [process.execPath, join(ROOT, 'tools', 'watchdog.mjs')]);
  } else {
    return console.log('Server na pozadí umím zatím jen na Macu a Windows. Spusť ho ručně: npm start');
  }
  if (!(await waitForServer())) throw new Error(`Server Merora Desktop neodpovídá, viz ${join(MERI, 'server.log')}`);
  console.log(`Server Merora Desktop běží na pozadí a po přihlášení se spustí sám. Log: ${join(MERI, 'server.log')}`);
}

// --- Klávesa pro mikrofon odkudkoli ---
// Do 23. 11. 2026 se služba, pomocník a log jmenovaly česky (klavesa). Stará instalace se uklidí.
function removeOldHotkey() {
  if (MAC) {
    launchdStop('app.merora.meri.klavesa');
    rmSync(plistPath('app.merora.meri.klavesa'), { force: true });
    rmSync(join(MERI, 'meri-klavesa'), { force: true });
  } else if (WIN) {
    rmSync(join(afterStart(), 'Meri klavesa.vbs'), { force: true });
  }
}

async function hotkey() {
  removeOldHotkey();
  if (MAC) {
    const service = 'app.merora.meri.hotkey';
    const program = join(MERI, 'meri-hotkey');
    if (disable) {
      launchdStop(service);
      rmSync(plistPath(service), { force: true });
      rmSync(program, { force: true });
      return console.log('Klávesa ⌥M pro Meri je vypnutá.');
    }
    if (spawnSync('swiftc', ['--version'], { stdio: 'ignore' }).status !== 0) {
      return console.log('Klávesu ⌥M přeskakuju: chybí Command Line Tools (xcode-select --install). M v okně Merory funguje i bez nich.');
    }
    mkdirSync(MERI, { recursive: true });
    execFileSync('swiftc', ['-O', join(ROOT, 'tools', 'hotkey.swift'), '-o', `${program}.new`], { stdio: 'inherit' });
    renameSync(`${program}.new`, program);
    await launchdStart(service, { program: [program], throttle: 30, log: join(MERI, 'hotkey.log') });
    return console.log('⌥M teď v jakékoli aplikaci zapne a vypne mikrofon Meri. Log: ~/.meri/hotkey.log');
  }
  if (WIN) {
    const file = join(afterStart(), 'Meri hotkey.vbs');
    windowsStop('hotkey-windows.ps1');
    if (disable) {
      rmSync(file, { force: true });
      return console.log('Klávesa Alt+M pro Meri je vypnutá.');
    }
    windowsLauncher('Meri hotkey', [
      'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', join(ROOT, 'tools', 'hotkey-windows.ps1'),
    ]);
    return console.log('Alt+M teď v jakékoli aplikaci zapne a vypne mikrofon Meri. Log: %USERPROFILE%\\.meri\\hotkey.log');
  }
  console.log('Klávesu odkudkoli umím zatím jen na Macu a Windows. V okně Merory funguje M.');
}

// --- Celá instalace ---
async function install() {
  const version = Number(process.versions.node.split('.')[0]);
  if (version < 20) throw new Error(`Merora Desktop potřebuje Node 20 nebo novější, máš ${process.versions.node}.`);
  const claude = spawnSync(claudePath(), ['--version'], { encoding: 'utf8', windowsHide: true });
  if (claude.status !== 0) {
    throw new Error('Nenašla jsem Claude Code. Nainstaluj ho, jednou se v terminálu přihlas příkazem „claude“ a spusť instalaci znovu.');
  }
  console.log(`Claude Code: ${claude.stdout.trim()}`);
  await background();
  await hotkey();
  console.log(`\nHotovo. Otevírám Meroru v Chromu: ${MERI_URL}`);
  console.log('V okně tě provede úvod a na konci Meroru jedním kliknutím nainstaluješ jako aplikaci.');
  if (MAC) spawn('open', ['-a', 'Google Chrome', MERI_URL], { detached: true, stdio: 'ignore' }).unref();
  else if (WIN) spawn('cmd.exe', ['/c', 'start', '', 'chrome', MERI_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// Příkazy z package.json (npm run setup, background, hotkey). České názvy (do 23. 11. 2026) bere kvůli aktualizaci
// ze starší verze: ta po stažení nové verze pouští `install.mjs klavesa` (tools/update.mjs té doby).
const commands = { setup: install, background, hotkey };
const OLD_NAMES = { instalace: 'setup', pozadi: 'background', klavesa: 'hotkey' };
const asked = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'setup';
const command = OLD_NAMES[asked] ?? asked;
try {
  if (!commands[command]) throw new Error(`Neznámý příkaz „${asked}“. Zkus: ${Object.keys(commands).join(', ')}.`);
  await commands[command]();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
