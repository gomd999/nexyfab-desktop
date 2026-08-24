/**
 * collab-worker/server.test.js — node:test suite for the Yjs relay.
 *
 * Lives outside `src/` so it does NOT get picked up by vitest (which scopes
 * to `src/**\/*.test.ts`). Run with:
 *
 *     node --test collab-worker/server.test.js
 *
 * Coverage:
 *   1. createServer returns an HTTP server with no port binding
 *   2. listen() binds the configured port
 *   3. /healthz returns 200 + JSON
 *   4. invalid pathname (control chars) → 400 during upgrade
 *   5. WebSocket accept lifecycle (connect + close cleans up the room)
 *   6. Two clients in same room: Y.Map update on A is seen by B
 *   7. Awareness update on A is seen by B
 *   8. Room isolation: clients on different docIds DO NOT see each other
 *   9. parseRequest: empty path → 'default'
 *  10. parseRequest: token round-trip
 *  11. authorize: tokenless → ok / anonymous
 *  12. authorize: token → ok / tok-<prefix>
 *  13. Three+ clients in a room all converge on the same state
 *  14. Client disconnect removes its awareness slot for peers
 *  15. Reconnect after empty-room teardown: room is rebuilt cleanly
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const WebSocket = require('ws');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');

const {
  createServer,
  parseRequest,
  authorize,
  collabRuntimeSettings,
} = require('./server.js');

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Boot the relay on an ephemeral port and return `{ url, server, close }`.
 * `close()` waits for the server to fully close — important for test
 * isolation since ws keeps the event loop alive.
 */
function bootServer(options = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(options);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const url = `ws://127.0.0.1:${addr.port}`;
      resolve({
        url,
        server,
        rooms: () => server._collab.registry,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

/**
 * Connect a Y.Doc + WebsocketProvider to a room and resolve once the
 * provider reports `synced`. y-websocket's WebsocketProvider takes
 * `(serverUrl, roomName, doc, opts)` and appends `serverUrl/roomName`
 * itself, so we pass the base URL.
 */
function connectClient(serverUrl, docId, ydoc) {
  const provider = new WebsocketProvider(serverUrl, docId, ydoc, {
    WebSocketPolyfill: WebSocket,
    connect: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`client did not sync within 3000ms (doc=${docId})`));
    }, 3000);
    const onSync = (synced) => {
      if (!synced) return;
      clearTimeout(timer);
      provider.off('sync', onSync);
      resolve(provider);
    };
    provider.on('sync', onSync);
  });
}

/** Poll until `pred()` returns truthy or timeout. */
function waitUntil(pred, timeoutMs = 2000, intervalMs = 20) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let ok = false;
      try { ok = !!pred(); } catch (e) { return reject(e); }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('waitUntil timed out'));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function destroyProvider(provider) {
  return new Promise((resolve) => {
    // y-websocket emits 'connection-close' synchronously on destroy in the
    // happy path; we just resolve on next tick.
    try { provider.destroy(); } catch { /* ignore */ }
    setTimeout(resolve, 30);
  });
}

// ─── unit tests (no port) ─────────────────────────────────────────────────

test('parseRequest: empty path → default docId', () => {
  const out = parseRequest({ url: '/' });
  assert.equal(out.docId, 'default');
  assert.equal(out.token, null);
});

test('parseRequest: docId + token round-trip', () => {
  const out = parseRequest({ url: '/project-42?token=abc123' });
  assert.equal(out.docId, 'project-42');
  assert.equal(out.token, 'abc123');
});

test('parseRequest: control chars rejected', () => {
  const out = parseRequest({ url: '/bad\x01id' });
  assert.equal(out.docId, null);
  assert.equal(out.reason, 'invalid-doc-id');
});

test('authorize: tokenless → ok/anonymous', () => {
  const a = authorize(null, 'doc1');
  assert.deepEqual(a, { ok: true, userId: 'anonymous' });
});

test('authorize: token → ok with tok- prefix', () => {
  const a = authorize('abcdefghij', 'doc1');
  assert.equal(a.ok, true);
  assert.equal(a.userId, 'tok-abcdefgh');
});

function workerToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('authorize: strict mode verifies HS256, expiry, subject, and optional document binding', () => {
  const secret = 'strict-collab-secret-that-is-32-chars';
  const valid = workerToken({ sub: 'user-1', exp: 2_000, docId: 'doc1' }, secret);
  assert.deepEqual(authorize(valid, 'doc1', { requireAuth: true, jwtSecret: secret, nowSeconds: 1_000 }), { ok: true, userId: 'user-1' });
  assert.equal(authorize(valid, 'doc2', { requireAuth: true, jwtSecret: secret, nowSeconds: 1_000 }).reason, 'token_doc_mismatch');
  assert.equal(authorize(valid, 'doc1', { requireAuth: true, jwtSecret: secret, nowSeconds: 2_000 }).reason, 'token_expired');
  assert.equal(authorize(`${valid}x`, 'doc1', { requireAuth: true, jwtSecret: secret, nowSeconds: 1_000 }).reason, 'token_invalid');
  const invalidDocClaim = workerToken({ sub: 'user-1', exp: 2_000, docId: 42 }, secret);
  assert.equal(authorize(invalidDocClaim, 'doc1', { requireAuth: true, jwtSecret: secret, nowSeconds: 1_000 }).reason, 'token_doc_mismatch');
});

test('runtime settings require auth secret and origin allowlist in production', () => {
  assert.deepEqual(collabRuntimeSettings({ NODE_ENV: 'production' }).issues, [
    'jwt_secret_missing_or_short',
    'allowed_origins_missing',
  ]);
  assert.deepEqual(collabRuntimeSettings({
    NODE_ENV: 'production',
    JWT_SECRET: 'strict-collab-secret-that-is-32-chars',
    ALLOWED_ORIGINS: 'https://nexyfab.com',
  }).issues, []);
  assert.deepEqual(collabRuntimeSettings({
    NODE_ENV: 'production',
    JWT_SECRET: 'strict-collab-secret-that-is-32-chars',
    ALLOWED_ORIGINS: 'http://nexyfab.com/path',
  }).issues, ['allowed_origins_invalid']);
  assert.throws(() => collabRuntimeSettings({ MAX_CLIENTS_PER_ROOM: 'NaN' }), /MAX_CLIENTS_PER_ROOM_INVALID/);
});

test('createServer: HTTP server is unbound by default', () => {
  const s = createServer();
  assert.equal(s.address(), null, 'server should not be listening yet');
  s.close();
});

// ─── integration tests (boot a real server) ───────────────────────────────

test('listen: binds the requested port', async () => {
  const { server, close } = await bootServer();
  const addr = server.address();
  assert.ok(addr && typeof addr.port === 'number' && addr.port > 0);
  await close();
});

test('GET /healthz: returns 200 JSON with room count', async () => {
  const { server, close } = await bootServer();
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.rooms, 'number');
  await close();
});

test('GET /healthz: strict deployment fails closed when auth configuration is incomplete', async () => {
  const { server, close } = await bootServer({ env: { NODE_ENV: 'production' } });
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.issues, ['jwt_secret_missing_or_short', 'allowed_origins_missing']);
  await close();
});

test('WebSocket: accept + close cleans up the room', async () => {
  const { url, rooms, close } = await bootServer();
  const doc = new Y.Doc();
  const provider = await connectClient(url, 'room-cleanup', doc);
  await waitUntil(() => rooms().rooms.has('room-cleanup'));
  assert.equal(rooms().rooms.get('room-cleanup').clients.size, 1);

  await destroyProvider(provider);
  doc.destroy();
  await waitUntil(() => rooms().rooms.size === 0);
  await close();
});

test('two clients in same room: Y.Map update on A is seen by B', async () => {
  const { url, close } = await bootServer();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const provA = await connectClient(url, 'shared-1', docA);
  const provB = await connectClient(url, 'shared-1', docB);

  docA.getMap('state').set('hello', 'world');
  await waitUntil(() => docB.getMap('state').get('hello') === 'world');
  assert.equal(docB.getMap('state').get('hello'), 'world');

  await destroyProvider(provA);
  await destroyProvider(provB);
  docA.destroy();
  docB.destroy();
  await close();
});

