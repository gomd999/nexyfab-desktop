// ─── CollabRoom — Durable Object holding one Y.Doc per documentId ────────────
//
// Wire protocol (binary):
//   [0] = MESSAGE_SYNC      → y-protocols/sync (state vector, update, …)
//   [1] = MESSAGE_AWARENESS → y-protocols/awareness (cursor, presence)
//
// Wire protocol (text, JSON):
//   { type: "ping" }       → server replies { type: "pong" }
//   { type: "error", … }   → server-emitted only
//
// Persistence:
//   - On first connect, load `snap:<docId>` from KV and apply as an update.
//   - Every SNAPSHOT_INTERVAL_MS while clients are connected, write a fresh
//     Y.encodeStateAsUpdate() to KV.
//   - On final client disconnect, write one last snapshot.
//   - IDLE_TIMEOUT_MS after the last client leaves, DO state self-evicts via
//     alarm so we do not keep memory pinned.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface Env {
  COLLAB_SNAPSHOTS: KVNamespace;
  SNAPSHOT_INTERVAL_MS: string;
  IDLE_TIMEOUT_MS: string;
  MAX_CLIENTS_PER_ROOM: string;
}

interface ClientInfo {
  userId: string;
  email: string;
  plan: string;
  connectedAt: number;
  /** Awareness clientIds this socket has published. Used to clean up on close. */
  awarenessIds: Set<number>;
}

