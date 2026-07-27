import '@testing-library/jest-dom/vitest';
import { configure as configureTestingLibrary } from '@testing-library/dom';

/**
 * `findBy*` / `waitFor` 의 기본 대기는 1000ms 인데, 이것은 **어설션 안에 박힌 머신 속도
 * 가정**이다 (260728 §6-4 의 DOM 판). 전체 스위트(1,792파일)를 병렬로 돌리면 렌더+이펙트
 * 체인이 1초를 넘겨, 격리 실행에서 120/120 통과하는 파일이 부하에서만 죽는다:
 *   `solverSketchEditorWithExtrudeModals.test.tsx` — 격리 18.2s 전체 통과 / 전체 병렬에서
 *   `findByTestId('branch-manager-panel')` 대기 초과 1건.
 * 대기 상한을 늘려도 **통과 조건은 바뀌지 않는다** — 끝내 나타나지 않는 요소는 여전히
 * 실패하고, 다만 실패까지 더 걸릴 뿐이다. 반대로 1000ms 를 유지하면 CPU 경합이 곧 실패가 된다.
 * 개별 테스트가 자기 timeout 을 명시했다면 그쪽이 이긴다(이 값은 기본값일 뿐).
 */
configureTestingLibrary({ asyncUtilTimeout: 15_000 });

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
