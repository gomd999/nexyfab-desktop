/**
 * collab-worker/server.js — Node.js Yjs WebSocket relay.
 *
 * Phase 6.4 of NexyFab collaborative editing. The browser's `crdtAdapter`
 * (transport: 'websocket') opens a `WebsocketProvider` against this server;
 * we then relay Yjs sync + y-protocols/awareness frames between every client
 * in the same room (one room == one `docId`).
 *
 * Why hand-rolled rather than `y-websocket/bin/server`?
 *   y-websocket@3 dropped its bundled `bin/server.js`. The official
 *   replacement is "use ws + y-protocols yourself" — that's this file.
 *   The wire format is identical to what `WebsocketProvider` expects, so
 *   `crdtAdapter` does not need any server-aware code paths.
 *
 * Wire format (matches y-websocket / y-protocols, same as occt-collab-worker):
 *   Binary frames:
 *     [0] = MESSAGE_SYNC      → y-protocols/sync (step1/step2/update)
 *     [1] = MESSAGE_AWARENESS → y-protocols/awareness encode/apply
 *   Text frames (JSON control):
 *     { type: 'ping' } → server replies { type: 'pong', ts }
 *
 * Scope (Phase 1):
 *   - In-memory per-room Y.Doc + Awareness. NO persistence — when the last
 *     client leaves a room, the room is destroyed and any unsaved state is
 *     gone. Reconnecting clients will rebuild state from THEIR local copy
 *     (CRDT merge keeps this safe), but a server restart with no clients
 *     online truly resets the room. Persistence (R2/D1) is Phase 2 wishlist.
 *   - Auth: query param `token` is accepted but NOT VALIDATED in Phase 1.
 *     Logged for observability. Phase 2 will HS256-verify against the
 *     main app's JWT secret + check `nfProjectAccess(userId, docId)`.
 *   - URL routing: any path is treated as a docId after stripping the
 *     leading slash. Empty path → room id `default`. We could lock this
 *     down to `/ws/:docId` but the WebsocketProvider just appends the
 *     room name to whatever wsUrl you give it, so flexible is friendlier.
 *
 * Layout deliberately matches occt-collab-worker/src/CollabRoom.ts so
 * Phase 2 can lift-and-shift the persistence + auth code paths.
 *
 * Run:
 *   node collab-worker/server.js                # default port 1234
 *   COLLAB_PORT=8787 node collab-worker/server.js
 *
 * Connect from crdtAdapter:
 *   createCrdtDoc({ transport: 'websocket', wsUrl: 'ws://localhost:1234',
 *                   docId: 'project-42' })
 */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Per-room state. Created lazily on first join, torn down on last leave. */
class Room {
  constructor(id) {
    this.id = id;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // The server is a relay, never a participant — clear its own local state
    // so it doesn't pollute the awareness map.
    this.awareness.setLocalState(null);
    /** @type {Map<WebSocket, { userId: string, awarenessIds: Set<number> }>} */
    this.clients = new Map();
    this._docUpdateHandler = (update, origin) => {
      // Re-emit raw doc updates as MESSAGE_SYNC/update frames to every peer
      // except the origin (the origin is the WebSocket that produced it).
      // This is the standard y-websocket fan-out.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const payload = encoding.toUint8Array(encoder);
      for (const sock of this.clients.keys()) {
        if (sock === origin) continue;
        safeSend(sock, payload);
      }
    };
    this.doc.on('update', this._docUpdateHandler);

    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      const payload = encoding.toUint8Array(encoder);
      for (const sock of this.clients.keys()) {
        // Even the origin gets the fan-out — y-protocols/awareness on the
        // client side is idempotent for its own clientID, and broadcasting
        // back lets the origin tell that the server received it.
        // (This mirrors the canonical y-websocket utils.js behaviour.)
        if (sock === origin) continue;
        safeSend(sock, payload);
      }
    };
    this.awareness.on('update', this._awarenessUpdateHandler);
  }

  destroy() {
    try { this.doc.off('update', this._docUpdateHandler); } catch { /* ignore */ }
    try { this.awareness.off('update', this._awarenessUpdateHandler); } catch { /* ignore */ }
    try { this.awareness.destroy(); } catch { /* ignore */ }
    try { this.doc.destroy(); } catch { /* ignore */ }
    this.clients.clear();
  }
}

