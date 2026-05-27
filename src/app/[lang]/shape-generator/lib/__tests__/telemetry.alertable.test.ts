// @vitest-environment jsdom
/**
 * W17 — Sentry forwarding for alertable info events. ADR-009 §5 burn-in
 * gate relies on `server_*` info events reaching Sentry so alert rules
 * (defined in docs/wave-1-sentry-alerts.md) can count them.
 *
 * Tests use jsdom so the `typeof window !== 'undefined'` gate inside
 * forwardToSentryIfAlertable evaluates true. The Sentry SDK itself is
 * mocked via dynamic-import interception so we don't pull the real
 * package.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportInfo } from '../telemetry';

// Mock @sentry/nextjs — every dynamic `import('@sentry/nextjs')` in
// telemetry.ts hits this. captureMessage is the function we're
// verifying gets called for alertable patterns.
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage,
  captureException: vi.fn(),
}));

beforeEach(() => {
  captureMessage.mockClear();
});

// Each test waits for the dynamic `import('@sentry/nextjs')` to
// resolve and its .then() callback to call captureMessage. The Sentry
// import is genuinely async even when mocked, so microtasks alone
// don't drain — a real setTimeout(0) lets the import settle.
async function flushSentry(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

afterEach(async () => {
  await flushSentry();
});

describe('reportInfo → Sentry forwarding (alertable patterns)', () => {
  it('server_boolean_ok → captureMessage', async () => {
    reportInfo('csg', 'server_boolean_ok', { elapsedMs: 250 });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
    const [msg, opts] = captureMessage.mock.calls[0]!;
    expect(msg).toBe('csg.server_boolean_ok');
    expect(opts.level).toBe('info');
    expect(opts.tags.telemetrySource).toBe('csg');
    expect(opts.tags.eventName).toBe('server_boolean_ok');
  });

  it('server_fillet_unavailable → captureMessage', async () => {
    reportInfo('csg', 'server_fillet_unavailable', { status: 500 });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage.mock.calls[0]![0]).toBe('csg.server_fillet_unavailable');
  });

  it('server_pattern_path_ok → captureMessage', async () => {
    reportInfo('csg', 'server_pattern_path_ok', { triangles: 1234 });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
  });

  it('server_chamfer_fallback → captureMessage', async () => {
    reportInfo('csg', 'server_chamfer_fallback', { phase: 'network' });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
  });

  it('server_shell_network → captureMessage', async () => {
    reportInfo('csg', 'server_shell_network', { elapsedMs: 50 });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
  });
});

describe('reportInfo → Sentry forwarding (non-alertable stays local)', () => {
  it('plain info message → NOT forwarded', async () => {
    reportInfo('csg', 'some_routine_event', {});
    await flushSentry();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('feature_pipeline info → NOT forwarded', async () => {
    // Source is not csg + message doesn't match server_* pattern.
    reportInfo('feature_pipeline', 'feature_added', {});
    await flushSentry();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('similar but not matching: server_X (without suffix) → NOT forwarded', async () => {
    reportInfo('csg', 'server_started', {});
    await flushSentry();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe('PII scrubbing extends to forwarded events', () => {
  it('email in context is scrubbed before captureMessage extra', async () => {
    reportInfo('csg', 'server_boolean_ok', {
      elapsedMs: 100,
      userEmail: 'user@example.com',
    });
    await flushSentry();
    expect(captureMessage).toHaveBeenCalledOnce();
    const opts = captureMessage.mock.calls[0]![1];
    // userEmail key gets redacted (contains 'email' in lowercased key).
    expect(opts.extra.userEmail).toBe('[REDACTED]');
  });
});
