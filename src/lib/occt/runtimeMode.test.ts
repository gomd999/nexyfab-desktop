/**
 * occt/runtimeMode — tests for the stub-vs-wasm runtime detector.
 *
 * Vitest runs under `node` environment (see vitest.config.ts), so `window`
 * is absent by default. Tests that want to simulate a browser explicitly
 * install `window` + a mock `fetch` on `globalThis`, then `resetOcctModeCache`
 * between cases so each test starts from a clean slate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectOcctMode,
  getCachedOcctMode,
  OCCT_WASM_PROBE_URL,
  resetOcctModeCache,
  setOcctPackagePresenceOverride,
} from './runtimeMode';

interface MutableGlobal {
  window?: unknown;
  fetch?: unknown;
}

const g = globalThis as unknown as MutableGlobal;

/** Install a window + fetch mock so the probe runs the browser path. */
function installBrowser(fetchImpl: typeof fetch): void {
  g.window = {} as Window;
  g.fetch = fetchImpl;
}

function uninstallBrowser(): void {
  delete g.window;
  delete g.fetch;
}

describe('detectOcctMode', () => {
  beforeEach(() => {
    resetOcctModeCache();
    // Phase 5 spike: existing tests pre-date the `'wasm-stub'` tier and assume
    // a clean Node env. Force the package-presence override to `false` so the
    // legacy assertions (Node → 'stub') still hold. New 'wasm-stub' tests opt
    // back in by passing `true` explicitly.
    setOcctPackagePresenceOverride(false);
  });
  afterEach(() => {
    resetOcctModeCache();
    setOcctPackagePresenceOverride(null);
    uninstallBrowser();
    vi.restoreAllMocks();
  });

  it('returns "stub" when window is undefined (Node environment)', async () => {
    // No window installed → node path → 'stub' without ever calling fetch.
    expect(g.window).toBeUndefined();
    const mode = await detectOcctMode();
    expect(mode).toBe('stub');
  });

  it('returns "stub" when fetch is not a function even if window exists', async () => {
    g.window = {} as Window;
    g.fetch = undefined;
    const mode = await detectOcctMode();
    expect(mode).toBe('stub');
  });

  it('returns "wasm" when probe HEAD responds 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);

    const mode = await detectOcctMode();
    expect(mode).toBe('wasm');
    expect(fetchMock).toHaveBeenCalledWith(
      OCCT_WASM_PROBE_URL,
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('returns "stub" when probe HEAD responds 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    installBrowser(fetchMock as unknown as typeof fetch);

    const mode = await detectOcctMode();
    expect(mode).toBe('stub');
  });

  it('returns "stub" when probe HEAD throws (network failure / CSP block)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    installBrowser(fetchMock as unknown as typeof fetch);

    const mode = await detectOcctMode();
    expect(mode).toBe('stub');
  });

  it('caches the result — second call does not re-fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);

    const first = await detectOcctMode();
    const second = await detectOcctMode();

    expect(first).toBe('wasm');
    expect(second).toBe('wasm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single fetch', async () => {
    let resolve!: (v: { ok: boolean; status: number }) => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<{ ok: boolean; status: number }>((r) => { resolve = r; }),
    );
    installBrowser(fetchMock as unknown as typeof fetch);

    const a = detectOcctMode();
    const b = detectOcctMode();
    const c = detectOcctMode();

    // All three should be waiting on the same in-flight fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({ ok: true, status: 200 });
    expect(await a).toBe('wasm');
    expect(await b).toBe('wasm');
    expect(await c).toBe('wasm');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resetOcctModeCache forces a re-probe on the next call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);

    expect(await detectOcctMode()).toBe('stub');
    resetOcctModeCache();
    expect(await detectOcctMode()).toBe('wasm');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses cache:"no-store" so deployment swaps are picked up after reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);

    await detectOcctMode();
    const initArg = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(initArg?.cache).toBe('no-store');
  });

  it('getCachedOcctMode returns null before resolution, mode after', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);

    expect(getCachedOcctMode()).toBeNull();
    await detectOcctMode();
    expect(getCachedOcctMode()).toBe('wasm');
  });

  it('probe URL points at the expected /occt-worker/ asset', () => {
    // Sanity: if this string moves, the dev-build copy script and CSP allowlist
    // need to move with it. Pinning it as a test keeps the contract visible.
    expect(OCCT_WASM_PROBE_URL).toBe('/occt-worker/opencascade.wasm');
  });
});

// ─── Phase 5 spike: 'wasm-stub' tier ──────────────────────────────────────

describe('detectOcctMode — Phase 5 wasm-stub tier', () => {
  beforeEach(() => {
    resetOcctModeCache();
  });
  afterEach(() => {
    resetOcctModeCache();
    setOcctPackagePresenceOverride(null);
    uninstallBrowser();
    vi.restoreAllMocks();
  });

  it('returns "wasm-stub" when package is present but no DOM (Node + opencascade.js)', async () => {
    setOcctPackagePresenceOverride(true);
    expect(g.window).toBeUndefined();
    const mode = await detectOcctMode();
    expect(mode).toBe('wasm-stub');
  });

  it('returns "wasm-stub" when package is present and probe HEAD returns 404', async () => {
    setOcctPackagePresenceOverride(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    installBrowser(fetchMock as unknown as typeof fetch);
    expect(await detectOcctMode()).toBe('wasm-stub');
  });

  it('returns "wasm-stub" when package is present and probe HEAD throws', async () => {
    setOcctPackagePresenceOverride(true);
    const fetchMock = vi.fn().mockRejectedValue(new Error('csp blocked'));
    installBrowser(fetchMock as unknown as typeof fetch);
    expect(await detectOcctMode()).toBe('wasm-stub');
  });

  it('returns "wasm" even when package present and probe HEAD succeeds (wasm wins)', async () => {
    // The WASM blob ALWAYS trumps the package presence — production deployment
    // is the only place the real blob lands; if it's there, we're real.
    setOcctPackagePresenceOverride(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    installBrowser(fetchMock as unknown as typeof fetch);
    expect(await detectOcctMode()).toBe('wasm');
  });

  it('returns "stub" when override is false even if package exists (forced fallback)', async () => {
    // The override is the only escape hatch — useful for UIs that want to
    // demo the stub badge even on a dev machine with the package installed.
    setOcctPackagePresenceOverride(false);
    expect(await detectOcctMode()).toBe('stub');
  });

  it('clearing the override (null) re-enables runtime detection', async () => {
    setOcctPackagePresenceOverride(true);
    expect(await detectOcctMode()).toBe('wasm-stub');
    resetOcctModeCache();
    setOcctPackagePresenceOverride(null);
    // Without DOM and with the real package installed on the dev machine,
    // the detection should now agree with the runtime.
    const mode = await detectOcctMode();
    expect(['stub', 'wasm-stub']).toContain(mode);
  });
});
