import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('PostHog forwarding (desktop telemetry opt-in)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function loadTrackEvent(tauri: boolean, optIn: boolean) {
    vi.doMock('../tauri', () => ({ isTauriApp: () => tauri }));
    vi.doMock('../platform', () => ({
      getTelemetryOptIn: () => optIn,
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph_test_key');
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    vi.stubGlobal('window', {
      gtag: undefined,
      fbq: undefined,
      location: { href: 'https://nexyfab.com/en/shape-generator', pathname: '/en/shape-generator' },
    });
    const { trackEvent } = await import('../analytics');
    return { fetchMock, trackEvent };
  }

  it('POSTs to PostHog on web even when desktop opt-in is false', async () => {
    const { fetchMock, trackEvent } = await loadTrackEvent(false, false);
    trackEvent('shape_generate', { shape_type: 'box' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(/posthog/);
  });

  it('does not POST to PostHog when Tauri and opted out', async () => {
    const { fetchMock, trackEvent } = await loadTrackEvent(true, false);
    trackEvent('shape_generate', { shape_type: 'box' });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to PostHog when Tauri and opted in', async () => {
    const { fetchMock, trackEvent } = await loadTrackEvent(true, true);
    trackEvent('shape_generate', { shape_type: 'box' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
  });
});
