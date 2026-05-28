// ─── Client example — paste into the Next.js app (NOT bundled here) ─────────
//
// This file is reference-only. It is NOT deployed with the worker.
// Copy it into `src/lib/collab/yjs-client.ts` in the main app and adapt.

/* eslint-disable */
// @ts-nocheck

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface YjsClientOptions {
  /** wss://collab.nexyfab.com */
  endpoint: string;
  /** Document id (e.g. project id). */
  docId: string;
  /** Short-lived JWT from /api/nexyfab/worker-token. */
  token: string;
  /** Optional: existing Y.Doc to attach. */
  doc?: Y.Doc;
}

export interface YjsClient {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  socket: WebSocket;
  destroy(): void;
}

export function connect(opts: YjsClientOptions): YjsClient {
  const doc = opts.doc ?? new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  const url = `${opts.endpoint}/ws/${encodeURIComponent(opts.docId)}?token=${encodeURIComponent(opts.token)}`;
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => {
    // Send sync step 1 unsolicited as well — handy after reconnect.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    socket.send(encoding.toUint8Array(encoder));

    // Publish initial awareness if a localState was already set.
    if (awareness.getLocalState() !== null) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        a,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
      );
      socket.send(encoding.toUint8Array(a));
    }
  });

  socket.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') return; // ignore ping/pong JSON
    const data = new Uint8Array(ev.data);
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, null);
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        socket,
      );
    }
  });

  doc.on('update', (update: Uint8Array, origin: any) => {
    if (origin === socket) return; // came from server
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoding.toUint8Array(encoder));
    }
  });

  awareness.on('update', ({ added, updated, removed }: any, origin: any) => {
    if (origin === socket) return;
    const changed = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(encoding.toUint8Array(encoder));
    }
  });

  return {
    doc,
    awareness,
    socket,
    destroy() {
      try { socket.close(1000, 'client destroy'); } catch {}
      awareness.destroy();
      doc.destroy();
    },
  };
}
