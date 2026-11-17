// Bowl Party game server: serves the game page and relays room state between phones.
// Zero dependencies — needs only Node 18+.  Start with:  node server.js   (PORT env var optional, default 8080)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PAGE = path.join(__dirname, 'public', 'index.html');
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const MAX_MSG = 16 * 1024, MAX_PRESENCE = 8 * 1024, MAX_PER_ROOM = 16, MAX_ROOMS_PER_CLIENT = 4;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // "/" -> public/index.html, "/camtest" -> public/camtest.html (only plain page names, nothing else on disk)
  const name = url === '/' ? 'index' : url.replace(/^\//, '').replace(/\.html$/, '');
  if (/^[a-z0-9-]+$/.test(name)) {
    fs.readFile(name === 'index' ? PAGE : path.join(__dirname, 'public', name + '.html'), (err, buf) => {
      if (err && name !== 'index') { res.writeHead(404); return res.end('Not found'); }
      if (err) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  } else if (url === '/health') { res.end('ok'); }
  else { res.writeHead(404); res.end('Not found'); }
});

// ---------- rooms ----------
const rooms = new Map();           // name -> Map(clientId -> presence)
const pending = new Map();         // name -> timer (coalesce broadcasts)
const clients = new Map();         // clientId -> client
function broadcast(name) {
  if (pending.has(name)) return;
  pending.set(name, setTimeout(() => {
    pending.delete(name);
    const room = rooms.get(name); if (!room) return;
    const msg = JSON.stringify({ t: 'peers', room: name, peers: [...room].map(([id, p]) => ({ id, p })) });
    for (const id of room.keys()) clients.get(id)?.send(msg);
  }, 30));
}
function leaveRoom(c, name) {
  const room = rooms.get(name); if (!room || !room.has(c.id)) return;
  room.delete(c.id); c.rooms.delete(name);
  if (room.size === 0) rooms.delete(name); else broadcast(name);
}
function onMessage(c, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
  const p = m.p && typeof m.p === 'object' && !Array.isArray(m.p) ? m.p : {};
  if ((m.t === 'join' || m.t === 'presence') && JSON.stringify(p).length > MAX_PRESENCE) return;
  if (m.t === 'join') {
    let room = rooms.get(m.room);
    if (!room) { room = new Map(); rooms.set(m.room, room); }
    if (!room.has(c.id) && (room.size >= MAX_PER_ROOM || c.rooms.size >= MAX_ROOMS_PER_CLIENT)) return;
    room.set(c.id, p); c.rooms.add(m.room); broadcast(m.room);
  } else if (m.t === 'presence') {
    const room = rooms.get(m.room); if (!room || !room.has(c.id)) return;
    room.set(c.id, p); broadcast(m.room);
  } else if (m.t === 'leave') leaveRoom(c, m.room);
}

// ---------- minimal WebSocket (RFC 6455) ----------
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!req.url.startsWith('/ws') || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: crypto.randomBytes(6).toString('hex'), sock, rooms: new Set(), buf: Buffer.alloc(0), frag: [], alive: true };
  c.send = str => { if (!sock.destroyed) sock.write(frame(0x1, Buffer.from(str))); };
  clients.set(c.id, c);
  c.send(JSON.stringify({ t: 'hello', id: c.id }));
  const close = () => { if (!clients.has(c.id)) return; clients.delete(c.id); for (const r of [...c.rooms]) leaveRoom(c, r); sock.destroy(); };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    for (;;) {
      const f = parse(c.buf); if (f === null) break;
      if (f === false) return close();
      c.buf = c.buf.subarray(f.used);
      if (f.op === 0x8) return close();
      if (f.op === 0x9) { sock.write(frame(0xA, f.data)); continue; }
      if (f.op === 0xA) { c.alive = true; continue; }
      if (f.op === 0x1 || f.op === 0x0) {
        c.frag.push(f.data);
        if (c.frag.reduce((n, b) => n + b.length, 0) > MAX_MSG) return close();
        if (f.fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = []; c.alive = true; onMessage(c, text); }
      }
    }
  });
  sock.on('close', close); sock.on('error', close);
});
function frame(op, data) {
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len])
    : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
  return Buffer.concat([head, data]);
}
function parse(b) {
  if (b.length < 2) return null;
  const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
  let len = b[1] & 0x7f, off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (b.length < 10) return null; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return false; len = Number(big); off = 10; }
  if (!masked || len > MAX_MSG) return false;
  if (b.length < off + 4 + len) return null;
  const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
  return { fin, op, data, used: off + 4 + len };
}
// keepalive: ping every 25 s, drop clients that stop answering
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.sock.destroy(); continue; }
    c.alive = false; try { c.sock.write(frame(0x9, Buffer.alloc(0))); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log(`Bowl Party running on http://localhost:${PORT}`));
