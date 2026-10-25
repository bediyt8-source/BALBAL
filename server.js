// Servidor multiplayer WebSocket do Battle World.  Rodar: npm install && node server.js
// - Valida posições (limite do mapa e velocidade) e limita o dano enviado pelos clientes
// - Escolhe um "host" que simula os inimigos; todos veem os mesmos inimigos
// - Controla mundo compartilhado (portal leva todos), Megazord único (piloto + artilheiro)
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });
const players = new Map(), MAXSP = 9, BOUND = 145;
let hostId = null, roomWorld = 0, mega = null, megaCd = 0;
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const broadcast = (o, except) => players.forEach(p => p.id !== except && send(p.ws, o));
const pickHost = () => { hostId = players.size ? [...players.keys()][0] : null; if (hostId) { players.forEach(p => send(p.ws, { t: 'host', v: p.id === hostId })); } };
wss.on('connection', ws => {
  let id = null;
  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 'join') {
      id = String(d.id).slice(0, 12);
      players.set(id, { id, name: String(d.name || 'Ranger').slice(0, 12), x: 0, z: 0, y: 0, ry: 0, ch: -1, m: 0, w: roomWorld, ws, last: Date.now() });
      if (!hostId || !players.has(hostId)) hostId = id;
      send(ws, { t: 'host', v: id === hostId }); send(ws, { t: 'warp', w: roomWorld });
    }
    const p = players.get(id); if (!p) return;
    switch (d.t) {
      case 'pos': {
        const now = Date.now(), dt = Math.max(now - p.last, 50) / 1000; p.last = now;
        const nx = Math.max(-BOUND, Math.min(BOUND, +d.x || 0)), nz = Math.max(-BOUND, Math.min(BOUND, +d.z || 0));
        if (Math.hypot(nx - p.x, nz - p.z) > MAXSP * dt * 1.8 + 10) send(ws, { t: 'kick' }); else { p.x = nx; p.z = nz; }
        p.y = Math.max(0, Math.min(4, +d.y || 0)); p.ry = +d.ry || 0; p.ch = d.ch | 0; p.m = d.m ? 1 : 0; p.w = d.w | 0; break; }
      case 'fx': case 'morph': broadcast({ ...d, id }, id); break;
      case 'chat': broadcast({ t: 'chat', name: p.name, text: String(d.text).slice(0, 80) }); break;
      case 'en': if (id === hostId) broadcast(d, id); break;                       // só o host envia inimigos
      case 'hit': { const h = players.get(hostId); if (h && id !== hostId) send(h.ws, { t: 'hit', id: d.id, d: Math.min(+d.d || 0, 2500) }); break; }
      case 'dmg': { const q = players.get(d.to); if (q && id === hostId) send(q.ws, { t: 'dmg', d: Math.min(+d.d || 0, 200) }); break; }
      case 'xp': case 'portal': case 'win': case 'rg': if (id === hostId) broadcast(d, id); break;
      case 'world': roomWorld = Math.max(0, Math.min(99, d.w | 0)); players.forEach(q => q.w = roomWorld); mega = null; broadcast({ t: 'warp', w: roomWorld }); break;
      case 'sig': { const q = players.get(d.to); if (q) send(q.ws, { t: 'sig', from: id, d: d.d }); break; }
      case 'vc': broadcast({ t: 'vc', id, on: d.on ? 1 : 0 }, id); break;
      case 'mega': { // um Megazord por sala; 2º jogador vira artilheiro
        if (mega || Date.now() < megaCd) return;
        const other = [...players.values()].find(q => q.id !== id && q.w === p.w);
        mega = { pilot: id, gunner: other ? other.id : id };
        broadcast({ t: 'megaOn', pilot: mega.pilot, gunner: mega.gunner, x: p.x, z: p.z, w: p.w });
        setTimeout(() => { mega = null; megaCd = Date.now() + 60000; broadcast({ t: 'megaOff' }); }, 27000); break; }
      case 'mz': if (mega && id === mega.pilot) broadcast({ t: 'mz', x: +d.x || 0, z: +d.z || 0, ry: +d.ry || 0 }, id); break;
      case 'mzfx': if (mega && (id === mega.pilot || id === mega.gunner)) broadcast({ t: 'mzfx', k: d.k }, id); break;
    }
  });
  ws.on('close', () => { players.delete(id); if (id === hostId) pickHost(); });
});
setInterval(() => { // 10 atualizações/s
  const arr = [...players.values()].map(({ id, name, x, z, y, ry, ch, m, w }) => ({ id, name, x, z, y, ry, ch, m, w }));
  broadcast({ t: 'state', p: arr });
}, 100);
console.log('Servidor Battle World na porta', process.env.PORT || 8080);
