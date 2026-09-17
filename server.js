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
app.get('/health', (_req, res) => res.json({ ok: true, service: 'SoyPerritoProProYT-Bed real relay', version: 2 }));

function safe(v) {
  try { return JSON.parse(JSON.stringify(v, (_k, value) => typeof value === 'bigint' ? Number(value) : value)); } catch { return null; }
}
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

async function snapshot(bot, ws, radius = 8, vertical = 8) {
  if (!bot?.self?.position) return;
  const p = bot.self.position;
  const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
  const blocks = [];
  const minY = Math.max(-64, cy - vertical);
  const maxY = Math.min(cy + vertical, (bot.world?.worldHeight || 320) - 1);

  // Limitamos la instantánea para mantener el navegador fluido.
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let y = minY; y <= maxY; y++) {
        try {
          const b = await bot.getBlock(new Vec3(x, y, z), { timeout: 150 });
          if (b && b.name && b.name !== 'air') {
            blocks.push({ x, y, z, name: b.name, stateId: b.stateId ?? null });
          }
        } catch {}
      }
    }
  }
  send(ws, 'world_snapshot', {
    center: { x: cx, y: cy, z: cz },
    blocks,
    dimension: bot.game?.dimension ?? 0,
    gameMode: bot.game?.gameMode ?? 0
  });
}

function inventorySnapshot(bot) {
  const inv = bot.inventory;
  if (!inv) return [];
  return (inv.slots || []).map((item, slot) => item ? {
    slot,
    name: item.name,
    displayName: item.displayName,
    count: item.count,
    stackId: item.stackId ?? null
  } : null);
}

function playersSnapshot(bot) {
  const out = [];
  for (const [id, p] of bot.players || []) {
    out.push({
      runtimeId: String(id),
      username: p.username || p.name || 'Jugador',
      position: p.position ? safe(p.position) : null,
      yaw: num(p.yaw),
      pitch: num(p.pitch)
    });
  }
  return out;
}

function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

wss.on('connection', ws => {
  let bot = null;
  let syncing = false;
  let lastSnapshot = 0;

  send(ws, 'ready', { service: 'SoyPerritoProProYT-Bed real relay', protocol: 'Bedrock' });

  const bind = (event, fn) => {
    try { bot.on(event, fn); } catch {}
  };

  async function sendSnapshot(force = false) {
    if (!bot?.self?.position || syncing) return;
    const now = Date.now();
    if (!force && now - lastSnapshot < 1800) return;
    lastSnapshot = now;
    syncing = true;
    try { await snapshot(bot, ws, 8, 7); } finally { syncing = false; }
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
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
          return send(ws, 'error', { message: 'Host o puerto no válido.' });
        }

        try { bot?.disconnect('Nueva conexión'); } catch {}
        send(ws, 'connecting', { host, port, username, version: version || 'auto' });

        bot = createBot({
          host, port, username, offline,
          ...(version ? { version } : {}),
          loggingEnabled: false,
          worldDecodeEnabled: true,
          physicsEnabled: true,
          chunkRadius: 6
        });

        bind('join', () => send(ws, 'connected', { host, port, username, version: bot.version }));
        bind('spawn', async () => {
          send(ws, 'spawn', { position: safe(bot.self?.position), game: safe(bot.game) });
          send(ws, 'players', { records: playersSnapshot(bot) });
          send(ws, 'inventory', { slots: inventorySnapshot(bot) });
          await sendSnapshot(true);
        });
        bind('game', () => send(ws, 'game', { game: safe(bot.game) }));
        bind('health', () => send(ws, 'health', { health: bot.playerState?.health ?? bot.self?.health ?? null }));
        bind('time', data => send(ws, 'world_time', { packet: safe(data) }));
        bind('chat', data => send(ws, 'chat', { source: data.username || data.source_name || data.sender || '', message: data.message || String(data) }));
        bind('playerSpawned', entity => send(ws, 'entity', { action: 'spawn', entity: safe(entity) }));
        bind('entitySpawned', entity => send(ws, 'entity', { action: 'spawn', entity: safe(entity) }));
        bind('entityRemoved', entity => send(ws, 'entity', { action: 'remove', entity: safe(entity) }));
        bind('physicsTick', () => {
          if (bot?.self?.position) send(ws, 'self', { position: safe(bot.self.position), yaw: num(bot.self.yaw), pitch: num(bot.self.pitch) });
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
        for (const name of ['forward','back','left','right','jump','sprint','sneak','swim']) {
          if (typeof msg[name] === 'boolean') {
            try { bot.setControlState(name, msg[name]); } catch {}
          }
        }
        return;
      }

      if (msg.type === 'look') {
        try { await bot.look(num(msg.yaw), num(msg.pitch), true); } catch (e) { send(ws, 'error', { message: e.message }); }
        return;
      }

      if (msg.type === 'chat') {
        const text = String(msg.message || '').trim().slice(0, 256);
        if (text) {
          try { bot.chat(text); } catch (e) { send(ws, 'error', { message: e.message }); }
        }
        return;
      }

      if (msg.type === 'command') {
        const command = String(msg.command || '').trim().slice(0, 256);
        if (command) {
          try { await bot.command(command); } catch (e) { send(ws, 'error', { message: e.message }); }
        }
        return;
      }

      if (msg.type === 'sync_world') {
        await sendSnapshot(true);
        return;
      }

      if (msg.type === 'inventory') {
        return send(ws, 'inventory', { slots: inventorySnapshot(bot) });
      }

      if (msg.type === 'break') {
        const x = Math.floor(num(msg.x)), y = Math.floor(num(msg.y)), z = Math.floor(num(msg.z));
        try {
          const block = await bot.getBlock(new Vec3(x, y, z));
          if (!block) return send(ws, 'action_error', { action: 'break', message: 'Bloque no cargado.' });
          await bot.dig(block, true);
          await sendSnapshot(true);
        } catch (e) { send(ws, 'action_error', { action: 'break', message: e.message || String(e) }); }
        return;
      }

      if (msg.type === 'place') {
        const x = Math.floor(num(msg.x)), y = Math.floor(num(msg.y)), z = Math.floor(num(msg.z));
        const fx = num(msg.fx), fy = num(msg.fy), fz = num(msg.fz);
        try {
          await bot.placeBlock(new Vec3(x, y, z), new Vec3(fx, fy, fz), { waitForUpdate: true });
          await sendSnapshot(true);
        } catch (e) { send(ws, 'action_error', { action: 'place', message: e.message || String(e) }); }
        return;
      }

      if (msg.type === 'disconnect') {
        try { bot.disconnect('Desconectado desde SoyPerritoProProYT-Bed'); } catch {}
        bot = null;
        send(ws, 'disconnected', { reason: 'Desconectado' });
      }
    } catch (e) {
      send(ws, 'error', { message: e.message || String(e) });
    }
  });

  ws.on('close', () => { try { bot?.disconnect('WebSocket cerrado'); } catch {} });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🐶 SoyPerritoProProYT-Bed real relay listening on ${PORT}`));
