/**
 * Anti-poach signal review API tests.
 * Validates auth, verdict allow-list, and the open/reviewed status filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ verifyAdmin: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn().mockResolvedValue(null),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

let GET: typeof import('../route').GET;
let POST: typeof import('../route').POST;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  ({ GET, POST } = await import('../route'));
});

const adminAuth = { userId: 'admin-1', email: 'admin@x.com', orgIds: [] };
const buyerAuth = { userId: 'buyer-1', email: 'b@x.com', orgIds: [] };

function req(method: string, body?: unknown, qs = '') {
  return new Request(`http://test/api/admin/anti-poach${qs}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function streamedReq(body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
  return new Request('http://test/api/admin/anti-poach', {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...headers }, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('GET /admin/anti-poach', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(req('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('403 non-admin', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const res = await GET(req('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(403);
  });

  it('200 returns signal list with counts', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const sig = {
      id: 's1', kind: 'orphan_order', buyer_id: 'b1', partner_email: 'p@x.com',
      ref_id: 'order-1', severity: 'high', details: '{"totalKrw":1000000}',
      detected_at: 1, reviewed_at: null, reviewed_by: null, verdict: null,
    };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn()
        .mockResolvedValueOnce({ c: 1 })
        .mockResolvedValueOnce({ c: 0 }),
      queryAll: vi.fn().mockResolvedValueOnce([sig]),
      execute: vi.fn(),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signals).toHaveLength(1);
    expect(body.signals[0].details.totalKrw).toBe(1_000_000);
    expect(body.counts.open).toBe(1);
  });
});

describe('POST /admin/anti-poach', () => {
  it('cancels declared and measured oversized input before admin mutation', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const execute = vi.fn();
    vi.mocked(getDbAdapter).mockReturnValue({ queryOne: vi.fn(), queryAll: vi.fn(), execute } as never);

    let declaredCancelled = false;
    const declared = new ReadableStream<Uint8Array>({ cancel() { declaredCancelled = true; } });
    const declaredResponse = await POST(streamedReq(declared, { 'content-length': '65537' }) as Parameters<typeof POST>[0]);
    expect(declaredResponse.status).toBe(413);
    expect(declaredCancelled).toBe(true);

    let measuredCancelled = false;
    const measured = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() { measuredCancelled = true; },
    });
    const measuredResponse = await POST(streamedReq(measured, { 'content-length': '1' }) as Parameters<typeof POST>[0]);
    expect(measuredResponse.status).toBe(413);
    expect(measuredCancelled).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 before querying or mutating admin data', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const queryOne = vi.fn();
    const execute = vi.fn();
    vi.mocked(getDbAdapter).mockReturnValue({ queryOne, queryAll: vi.fn(), execute } as never);
    const response = await POST(new Request('http://test/api/admin/anti-poach', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff]),
    }) as Parameters<typeof POST>[0]);
    expect(response.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('400 invalid verdict', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const res = await POST(req('POST', { signalId: 's1', verdict: 'guilty' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('404 unknown signalId', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
    } as never);
    const res = await POST(req('POST', { signalId: 'ghost', verdict: 'false_positive' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(404);
  });

  it('200 records verdict + merges notes', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ id: 's1', details: '{"existing":true}' }),
      queryAll: vi.fn(),
      execute,
    } as never);
    const res = await POST(req('POST', {
      signalId: 's1', verdict: 'warning_sent', notes: 'sent email to partner',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalled();
    const args = execute.mock.calls[0];
    const detailsArg = args[args.length - 2] as string; // details JSON
    const parsed = JSON.parse(detailsArg);
    expect(parsed.existing).toBe(true);
    expect(parsed.reviewNotes).toBe('sent email to partner');
  });
});
