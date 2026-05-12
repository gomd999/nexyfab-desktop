/**
 * M1 — Thread messages API tests.
 *
 * Validates auth, kind validation, ownership (buyer or partner only),
 * thread resolution from rfq/order, and POST insert path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/notify', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/partner-factory-access', () => ({
  normPartnerEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn().mockResolvedValue(null),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

let GET: typeof import('../[kind]/[id]/messages/route').GET;
let POST: typeof import('../[kind]/[id]/messages/route').POST;

beforeEach(async () => {
  vi.resetModules();
  ({ GET, POST } = await import('../[kind]/[id]/messages/route'));
});

function makeReq(method: string, path = 'rfq/r1', body?: unknown) {
  return new Request(`http://test/api/nexyfab/threads/${path}/messages`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const buyerAuth = { userId: 'buyer-1', email: 'buyer@x.com', orgIds: [] };
const partnerAuth = { userId: 'partner-user', email: 'factory@x.com', orgIds: [] };

describe('GET /threads/{kind}/{id}/messages', () => {
  it('401 unauth', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ kind: 'rfq', id: 'r1' }) });
    expect(res.status).toBe(401);
  });

  it('400 invalid kind', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ kind: 'invoice', id: 'x' }) });
    expect(res.status).toBe(400);
  });

  it('404 when thread not found', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue(null),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ kind: 'rfq', id: 'ghost' }) });
    expect(res.status).toBe(404);
  });

  it('403 when neither buyer nor partner', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'random-user', email: 'random@x.com', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const queryOne = vi.fn()
      .mockResolvedValueOnce({ user_id: 'buyer-1', preferred_factory_id: null, status: 'pending' }) // rfq lookup
      .mockResolvedValueOnce(null); // accepted quote lookup
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne, queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0], { params: Promise.resolve({ kind: 'rfq', id: 'r1' }) });
    expect(res.status).toBe(403);
  });

  it('200 with messages for buyer of an order thread', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const queryOne = vi.fn().mockResolvedValueOnce({ user_id: 'buyer-1', partner_email: 'factory@x.com' });
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne,
      queryAll: vi.fn().mockResolvedValue([
        { id: 'm1', thread_kind: 'order', thread_id: 'o1', sender_user_id: 'buyer-1', sender_partner_email: null, sender_type: 'buyer', body: 'hi', attachments_json: null, read_at: null, created_at: 1 },
      ]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await GET(makeReq('GET', 'order/o1') as Parameters<typeof GET>[0], { params: Promise.resolve({ kind: 'order', id: 'o1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body).toBe('hi');
  });
});

describe('POST /threads/{kind}/{id}/messages', () => {
  it('400 missing body', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await POST(makeReq('POST', 'order/o1', {}) as Parameters<typeof POST>[0], { params: Promise.resolve({ kind: 'order', id: 'o1' }) });
    expect(res.status).toBe(400);
  });

  it('201 buyer sends to order thread', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'buyer-1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(
      makeReq('POST', 'order/o1', { body: 'hello partner', attachments: ['https://example.com/file.pdf'] }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ kind: 'order', id: 'o1' }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message.senderType).toBe('buyer');
    expect(body.message.body).toBe('hello partner');
    expect(body.message.attachments).toEqual(['https://example.com/file.pdf']);
  });

  it('201 partner sends to RFQ thread', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(partnerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn()
        .mockResolvedValueOnce({ user_id: 'buyer-1', preferred_factory_id: null, status: 'pending' })
        .mockResolvedValueOnce({ partner_email: 'factory@x.com' }),  // accepted quote
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(
      makeReq('POST', 'rfq/r1', { body: 'quote ready' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ kind: 'rfq', id: 'r1' }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message.senderType).toBe('partner');
  });

  it('truncates body at 5000 chars', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'buyer-1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const huge = 'A'.repeat(10_000);
    const res = await POST(makeReq('POST', 'order/o1', { body: huge }) as Parameters<typeof POST>[0], { params: Promise.resolve({ kind: 'order', id: 'o1' }) });
    const body = await res.json();
    expect(body.message.body.length).toBe(5000);
  });

  it('drops non-https attachment URLs', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(buyerAuth as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'buyer-1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(
      makeReq('POST', 'order/o1', {
        body: 'with attach',
        attachments: ['javascript:alert(1)', 'http://ok.com/a', 'not a url', 'https://safe.com/b'],
      }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ kind: 'order', id: 'o1' }) },
    );
    const body = await res.json();
    expect(body.message.attachments).toEqual(['http://ok.com/a', 'https://safe.com/b']);
  });
});