export class CollabRoom implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private docId: string | null = null;

  private loadedFromKV = false;
  private snapshotTimer: number | null = null;
  private dirty = false;          // unsaved changes since last snapshot

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.attachDocListeners();
    // Awareness is local to this DO; the server is a relay, not a participant.
    this.awareness.setLocalState(null);
  }

  /** Attach 'update' listener so we know when to flush. */
  private attachDocListeners(): void {
    this.doc.on('update', () => {
      this.dirty = true;
    });
  }

  // ─── HTTP entry from index.ts ──────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /__do/flush/:docId — force snapshot
    if (url.pathname.startsWith('/__do/flush/')) {
      const docId = url.pathname.slice('/__do/flush/'.length);
      await this.ensureLoaded(docId);
      const wrote = await this.snapshotIfDirty();
      return Response.json({ ok: true, wrote, clients: this.clients.size });
    }

    // GET /__do/ws/:docId — WebSocket upgrade
    if (url.pathname.startsWith('/__do/ws/')) {
      const docId = url.pathname.slice('/__do/ws/'.length);
      return this.handleWebSocket(request, docId);
    }

    return new Response('Not found', { status: 404 });
  }

  // ─── WebSocket handshake ───────────────────────────────────────────────────

  private async handleWebSocket(
    request: Request,
    docId: string,
  ): Promise<Response> {
    const max = Number(this.env.MAX_CLIENTS_PER_ROOM ?? '20');
    if (this.clients.size >= max) {
      return new Response('Room full', { status: 429 });
    }

    await this.ensureLoaded(docId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const info: ClientInfo = {
      userId: request.headers.get('X-User-Id') ?? 'anonymous',
      email: request.headers.get('X-User-Email') ?? '',
      plan: request.headers.get('X-User-Plan') ?? 'free',
      connectedAt: Date.now(),
      awarenessIds: new Set<number>(),
    };
    this.clients.set(server, info);

    // Cancel any pending idle eviction now that someone has joined.
    await this.state.storage.deleteAlarm();

    // Start snapshot loop on first client.
    if (this.clients.size === 1) {
      this.startSnapshotLoop();
    }

    server.addEventListener('message', (event) => {
      this.onMessage(server, event.data).catch((err) => {
        console.error('[CollabRoom] message handler:', err);
      });
    });

    server.addEventListener('close', () => {
      this.onClose(server).catch((err) => {
        console.error('[CollabRoom] close handler:', err);
      });
    });

    server.addEventListener('error', (err) => {
      console.error('[CollabRoom] ws error:', err);
    });

    // Send Yjs sync step 1 (state vector request) so the client can send
    // missing updates back. y-protocols/sync writes the proper framing.
    this.sendSyncStep1(server);

    // Send current awareness so the new client knows who else is here.
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      this.sendBinary(server, encoding.toUint8Array(encoder));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Message handling ──────────────────────────────────────────────────────

  private async onMessage(
    sender: WebSocket,
    raw: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof raw === 'string') {
      // JSON control channel (ping / pong only for now).
      try {
        const msg = JSON.parse(raw) as { type?: string };
        if (msg.type === 'ping') {
          sender.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // ignore malformed control frames
      }
      return;
    }

    const data = new Uint8Array(raw);
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        // Peek the inner sync sub-type without consuming the outer decoder.
        // We need this to decide whether to rebroadcast to peers (Step2 and
        // Update are state-bearing; Step1 is just a query and stays local).
        const peekDecoder = decoding.createDecoder(data);
        decoding.readVarUint(peekDecoder); // outer MESSAGE_SYNC
        const syncSubType = decoding.readVarUint(peekDecoder);

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, sender);

        // Reply to the sender only if the protocol actually produced a reply
        // (e.g. Step2 in response to Step1).
        if (encoding.length(encoder) > 1) {
          this.sendBinary(sender, encoding.toUint8Array(encoder));
        }

        // Fan out Step2 / Update to all peers so they converge. Step1 is a
        // local query and is not propagated.
        if (
          syncSubType === syncProtocol.messageYjsSyncStep2 ||
          syncSubType === syncProtocol.messageYjsUpdate
        ) {
          this.broadcast(sender, data);
        }
        break;
      }

      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        // Track which awareness client IDs this socket owns so we can
        // remove them on disconnect. We sniff the update before applying.
        const info = this.clients.get(sender);
        if (info) {
          try {
            const d2 = decoding.createDecoder(update);
            const len = decoding.readVarUint(d2);
            for (let i = 0; i < len; i++) {
              const cid = decoding.readVarUint(d2);
              decoding.readVarUint(d2);            // clock
              decoding.readVarString(d2);          // state JSON
              info.awarenessIds.add(cid);
            }
          } catch {
            // best-effort sniff; ignore malformed
          }
        }
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, sender);
        // Awareness updates are always broadcast to all other peers.
        this.broadcast(sender, data);
        break;
      }

      default:
        // unknown message — silently drop
        break;
    }
  }

  private async onClose(sock: WebSocket): Promise<void> {
    const info = this.clients.get(sock);
    this.clients.delete(sock);

    // Tell remaining peers this awareness client is gone. removeAwarenessStates
    // emits an awareness update via the 'update' event, but since we don't have
    // a local awareness listener here, we manually broadcast a removal frame.
    if (info && info.awarenessIds.size > 0) {
      const ids = Array.from(info.awarenessIds);
      awarenessProtocol.removeAwarenessStates(this.awareness, ids, null);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids),
      );
      const payload = encoding.toUint8Array(encoder);
      for (const peer of this.clients.keys()) {
        this.sendBinary(peer, payload);
      }
    }

    // Last client out → final snapshot + schedule idle eviction.
    if (this.clients.size === 0) {
      this.stopSnapshotLoop();
      await this.snapshotIfDirty();
      const idleMs = Number(this.env.IDLE_TIMEOUT_MS ?? '1800000');
      await this.state.storage.setAlarm(Date.now() + idleMs);
    }
  }

  // ─── Yjs helpers ───────────────────────────────────────────────────────────

  private sendSyncStep1(sock: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.sendBinary(sock, encoding.toUint8Array(encoder));
  }

  private sendBinary(sock: WebSocket, payload: Uint8Array): void {
    try {
      sock.send(payload);
    } catch (err) {
      console.error('[CollabRoom] send failed:', err);
      this.clients.delete(sock);
    }
  }

  private broadcast(except: WebSocket, payload: Uint8Array): void {
    for (const peer of this.clients.keys()) {
      if (peer === except) continue;
      this.sendBinary(peer, payload);
    }
  }

  // ─── KV persistence ────────────────────────────────────────────────────────

  private async ensureLoaded(docId: string): Promise<void> {
    if (this.loadedFromKV && this.docId === docId) return;
    this.docId = docId;

    const stored = await this.env.COLLAB_SNAPSHOTS.get(
      `snap:${docId}`,
      'arrayBuffer',
    );
    if (stored && stored.byteLength > 0) {
      try {
        Y.applyUpdate(this.doc, new Uint8Array(stored));
        // Loading from KV should NOT mark dirty (no new edits yet).
        this.dirty = false;
      } catch (err) {
        console.error('[CollabRoom] failed to apply snapshot:', err);
      }
    }
    this.loadedFromKV = true;
  }

  private async snapshotIfDirty(): Promise<boolean> {
    if (!this.dirty || !this.docId) return false;
    const update = Y.encodeStateAsUpdate(this.doc);
    // KV accepts ArrayBufferView directly; passing `update.buffer` would risk
    // shipping the entire backing buffer if it's a subarray.
    await this.env.COLLAB_SNAPSHOTS.put(`snap:${this.docId}`, update, {
      metadata: {
        updatedAt: Date.now(),
        size: update.byteLength,
        clients: this.clients.size,
      },
    });
    this.dirty = false;
    return true;
  }

  private startSnapshotLoop(): void {
    if (this.snapshotTimer !== null) return;
    const interval = Number(this.env.SNAPSHOT_INTERVAL_MS ?? '30000');
    this.snapshotTimer = setInterval(() => {
      this.snapshotIfDirty().catch((err) => {
        console.error('[CollabRoom] snapshot loop:', err);
      });
    }, interval) as unknown as number;
  }

  private stopSnapshotLoop(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // ─── Alarm (idle eviction) ─────────────────────────────────────────────────

  async alarm(): Promise<void> {
    if (this.clients.size > 0) {
      // Spurious — someone reconnected before alarm fired. Reschedule.
      const idleMs = Number(this.env.IDLE_TIMEOUT_MS ?? '1800000');
      await this.state.storage.setAlarm(Date.now() + idleMs);
      return;
    }
    // Final snapshot for safety and then release in-memory state. The DO
    // class instance will be reconstructed on next request.
    await this.snapshotIfDirty();
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.attachDocListeners();
    this.awareness.setLocalState(null);
    this.loadedFromKV = false;
    this.docId = null;
  }
}
