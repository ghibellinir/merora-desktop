// Signál z Merory „připomínky se změnily“: Supabase Realtime, soukromý kanál user:<id účtu>, událost changed.
// Merora ho pošle po každém zápisu (telefon, Claude, Merora Desktop), po čtení nikdy. Desktop pak hned načte
// Meroru (server.mjs, readMeroraNow). Doručení není zaručené, proto čtení při otevření okna, fokusu a ⌥M zůstává
// a minutové čtení se jen zředí, dokud je kanál připojený.
// Bez závislostí: Node 20 nemá WebSocket bez přepínače, takže je tu malý klient nad node:https (RFC 6455)
// a nad ním protokol Phoenix, kterým Realtime mluví (phx_join, heartbeat, broadcast, access_token).
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const HEARTBEAT_MS = 25_000;
// Token se obnoví až minutu před vypršením (accessToken v merora.mjs), proto kontrola častěji než jednou
// za minutu: jinak tu minutu přeskočí, Realtime kanál po vypršení zavře („Token has expired“, 22. 11.)
// a změny z telefonu pár vteřin nepřijdou. Kontrola jen čte soubor, obnova jde na server jednou za hodinu.
const TOKEN_CHECK_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

// Rámec od klienta: vždycky maskovaný (RFC 6455, 5.3).
function frame(opcode, payload = Buffer.alloc(0)) {
  const mask = randomBytes(4);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len])
    : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255])
      : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

// Otevře WebSocket. onText(text) pro každou textovou zprávu, onClose(důvod) jednou na konci.
// Vrací { send(text), close() }.
function openSocket(url, { onOpen, onText, onClose }) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const key = randomBytes(16).toString('base64');
  let socket = null;
  let closed = false;
  const finish = (reason) => {
    if (closed) return;
    closed = true;
    socket?.destroy();
    onClose(reason);
  };
  const req = (secure ? httpsRequest : httpRequest)({
    hostname: u.hostname,
    port: u.port || (secure ? 443 : 80),
    path: u.pathname + u.search,
    headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    timeout: 20_000,
  });
  req.on('upgrade', (res, s, head) => {
    socket = s;
    const expected = createHash('sha1').update(key + GUID).digest('base64');
    if (res.headers['sec-websocket-accept'] !== expected) return finish('chybná odpověď na handshake');
    let buf = head;
    let parts = [];
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const fin = buf[0] & 0x80;
        const opcode = buf[0] & 0x0f;
        const masked = buf[1] & 0x80;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const maskKey = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
        buf = buf.subarray(off + len);
        if (opcode === 0x1 || opcode === 0x0) {
          parts.push(payload);
          if (fin) {
            onText(Buffer.concat(parts).toString('utf8'));
            parts = [];
          }
        } else if (opcode === 0x8) {
          socket.write(frame(0x8));
          return finish('server spojení zavřel');
        } else if (opcode === 0x9) socket.write(frame(0xa, payload));
      }
    });
    socket.on('close', () => finish('spojení skončilo'));
    socket.on('error', (err) => finish(err.message));
    onOpen();
  });
  req.on('response', (res) => {
    res.resume();
    finish(`server odpověděl ${res.statusCode} místo websocketu`);
  });
  req.on('timeout', () => req.destroy(new Error('spojení se nenavázalo včas')));
  req.on('error', (err) => finish(err.message));
  req.end();
  return {
    send: (text) => socket && !closed && socket.write(frame(0x1, Buffer.from(text, 'utf8'))),
    close: () => {
      if (socket && !closed) socket.write(frame(0x8));
      finish('zavřeno');
    },
  };
}

