// Hlídač serveru pro Windows: pustí server.mjs a když spadne, za 10 s ho pustí znovu (na Macu to dělá launchd).
// Spouští ho po přihlášení skript ve složce Po spuštění (npm run background). Bez okna, log v ~/.meri/server.log.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 4747);
mkdirSync(join(homedir(), '.meri'), { recursive: true });
const log = createWriteStream(join(homedir(), '.meri', 'server.log'), { flags: 'a' });

// Už běží jiný server Meri (třeba spuštěný ručně)? Pak hlídač nic nedělá.
const occupied = () =>
  new Promise((finished) => {
    const s = createConnection({ host: '127.0.0.1', port: PORT });
    s.once('connect', () => (s.destroy(), finished(true)));
    s.once('error', () => finished(false));
  });

async function startService() {
  if (await occupied()) {
    log.write(`${new Date().toISOString()} Server Merora Desktop už běží, hlídám dál.\n`);
    setTimeout(startService, 60_000);
    return;
  }
  // MERI_SUPERVISED: server po aktualizaci jen skončí a hlídač ho pustí znovu (tools/update.mjs).
  const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], { cwd: ROOT, windowsHide: true, env: { ...process.env, MERI_SUPERVISED: '1' } });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  server.on('exit', (code) => {
    log.write(`${new Date().toISOString()} Server Merora Desktop skončil (${code}), za 10 s ho pustím znovu.\n`);
    setTimeout(startService, 10_000);
  });
}

startService();
