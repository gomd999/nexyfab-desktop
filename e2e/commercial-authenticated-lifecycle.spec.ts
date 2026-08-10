import fs from 'node:fs';
import path from 'node:path';
import { expect, request as requestFactory, test } from '@playwright/test';
import { assertStagingMutationSafety } from './helpers/staging-safety';

type Credentials = { email: string; password: string };

function credentials(): Credentials {
  if (process.env.E2E_AUTH_EMAIL && process.env.E2E_AUTH_PASSWORD) {
    return { email: process.env.E2E_AUTH_EMAIL, password: process.env.E2E_AUTH_PASSWORD };
  }
  const file = path.resolve('.e2e-credentials.json');
  if (!fs.existsSync(file)) throw new Error('Authenticated commercial E2E credentials are required');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Credentials>;
  if (!value.email || !value.password) throw new Error('Invalid .e2e-credentials.json');
  return { email: value.email, password: value.password };
}

test('authenticated project → CAD verify → reconnect → expert workspace → cleanup', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error('E2E baseURL is required');
  const receiptPath = process.env.COMMERCIAL_E2E_RECEIPT
    ? path.resolve(process.env.COMMERCIAL_E2E_RECEIPT)
    : null;
  if (receiptPath && fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath);
  const account = credentials();
  assertStagingMutationSafety({
    baseURL,
    confirmation: process.env.E2E_STAGING_MUTATION_CONFIRM,
    accountEmails: [account.email],
    tenantMarker: process.env.E2E_STAGING_TENANT_MARKER ?? 'e2e',
  });
  const api = await requestFactory.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL, 'user-agent': 'NexyFab-Commercial-E2E/1.0' },
  });
  let projectId: string | null = null;
  try {
    const login = await api.post('/api/auth/login', { data: account });
    expect(login.status(), await login.text()).toBe(200);

    const session = await api.get('/api/auth/session');
    expect(session.status(), await session.text()).toBe(200);
    expect((await session.json()).user.email).toBe(account.email);

    const created = await api.post('/api/nexyfab/projects', {
      data: {
        name: `commercial-e2e-${Date.now()}`,
        shapeId: 'box',
        materialId: 'steel',
        sceneData: JSON.stringify({ schema: 'nexyfab.e2e.v1', features: [{ type: 'box', dimensions: [30, 20, 10] }] }),
        tags: ['commercial-e2e'],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const project = (await created.json()).project;
    projectId = project.id;

    const saved = await api.get(`/api/nexyfab/projects/${encodeURIComponent(projectId!)}`);
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).project.name).toBe(project.name);

    const verified = await api.post('/api/cad/v1/project/verify', {
      data: { structure: { valid: true }, placement: { required: 1, resolved: 1, invalid: 0 } },
    });
    expect(verified.status(), await verified.text()).toBe(200);
    expect(await verified.json()).toMatchObject({ ok: true, releaseReady: true });

    const state = await api.storageState();
    expect(state.cookies.some(cookie => cookie.name === 'nf_access_token' && cookie.path === '/')).toBe(true);
    const reconnected = await requestFactory.newContext({
      baseURL,
      storageState: state,
      extraHTTPHeaders: { origin: baseURL, 'user-agent': 'NexyFab-Commercial-E2E/1.0' },
    });
    try {
      const reopened = await reconnected.get(`/api/nexyfab/projects/${encodeURIComponent(projectId!)}`);
      expect(reopened.status(), await reopened.text()).toBe(200);
    } finally {
      await reconnected.dispose();
    }

    const browserContext = await browser.newContext({ storageState: state });
    try {
      const page = await browserContext.newPage();
      const browserSession = await browserContext.request.get(`${baseURL}/api/auth/session/`);
      expect(browserSession.status(), await browserSession.text()).toBe(200);
      const response = await page.goto(`${baseURL}/en/shape-generator/?expert=1&mode=expert`, { waitUntil: 'domcontentloaded' });
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 90_000 });
    } finally {
      await browserContext.close();
    }
  } finally {
    if (projectId) {
      const removed = await api.delete(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`);
      expect([200, 404]).toContain(removed.status());
    }
    await api.post('/api/auth/logout').catch(() => null);
    await api.dispose();
  }
  if (receiptPath) {
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      schema: 'nexyfab.authenticated-commercial-e2e.v1',
      generatedAt: new Date().toISOString(),
      ok: true,
      target: new URL(baseURL).origin,
      checks: [
        'login', 'session', 'project_create', 'project_read', 'cad_verify',
        'storage_state_reconnect', 'expert_workspace_visible', 'project_cleanup', 'logout',
      ],
      credentialsPersisted: false,
      transientProjectRetained: false,
    }, null, 2)}\n`);
  }
});
