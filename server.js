// 🐶 SoyPerritoProProYT-Bed · puente Bedrock
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bedrock = require('bedrock-protocol');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (_req, res) => res.type('html').send('<h1>🐶 SoyPerritoProProYT-Bed Relay</h1><p>🟢 Servidor online.</p><p>WebSocket: <code>wss://soyperritoproproyt-console-bed.onrender.com</code></p>'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'SoyPerritoProProYT-Bed relay' }));

wss.on('connection', (ws) => {
  let client = null;
  const send = (type, data = {}) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
  };
  send('ready');

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'connect') return;
      const host = String(msg.host || '').trim();
      const port = Number(msg.port || 19132);
      const username = String(msg.username || 'SoyPerrito').trim().slice(0, 16);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        send('error', { message: 'Host o puerto no válido.' }); return;
      }
      send('connecting', { host, port });
      try { client?.close(); } catch {}
      client = bedrock.createClient({ host, port, username, offline: true });
      client.on('join', () => send('connected', { host, port }));
      client.on('start_game', packet => send('world_info', { entityId: packet.entity_id, dimension: packet.dimension, position: packet.player_position }));
      client.on('player_list', packet => send('players', { records: packet.records || [] }));
      client.on('text', packet => send('chat', { source: packet.source_name, message: packet.message }));
      client.on('disconnect', packet => send('disconnected', { reason: packet?.message || 'Servidor desconectado' }));
      client.on('error', err => send('error', { message: err.message || String(err) }));
    } catch (e) { send('error', { message: e.message || String(e) }); }
  });
  ws.on('close', () => { try { client?.close(); } catch {} });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SoyPerritoProProYT-Bed relay listening on ${PORT}`));
