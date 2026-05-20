import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { OfflineQueue, bindDocToQueue } from '../offlineQueue';

describe('OfflineQueue · enqueue', () => {
  it('starts empty', () => {
    const q = new OfflineQueue({ send: async () => {} });
    expect(q.size()).toBe(0);
  });

  it('appends updates and assigns monotonic ids', () => {
    const q = new OfflineQueue({ send: async () => {} });
    q.enqueue(new Uint8Array([1]));
    q.enqueue(new Uint8Array([2]));
    const snap = q.snapshot();
    expect(snap[0].id).toBeLessThan(snap[1].id);
  });

  it('coalesces past maxQueued by merging into the last entry', () => {
    const q = new OfflineQueue({ send: async () => {}, maxQueued: 2 });
    const doc = new Y.Doc();
    const m = doc.getMap('m');
    m.set('a', 1);
    const u1 = Y.encodeStateAsUpdate(doc);
    m.set('b', 2);
    const u2 = Y.encodeStateAsUpdate(doc);
    m.set('c', 3);
    const u3 = Y.encodeStateAsUpdate(doc);
    q.enqueue(u1);
    q.enqueue(u2);
    q.enqueue(u3); // exceeds cap → coalesces
    expect(q.size()).toBe(2);
  });
});

describe('OfflineQueue · flush', () => {
  it('drains queue when online + send succeeds', async () => {
    const sent: Uint8Array[] = [];
    const q = new OfflineQueue({
      send: async (u) => { sent.push(u.bytes); },
    });
    q.enqueue(new Uint8Array([1]));
    q.enqueue(new Uint8Array([2]));
    const r = await q.flush();
    expect(r.sent).toBe(2);
    expect(r.failed).toBe(0);
    expect(q.size()).toBe(0);
  });

  it('stops on first send rejection (no auto-retry)', async () => {
    let calls = 0;
    const q = new OfflineQueue({
      send: async () => {
        calls++;
        if (calls === 2) throw new Error('network');
      },
    });
    q.enqueue(new Uint8Array([1]));
    q.enqueue(new Uint8Array([2]));
    q.enqueue(new Uint8Array([3]));
    const r = await q.flush();
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(1);
    // Items 2 and 3 still pending.
    expect(q.size()).toBe(2);
  });

  it('no-ops when offline', async () => {
    const send = vi.fn(async () => {});
    const q = new OfflineQueue({ send });
    q.setOnline(false);
    q.enqueue(new Uint8Array([1]));
    const r = await q.flush();
    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(q.size()).toBe(1);
  });

  it('auto-flushes on online transition (offline → online)', async () => {
    const send = vi.fn(async () => {});
    const q = new OfflineQueue({ send });
    q.setOnline(false);
    q.enqueue(new Uint8Array([1]));
    q.enqueue(new Uint8Array([2]));
    q.setOnline(true);
    // Auto-flush is fire-and-forget; wait a microtask for resolution.
    await new Promise(r => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0);
  });

  it('is re-entrancy-safe (concurrent flush returns immediately)', async () => {
    const q = new OfflineQueue({
      send: async () => new Promise(r => setTimeout(r, 5)),
    });
    q.enqueue(new Uint8Array([1]));
    const a = q.flush();
    const b = q.flush();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.sent + rb.sent).toBe(1);
  });
});

describe('OfflineQueue · clear', () => {
  it('drops everything pending', () => {
    const q = new OfflineQueue({ send: async () => {} });
    q.enqueue(new Uint8Array([1]));
    q.enqueue(new Uint8Array([2]));
    q.clear();
    expect(q.size()).toBe(0);
  });
});

describe('bindDocToQueue', () => {
  it('enqueues updates from local-origin transactions', () => {
    const doc = new Y.Doc();
    const q = new OfflineQueue({ send: async () => {} });
    bindDocToQueue(doc, q, 'alice');
    doc.transact(() => { doc.getMap('m').set('x', 1); }, 'alice');
    expect(q.size()).toBe(1);
  });

  it('ignores remote-origin transactions', () => {
    const doc = new Y.Doc();
    const q = new OfflineQueue({ send: async () => {} });
    bindDocToQueue(doc, q, 'alice');
    doc.transact(() => { doc.getMap('m').set('x', 1); }, 'bob');
    expect(q.size()).toBe(0);
  });

  it('disposer stops further observation', () => {
    const doc = new Y.Doc();
    const q = new OfflineQueue({ send: async () => {} });
    const stop = bindDocToQueue(doc, q, 'alice');
    stop();
    doc.transact(() => { doc.getMap('m').set('x', 1); }, 'alice');
    expect(q.size()).toBe(0);
  });
});
