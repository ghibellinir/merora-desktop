// Volání Claude Code bez interakce. Jde to z limitů plánu, klíč není potřeba.
// Vestavěné nástroje jsou vypnuté a služby se povolují výslovně pro každý dotaz.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(homedir(), '.meri'); // mimo repa, ať se nenačítají cizí instrukce

// Kde je Claude Code. Na Macu a Linuxu stačí „claude“ z PATH. Na Windows se hledá claude.exe (nativní
// instalace v %USERPROFILE%\\.local\\bin, nebo balíček z npm), protože claude.cmd z npm Node bez shellu
// spustit nesmí a se shellem by se rozbily uvozovky v argumentech.
export function claudePath() {
  if (process.env.MERI_CLAUDE) return process.env.MERI_CLAUDE;
  if (process.platform !== 'win32') return 'claude';
  const candidates = [
    ...(process.env.PATH ?? '').split(';').filter(Boolean).map((d) => join(d, 'claude.exe')),
    join(homedir(), '.local', 'bin', 'claude.exe'),
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
  ];
  return candidates.find((k) => existsSync(k)) ?? 'claude.exe';
}

// Rozhovor: jeden proces běží pořád, takže další věta neplatí rozběh a pamatuje si, co zaznělo.
// Bez nástrojů a bez služeb. Co se opravdu stane, rozhoduje a hlídá kód, ne model.
// Bezpečný režim Claude Code (CLAUDE_CODE_SAFE_MODE): bez hooků, pluginů, CLAUDE.md a dalších vlastních
// úprav uživatele. Proces naběhne asi o 1,5 s dřív a do rozhovoru se nedostane cizí kontext (třeba text, který
// přidává hook SessionStart). Přes proměnnou, ne přepínač: starší Claude Code ji jen přeskočí a jede jako dřív.
// Proces jde pustit předem (dialog.mjs warmUp): used říká, jestli už dostal větu.
export class Conversation {
  constructor({ model, system, schema }) {
    mkdirSync(WORK_DIR, { recursive: true });
    this.alive = true;
    this.waiting = null;
    this.used = false;
    this.model = model;
    this.system = system;
    this.startedAt = Date.now();
    this.p = spawn(
      claudePath(),
      [
        '-p',
        '--model', model,
        '--tools', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--system-prompt', system,
        '--json-schema', JSON.stringify(schema),
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
      ],
      { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_CODE_SAFE_MODE: '1' } },
    );
    let pool = '';
    this.p.stdout.on('data', (d) => {
      pool += d;
      let i;
      while ((i = pool.indexOf('\n')) >= 0) {
        const line = pool.slice(0, i);
        pool = pool.slice(i + 1);
        try {
          const j = JSON.parse(line);
          if (j.type === 'result') this.reply(j.structured_output);
        } catch {
          // Jiný než JSON řádek nás nezajímá.
        }
      }
    });
    this.p.stdin.on('error', () => {});
    const end = () => {
      this.alive = false;
      this.reply(null);
    };
    this.p.on('error', end);
    this.p.on('close', end);
  }

  reply(result) {
    const c = this.waiting;
    if (!c) return;
    this.waiting = null;
    clearTimeout(c.timer);
    if (result) c.finished(result);
    else c.failed(new Error('Claude nevrátil výsledek.'));
  }

  ask(text, limitMs = 45_000) {
    return new Promise((finished, failed) => {
      if (!this.alive || this.waiting) return failed(new Error('Claude teď nemůže odpovědět.'));
      const timer = setTimeout(() => {
        this.waiting = null;
        failed(new Error('Claude neodpověděl včas.'));
      }, limitMs);
      this.waiting = { finished, failed, timer };
      this.used = true;
      this.p.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
    });
  }

  close() {
    this.alive = false;
    this.p.kill();
  }
}

