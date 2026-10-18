// Clash of Realms game server (no extra packages needed).
// Serves the game page and relays each player's state to the others in the same room over WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PAGE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(PAGE);
});

/* ---------- tiny WebSocket implementation ---------- */
const clients = new Set();
function wsSend(c, obj) {
  if (c.closed) return;
  const payload = Buffer.from(JSON.stringify(obj));
  const len = payload.length; let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81; // FIN + text
  try { c.sock.write(Buffer.concat([head, payload])); } catch (e) {}
}
function wsControl(c, op, data) { const d = data || Buffer.alloc(0); const h = Buffer.from([0x80 | op, d.length]); try { c.sock.write(Buffer.concat([h, d])); } catch (e) {} }
function wsClose(c) { if (c.closed) return; c.closed = true; clients.delete(c); try { wsControl(c, 0x8); c.sock.end(); } catch (e) {} leave(c); }

server.on('upgrade', (req, sock) => {
  if (!req.url.startsWith('/ws') || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, id: 'p' + crypto.randomBytes(5).toString('hex'), room: null, buf: Buffer.alloc(0), frag: [], alive: true, closed: false };
  clients.add(c);
  sock.on('data', chunk => {
    c.buf = Buffer.concat([c.buf, chunk]);
    if (c.buf.length > 256 * 1024) return wsClose(c);
    while (c.buf.length >= 2) {
      const b0 = c.buf[0], b1 = c.buf[1], op = b0 & 0x0f, fin = !!(b0 & 0x80), masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 128 * 1024) return wsClose(c);
      const need = off + (masked ? 4 : 0) + len; if (c.buf.length < need) return;
      let data = c.buf.slice(off + (masked ? 4 : 0), need);
      if (masked) { const m = c.buf.slice(off, off + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
      c.buf = c.buf.slice(need);
      if (op === 0x8) return wsClose(c);
      if (op === 0x9) { wsControl(c, 0xA, data); continue; }
      if (op === 0xA) { c.alive = true; continue; }
      if (op === 0x1 || op === 0x0) { c.frag.push(data); if (fin) { const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onMessage(c, txt); } }
    }
  });
  sock.on('close', () => { c.closed = true; clients.delete(c); leave(c); });
  sock.on('error', () => { c.closed = true; clients.delete(c); leave(c); });
  wsSend(c, { t: 'hello', id: c.id });
});

/* ---------- rooms ---------- */
const rooms = new Map(); // name -> Map(id -> {c, presence})
function broadcast(room, msg, exceptId) { const r = rooms.get(room); if (!r) return; for (const [id, p] of r) if (id !== exceptId) wsSend(p.c, msg); }
function leave(c) {
  if (!c.room) return;
  const r = rooms.get(c.room);
  if (r) { r.delete(c.id); broadcast(c.room, { t: 'left', peer: c.id }); if (r.size === 0) rooms.delete(c.room); }
  c.room = null;
}
function onMessage(c, txt) {
  let m; try { m = JSON.parse(txt); } catch (e) { return; }
  if (m.t === 'join' && typeof m.room === 'string' && /^[a-z0-9][a-z0-9_.-]{0,47}$/.test(m.room)) {
    leave(c);
    let r = rooms.get(m.room); if (!r) { r = new Map(); rooms.set(m.room, r); }
    if (r.size >= 6) return wsSend(c, { t: 'joinErr', code: 'limit_reached' });
    c.room = m.room; r.set(c.id, { c, presence: {} });
    const peers = []; for (const [id, p] of r) peers.push({ peer: id, presence: p.presence });
    wsSend(c, { t: 'joined', room: m.room, peers });
    broadcast(m.room, { t: 'p', peer: c.id, presence: {} }, c.id);
  } else if (m.t === 'presence' && c.room && m.presence && typeof m.presence === 'object') {
    const r = rooms.get(c.room); const me = r && r.get(c.id); if (!me) return;
    me.presence = m.presence;
    broadcast(c.room, { t: 'p', peer: c.id, presence: m.presence }, c.id);
  } else if (m.t === 'leave') { leave(c); }
}
// keep connections alive and drop dead ones
setInterval(() => { for (const c of clients) { if (!c.alive) { wsClose(c); continue; } c.alive = false; wsControl(c, 0x9); } }, 20000);

server.listen(PORT, () => console.log('Clash of Realms running on port ' + PORT));
