/**
 * collab-worker/cloudflare/index.ts — Cloudflare Workers + Durable Objects
 * scaffold for the Yjs collab relay.
 *
 * This is a Phase 1 SCAFFOLD: it shows the shape we'd take when promoting
 * the Node.js relay (../server.js) to per-doc Durable Object scaling, but
 * the production-grade version already lives in occt-collab-worker/. The
 * intent here is to make it obvious which knobs flip when picking the
 * Cloudflare option (see ../README.md "Deployment options").
 *
 * Topology:
 *   Browser ──ws──▶ Worker ──fetch(Upgrade)──▶ DurableObject(idFromName(docId))
 *                    │                            │
 *                    │ (origin / token check)     │ Y.Doc + Awareness in memory
 *                    │                            │ KV snapshot every 30s (Phase 2)
 *                    └─ /healthz                  └─ alarm() to evict idle rooms
 *
 * For a *finished* Cloudflare implementation, see:
 *   occt-collab-worker/src/index.ts
 *   occt-collab-worker/src/CollabRoom.ts
 *
 * What this scaffold provides:
 *   1. Worker entrypoint with /healthz and WebSocket upgrade routing.
 *   2. Durable Object stub (`CollabRoomDO`) that accepts the upgrade,
 *      runs the same in-memory Y.Doc + Awareness model as server.js, and
 *      relays sync/awareness frames between connected clients in the room.
 *   3. Auth shim that mirrors authorize() in server.js (Phase 1: pass-through,
 *      Phase 2: HS256 verify + nfProjectAccess).
 *
 * What this scaffold does NOT do (Phase 2 wishlist):
 *   - KV snapshot loop (see CollabRoom.ts in occt-collab-worker).
 *   - Idle-room alarm eviction (DurableObject.state.storage.setAlarm).
 *   - Custom-domain route binding (configure in wrangler.toml).
 *   - JWT verification (just trusts ?token=).
 */

// NOTE: This file is a Workers TypeScript module. It will not typecheck under
// the main app's tsconfig.json — it expects @cloudflare/workers-types in a
// dedicated `collab-worker/cloudflare/tsconfig.json` (Phase 2: when we wire
// `wrangler.toml` here). Until then it lives as a reference document for the
// shape of the worker.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const WebSocketPair: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DurableObjectState = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DurableObjectNamespace = any;

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface Env {
  COLLAB_ROOM: DurableObjectNamespace;
  /** Phase 2: HS256 secret to verify the worker-token. */
  JWT_SECRET?: string;
  /** Optional CSV of origins allowed to open WebSocket connections. */
  ALLOWED_ORIGINS?: string;
}

