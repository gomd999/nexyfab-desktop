/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { getSuppressCadPerfToasts, setSuppressCadPerfToasts } from '@/lib/cadPerfHints';

// Vitest 4.x's jsdom Storage stub silently no-ops writes — we replace it
// with a Map-backed shim so the persistence test actually exercises the
// getter + setter contract.
class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(k: string): void { this.store.delete(k); }
  setItem(k: string, v: string): void { this.store.set(k, v); }
}

describe('cadPerfHints', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: new MapStorage(),
      configurable: true,
    });
  });

  it('defaults to off', () => {
    expect(getSuppressCadPerfToasts()).toBe(false);
  });

  it('persists suppress flag', () => {
    setSuppressCadPerfToasts(true);
    expect(getSuppressCadPerfToasts()).toBe(true);
    setSuppressCadPerfToasts(false);
    expect(getSuppressCadPerfToasts()).toBe(false);
  });
});
