/**
 * M5 — Inbound email webhook tests.
 *
 * Pin parsing of recipient (Resend/SendGrid shape variants), sender
 * verification against thread partner, quote-stripping, and the
 * shared-secret guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/partner-factory-access', () => ({ normPartnerEmail: (e: string) => e.trim().toLowerCase() }));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn(),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { getDbAdapter } from '@/lib/db-adapter';

let POST: typeof import('../route').POST;

beforeEach(async () => {
  vi.resetModules();
  delete process.env.INBOUND_EMAIL_SHARED_SECRET;
  ({ POST } = await import('../route'));
});

function makeReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://test/api/webhooks/inbound-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('inbound email webhook', () => {
  it('400 when no thread+ recipient', async () => {
    const res = await POST(makeReq({ from: 'a@b.com', to: 'random@nexyfab.com' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('parses Resend-style payload (string to)', async () => {
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(makeReq({
      from: 'factory@x.com',
      to: 'thread+order-ord123@inbox.nexyfab.com',
      text: 'Hello buyer, status update.',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.threadKind).toBe('order');
    expect(body.threadId).toBe('ord123');
  });

  it('parses SendGrid-style payload (envelope.to)', async () => {
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(makeReq({
      envelope: {
        from: 'factory@x.com',
        to: ['thread+order-O42@inbox.nexyfab.com'],
      },
      text: 'reply via sendgrid',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.threadId).toBe('O42');
  });

  it('403 when sender does not match thread partner', async () => {
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'real-factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(makeReq({
      from: 'attacker@evil.com',
      to: 'thread+order-O1@inbox.nexyfab.com',
      text: 'malicious',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });

  it('strips quoted reply blocks', async () => {
    let captured = '';
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn(async (...args: unknown[]) => {
        const a = args as string[];
        if (a[0]?.includes('INSERT INTO nf_thread_messages')) {
          captured = a[6];  // body column
        }
      }),
    } as unknown as ReturnType<typeof getDbAdapter>);
    await POST(makeReq({
      from: 'factory@x.com',
      to: 'thread+order-O1@inbox.nexyfab.com',
      text: 'New reply text\n\nOn Mon, Jan 1, 2026 at 10:00 user wrote:\n> previous question',
    }) as Parameters<typeof POST>[0]);
    expect(captured).toBe('New reply text');
    expect(captured).not.toContain('previous question');
  });

  it('falls back to HTML when text is empty', async () => {
    let captured = '';
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn(async (...args: unknown[]) => {
        const a = args as string[];
        if (a[0]?.includes('INSERT INTO nf_thread_messages')) {
          captured = a[6];
        }
      }),
    } as unknown as ReturnType<typeof getDbAdapter>);
    await POST(makeReq({
      from: 'factory@x.com',
      to: 'thread+order-O1@inbox.nexyfab.com',
      text: '',
      html: '<p>Reply <b>body</b></p><script>alert(1)</script>',
    }) as Parameters<typeof POST>[0]);
    expect(captured).toContain('Reply');
    expect(captured).not.toContain('alert');
    expect(captured).not.toContain('<');
  });

  it('shared-secret guard rejects when missing header', async () => {
    process.env.INBOUND_EMAIL_SHARED_SECRET = 'sekret';
    vi.resetModules();
    const { POST: P } = await import('../route');
    const res = await P(makeReq({ from: 'x@y.com', to: 'thread+order-O1@a.b', text: '!' }) as Parameters<typeof P>[0]);
    expect(res.status).toBe(401);
  });

  it('shared-secret guard accepts when header matches', async () => {
    process.env.INBOUND_EMAIL_SHARED_SECRET = 'sekret';
    vi.resetModules();
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValueOnce({ user_id: 'b1', partner_email: 'factory@x.com' }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const { POST: P } = await import('../route');
    const res = await P(makeReq(
      { from: 'factory@x.com', to: 'thread+order-O1@inbox.nexyfab.com', text: 'ok' },
      { 'x-inbound-secret': 'sekret' },
    ) as Parameters<typeof P>[0]);
    expect(res.status).toBe(201);
  });

  it('handles RFQ thread routing with accepted quote partner', async () => {
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn()
        .mockResolvedValueOnce({ user_id: 'b1', preferred_factory_id: null })  // rfq
        .mockResolvedValueOnce({ partner_email: 'factory@x.com' }),  // accepted quote
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);
    const res = await POST(makeReq({
      from: 'factory@x.com',
      to: 'thread+rfq-r1@inbox.nexyfab.com',
      text: 'Quote details ready',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.threadKind).toBe('rfq');
  });
});
