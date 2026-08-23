import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  resolveProjectAccess: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: () => ({}) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: () => '127.0.0.1' }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: () => true }));

import { POST } from './route';

const keys = generateKeyPairSync('ed25519');
const privateKeyBase64 = Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
const auth = {
  userId: 'user-1', email: 'member@example.com', plan: 'pro', globalRole: 'user', roles: [],
  orgIds: ['org-1'], activeOrgId: 'org-1', orgContextStatus: 'active' as const, emailVerified: true,
};

function request(body: unknown = { projectId: 'project-1' }): NextRequest {
  return new NextRequest('https://nexyfab.com/api/integrations/nexycad/handoff', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://nexyfab.com' }, body: JSON.stringify(body),
  });
}

describe('POST /api/integrations/nexycad/handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.resolveProjectAccess.mockResolvedValue({ row: { id: 'project-1', org_id: 'org-1' }, role: 'editor', canEdit: true, ownerUserId: 'owner-1' });
    process.env.NEXYCAD_STUDIO_URL = 'https://cad-preview.nexyfab.com/';
    process.env.NEXYCAD_HANDOFF_ISSUER = 'https://nexyfab.com';
    process.env.NEXYCAD_HANDOFF_AUDIENCE = 'nexycad-commercial';
    process.env.NEXYCAD_HANDOFF_KEY_ID = 'nf-test';
    process.env.NEXYCAD_HANDOFF_PRIVATE_KEY_PEM_BASE64 = privateKeyBase64;
  });

  it('requires a verified interactive member with current project access', async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.getAuthUser.mockResolvedValueOnce({ ...auth, emailVerified: false });
    expect((await POST(request())).status).toBe(403);
    mocks.resolveProjectAccess.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
  });

  it('returns a no-store fragment launch URL with only project-scoped claims', async () => {
    const response = await POST(request());
    const body = await response.json() as { launchUrl: string; project: { role: string }; consentRequired: boolean };
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const launch = new URL(body.launchUrl);
    expect(launch.search).toBe('');
    const token = new URLSearchParams(launch.hash.slice(1)).get('handoff');
    expect(token).toBeTruthy();
    const payload = JSON.parse(Buffer.from(token!.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(payload).toMatchObject({ sub: 'user-1', organization_id: 'org-1', project_id: 'project-1', project_role: 'EDITOR' });
    expect(JSON.stringify(payload)).not.toMatch(/member@example|email|name|plan|cookie/i);
    expect(body.project.role).toBe('EDITOR');
    expect(body.consentRequired).toBe(true);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'nexycad.handoff.issue', resourceId: 'project-1' }));
  });

  it('fails closed when signing configuration is absent', async () => {
    delete process.env.NEXYCAD_HANDOFF_PRIVATE_KEY_PEM_BASE64;
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'NEXYCAD_HANDOFF_NOT_CONFIGURED' });
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
