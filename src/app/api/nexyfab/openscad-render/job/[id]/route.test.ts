import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn() }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '203.0.113.10') }));
vi.mock('@/lib/openscad-render/jobQueue', () => ({ getOpenScadJobAsync: vi.fn() }));

import { getAuthUser } from '@/lib/auth-middleware';
import { getOpenScadJobAsync } from '@/lib/openscad-render/jobQueue';
import { GET } from './route';

const context = { params: Promise.resolve({ id: 'oscad-test' }) };

describe('OpenSCAD async job ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds a guest poll to the same trusted IP owner as POST', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(getOpenScadJobAsync).mockResolvedValue({
      id: 'oscad-test',
      userId: 'guest:203.0.113.10',
      status: 'complete',
      format: 'stl',
      createdAt: 1,
      updatedAt: 2,
      resultBase64: 'c3Rs',
    });
    const response = await GET(new NextRequest('https://nexyfab.test/api/nexyfab/openscad-render/job/oscad-test'), context);
    expect(response.status).toBe(200);
    expect(getOpenScadJobAsync).toHaveBeenCalledWith('oscad-test', 'guest:203.0.113.10');
  });

  it('uses the authenticated account owner when present', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: 'account-1',
      email: 'user@example.test',
      plan: 'pro',
      globalRole: 'user',
      roles: [],
      orgIds: [],
      emailVerified: true,
    });
    vi.mocked(getOpenScadJobAsync).mockResolvedValue(null);
    const response = await GET(new NextRequest('https://nexyfab.test/api/nexyfab/openscad-render/job/oscad-test'), context);
    expect(response.status).toBe(404);
    expect(getOpenScadJobAsync).toHaveBeenCalledWith('oscad-test', 'account-1');
  });
});
