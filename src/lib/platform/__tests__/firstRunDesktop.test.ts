import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('firstRunDesktop preferences', () => {
  const store: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.resetModules();
    Object.keys(store).forEach((k) => {
      delete store[k];
    });
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', { localStorage: ls });
  });

  it('marks first-run complete and reset clears it', async () => {
    const { isDesktopFirstRunComplete, markDesktopFirstRunComplete, resetDesktopFirstRun } = await import(
      '../firstRunDesktop'
    );
    expect(isDesktopFirstRunComplete()).toBe(false);
    markDesktopFirstRunComplete();
    expect(isDesktopFirstRunComplete()).toBe(true);
    resetDesktopFirstRun();
    expect(isDesktopFirstRunComplete()).toBe(false);
  });

  it('stores telemetry opt-in as 1/0', async () => {
    const { getTelemetryOptIn, setTelemetryOptIn } = await import('../firstRunDesktop');
    expect(getTelemetryOptIn()).toBe(false);
    setTelemetryOptIn(true);
    expect(getTelemetryOptIn()).toBe(true);
    setTelemetryOptIn(false);
    expect(getTelemetryOptIn()).toBe(false);
  });
});
