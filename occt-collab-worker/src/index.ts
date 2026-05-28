// ─── occt-collab-worker — entrypoint ─────────────────────────────────────────
//
// Routes:
//   GET  /                        → health probe
//   GET  /healthz                 → JSON health
//   GET  /ws/:docId?token=<jwt>   → upgrade to WebSocket, forward to DO
//   GET  /rooms/:docId/snapshot   → read latest snapshot (server-side debug)
//   POST /rooms/:docId/flush      → force snapshot write (admin)
//
// All authenticated routes accept the same HS256 JWT used by the main app.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { extractToken, verifyJWT } from './auth';

export { CollabRoom } from './CollabRoom';

export interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  COLLAB_SNAPSHOTS: KVNamespace;
  JWT_SECRET: string;
  SNAPSHOT_INTERVAL_MS: string;
  IDLE_TIMEOUT_MS: string;
  MAX_CLIENTS_PER_ROOM: string;
  ALLOWED_ORIGINS: string;
}

const DOC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const app = new Hono<{ Bindings: Env }>();

// ─── CORS (HTTP routes only; WS upgrades bypass CORS) ────────────────────────

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const handler = cors({
    origin: (origin) => {
      if (!origin) return null;
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 3600,
  });
  return handler(c, next);
});

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/', (c) => c.text('occt-collab-worker ok'));

app.get('/healthz', (c) =>
  c.json({
    ok: true,
    service: 'occt-collab-worker',
    ts: Date.now(),
  }),
);

// ─── WebSocket upgrade → Durable Object ──────────────────────────────────────

app.get('/ws/:docId', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }

  const docId = c.req.param('docId');
  if (!docId || !DOC_ID_RE.test(docId)) {
    return c.text('Invalid docId', 400);
  }

  // Origin check — browsers always send Origin on WS handshake.
  const origin = c.req.header('Origin');
  const allowed = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim());
  if (origin && !allowed.includes(origin)) {
    return c.text('Forbidden origin', 403);
  }

  // JWT verify.
  const token = extractToken(c.req.raw);
  if (!token) return c.text('Missing token', 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.text('Invalid or expired token', 401);

  // Authorization at room level lives elsewhere (main app's collab ACLs).
  // This worker only proves token authenticity; the DO trusts the principal
  // claims we forward via headers.

  // Route to the DO instance owning this docId.
  const id = c.env.COLLAB_ROOM.idFromName(docId);
  const stub = c.env.COLLAB_ROOM.get(id);

  // Forward the upgrade. Attach principal claims as headers so the DO does
  // not need to re-verify the JWT.
  const forwardUrl = new URL(c.req.raw.url);
  forwardUrl.pathname = `/__do/ws/${docId}`;
  forwardUrl.searchParams.delete('token');

  const forwardReq = new Request(forwardUrl.toString(), {
    method: 'GET',
    headers: {
      Upgrade: 'websocket',
      'X-User-Id': payload.sub,
      'X-User-Email': payload.email,
      'X-User-Plan': payload.plan ?? 'free',
      'X-Doc-Id': docId,
    },
  });

  return stub.fetch(forwardReq);
});

// ─── Snapshot read (debug / admin) ───────────────────────────────────────────

app.get('/rooms/:docId/snapshot', async (c) => {
  const token = extractToken(c.req.raw);
  if (!token) return c.json({ error: 'Missing token' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  const docId = c.req.param('docId');
  if (!docId || !DOC_ID_RE.test(docId)) {
    return c.json({ error: 'Invalid docId' }, 400);
  }

  const meta = await c.env.COLLAB_SNAPSHOTS.getWithMetadata<{
    updatedAt: number;
    size: number;
  }>(`snap:${docId}`, 'arrayBuffer');

  if (!meta.value) return c.json({ error: 'Not found' }, 404);

  return new Response(meta.value, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Snapshot-Updated-At': String(meta.metadata?.updatedAt ?? ''),
      'X-Snapshot-Size': String(meta.metadata?.size ?? meta.value.byteLength),
    },
  });
});

// ─── Force snapshot flush (admin / cron) ─────────────────────────────────────

app.post('/rooms/:docId/flush', async (c) => {
  const token = extractToken(c.req.raw);
  if (!token) return c.json({ error: 'Missing token' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  const docId = c.req.param('docId');
  if (!docId || !DOC_ID_RE.test(docId)) {
    return c.json({ error: 'Invalid docId' }, 400);
  }

  const id = c.env.COLLAB_ROOM.idFromName(docId);
  const stub = c.env.COLLAB_ROOM.get(id);
  const res = await stub.fetch(`https://internal/__do/flush/${docId}`, {
    method: 'POST',
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('[occt-collab-worker] unhandled:', err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