// Odběr signálu. getAuth() vrací { token, userId } (platný token OAuth), nebo vyhodí chybu.
// onChanged() se zavolá po každé změně z jiného klienta než skipBy (vlastní změny Desktop zná sám).
// Vrací { start(), stop(), get live() }: live = kanál je připojený a server odpovídá.
export function meroraSignal({ supabaseUrl, apikey, getAuth, skipBy, onChanged, log = console.log, heartbeatMs = HEARTBEAT_MS, tokenCheckMs = TOKEN_CHECK_MS }) {
  let socket = null;
  let running = false;
  let live = false;
  let ref = 0;
  let joinRef = null;
  let topic = null;
  let token = null;
  let heartbeat = null;
  let tokenCheck = null;
  let pendingHeartbeat = null;
  let retry = null;
  let backoff = 5_000;
  let lastProblem = null;
  let rejected = false;

  const send = (event, payload, t = topic, extra = {}) => {
    ref += 1;
    socket?.send(JSON.stringify({ topic: t, event, payload, ref: String(ref), ...extra }));
    return String(ref);
  };
  const problem = (text) => {
    if (text !== lastProblem) log(`Signál z Merory: ${text}`);
    lastProblem = text;
  };
  const clearTimers = () => {
    clearInterval(heartbeat);
    clearInterval(tokenCheck);
    clearTimeout(retry);
    heartbeat = tokenCheck = retry = null;
  };
  const scheduleRetry = () => {
    if (!running) return;
    clearTimeout(retry);
    retry = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  async function connect() {
    if (!running || socket) return;
    let auth;
    try {
      auth = await getAuth();
    } catch (err) {
      problem(`bez přístupu (${err.message})`);
      return scheduleRetry();
    }
    if (!running || socket) return;
    token = auth.token;
    topic = `realtime:user:${auth.userId}`;
    const url = `${supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(apikey)}&vsn=1.0.0`;
    socket = openSocket(url, {
      onOpen: () => {
        joinRef = String(ref + 1);
        send('phx_join', {
          config: { broadcast: { ack: false, self: false }, presence: { key: '' }, private: true },
          access_token: token,
        }, topic, { join_ref: joinRef });
        heartbeat = setInterval(() => {
          // Bez odpovědi na minulý heartbeat je spojení mrtvé, i když se socket netváří zavřeně.
          if (pendingHeartbeat) {
            problem('server neodpovídá, připojuju znovu');
            return socket?.close();
          }
          pendingHeartbeat = send('heartbeat', {}, 'phoenix');
        }, heartbeatMs);
        // Obnovený token (platí hodinu) Realtime dostane hned, jinak by kanál po vypršení zavřel.
        tokenCheck = setInterval(async () => {
          try {
            const next = (await getAuth()).token;
            if (next !== token) {
              token = next;
              send('access_token', { access_token: token }, topic, { join_ref: joinRef });
            }
          } catch (err) {
            problem(`token se neobnovil (${err.message})`);
          }
        }, tokenCheckMs);
      },
      onText: (text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.event === 'phx_reply' && msg.ref === pendingHeartbeat) pendingHeartbeat = null;
        else if (msg.event === 'phx_reply' && msg.ref === joinRef) {
          if (msg.payload?.status === 'ok') {
            live = true;
            backoff = 5_000;
            if (lastProblem !== 'připojeno') log('Signál z Merory: připojeno');
            lastProblem = 'připojeno';
          } else {
            // Dokud Merora signál nemá nasazený (nebo účet kanál nemá), odpověď je Unauthorized. Do logu jednou.
            rejected = true;
            problem(`kanál nepustil (${JSON.stringify(msg.payload?.response ?? msg.payload).slice(0, 160)})`);
            socket?.close();
          }
        } else if (msg.event === 'broadcast' && msg.payload?.event === 'changed') {
          if (msg.payload.payload?.by !== skipBy) onChanged(msg.payload.payload?.by ?? null);
        } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
          problem(`kanál skončil (${msg.event})`);
          socket?.close();
        } else if (msg.event === 'system' && msg.payload?.status === 'error') {
          problem(`chyba kanálu (${String(msg.payload.message ?? '').slice(0, 160)})`);
        }
      },
      onClose: (reason) => {
        const wasLive = live;
        live = false;
        socket = null;
        pendingHeartbeat = null;
        clearTimers();
        if (!running) return;
        if (wasLive) problem(`odpojeno (${reason}), připojuju znovu`);
        else if (!rejected) problem(`nepřipojeno (${reason})`);
        rejected = false;
        scheduleRetry();
      },
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      backoff = 5_000;
      connect();
    },
    stop() {
      running = false;
      clearTimers();
      socket?.close();
      socket = null;
      live = false;
    },
    get live() {
      return live;
    },
  };
}
