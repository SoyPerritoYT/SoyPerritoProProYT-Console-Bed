// 🐶 SoyPerritoProProYT-Bed · puente Bedrock + WebSocket
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bedrock = require('bedrock-protocol');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (_req, res) => res.type('html').send('<h1>🐶 SoyPerritoProProYT-Bed Relay</h1><p>🟢 Servidor online.</p><p>WebSocket: <code>wss://soyperritoproproyt-console-bed.onrender.com</code></p>'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'SoyPerritoProProYT-Bed relay' }));

function safe(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

wss.on('connection', (ws) => {
  let client = null;
  let connected = false;

  const send = (type, data = {}) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
  };

  send('ready', { service: 'SoyPerritoProProYT-Bed relay' });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'ping') {
        send('pong', { time: Date.now() });
        return;
      }

      if (msg.type !== 'connect') return;

      const host = String(msg.host || '').trim();
      const port = Number(msg.port || 19132);
      const username = String(msg.username || 'SoyPerrito').trim().slice(0, 16);

      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        send('error', { message: 'Host o puerto no válido.' });
        return;
      }

      send('connecting', { host, port, username });
      try { client?.close(); } catch {}

      client = bedrock.createClient({
        host,
        port,
        username,
        offline: true
      });

      client.on('join', () => {
        connected = true;
        send('connected', { host, port, username });
      });

      // Datos iniciales del mundo.
      client.on('start_game', packet => send('world_info', {
        entityId: packet.entity_id,
        runtimeEntityId: packet.runtime_entity_id,
        dimension: packet.dimension,
        position: packet.player_position,
        seed: packet.seed,
        time: packet.time
      }));

      // Jugadores conectados.
      client.on('player_list', packet => send('players', {
        records: safe(packet.records || []) || []
      }));

      // Mensajes de chat del servidor.
      client.on('text', packet => send('chat', {
        source: packet.source_name || packet.xbox_user_id || '',
        message: packet.message || packet.parameters?.join(' ') || ''
      }));

      // Movimiento de entidades/jugadores. El navegador recibe los datos
      // para poder representar a los jugadores visibles.
      for (const name of ['add_player', 'add_entity', 'remove_entity', 'move_player', 'move_entity_delta', 'set_entity_motion']) {
        client.on(name, packet => send('entity_packet', {
          name,
          packet: safe(packet)
        }));
      }

      // Tiempo del mundo y cambios de bloques que el servidor comunique.
      client.on('set_time', packet => send('world_time', { packet: safe(packet) }));
      client.on('update_block', packet => send('block_update', { packet: safe(packet) }));
      client.on('level_event', packet => send('level_event', { packet: safe(packet) }));
      client.on('respawn', packet => send('respawn', { packet: safe(packet) }));

      // Inventario: solo se reenvía si el servidor/protocolo lo entrega al
      // cliente conectado; no se intenta acceder a inventarios privados ajenos.
      client.on('inventory_content', packet => send('inventory', { packet: safe(packet) }));
      client.on('inventory_slot', packet => send('inventory_slot', { packet: safe(packet) }));

      // Paquetes de mundo grandes (chunks/subchunks) se notifican para que
      // el frontend sepa que el servidor está enviando terreno real.
      for (const name of ['level_chunk', 'sub_chunk']) {
        client.on(name, packet => send('world_packet', {
          name,
          packet: safe(packet)
        }));
      }

      client.on('disconnect', packet => {
        connected = false;
        send('disconnected', {
          reason: packet?.message || 'Servidor desconectado'
        });
      });

      client.on('error', err => send('error', {
        message: err.message || String(err)
      }));
    } catch (e) {
      send('error', { message: e.message || String(e) });
    }
  });

  ws.on('close', () => {
    connected = false;
    try { client?.close(); } catch {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SoyPerritoProProYT-Bed relay listening on ${PORT}`));