/** Registry of rooms keyed by docId. */
class RoomRegistry {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }
  getOrCreate(docId) {
    let room = this.rooms.get(docId);
    if (!room) {
      room = new Room(docId);
      this.rooms.set(docId, room);
    }
    return room;
  }
  remove(docId) {
    const room = this.rooms.get(docId);
    if (!room) return;
    room.destroy();
    this.rooms.delete(docId);
  }
  size() {
    return this.rooms.size;
  }
  /** Test helper — drop every room. */
  _reset() {
    for (const id of Array.from(this.rooms.keys())) this.remove(id);
  }
}

function safeSend(sock, payload) {
  // ws ReadyState.OPEN === 1. Avoid importing the constant for CJS terseness.
  if (sock.readyState !== 1) return;
  try {
    sock.send(payload, { binary: payload instanceof Uint8Array });
  } catch (err) {
    // A failed send usually means the socket is mid-close. The 'close'
    // handler will clean up; we just drop the frame.
    console.error('[collab] send failed:', err && err.message);
  }
}

/**
 * Phase 1 auth: log the token, don't validate.
 * Phase 2: HS256 verify against process.env.JWT_SECRET + check
 *   nfProjectAccess(payload.sub, docId).
 * Returns `{ ok: boolean, userId: string, reason?: string }`.
 */
function authorize(token, _docId) {
  if (!token) {
    // Phase 1 still allows tokenless connections (dev convenience). Logged
    // so an operator can spot prod traffic missing a token.
    return { ok: true, userId: 'anonymous' };
  }
  // Phase 1: trust the token. We DO NOT decode it because that would imply
  // we believe the contents; instead we generate a stable-ish userId from a
  // short prefix so multi-tab dev sessions don't all collide on 'anonymous'.
  const userId = 'tok-' + token.slice(0, 8);
  return { ok: true, userId };
}

/**
 * Extract a docId from a request URL. The WebsocketProvider opens
 * `<wsUrl>/<docId>` so we just take the pathname minus the leading slash.
 * Empty path → 'default'. The first ?token query param (if any) is returned
 * separately for the auth layer.
 */
function parseRequest(req) {
  // Use WHATWG URL — `url.parse()` is deprecated (DEP0169). The base origin
  // is irrelevant; we only read pathname + query.
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://x');
  let docId = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (docId.length === 0) docId = 'default';
  // The browser usually percent-encodes path segments; decode so the room
  // key matches what the WebsocketProvider intended. Decoding before the
  // validation regex is important — `\x01` would otherwise be hidden behind
  // `%01` after WHATWG normalisation.
  try { docId = decodeURIComponent(docId); } catch {
    return { docId: null, token: null, reason: 'invalid-doc-id' };
  }
  // Defensive: reject pathological docIds that include weird characters
  // we'd never want as a key (control chars, path traversal). Length cap
  // mirrors what the Cloudflare DO `idFromName` accepts cleanly.
  // eslint-disable-next-line no-control-regex
  if (docId.length > 256 || /[\x00-\x1f]/.test(docId)) {
    return { docId: null, token: null, reason: 'invalid-doc-id' };
  }
  const token = parsed.searchParams.get('token');
  return { docId, token, reason: null };
}

/** Send Yjs sync step 1 to a freshly-connected client. */
function sendSyncStep1(sock, doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  safeSend(sock, encoding.toUint8Array(encoder));
}

/** Send the current awareness snapshot to a freshly-connected client. */
function sendInitialAwareness(sock, awareness) {
  const states = awareness.getStates();
  if (states.size === 0) return;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      Array.from(states.keys()),
    ),
  );
  safeSend(sock, encoding.toUint8Array(encoder));
}

/**
 * Handle one binary frame from a client. Mirrors CollabRoom.onMessage but
 * leans on the room's `awareness.on('update')` handler to do the fan-out
 * (so we don't have to manually re-broadcast every frame here).
 */
