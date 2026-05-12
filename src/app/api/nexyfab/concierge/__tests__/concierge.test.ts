/**
 * Q — Concierge API tests.
 *
 * Validates auth gates (owner/admin), upsert path (insert vs update),
 * masked-name reveal at quote_received, and admin vs buyer note visibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({
  verifyAdmin: vi.fn(),
}));

vi.mock('@/lib/funnel-logger', () => ({
  logFunnelEvent: vi.fn().mockResolvedValue(undefined),
}));

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

let GET: typeof import('../[rfqId]/route').GET;
let POST: typeof import('../[rfqId]/route').POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, POST } = await import('../[rfqId]/route'));
});

const buyerAuth = { userId: 'buyer-1', email: 'buyer@x.com', orgIds: [] };
const otherAuth = { userId: 'other-1', email: 'other@x.com', orgIds: [] };
const adminAuth = { userId: 'admin-1', email: 'admin@x.com', orgIds: [] };

function req(method: string, body?: unknown) {
  return new Request('http://test/api/nexyfab/concierge/rfq-1', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const rfqRow = { user_id: 'buyer-1', status: 'pending', shape_name: '브라켓 A' };

describe('GET /concierge/[rfqId]', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(401);
  });

  it('404 RFQ not found', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(404);
  });

  it('403 when caller is neither owner nor admin', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(rfqRow),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(403);
  });

  it('200 owner sees masked names while status is pre-quote', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const conciergeRow = {
      id: 'c1', factory_id: 'f1', status: 'contacted', last_note: 'private',
      public_note: false, last_action_at: 1, last_action_by: 'admin-1',
    };
    const factoryRow = { id: 'f1', name: '대한정밀공업', region: '경기', partner_email: 'p@x.com', contact_email: null };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(rfqRow),
      queryAll: vi.fn()
        .mockResolvedValueOnce([conciergeRow])
        .mockResolvedValueOnce([factoryRow]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].displayName).not.toBe('대한정밀공업'); // masked
    expect(body.entries[0].displayName).toContain('○'); // mask char present
    expect(body.entries[0].partnerEmail).toBeNull(); // not revealed yet
    expect(body.entries[0].note).toBeNull(); // private note hidden from buyer
  });

  it('200 reveals full name + partner email at quote_received', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const conciergeRow = {
      id: 'c1', factory_id: 'f1', status: 'quote_received', last_note: null,
      public_note: false, last_action_at: 1, last_action_by: 'admin-1',
    };
    const factoryRow = { id: 'f1', name: '대한정밀공업', region: '경기', partner_email: 'p@x.com', contact_email: null };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(rfqRow),
      queryAll: vi.fn()
        .mockResolvedValueOnce([conciergeRow])
        .mockResolvedValueOnce([factoryRow]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries[0].displayName).toBe('대한정밀공업');
    expect(body.entries[0].partnerEmail).toBe('p@x.com');
  });

  it('200 admin sees private notes', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const conciergeRow = {
      id: 'c1', factory_id: 'f1', status: 'contacted', last_note: 'awaiting_callback',
      public_note: false, last_action_at: 1, last_action_by: 'admin-1',
    };
    const factoryRow = { id: 'f1', name: '대한정밀', region: null, partner_email: null, contact_email: null };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(rfqRow),
      queryAll: vi.fn()
        .mockResolvedValueOnce([conciergeRow])
        .mockResolvedValueOnce([factoryRow]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries[0].note).toBe('awaiting_callback');
    expect(body.isAdmin).toBe(true);
  });
});

describe('POST /concierge/[rfqId] — admin only', () => {
  it('403 non-admin', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const res = await POST(req('POST', { factoryId: 'f1', status: 'contacted' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(403);
  });

  it('400 missing factoryId', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const res = await POST(req('POST', { status: 'contacted' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(400);
  });

  it('400 unknown status', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const res = await POST(req('POST', { factoryId: 'f1', status: 'bogus' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(400);
  });

  it('201 inserts new (rfq, factory) pair', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null), // no existing pair
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await POST(req('POST', { factoryId: 'f1', status: 'recommended' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('recommended');
  });

  it('200 updates existing pair (upsert path)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ id: 'existing-c1' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { factoryId: 'f1', status: 'quote_received' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ rfqId: 'rfq-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('existing-c1');
    expect(body.status).toBe('quote_received');
  });
});
