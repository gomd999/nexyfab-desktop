import { test, expect } from '@playwright/test';

function m6EnvReady(): boolean {
  return (
    !!process.env.E2E_M6_OWNER_EMAIL &&
    !!process.env.E2E_M6_OWNER_PASSWORD &&
    !!process.env.E2E_M6_MEMBER_EMAIL &&
    !!process.env.E2E_M6_MEMBER_PASSWORD
  );
}

test.describe('M6 team ACL (API, env-gated)', () => {
  test('viewer gets canEdit false and PATCH scene returns 403', async ({ request }) => {
    test.skip(!m6EnvReady(), 'Set E2E_M6_OWNER_EMAIL, E2E_M6_OWNER_PASSWORD, E2E_M6_MEMBER_EMAIL, E2E_M6_MEMBER_PASSWORD');

    const origin = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
    const originUrl = new URL(origin);
    const hdr = { 'Content-Type': 'application/json', Origin: originUrl.origin };

    const login = async (email: string, password: string) => {
      const res = await request.post(`${origin}/api/auth/login`, { data: { email, password }, headers: hdr });
      expect(res.ok(), await res.text()).toBeTruthy();
    };

    await login(process.env.E2E_M6_OWNER_EMAIL!, process.env.E2E_M6_OWNER_PASSWORD!);
    const projRes = await request.post(`${origin}/api/nexyfab/projects`, {
      data: { name: `e2e-m6-${Date.now()}`, sceneData: '{}' },
      headers: hdr,
    });
    expect(projRes.status(), await projRes.text()).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };

    const addRes = await request.post(`${origin}/api/nexyfab/projects/${project.id}/members`, {
      data: { email: process.env.E2E_M6_MEMBER_EMAIL!, role: 'viewer' },
      headers: hdr,
    });
    expect(addRes.ok(), await addRes.text()).toBeTruthy();

    await login(process.env.E2E_M6_MEMBER_EMAIL!, process.env.E2E_M6_MEMBER_PASSWORD!);
    const getRes = await request.get(`${origin}/api/nexyfab/projects/${project.id}`);
    expect(getRes.ok()).toBeTruthy();
    const body = (await getRes.json()) as { project: { canEdit?: boolean; role?: string } };
    expect(body.project.canEdit).toBe(false);
    expect(body.project.role).toBe('viewer');

    const patchRes = await request.patch(`${origin}/api/nexyfab/projects/${project.id}`, {
      data: { sceneData: '{"x":1}' },
      headers: hdr,
    });
    expect(patchRes.status()).toBe(403);
    const err = (await patchRes.json()) as { code?: string };
    expect(err.code).toBe('PROJECT_READ_ONLY');

    await login(process.env.E2E_M6_OWNER_EMAIL!, process.env.E2E_M6_OWNER_PASSWORD!);
    const listRes = await request.get(`${origin}/api/nexyfab/projects/${project.id}/members`);
    expect(listRes.ok()).toBeTruthy();
    const { members } = (await listRes.json()) as { members: { userId: string; email: string }[] };
    const row = members.find(m => m.email === process.env.E2E_M6_MEMBER_EMAIL);
    expect(row?.userId).toBeTruthy();
    const delM = await request.delete(
      `${origin}/api/nexyfab/projects/${project.id}/members?userId=${encodeURIComponent(row!.userId)}`,
      { headers: hdr },
    );
    expect(delM.ok()).toBeTruthy();

    const delP = await request.delete(`${origin}/api/nexyfab/projects/${project.id}`, { headers: hdr });
    expect(delP.ok()).toBeTruthy();
  });
});
