// 🐶 SoyPerritoProProYT-Bed · puente Web ↔ Bedrock real
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createBot } = require('prismarine-bedrock');
const { Vec3 } = require('vec3');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (_req, res) => res.type('html').send('<h1>🐶 SoyPerritoProProYT-Bed</h1><p>🟢 Relay Bedrock real online.</p>'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'SoyPerritoProProYT-Bed real relay', version: 4 }));

function safe(v) {
  try { return JSON.parse(JSON.stringify(v, (_k, value) => typeof value === 'bigint' ? Number(value) : value)); } catch { return null; }
}
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function send(ws, type, data = {}) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data })); }

async function snapshot(bot, ws, radius = 10, vertical = 8) {
  if (!bot?.entity?.position && !bot?.self?.position) return;
  const p = bot.entity?.position || bot.self?.position;
  const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
  const blocks = [];
  const minY = Math.max(-64, cy - vertical);
  const maxY = Math.min(cy + vertical, 319);
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let y = minY; y <= maxY; y++) {
        try {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (b && b.name && b.name !== 'air') blocks.push({ x, y, z, name: b.name, stateId: b.stateId ?? null });
        } catch {}
      }
    }
  }
  send(ws, 'world_snapshot', { center: { x: cx, y: cy, z: cz }, blocks, blockCount: blocks.length, dimension: bot.game?.dimension ?? 0, gameMode: bot.game?.gameMode ?? 0 });
}

function inventorySnapshot(bot) {
  const inv = bot.inventory;
  if (!inv) return [];
  return (inv.slots || []).map((item, slot) => item ? { slot, name: item.name, displayName: item.displayName, count: item.count, stackId: item.stackId ?? null } : null);
}
function playersSnapshot(bot) {
  const out = [];
  const players = bot.players instanceof Map ? bot.players : new Map(Object.entries(bot.players || {}));
  for (const [id, p] of players) out.push({ runtimeId: String(id), username: p.username || p.name || 'Jugador', position: p.position ? safe(p.position) : null, yaw: num(p.yaw), pitch: num(p.pitch) });
  return out;
}

