import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom-style sessionStorage shim so we can test without a browser env.
class MemStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

// Inject sessionStorage globally before importing the module under test.
const memStorage = new MemStorage();
vi.stubGlobal('sessionStorage', memStorage);
vi.stubGlobal('window', { sessionStorage: memStorage });

import { stashPendingIntent, readPendingIntent, clearPendingIntent, type PendingIntent } from '../pending-intents';

describe('pending-intents', () => {
  beforeEach(() => {
    memStorage.clear();
  });

  it('round-trips a cloud_save_project intent', () => {
    const i: PendingIntent = {
      kind: 'cloud_save_project',
      shapeId: 'flange',
      materialId: 'al-6061',
      sceneData: { foo: 1 },
      stashedAt: Date.now(),
    };
    stashPendingIntent(i);
    const out = readPendingIntent();
    expect(out).toEqual(i);
  });

  it('returns null when nothing is stashed', () => {
    expect(readPendingIntent()).toBeNull();
  });

  it('clearPendingIntent removes the entry', () => {
    stashPendingIntent({
      kind: 'cloud_save_project', shapeId: null, materialId: null,
      sceneData: null, stashedAt: Date.now(),
    });
    expect(readPendingIntent()).not.toBeNull();
    clearPendingIntent();
    expect(readPendingIntent()).toBeNull();
  });

  it('expires intents older than 1h', () => {
    const old: PendingIntent = {
      kind: 'cloud_save_project', shapeId: 'box', materialId: null,
      sceneData: { x: 1 },
      stashedAt: Date.now() - 2 * 60 * 60 * 1000,  // 2h ago
    };
    stashPendingIntent(old);
    expect(readPendingIntent()).toBeNull();
    // Confirm expiry also clears the entry (no zombie reads).
    expect(memStorage.getItem('nexyfab.pendingIntent')).toBeNull();
  });

  it('readPendingIntent on malformed JSON returns null without throwing', () => {
    memStorage.setItem('nexyfab.pendingIntent', '{not-json');
    expect(readPendingIntent()).toBeNull();
  });

  it('latest stash overwrites the previous', () => {
    stashPendingIntent({
      kind: 'cloud_save_project', shapeId: 'one', materialId: null,
      sceneData: null, stashedAt: Date.now(),
    });
    stashPendingIntent({
      kind: 'cloud_save_project', shapeId: 'two', materialId: null,
      sceneData: null, stashedAt: Date.now(),
    });
    const out = readPendingIntent();
    expect(out?.kind).toBe('cloud_save_project');
    if (out?.kind === 'cloud_save_project') {
      expect(out.shapeId).toBe('two');
    }
  });
});
