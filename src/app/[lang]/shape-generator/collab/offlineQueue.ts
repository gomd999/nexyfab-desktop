/**
 * offlineQueue.ts — Offline edit queue + reconnect replay.
 *
 * When the SSE collab transport drops (network blip, server restart,
 * tab backgrounded), the local Y.Doc keeps accepting edits — Yjs is
 * a pure CRDT and doesn't care about connectivity. The problem is on
 * reconnect: the doc has diverged from the server's view, and the
 * server has its own diverged history from other peers' edits.
 *
 * The standard Yjs reconnect dance:
 *   1. On reconnect, exchange state vectors.
 *   2. Apply incoming `update` bytes to the local doc.
 *   3. Send outgoing `update` bytes derived from local state since
 *      the last server-known vector.
 *
 * This module wraps that dance plus a queue layer so:
 *   - Offline edits are batched into one or more pending updates.
 *   - On reconnect, the queue flushes in order with retry on failure.
 *   - Telemetry hooks let the UI show "syncing 42 edits…" banners.
 */

import * as Y from 'yjs';

export interface OfflineUpdate {
  /** Monotonically increasing local id for ordering / dedup. */
  id: number;
  /** Yjs update bytes (already encoded). */
  bytes: Uint8Array;
  /** ms timestamp when the edit was made locally. */
  createdAt: number;
}

export interface OfflineQueueOptions {
  /** Hard cap on queued updates before we coalesce. Default 500. */
  maxQueued?: number;
  /** Hook invoked on each flush attempt. Resolve = success, reject = retry. */
  send: (update: OfflineUpdate) => Promise<void>;
}

export class OfflineQueue {
  private queue: OfflineUpdate[] = [];
  private nextId = 1;
  private online = true;
  private flushing = false;

  constructor(private readonly opts: OfflineQueueOptions) {}

  /** Push a Yjs update onto the queue. Caller is responsible for
   *  observing the doc (`doc.on('update', bytes => queue.enqueue(bytes))`). */
  enqueue(bytes: Uint8Array): void {
    if (this.queue.length >= (this.opts.maxQueued ?? 500)) {
      // Coalesce — merge the new bytes into the most recent queued update
      // by encoding both as a combined Y.mergeUpdates payload.
      const last = this.queue[this.queue.length - 1];
      last.bytes = Y.mergeUpdates([last.bytes, bytes]);
      return;
    }
    this.queue.push({
      id: this.nextId++,
      bytes,
      createdAt: Date.now(),
    });
  }

  /** Mark the transport as online and trigger a flush. Idempotent. */
  setOnline(online: boolean): void {
    const transition = online && !this.online;
    this.online = online;
    if (transition) {
      // Fire-and-forget — caller observes via the `send` callback's resolves.
      void this.flush();
    }
  }

  /** Current state for UI / telemetry. */
  isOnline(): boolean { return this.online; }
  size(): number { return this.queue.length; }

  /** Drain the queue, one update at a time, awaiting each `send`.
   *  Stops on the first send rejection — the caller decides when to
   *  retry (we don't auto-retry to avoid hammering a flaky server). */
  async flush(): Promise<{ sent: number; failed: number }> {
    if (this.flushing) return { sent: 0, failed: 0 };
    if (!this.online) return { sent: 0, failed: 0 };
    this.flushing = true;
    let sent = 0;
    let failed = 0;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0];
        try {
          await this.opts.send(head);
          this.queue.shift();
          sent++;
        } catch {
          failed++;
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    return { sent, failed };
  }

  /** Drop everything pending. Used when the document is replaced
   *  (file close / new file). */
  clear(): void {
    this.queue = [];
  }

  /** Snapshot the queue for debugging — the returned array is a copy
   *  so the caller can mutate without disturbing internal state. */
  snapshot(): OfflineUpdate[] {
    return this.queue.map(u => ({ ...u, bytes: u.bytes.slice() }));
  }
}

/** Helper: install an observer on a Y.Doc that auto-enqueues every
 *  local-origin update. Returns the disposer. */
export function bindDocToQueue(doc: Y.Doc, queue: OfflineQueue, localOrigin: string): () => void {
  const handler = (update: Uint8Array, origin: unknown): void => {
    if (origin !== localOrigin) return;
    queue.enqueue(update);
  };
  doc.on('update', handler);
  return () => doc.off('update', handler);
}
