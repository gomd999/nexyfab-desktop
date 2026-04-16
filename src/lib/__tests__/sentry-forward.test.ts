import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('forwardToSentry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    // Force module to re-evaluate DSN each test.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is a no-op when SENTRY_DSN is unset', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const { forwardToSentry } = await import('../sentry-forward');
    forwardToSentry({ level: 'error', message: 'boom' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when SENTRY_DSN is malformed', async () => {
    vi.stubEnv('SENTRY_DSN', 'not-a-url');
    const { forwardToSentry } = await import('../sentry-forward');
    forwardToSentry({ level: 'error', message: 'boom' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a valid envelope when DSN is set', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://abc123@o123456.ingest.sentry.io/789');
    const { forwardToSentry } = await import('../sentry-forward');

    forwardToSentry({
      level: 'error',
      message: 'CSG boolean failed',
      stack: 'Error: boom\n    at foo (/app/src/csg.ts:10:5)',
      tags: { source: 'csg' },
      extra: { featureId: 'f1' },
    });

    await new Promise(r => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://o123456.ingest.sentry.io/api/789/envelope/');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-sentry-envelope');
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=abc123');

    // Envelope body: 3 lines (envelope header, item header, payload).
    const body = (init as RequestInit).body as string;
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(3);
    const envHeader = JSON.parse(lines[0]);
    expect(envHeader.event_id).toMatch(/^[a-f0-9]{32}$/);
    const payload = JSON.parse(lines[2]);
    expect(payload.level).toBe('error');
    expect(payload.message.formatted).toBe('CSG boolean failed');
    expect(payload.tags.source).toBe('csg');
    expect(payload.extra.featureId).toBe('f1');
    expect(payload.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });
});
