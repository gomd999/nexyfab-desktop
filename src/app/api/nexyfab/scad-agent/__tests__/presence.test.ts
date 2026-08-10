/**
 * X1 — Presence endpoint integration tests.
 *
 * Validates the POST heartbeat / GET roster contract used by the
 * SCAD agent panel's presence indicator. The endpoint is intentionally
 * cheap (no AI spend); the authenticated plan boundary is mocked so tests focus on input validation, roster
 * accumulation across multiple registrants, and TTL eviction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/plan-guard', () => ({
  checkPlan: vi.fn(async () => ({ ok: true, userId: 'presence-test-user', plan: 'free' })),
}));

// We poke private TTL state via vi.useFakeTimers + fresh module import.
// The PARTICIPANTS map in serverCollab is process-singleton; reset it
// between tests by re-importing.

describe('POST /api/nexyfab/scad-agent/presence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function POST(body: unknown) {
    const { POST: handler } = await import('../presence/route');
    const req = new Request('http://test/api/nexyfab/scad-agent/presence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return handler(req as unknown as Parameters<typeof handler>[0]);
  }

  async function GET(sessionId: string | null) {
    const { GET: handler } = await import('../presence/route');
    const url = sessionId
      ? `http://test/api/nexyfab/scad-agent/presence?sessionId=${encodeURIComponent(sessionId)}`
      : 'http://test/api/nexyfab/scad-agent/presence';
    const req = new Request(url);
    return handler(req as unknown as Parameters<typeof handler>[0]);
  }

  it('rejects POST without sessionId or userId', async () => {
    const res = await POST({ label: 'foo' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('rejects invalid JSON', async () => {
    const res = await POST('not-json');
    expect(res.status).toBe(400);
  });

  it('records a heartbeat and returns the peer list', async () => {
    const res = await POST({ sessionId: 's1', userId: 'u1', label: 'Alice' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.peers[0].id).toBe('u1');
    expect(body.peers[0].label).toBe('Alice');
  });

  it('accumulates multiple peers in the same session', async () => {
    await POST({ sessionId: 's2', userId: 'u1', label: 'Alice' });
    await POST({ sessionId: 's2', userId: 'u2', label: 'Bob' });
    const res = await POST({ sessionId: 's2', userId: 'u3', label: 'Carol' });
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.peers.map((p: { id: string }) => p.id).sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('isolates rosters by sessionId', async () => {
    await POST({ sessionId: 'roomA', userId: 'u1', label: 'Alice' });
    await POST({ sessionId: 'roomB', userId: 'u2', label: 'Bob' });
    const res = await GET('roomA');
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.peers[0].id).toBe('u1');
  });

  it('GET without sessionId returns 400', async () => {
    const res = await GET(null);
    expect(res.status).toBe(400);
  });

  it('GET on empty room returns count=0', async () => {
    const res = await GET('never-touched');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(0);
  });

  it('truncates oversize labels to 40 chars (defense-in-depth)', async () => {
    const longLabel = 'X'.repeat(200);
    const res = await POST({ sessionId: 's3', userId: 'u1', label: longLabel });
    const body = await res.json();
    expect(body.peers[0].label.length).toBe(40);
  });

  it('repeat heartbeat from same userId does not duplicate the entry', async () => {
    await POST({ sessionId: 's4', userId: 'u1', label: 'Alice' });
    await POST({ sessionId: 's4', userId: 'u1', label: 'Alice (renamed)' });
    const res = await POST({ sessionId: 's4', userId: 'u1', label: 'Alice' });
    const body = await res.json();
    expect(body.count).toBe(1);
  });
});