test('awareness update on A is seen by B', async () => {
  const { url, close } = await bootServer();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const provA = await connectClient(url, 'aw-1', docA);
  const provB = await connectClient(url, 'aw-1', docB);

  provA.awareness.setLocalStateField('cursor', { x: 10, y: 20 });
  // B's awareness should pick up A's clientID with a 'cursor' field
  await waitUntil(() => {
    for (const [cid, state] of provB.awareness.getStates()) {
      if (cid === provB.awareness.clientID) continue;
      if (state && state.cursor && state.cursor.x === 10) return true;
    }
    return false;
  });

  await destroyProvider(provA);
  await destroyProvider(provB);
  docA.destroy();
  docB.destroy();
  await close();
});

test('room isolation: clients in different docIds do NOT see each other', async () => {
  const { url, close } = await bootServer();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const provA = await connectClient(url, 'iso-A', docA);
  const provB = await connectClient(url, 'iso-B', docB);

  docA.getMap('state').set('only-in-A', 'A-value');
  // Give the message a fair chance to leak (it shouldn't).
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(
    docB.getMap('state').get('only-in-A'),
    undefined,
    'B in a different room must not see A\'s update',
  );

  await destroyProvider(provA);
  await destroyProvider(provB);
  docA.destroy();
  docB.destroy();
  await close();
});

test('three clients converge on the same state', async () => {
  const { url, close } = await bootServer();
  const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
  const provs = await Promise.all(
    docs.map((d) => connectClient(url, 'three-way', d)),
  );

  docs[0].getMap('state').set('a', 1);
  docs[1].getMap('state').set('b', 2);
  docs[2].getMap('state').set('c', 3);

  await waitUntil(() =>
    docs.every((d) =>
      d.getMap('state').get('a') === 1 &&
      d.getMap('state').get('b') === 2 &&
      d.getMap('state').get('c') === 3,
    ),
  );

  await Promise.all(provs.map(destroyProvider));
  docs.forEach((d) => d.destroy());
  await close();
});

test('client disconnect removes its awareness slot for peers', async () => {
  const { url, close } = await bootServer();
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const provA = await connectClient(url, 'leaver', docA);
  const provB = await connectClient(url, 'leaver', docB);

  provA.awareness.setLocalStateField('cursor', { x: 1, y: 1 });
  await waitUntil(() => provB.awareness.getStates().has(provA.awareness.clientID));

  await destroyProvider(provA);
  // Peer's awareness map should eventually drop A's clientID. y-protocols
  // sends removeAwarenessStates with the leaving clientIds.
  await waitUntil(
    () => !provB.awareness.getStates().has(provA.awareness.clientID),
    2500,
  );

  await destroyProvider(provB);
  docA.destroy();
  docB.destroy();
  await close();
});

test('reconnect after empty-room teardown: room is rebuilt cleanly', async () => {
  const { url, rooms, close } = await bootServer();

  // First session: open, write, close.
  const doc1 = new Y.Doc();
  const prov1 = await connectClient(url, 'recycled', doc1);
  doc1.getMap('state').set('phase', 'one');
  await destroyProvider(prov1);
  doc1.destroy();
  await waitUntil(() => !rooms().rooms.has('recycled'));

  // Second session: same docId, but the server room is gone. A fresh client
  // with no prior state should connect cleanly (empty room).
  const doc2 = new Y.Doc();
  const prov2 = await connectClient(url, 'recycled', doc2);
  // Phase 1 has no persistence, so the value from session 1 must NOT
  // reappear. This documents the trade-off; persistence is Phase 2.
  assert.equal(doc2.getMap('state').get('phase'), undefined);
  doc2.getMap('state').set('phase', 'two');
  // And the new write is observable via a third peer joining same room.
  const doc3 = new Y.Doc();
  const prov3 = await connectClient(url, 'recycled', doc3);
  await waitUntil(() => doc3.getMap('state').get('phase') === 'two');

  await destroyProvider(prov2);
  await destroyProvider(prov3);
  doc2.destroy();
  doc3.destroy();
  await close();
});
