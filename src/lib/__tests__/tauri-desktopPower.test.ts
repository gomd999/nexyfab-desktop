import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('hasDesktopPower', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false for all keys when not in Tauri', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: undefined });
    const { hasDesktopPower } = await import('../tauri');
    expect(hasDesktopPower('nativeFilesystem')).toBe(false);
    expect(hasDesktopPower('nativeSidecar')).toBe(false);
  });

  it('returns impl map when Tauri internals are present', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const { hasDesktopPower } = await import('../tauri');
    expect(hasDesktopPower('nativeFilesystem')).toBe(true);
    expect(hasDesktopPower('directDiskExport')).toBe(true);
    expect(hasDesktopPower('nativeSidecar')).toBe(false);
  });
});