wss.on('connection', ws => {
  let bot = null;
  let syncing = false;
  let lastSnapshot = 0;
  const controls = { forward:false, back:false, left:false, right:false, jump:false, sprint:false, sneak:false, swim:false };

  send(ws, 'ready', { service: 'SoyPerritoProProYT-Bed real relay', protocol: 'Bedrock' });
  const bind = (event, fn) => { try { bot.on(event, fn); } catch {} };
  const applyControls = () => {
    if (!bot) return;
    for (const [name, value] of Object.entries(controls)) {
      try { bot.setControlState(name, value); } catch {}
    }
  };
  const controlTimer = setInterval(applyControls, 50);

  async function sendSnapshot(force = false) {
    if (!bot || syncing) return;
    const now = Date.now();
    if (!force && now - lastSnapshot < 1400) return;
    lastSnapshot = now; syncing = true;
    try { await snapshot(bot, ws, 10, 8); } finally { syncing = false; }
  }

  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') return send(ws, 'pong', { time: Date.now() });

      if (msg.type === 'connect') {
        const host = String(msg.host || '').trim();
        const port = Number(msg.port || 19132);
        const username = String(msg.username || 'SoyPerrito').trim().slice(0, 16) || 'SoyPerrito';
        const version = String(msg.version || '').trim() || undefined;
        const offline = msg.offline !== false;
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return send(ws, 'error', { message: 'Host o puerto no válido.' });
        try { bot?.disconnect('Nueva conexión'); } catch {}
        Object.keys(controls).forEach(k => controls[k] = false);
        send(ws, 'connecting', { host, port, username, version: version || 'auto' });
        try {
          bot = createBot({ host, port, username, offline, ...(version ? { version } : {}), loggingEnabled: false, worldDecodeEnabled: true, physicsEnabled: true, chunkRadius: 6 });
        } catch (e) { return send(ws, 'error', { message: e.message || String(e) }); }

        bind('join', () => send(ws, 'connected', { host, port, username, version: bot.version }));
        bind('spawn', async () => {
          send(ws, 'spawn', { position: safe(bot.entity?.position || bot.self?.position), game: safe(bot.game) });
          send(ws, 'players', { records: playersSnapshot(bot) });
          send(ws, 'inventory', { slots: inventorySnapshot(bot) });
          await sendSnapshot(true);
        });
        bind('game', () => send(ws, 'game', { game: safe(bot.game) }));
        bind('health', () => send(ws, 'health', { health: bot.playerState?.health ?? bot.entity?.health ?? null }));
        bind('time', data => send(ws, 'world_time', { packet: safe(data) }));
        bind('chat', data => send(ws, 'chat', { source: data.username || data.source_name || data.sender || '', message: data.message || String(data) }));
        bind('physicsTick', () => {
          applyControls();
          const p = bot.entity?.position || bot.self?.position;
          if (p) send(ws, 'self', { position: safe(p), yaw: num(bot.entity?.yaw || bot.self?.yaw), pitch: num(bot.entity?.pitch || bot.self?.pitch) });
        });
        bind('diggingCompleted', data => { send(ws, 'block_update', { action: 'break', block: safe(data.block) }); sendSnapshot(true); });
        bind('diggingAborted', data => send(ws, 'action_error', { action: 'break', message: data?.error?.message || 'No se pudo romper.' }));
        bind('blockPlaceRequested', data => send(ws, 'block_place', safe(data)));
        bind('close', reason => send(ws, 'disconnected', { reason: String(reason || 'Servidor desconectado') }));
        bind('error', err => send(ws, 'error', { message: err?.message || String(err) }));
        return;
      }

      if (!bot) return send(ws, 'error', { message: 'Conecta primero a un servidor.' });
      if (msg.type === 'controls') {
        for (const name of Object.keys(controls)) if (typeof msg[name] === 'boolean') controls[name] = msg[name];
        applyControls();
        return;
      }
      if (msg.type === 'look') {
        try {
          // El navegador trabaja en grados; Mineflayer/Prismarine trabaja en radianes.
          const yaw = num(msg.yaw) * Math.PI / 180;
          const pitch = num(msg.pitch) * Math.PI / 180;
          await bot.look(yaw, pitch, true);
        } catch (e) { send(ws, 'error', { message: e.message || String(e) }); }
        return;
      }
      if (msg.type === 'chat') {
        const text = String(msg.message || '').trim().slice(0, 256);
        if (text) try { bot.chat(text); } catch (e) { send(ws, 'error', { message: e.message || String(e) }); }
        return;
      }
      if (msg.type === 'command') {
        const command = String(msg.command || '').trim().slice(0, 256);
        if (command) try { await bot.command(command); } catch (e) { send(ws, 'error', { message: e.message || String(e) }); }
        return;
      }
      if (msg.type === 'sync_world') { await sendSnapshot(true); return; }
      if (msg.type === 'inventory') return send(ws, 'inventory', { slots: inventorySnapshot(bot) });
      if (msg.type === 'break') {
        const x = Math.floor(num(msg.x)), y = Math.floor(num(msg.y)), z = Math.floor(num(msg.z));
        try {
          const block = bot.blockAt(new Vec3(x, y, z));
          if (!block || block.name === 'air') return send(ws, 'action_error', { action: 'break', message: 'Bloque no cargado.' });
          await bot.dig(block, true); await sendSnapshot(true);
        } catch (e) { send(ws, 'action_error', { action: 'break', message: e.message || String(e) }); }
        return;
      }
      if (msg.type === 'place') {
        const x = Math.floor(num(msg.x)), y = Math.floor(num(msg.y)), z = Math.floor(num(msg.z));
        try {
          const reference = bot.blockAt(new Vec3(x, y, z));
          const face = new Vec3(num(msg.fx), num(msg.fy), num(msg.fz));
          await bot.placeBlock(reference, face, { waitForUpdate: true }); await sendSnapshot(true);
        } catch (e) { send(ws, 'action_error', { action: 'place', message: e.message || String(e) }); }
        return;
      }
      if (msg.type === 'disconnect') { try { bot.disconnect('Desconectado desde SoyPerritoProProYT-Bed'); } catch {} bot = null; send(ws, 'disconnected', { reason: 'Desconectado' }); }
    } catch (e) { send(ws, 'error', { message: e.message || String(e) }); }
  });

  ws.on('close', () => { clearInterval(controlTimer); try { bot?.disconnect('WebSocket cerrado'); } catch {} });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🐶 SoyPerritoProProYT-Bed real relay listening on ${PORT}`));
