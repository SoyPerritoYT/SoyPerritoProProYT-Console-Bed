// 🐶 SoyPerritoProProYT-Bed · puente Bedrock
// Node.js + WebSocket + bedrock-protocol
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bedrock = require('bedrock-protocol');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/health', (_req, res) => res.json({ ok: true, service: 'SoyPerritoProProYT-Bed relay' }));

wss.on('connection', (ws) => {
  let client = null;
  let connected = false;

  const send = (type, data = {}) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }));
    }
  };

  const sendPacket = (name, params) => {
    // Solo reenviamos datos JSON/serializables que el navegador pueda consumir.
    try { send('packet', { name, params }); } catch {}
  };

  send('ready');

  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'connect') {
        if (client) {
          try { client.close(); } catch {}
          client = null;
        }

        const host = String(msg.host || '').trim();
        const port = Number(msg.port || 19132);
        const username = String(msg.username || 'SoyPerrito').trim().slice(0, 16);

        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
          send('error', { message: 'Host o puerto no válido.' });
          return;
        }

        send('connecting', { host, port, username });

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

        client.on('start_game', packet => {
          send('world_info', {
            entityId: packet.entity_id,
            dimension: packet.dimension,
            position: packet.player_position,
            rotation: packet.rotation,
            seed: packet.seed
          });
        });

        client.on('player_list', packet => {
          send('players', { records: packet.records || [] });
        });

        client.on('text', packet => {
          send('chat', {
            source: packet.source_name,
            message: packet.message,
            type: packet.type
          });
        });

        // Entidades/movimiento que el servidor envíe al cliente.
        const entityEvents = [
          'add_entity',
          'add_item_entity',
          'add_player',
          'move_entity_absolute',
          'move_player',
          'remove_entity',
          'set_entity_data',
          'update_attributes',
          'entity_event'
        ];
        for (const name of entityEvents) {
          client.on(name, packet => sendPacket(name, packet));
        }

        // Datos del mundo que podamos retransmitir como paquetes estructurados.
        const worldEvents = [
          'level_chunk',
          'network_chunk_publisher_update',
          'update_block',
          'update_subchunk_blocks',
          'block_event',
          'level_event'
        ];
        for (const name of worldEvents) {
          client.on(name, packet => sendPacket(name, packet));
        }

        client.on('set_time', packet => sendPacket('set_time', packet));
        client.on('play_status', packet => sendPacket('play_status', packet));
        client.on('respawn', packet => sendPacket('respawn', packet));

        client.on('disconnect', packet => {
          connected = false;
          send('disconnected', { reason: packet?.message || 'Servidor desconectado' });
        });

        client.on('error', err => {
          connected = false;
          send('error', { message: err.message || String(err) });
        });

        return;
      }

      // El navegador puede enviar acciones de juego cuando el frontend las implemente.
      // No se acepta ningún nombre de paquete arbitrario: solo una lista básica.
      if (msg.type === 'client_packet' && client && connected) {
        const allowed = new Set([
          'move_player',
          'player_action',
          'inventory_transaction',
          'interact',
          'text'
        ]);
        const name = String(msg.name || '');
        if (!allowed.has(name)) {
          send('error', { message: 'Paquete de cliente no permitido: ' + name });
          return;
        }
        if (typeof client.queue === 'function') {
          client.queue(name, msg.params || {});
        } else {
          send('error', { message: 'El cliente Bedrock no permite enviar ese paquete en esta versión.' });
        }
      }
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
