import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  checkOrigin: vi.fn(() => true),
  getUserOrgs: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.checkOrigin }));
vi.mock('@/lib/rbac', () => ({ getUserOrgs: mocks.getUserOrgs }));

import { GET, POST } from './route';

const authUser = {
  userId: 'user-1',
  orgIds: ['org-a', 'org-b'],
  activeOrgId: null,
  orgContextStatus: 'selection_required',
};

function request(body?: unknown) {
  return new NextRequest('https://nexyfab.com/api/nexyfab/orgs/active', body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://nexyfab.com' },
    body: JSON.stringify(body),
  });
}

describe('/api/nexyfab/orgs/active', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(authUser);
    mocks.getUserOrgs.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
  });

  it('returns the explicit selection state and memberships', async () => {
    const response = await GET(request());
    await expect(response.json()).resolves.toMatchObject({
      activeOrgId: null,
      orgContextStatus: 'selection_required',
      orgs: [{ id: 'org-a' }, { id: 'org-b' }],
    });
  });

  it('sets an httpOnly active-organization cookie for a verified membership', async () => {
    const response = await POST(request({ orgId: 'org-b' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('nf_active_org_id=org-b');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('supports an explicit personal workspace', async () => {
    const response = await POST(request({ orgId: null }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('nf_active_org_id=personal');
  });

  it('rejects selection of a non-member organization', async () => {
    const response = await POST(request({ orgId: 'org-x' }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ORG_CONTEXT_INVALID' });
  });
});