// ─── Worker entrypoint ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, transport: 'cloudflare-do' });
    }

    // WebSocket upgrade — route by docId so each doc gets its own DO.
    if (request.headers.get('Upgrade') === 'websocket') {
      // Path convention: /ws/<docId>. Anything else falls through to 404.
      const match = url.pathname.match(/^\/ws\/([^/]+)\/?$/);
      if (!match) return new Response('Not found', { status: 404 });
      const docId = decodeURIComponent(match[1]);

      // Origin allowlist (defence in depth on top of token auth).
      const allowed = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      const origin = request.headers.get('Origin') || '';
      if (allowed.length > 0 && origin && !allowed.includes(origin)) {
        return new Response('Forbidden origin', { status: 403 });
      }

      // Phase 1 auth: pass-through. Phase 2: verify ?token= against JWT_SECRET.
      const token = url.searchParams.get('token') || '';
      const auth = authorize(token, docId, env);
      if (!auth.ok) return new Response('Unauthorized', { status: 401 });

      // Route to per-doc DO. `idFromName(docId)` is deterministic so every
      // client editing the same docId lands on the same instance.
      const id = env.COLLAB_ROOM.idFromName(docId);
      const stub = env.COLLAB_ROOM.get(id);
      // Forward the upgrade with extra headers the DO will read on accept.
      const forwarded = new Request(
        new URL(`/__do/ws/${encodeURIComponent(docId)}`, request.url),
        request,
      );
      forwarded.headers.set('X-User-Id', auth.userId);
      return stub.fetch(forwarded);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── Auth (Phase 1 pass-through; Phase 2 will HS256-verify) ───────────────

function authorize(
  token: string,
  _docId: string,
  _env: Env,
): { ok: boolean; userId: string; reason?: string } {
  if (!token) return { ok: true, userId: 'anonymous' };
  // TODO Phase 2: jose.jwtVerify(token, secret) + check payload.sub/exp +
  // check nfProjectAccess(payload.sub, docId). For now we just stash a
  // short prefix as the userId.
  return { ok: true, userId: 'tok-' + token.slice(0, 8) };
}

// ─── Durable Object: one instance per docId ───────────────────────────────

interface ClientInfo {
  userId: string;
  awarenessIds: Set<number>;
}

export class CollabRoomDO {
  private readonly state: DurableObjectState;
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private clients: Map<WebSocket, ClientInfo> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);

    // Fan out local awareness/doc updates exactly as the Node server does.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const payload = encoding.toUint8Array(encoder);
      for (const sock of this.clients.keys()) {
        if (sock === origin) continue;
        try { sock.send(payload); } catch { /* mid-close */ }
      }
    });

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        const payload = encoding.toUint8Array(encoder);
        for (const sock of this.clients.keys()) {
          if (sock === origin) continue;
          try { sock.send(payload); } catch { /* mid-close */ }
        }
      },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__do/ws/')) {
      return new Response('Not found', { status: 404 });
    }
    return this.acceptWebSocket(request);
  }

  private acceptWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const userId = request.headers.get('X-User-Id') || 'anonymous';
    this.clients.set(server, { userId, awarenessIds: new Set() });

    server.addEventListener('message', (event: MessageEvent) => {
      try {
        if (typeof event.data === 'string') {
          this.handleText(server, event.data);
        } else {
          this.handleBinary(server, new Uint8Array(event.data as ArrayBuffer));
        }
      } catch (err) {
        console.error('[CollabRoomDO] message:', err);
      }
    });

    server.addEventListener('close', () => {
      const info = this.clients.get(server);
      this.clients.delete(server);
      if (info && info.awarenessIds.size > 0) {
        try {
          awarenessProtocol.removeAwarenessStates(
            this.awareness,
            Array.from(info.awarenessIds),
            null,
          );
        } catch { /* ignore */ }
      }
      // Phase 2: if (this.clients.size === 0) schedule alarm() for idle eviction.
    });

    // Initial sync + awareness.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    server.send(encoding.toUint8Array(syncEncoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(states.keys()),
        ),
      );
      server.send(encoding.toUint8Array(awEncoder));
    }

    // Cloudflare's WebSocket upgrade response. The `as unknown as Response`
    // dance is because @cloudflare/workers-types extends ResponseInit with
    // `webSocket`, but the plain DOM types don't know about it.
    return new Response(null, {
      status: 101,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      webSocket: client,
    } as any);
  }

  private handleBinary(sock: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, sock);
        if (encoding.length(encoder) > 1) {
          sock.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        const info = this.clients.get(sock);
        if (info) {
          try {
            const d2 = decoding.createDecoder(update);
            const len = decoding.readVarUint(d2);
            for (let i = 0; i < len; i++) {
              const cid = decoding.readVarUint(d2);
              decoding.readVarUint(d2);
              decoding.readVarString(d2);
              info.awarenessIds.add(cid);
            }
          } catch { /* best-effort sniff */ }
        }
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, sock);
        break;
      }
      default:
        // unknown frame — drop
        break;
    }
  }

  private handleText(sock: WebSocket, raw: string): void {
    let msg: { type?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') {
      sock.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    }
  }

  // Phase 2 hook: scheduled idle eviction.
  // async alarm(): Promise<void> { /* snapshot to KV + reset Y.Doc */ }
}
