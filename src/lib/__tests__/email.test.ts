import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../email-suppression', () => ({ isSuppressed: vi.fn(async () => false) }));
vi.mock('../api-meter', () => ({ recordApiUsage: vi.fn() }));

const { sendEmail } = await import('../email');

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test_https_key';
  process.env.MAIL_FROM = 'NexyFab <noreply@nexyfab.com>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe('email HTTPS transport', () => {
  it('uses the Resend API and preserves an already formatted sender', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ id: 'email_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      to: 'owner@example.com',
      subject: 'Admin code',
      html: '<b>123456</b>',
    });

    expect(result).toEqual({ ok: true, messageId: 'email_123' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: 'NexyFab <noreply@nexyfab.com>',
      to: ['owner@example.com'],
      subject: 'Admin code',
    });
  });

  it('returns a bounded provider error without exposing the API key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'domain not verified' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })));
    const result = await sendEmail({ to: 'owner@example.com', subject: 'Admin code', html: '123456' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('resend_http_403');
    expect(result.error).not.toContain(process.env.RESEND_API_KEY!);
  });
});
