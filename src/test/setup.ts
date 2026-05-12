import '@testing-library/jest-dom/vitest';

// Load Three before any feature modules that pull three-bvh-csg / three-mesh-bvh (peer circular deps).
import 'three';

// 환경변수 설정
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long';
// NODE_ENV is read-only in TS strict mode; vitest sets it to 'test' automatically

// crypto.randomUUID polyfill (Node.js 환경)
if (!globalThis.crypto?.randomUUID) {
  const { randomUUID } = await import('crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID, subtle: globalThis.crypto?.subtle },
  });
}

// Vitest 4.x with jsdom emits "--localstorage-file was provided without a
// valid path" and silently no-ops Storage writes. Tests that touch
// localStorage need a real Map-backed shim. Install once per worker so
// every jsdom test gets working set/get/remove/clear semantics.
if (typeof window !== 'undefined') {
  class MapStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number { return this.store.size; }
    clear(): void { this.store.clear(); }
    getItem(k: string): string | null { return this.store.get(k) ?? null; }
    key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
    removeItem(k: string): void { this.store.delete(k); }
    setItem(k: string, v: string): void { this.store.set(k, v); }
  }
  try {
    Object.defineProperty(window, 'localStorage', {
      value: new MapStorage(), configurable: true, writable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: new MapStorage(), configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: window.localStorage, configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: window.sessionStorage, configurable: true, writable: true,
    });
  } catch {
    /* older jsdom locks the descriptor — tests fall back to its stub */
  }
}

export {};
