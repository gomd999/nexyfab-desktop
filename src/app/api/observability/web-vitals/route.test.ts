import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => 'test-ip' }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ allowed: true }) }));

import { POST } from './route';

describe('POST /api/observability/web-vitals', () => {
  beforeEach(() => logAudit.mockClear());

  it('stores a sanitized anonymous metric without IP or arbitrary fields', async () => {
    const request = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'INP', value: 140, delta: 30, rating: 'good', device: 'mobile',
        route: '/kr/nexyfab/projects/private-project-id-123456?email=secret@example.com',
        prompt: 'private design prompt',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(logAudit).toHaveBeenCalledWith({
      userId: 'anonymous-rum',
      action: 'rum.web_vital',
      resourceId: '/kr/nexyfab/projects/:id',
      metadata: {
        name: 'INP', value: 140, delta: 30, rating: 'good', device: 'mobile',
        route: '/kr/nexyfab/projects/:id',
      },
    });
  });

  it('rejects unsupported or oversized metrics', async () => {
    const bad = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST', body: JSON.stringify({ name: 'FCP' }),
    });
    expect((await POST(bad)).status).toBe(400);

    const oversized = new NextRequest('https://nexyfab.com/api/observability/web-vitals/', {
      method: 'POST', body: '{}', headers: { 'content-length': '4096' },
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