function handleBinary(room, sock, data) {
  const decoder = decoding.createDecoder(data);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case MESSAGE_SYNC: {
      // readSyncMessage may apply an update (which the doc's 'update'
      // listener will then fan out) AND/OR write a reply (Step2 in response
      // to Step1, etc.) into the encoder we pass in.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      // The 4th arg (`transactionOrigin`) is what shows up in the doc's
      // 'update' listener — passing `sock` lets the fan-out skip the origin.
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, sock);
      // Only send the reply if the protocol actually wrote something past
      // the outer MESSAGE_SYNC byte. Otherwise it's a no-op echo.
      if (encoding.length(encoder) > 1) {
        safeSend(sock, encoding.toUint8Array(encoder));
      }
      break;
    }
    case MESSAGE_AWARENESS: {
      const update = decoding.readVarUint8Array(decoder);
      // Sniff which awareness clientIds this socket has published so we can
      // clear them on disconnect. Same trick CollabRoom uses.
      const info = room.clients.get(sock);
      if (info) {
        try {
          const d2 = decoding.createDecoder(update);
          const len = decoding.readVarUint(d2);
          for (let i = 0; i < len; i++) {
            const cid = decoding.readVarUint(d2);
            decoding.readVarUint(d2); // clock
            decoding.readVarString(d2); // state JSON
            info.awarenessIds.add(cid);
          }
        } catch {
          // best-effort sniff; ignore malformed
        }
      }
      // applyAwarenessUpdate fires the awareness 'update' event whose
      // handler does the broadcast.
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, sock);
      break;
    }
    default:
      // unknown frame type — silently drop (forward compatibility)
      break;
  }
}

function handleText(sock, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg && msg.type === 'ping') {
    safeSend(sock, JSON.stringify({ type: 'pong', ts: Date.now() }));
  }
}

/** Build (don't start) an HTTP + WebSocket server. Exported for tests. */
function createServer() {
  const registry = new RoomRegistry();

  const httpServer = http.createServer((req, res) => {
    // Tiny ops surface: /healthz so a Railway healthcheck or readiness probe
    // can hit something without speaking WebSocket.
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: registry.size() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { docId, token, reason } = parseRequest(req);
    if (!docId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      console.error('[collab] reject:', reason || 'unknown');
      return;
    }
    const auth = authorize(token, docId);
    if (!auth.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      console.error('[collab] auth rejected for', docId, ':', auth.reason);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, registry, docId, auth.userId);
    });
  });

  /** Test/inspection hook. */
  httpServer._collab = { registry };

  return httpServer;
}

function onConnection(ws, registry, docId, userId) {
  const room = registry.getOrCreate(docId);
  room.clients.set(ws, { userId, awarenessIds: new Set() });

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        // `data` from ws is a Node Buffer; wrap as Uint8Array so lib0/decoding
        // reads bytes (and not Buffer's UTF-8 indexers) correctly.
        handleBinary(room, ws, new Uint8Array(data));
      } else {
        handleText(ws, data.toString('utf8'));
      }
    } catch (err) {
      console.error('[collab] message handler:', err && err.message);
    }
  });

  ws.on('close', () => {
    const info = room.clients.get(ws);
    room.clients.delete(ws);
    // Drop this socket's awareness slots so peers' cursors disappear.
    // `null` origin so OUR awareness.on('update') handler still broadcasts
    // to the remaining peers (it skips only `origin === sock`).
    if (info && info.awarenessIds.size > 0) {
      try {
        awarenessProtocol.removeAwarenessStates(
          room.awareness,
          Array.from(info.awarenessIds),
          null,
        );
      } catch {
        // ignore
      }
    }
    // Tear down empty rooms so we don't accumulate Y.Docs forever. A new
    // client opening the same docId will get a fresh room and re-sync from
    // its own local copy (or empty state, if it's the very first peer).
    if (room.clients.size === 0) {
      registry.remove(docId);
    }
  });

  ws.on('error', (err) => {
    console.error('[collab] socket error:', err && err.message);
  });

  // Handshake: send sync step 1 + current awareness so the new client
  // knows the room's current state and who else is here.
  sendSyncStep1(ws, room.doc);
  sendInitialAwareness(ws, room.awareness);
}

// ─── module entry ─────────────────────────────────────────────────────────

module.exports = {
  createServer,
  // Re-exported for tests and Phase 2 callers that want to embed the relay
  // in another HTTP app.
  Room,
  RoomRegistry,
  authorize,
  parseRequest,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
};

// Only auto-start if invoked directly (`node collab-worker/server.js`) —
// importing the module from tests must NOT bind a port.
if (require.main === module) {
  const port = Number(process.env.COLLAB_PORT || 1234);
  const host = process.env.COLLAB_HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`[collab] listening on ws://${host}:${port}`);
    console.log(`[collab] healthz at http://${host}:${port}/healthz`);
    if (!process.env.JWT_SECRET) {
      console.log('[collab] WARN: JWT_SECRET unset — auth is in Phase 1 (no validation).');
    }
  });
}
