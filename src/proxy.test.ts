import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, proxy } from './proxy';

function request(
  path: string,
  ip = '203.0.113.10',
  init: { method?: string; contentLength?: number } = {},
): NextRequest {
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (init.contentLength != null) headers['content-length'] = String(init.contentLength);
  return new NextRequest(`https://nexyfab.com${path}`, {
    method: init.method,
    headers,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Next 16 proxy closed-beta security boundary', () => {
  it('defaults to shadow mode and preserves existing asset responses', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await proxy(request('/uploads/quick-quote/existing-beta.step'));

    expect(response.status).not.toBe(404);
    expect(console.warn).toHaveBeenCalledWith(
      '[security-event]',
      expect.stringContaining('"decision":"would_block"'),
    );
    const payload = JSON.parse(vi.mocked(console.warn).mock.calls[0][1] as string);
    expect(payload).toMatchObject({
      event: 'security_gate_decision', mode: 'shadow',
      reason: 'blocked_public_asset', pathname: '/uploads/:path*',
    });
  });

  it('defaults to enforcement in production when no rollout flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SECURITY_GATE_MODE', '');
    const response = await proxy(request('/api/example', '203.0.113.82', {
      method: 'POST',
      contentLength: 17 * 1024 * 1024,
    }));
    expect(response.status).toBe(413);
  });

  it.each(['/send-mail.php', '/search.php'])(
    'never serves non-executable legacy PHP source: %s',
    async (path) => {
      vi.stubEnv('SECURITY_GATE_MODE', 'off');
      const response = await proxy(request(path));
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('blocks legacy upload paths only in enforce mode', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const response = await proxy(request('/uploads/quick-quote/customer.step'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('off mode bypasses the new compatibility gate', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'off');
    const response = await proxy(request('/uploads/quick-quote/existing-beta.step'));
    expect(response.status).not.toBe(404);
  });

  it('matches every API route so observation covers the full surface', () => {
    expect(config.matcher).toContain('/api/:path*');
  });

  it('allows the passwordless admin sign-in endpoint while protecting other admin APIs', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'off');
    vi.stubEnv('ADMIN_OTP_REQUIRED', 'true');
    const signIn = await proxy(request('/api/admin/auth', '203.0.113.86', { method: 'POST' }));
    const protectedRoute = await proxy(request('/api/admin/users', '203.0.113.87'));
    expect(signIn.status).not.toBe(428);
    expect(protectedRoute.status).toBe(428);
  });

  it('observes rate-limit violations without blocking in shadow mode', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'shadow');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ip = '203.0.113.77';
    for (let i = 0; i < 101; i += 1) {
      const response = await proxy(request('/api/health', ip));
      expect(response.status).not.toBe(429);
    }
  });

  it('rate-limits repeated traffic in enforce mode', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const ip = '203.0.113.78';
    for (let i = 0; i < 100; i += 1) {
      const response = await proxy(request('/api/health', ip));
      expect(response.status).not.toBe(429);
    }
    const blocked = await proxy(request('/api/health', ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('observes oversized requests in shadow and blocks only in enforce', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('SECURITY_GATE_MODE', 'shadow');
    const observed = await proxy(request('/api/example', '203.0.113.80', {
      method: 'POST',
      contentLength: 17 * 1024 * 1024,
    }));
    expect(observed.status).not.toBe(413);

    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const blocked = await proxy(request('/api/example', '203.0.113.81', {
      method: 'POST',
      contentLength: 17 * 1024 * 1024,
    }));
    expect(blocked.status).toBe(413);
  });

  it('preserves route-aligned upload ceilings for complex verified systems', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const graphBundle = await proxy(request('/api/cad/v1/system/verify', '203.0.113.90', {
      method: 'POST', contentLength: 149_000_000,
    }));
    const impactBundle = await proxy(request('/api/cad/v1/system/change-impact/verify', '203.0.113.91', {
      method: 'POST', contentLength: 299_000_000,
    }));
    const scaleBundle = await proxy(request('/api/cad/v1/system/scale/verify', '203.0.113.92', {
      method: 'POST', contentLength: 127 * 1024 * 1024,
    }));
    expect(graphBundle.status).not.toBe(413);
    expect(impactBundle.status).not.toBe(413);
    expect(scaleBundle.status).not.toBe(413);
    const oversizedScaleBundle = await proxy(request('/api/cad/v1/system/scale/verify', '203.0.113.93', {
      method: 'POST', contentLength: 128 * 1024 * 1024 + 1,
    }));
    expect(oversizedScaleBundle.status).toBe(413);
    const sendMailAtCap = await proxy(request('/api/send-mail', '203.0.113.94', {
      method: 'POST', contentLength: 20 * 1024 * 1024,
    }));
    const oversizedSendMail = await proxy(request('/api/send-mail', '203.0.113.95', {
      method: 'POST', contentLength: 20 * 1024 * 1024 + 1,
    }));
    expect(sendMailAtCap.status).not.toBe(413);
    expect(oversizedSendMail.status).toBe(413);
  });

  it('blocks cross-site cookie mutations but leaves bearer/server calls unaffected', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const cookieRequest = request('/api/nexyfab/projects', '203.0.113.83', { method: 'POST' });
    cookieRequest.headers.set('origin', 'https://evil.example');
    cookieRequest.headers.set('sec-fetch-site', 'cross-site');
    cookieRequest.cookies.set('nf_access_token', 'closed-beta-token');
    expect((await proxy(cookieRequest)).status).toBe(403);

    const bearerRequest = request('/api/nexyfab/projects', '203.0.113.84', { method: 'POST' });
    bearerRequest.headers.set('origin', 'https://developer.example');
    bearerRequest.headers.set('authorization', 'Bearer API-key-or-token');
    expect((await proxy(bearerRequest)).status).not.toBe(403);
  });

  it('also protects refresh-token-only cookie rotation from cross-site requests', async () => {
    vi.stubEnv('SECURITY_GATE_MODE', 'enforce');
    const refreshRequest = request('/api/auth/refresh', '203.0.113.85', { method: 'POST' });
    refreshRequest.headers.set('origin', 'https://evil.example');
    refreshRequest.headers.set('sec-fetch-site', 'cross-site');
    refreshRequest.cookies.set('nf_refresh_token', 'closed-beta-refresh-token');
    expect((await proxy(refreshRequest)).status).toBe(403);
  });
});
