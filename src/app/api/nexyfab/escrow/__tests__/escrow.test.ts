/**
 * Q8 — Escrow API tests.
 *
 * Validates auth gates, action validation, and the state machine for
 * status transitions (pending → received → released, refund paths,
 * forbidden transitions). Money-flow code is the highest-risk surface
 * to ship without tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({
  verifyAdmin: vi.fn(),
}));

vi.mock('@/lib/partner-factory-access', () => ({
  normPartnerEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock('@/lib/funnel-logger', () => ({
  logFunnelEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/partner-pro-grace', () => ({
  extendPartnerProGrace: vi.fn().mockResolvedValue({ updated: false, expiresAt: null }),
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

let GET: typeof import('../[orderId]/route').GET;
let POST: typeof import('../[orderId]/route').POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  ({ GET, POST } = await import('../[orderId]/route'));
});

const adminAuth = { userId: 'admin-1', email: 'admin@x.com', orgIds: [] };
const buyerAuth = { userId: 'buyer-1', email: 'buyer@x.com', orgIds: [] };
const partnerAuth = { userId: 'partner-user', email: 'factory@x.com', orgIds: [] };
const otherAuth = { userId: 'random-1', email: 'random@x.com', orgIds: [] };

function req(method: string, body?: unknown) {
  return new Request('http://test/api/nexyfab/escrow/order-1', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const orderRow = {
  user_id: 'buyer-1',
  partner_email: 'factory@x.com',
  total_price_krw: 1_000_000,
  status: 'paid',
};

describe('GET /escrow/[orderId]', () => {
  it('401 when no auth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(401);
  });

  it('404 when order missing', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(404);
  });

  it('403 when caller is not buyer/partner/admin', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(otherAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(orderRow),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(403);
  });

  it('200 returns transaction without notes for buyer', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const tx = {
      id: 'esc-1', order_id: 'order-1', gross_amount_krw: 1_000_000,
      commission_pct: 8, commission_amount_krw: 80_000, net_amount_krw: 920_000,
      status: 'pending', pg_provider: null, received_at: null,
      released_at: null, refunded_at: null, notes: 'admin private memo',
      created_at: 1, updated_at: 1,
    };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(tx),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction.notes).toBeNull(); // hidden from buyer
    expect(body.transaction.commissionKrw).toBe(80_000);
  });

  it('200 partner sees their own order escrow', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(partnerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await GET(req('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(200);
  });
});

describe('POST /escrow/[orderId] — admin only', () => {
  it('403 non-admin', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    const res = await POST(req('POST', { action: 'create' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(403);
  });

  it('400 unknown action', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const res = await POST(req('POST', { action: 'destroy' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(400);
  });

  it('400 when order has no partner', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({ ...orderRow, partner_email: null }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'create' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(400);
  });

  it('201 create computes 8% commission by default', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn()
        .mockResolvedValueOnce(orderRow)         // order lookup
        .mockResolvedValueOnce(null),            // contract rate lookup → falls back to default 8%
      queryAll: vi.fn().mockResolvedValue([]),
      execute,
    } as never);
    const res = await POST(req('POST', { action: 'create' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.commissionKrw).toBe(80_000);
    expect(body.netKrw).toBe(920_000);
  });

  it('rejects pending → released (must go through received first)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const tx = {
      id: 'esc-1', status: 'pending',
      partner_email: 'factory@x.com', net_amount_krw: 920_000,
    };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(tx),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'release' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cannot transition from pending to released/);
  });

  it('allows received → released', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const tx = {
      id: 'esc-1', status: 'received',
      partner_email: 'factory@x.com', net_amount_krw: 920_000,
    };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn()
        .mockResolvedValueOnce(orderRow)
        .mockResolvedValueOnce(tx)
        .mockResolvedValueOnce({ id: 'partner-user-1' }), // grace lookup
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'release' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('released');
  });

  it('allows pending → received', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const tx = { id: 'esc-1', status: 'pending', partner_email: 'factory@x.com', net_amount_krw: 920_000 };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(tx),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'mark_received' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('received');
  });

  it('rejects released → refund (terminal)', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    const tx = { id: 'esc-1', status: 'released', partner_email: 'factory@x.com', net_amount_krw: 920_000 };
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(tx),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'refund' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(400);
  });

  it('404 when no escrow tx exists for non-create actions', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(adminAuth as never);
    vi.mocked(verifyAdmin).mockResolvedValue(true);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce(orderRow).mockResolvedValueOnce(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as never);
    const res = await POST(req('POST', { action: 'mark_received' }) as Parameters<typeof POST>[0], { params: Promise.resolve({ orderId: 'order-1' }) });
    expect(res.status).toBe(404);
  });
});