export function askClaude({ prompt, schema, model, services = [], system, limitMs = 240_000 }) {
  mkdirSync(WORK_DIR, { recursive: true });
  const args = [
    '-p',
    '--model', model,
    '--tools', '',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--no-session-persistence',
  ];
  if (system) args.push('--system-prompt', system);
  if (services.length) args.push('--allowedTools', ...services);
  else args.push('--strict-mcp-config');

  return new Promise((finished, failed) => {
    const p = spawn(claudePath(), args, { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => {
      p.kill();
      failed(new Error('Claude neodpověděl včas.'));
    }, limitMs);
    p.stdout.on('data', (d) => {
      output += d;
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      failed(new Error(`Claude nejde spustit: ${err.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(output);
        if (j.is_error || !j.structured_output) throw new Error('bez výsledku');
        finished(j.structured_output);
      } catch {
        failed(new Error(`Claude nevrátil výsledek (kód ${code}).`));
      }
    });
    p.stdin.end(prompt);
  });
}

// --- Konektory v Claudovi (Merora, Gmail…) ---
// „claude mcp list“ vypíše konektory z claude.ai („claude.ai Merora: https://… - ✔ Connected“) i servery přidané
// v Claude Code („merora: https://… (HTTP) - ✔ Connected“). Konektor se pak hledá podle adresy, ne podle jména:
// každý si ho může pojmenovat po svém. Trvá to pár vteřin, Claude Code při tom ověřuje spojení.
let lastList = null; // { kdy, prace }: víc zdrojů se ptá zároveň, stačí jedno „claude mcp list“ za minutu
// znovu: nečekat na starší výsledek (tlačítko Zkontrolovat hned po propojení v Claudovi).
export function listConnectors({ again = false } = {}) {
  if (again || !lastList || Date.now() - lastList.when > 60_000) {
    lastList = { when: Date.now(), work: loadConnectors() };
    lastList.work.catch(() => {
      lastList = null; // chyba se nepamatuje
    });
  }
  return lastList.work;
}

function loadConnectors(limitMs = 60_000) {
  mkdirSync(WORK_DIR, { recursive: true });
  return new Promise((finished, failed) => {
    const p = spawn(claudePath(), ['mcp', 'list'], { cwd: WORK_DIR, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    const timer = setTimeout(() => {
      p.kill();
      failed(new Error('Claude neodpověděl včas.'));
    }, limitMs);
    p.stdout.on('data', (d) => {
      output += d;
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      failed(new Error(`Claude nejde spustit: ${err.message}`));
    });
    p.on('close', () => {
      clearTimeout(timer);
      const connectors = [];
      for (const line of output.split(/\r?\n/)) {
        const m = line.match(/^(.+?): (\S+).* - (.+)$/);
        if (!m) continue;
        const [, name, address, status] = m;
        connectors.push({
          name,
          address,
          // Nástroje se jmenují mcp__<jméno konektoru, jiné znaky než písmena a číslice jako _>__<nástroj>.
          prefix: `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__`,
          status: /Connected/i.test(status) ? 'ok' : /auth/i.test(status) ? 'needs_login' : 'error',
        });
      }
      finished(connectors);
    });
  });
}

// Claude Code s povolenými nástroji konektorů. Vrátí strukturovaný výstup modelu (když je zadané schéma)
// a syrové výsledky všech volání těch nástrojů, čtené z proudu událostí: data od služby, ne převyprávění modelem.
export function withTool({ prompt, services, schema = null, model = 'haiku', maxSteps = null, limitMs = 120_000 }) {
  mkdirSync(WORK_DIR, { recursive: true });
  const args = ['-p', '--model', model, '--tools', '', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
  if (maxSteps) args.push('--max-turns', String(maxSteps));
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  args.push('--allowedTools', ...services);
  return new Promise((finished, failed) => {
    const p = spawn(claudePath(), args, { cwd: WORK_DIR, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let pool = '';
    const call = new Map(); // id volání → { nastroj, vstup, obsah, chyba }
    let output = null;
    const timer = setTimeout(() => {
      p.kill();
      failed(new Error('Claude neodpověděl včas.'));
    }, limitMs);
    p.stdout.on('data', (d) => {
      pool += d;
      let i;
      while ((i = pool.indexOf('\n')) >= 0) {
        const line = pool.slice(0, i);
        pool = pool.slice(i + 1);
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.type === 'result') output = j.structured_output ?? null;
        for (const block of j.message?.content ?? []) {
          if (block.type === 'tool_use' && services.includes(block.name)) {
            call.set(block.id, { tool: block.name, input: block.input ?? {}, content: null, error: false });
          }
          const v = block.type === 'tool_result' ? call.get(block.tool_use_id) : null;
          if (v && v.content === null) {
            v.content = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => c.text ?? '').join('');
            v.error = Boolean(block.is_error);
          }
        }
      }
    });
    p.on('error', (err) => {
      clearTimeout(timer);
      failed(new Error(`Claude nejde spustit: ${err.message}`));
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      finished({ output, code, call: [...call.values()].filter((v) => v.content !== null) });
    });
    p.stdin.end(prompt);
  });
}

// Výsledek jednoho volání: JSON od služby, nebo text.
export function callContent(v) {
  try {
    return JSON.parse(v.content);
  } catch {
    return v.content;
  }
}

// Zavolá jeden nástroj konektoru a vrátí jeho syrový výsledek. Chyba nástroje vyhodí jeho text.
export async function callTool({ tool, extraArgs = {}, limitMs = 120_000 }) {
  const { call, code } = await withTool({
    prompt: `Zavolej jednou nástroj ${tool} přesně s těmito argumenty a nic dalšího nedělej: ${JSON.stringify(extraArgs)}`,
    services: [tool],
    maxSteps: 2,
    limitMs,
  });
  const v = call[0];
  if (!v) throw new Error(`Claude nástroj nezavolal (kód ${code}).`);
  if (v.error) throw new Error(v.content || 'Nástroj vrátil chybu.');
  return callContent(v);
}
