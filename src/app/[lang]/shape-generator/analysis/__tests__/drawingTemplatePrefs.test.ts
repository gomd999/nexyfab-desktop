/**
 * drawingTemplatePrefs.test.ts — Phase 6c persistence helper.
 *
 * Pure unit tests for the load/save/clear helpers + edge cases.
 * The React hook is exercised indirectly via the host integration —
 * adding a jsdom hook test would mostly duplicate React's own
 * useState/useEffect coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_DRAWING_TEMPLATE,
  DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
  clearDrawingTemplatePrefs,
  loadDrawingTemplatePrefs,
  saveDrawingTemplatePrefs,
} from '../drawingTemplatePrefs';
import type { DrawingConfig } from '../autoDrawing';

// Minimal in-memory localStorage shim so the pure tests don't need
// jsdom (and so the suite stays inside the default vitest environment).
type LStore = { [k: string]: string };
let __store: LStore = {};
const memoryStorage: Storage = {
  get length() { return Object.keys(__store).length; },
  clear: () => { __store = {}; },
  getItem: (k: string) => (k in __store ? __store[k] : null),
  key: (i: number) => Object.keys(__store)[i] ?? null,
  removeItem: (k: string) => { delete __store[k]; },
  setItem: (k: string, v: string) => { __store[k] = String(v); },
};

beforeEach(() => {
  __store = {};
  (globalThis as unknown as { window?: { localStorage: Storage } }).window = {
    localStorage: memoryStorage,
  };
});

describe('DEFAULT_DRAWING_TEMPLATE', () => {
  it('is a complete DrawingConfig (every required field present)', () => {
    expect(DEFAULT_DRAWING_TEMPLATE.views.length).toBeGreaterThan(0);
    expect(DEFAULT_DRAWING_TEMPLATE.scale).toBeGreaterThan(0);
    expect(DEFAULT_DRAWING_TEMPLATE.paperSize).toBeTruthy();
    expect(DEFAULT_DRAWING_TEMPLATE.orientation).toBeTruthy();
    expect(DEFAULT_DRAWING_TEMPLATE.titleBlock.partName).toBeDefined();
    expect(DEFAULT_DRAWING_TEMPLATE.titleBlock.revision).toBeTruthy();
  });

  it('default views include front/top/right (the cookbook 3-view layout)', () => {
    expect(DEFAULT_DRAWING_TEMPLATE.views).toContain('front');
    expect(DEFAULT_DRAWING_TEMPLATE.views).toContain('top');
    expect(DEFAULT_DRAWING_TEMPLATE.views).toContain('right');
  });
});

describe('loadDrawingTemplatePrefs', () => {
  it('returns the default when localStorage is empty', () => {
    expect(loadDrawingTemplatePrefs()).toEqual(DEFAULT_DRAWING_TEMPLATE);
  });

  it('returns the default when stored JSON is corrupted', () => {
    memoryStorage.setItem(DRAWING_TEMPLATE_PREFS_STORAGE_KEY, '{not json');
    expect(loadDrawingTemplatePrefs()).toEqual(DEFAULT_DRAWING_TEMPLATE);
  });

  it('returns the default when window is undefined (SSR)', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(loadDrawingTemplatePrefs()).toEqual(DEFAULT_DRAWING_TEMPLATE);
  });

  it('merges saved partial onto the default (preserves required fields)', () => {
    memoryStorage.setItem(
      DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
      JSON.stringify({ paperSize: 'A3', orientation: 'portrait' }),
    );
    const loaded = loadDrawingTemplatePrefs();
    expect(loaded.paperSize).toBe('A3');
    expect(loaded.orientation).toBe('portrait');
    // Required fields the partial didn't override still present.
    expect(loaded.views.length).toBeGreaterThan(0);
    expect(loaded.titleBlock.revision).toBe(DEFAULT_DRAWING_TEMPLATE.titleBlock.revision);
  });

  it('merges titleBlock partial without losing other titleBlock fields', () => {
    memoryStorage.setItem(
      DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
      JSON.stringify({ titleBlock: { revision: 'B', drawnBy: 'gomd9' } }),
    );
    const loaded = loadDrawingTemplatePrefs();
    expect(loaded.titleBlock.revision).toBe('B');
    expect(loaded.titleBlock.drawnBy).toBe('gomd9');
    // Untouched titleBlock fields default through.
    expect(loaded.titleBlock.partName).toBe(DEFAULT_DRAWING_TEMPLATE.titleBlock.partName);
    expect(loaded.titleBlock.scale).toBe(DEFAULT_DRAWING_TEMPLATE.titleBlock.scale);
  });

  it('empty views array in saved partial → falls back to default views (avoid empty drawings)', () => {
    memoryStorage.setItem(
      DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
      JSON.stringify({ views: [] }),
    );
    const loaded = loadDrawingTemplatePrefs();
    expect(loaded.views.length).toBeGreaterThan(0);
  });

  it('accepts a custom default when callers want one (e.g. host already has DEFAULT in scope)', () => {
    const customDefault: DrawingConfig = {
      ...DEFAULT_DRAWING_TEMPLATE,
      paperSize: 'A0',
    };
    expect(loadDrawingTemplatePrefs(customDefault).paperSize).toBe('A0');
  });
});

describe('saveDrawingTemplatePrefs', () => {
  it('persists a full template that loadPrefs round-trips', () => {
    const next: DrawingConfig = {
      ...DEFAULT_DRAWING_TEMPLATE,
      paperSize: 'A3',
      orientation: 'portrait',
      titleBlock: {
        ...DEFAULT_DRAWING_TEMPLATE.titleBlock,
        drawnBy: 'tester',
        revision: 'D',
      },
    };
    saveDrawingTemplatePrefs(next);
    const round = loadDrawingTemplatePrefs();
    expect(round.paperSize).toBe('A3');
    expect(round.orientation).toBe('portrait');
    expect(round.titleBlock.drawnBy).toBe('tester');
    expect(round.titleBlock.revision).toBe('D');
  });

  it('silently swallows write failures (SSR / storage disabled)', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(() => saveDrawingTemplatePrefs(DEFAULT_DRAWING_TEMPLATE)).not.toThrow();
  });
});

describe('clearDrawingTemplatePrefs', () => {
  it('removes the storage key, next load returns default', () => {
    saveDrawingTemplatePrefs({ ...DEFAULT_DRAWING_TEMPLATE, paperSize: 'A2' });
    clearDrawingTemplatePrefs();
    expect(loadDrawingTemplatePrefs().paperSize).toBe(DEFAULT_DRAWING_TEMPLATE.paperSize);
  });

  it('safe to call when no prefs exist (idempotent)', () => {
    expect(() => clearDrawingTemplatePrefs()).not.toThrow();
  });
});
