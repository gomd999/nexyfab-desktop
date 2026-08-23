import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, request as requestFactory, test } from '@playwright/test';
import { assertStagingMutationSafety } from './helpers/staging-safety';
import {
  AUTHENTICATED_E2E_REQUIRED_CHECKS,
  buildAuthenticatedCommercialE2EReceipt,
  writeAuthenticatedE2ESource,
} from './authenticated-commercial-e2e-receipt';

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
  const target = new URL(baseURL);
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  test.skip(
    isLocal && process.env.E2E_ALLOW_LOCAL_AUTH_LIFECYCLE !== '1',
    'The production-mode local server intentionally disables demo auth; run this lifecycle against isolated staging or opt in explicitly.',
  );
  const receiptPath = process.env.COMMERCIAL_E2E_RECEIPT
    ? path.resolve(process.env.COMMERCIAL_E2E_RECEIPT)
    : null;
  if (receiptPath && fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath);
  const account = credentials();
  const observations: Array<Record<string, unknown>> = [];
  const observe = async (id: string, pathname: string, response: { status(): number; body(): Promise<Buffer>; headers(): Record<string, string> } | null, method = 'GET') => {
    const body = response ? await response.body().catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
    observations.push({
      id,
      request: { method, pathname },
      httpStatus: response?.status() ?? 599,
      bodyBytes: body.byteLength,
      bodySha256: createHash('sha256').update(body).digest('hex'),
      contentType: response?.headers()['content-type'] ?? '',
    });
  };
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
    await observe('login', '/api/auth/login', login, 'POST');
    expect(login.status(), await login.text()).toBe(200);

    const session = await api.get('/api/auth/session');
    await observe('session', '/api/auth/session', session);
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
    await observe('project_create', '/api/nexyfab/projects', created, 'POST');
    expect(created.status(), await created.text()).toBe(201);
    const project = (await created.json()).project;
    projectId = project.id;

    const saved = await api.get(`/api/nexyfab/projects/${encodeURIComponent(projectId!)}`);
    await observe('project_read', `/api/nexyfab/projects/${encodeURIComponent(projectId!)}`, saved);
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).project.name).toBe(project.name);

    const verified = await api.post('/api/cad/v1/project/verify', {
      data: { structure: { valid: true }, placement: { required: 1, resolved: 1, invalid: 0 } },
    });
    await observe('cad_verify', '/api/cad/v1/project/verify', verified, 'POST');
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
      await observe('storage_state_reconnect', `/api/nexyfab/projects/${encodeURIComponent(projectId!)}`, reopened);
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
      await observe('expert_workspace_visible', '/en/shape-generator/?expert=1&mode=expert', response);
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 90_000 });
      observations[observations.length - 1] = {
        ...observations[observations.length - 1],
        marker: 'shape-generator-workspace',
        markerSha256: createHash('sha256').update('shape-generator-workspace').digest('hex'),
      };
    } finally {
      await browserContext.close();
    }
  } finally {
    if (projectId) {
      const removed = await api.delete(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`);
      await observe('project_cleanup', `/api/nexyfab/projects/${encodeURIComponent(projectId!)}`, removed, 'DELETE');
      expect([200, 404]).toContain(removed.status());
    }
    const logout = await api.post('/api/auth/logout').catch(() => null);
    await observe('logout', '/api/auth/logout', logout, 'POST');
    await api.dispose();
  }
  if (receiptPath) {
    const readyResponse = await requestFactory.newContext({ baseURL }).then(async readyApi => {
      try { return await readyApi.get('/api/health/ready'); } finally { await readyApi.dispose(); }
    });
    const readyBody = readyResponse.ok() ? await readyResponse.json() : null;
    const release = {
      buildId: process.env.NEXYFAB_E2E_BUILD_ID?.trim() ?? '',
      productionDeploymentId: process.env.NEXYFAB_E2E_PRODUCTION_DEPLOYMENT_ID?.trim() ?? '',
      evidenceDeploymentId: process.env.NEXYFAB_E2E_DEPLOYMENT_ID?.trim() ?? '',
      gitHead: process.env.NEXYFAB_E2E_GIT_HEAD?.trim() ?? '',
    };
    const component = (value: Record<string, unknown> | undefined) => ({
      status: value?.status ?? null,
      required: value?.required === true,
      backend: value?.backend ?? null,
    });
    const generatedAt = new Date().toISOString();
    const ready = readyBody ? {
        status: readyBody.status ?? null,
        db: component(readyBody.db),
        redis: component(readyBody.redis),
        commercialBoundary: component(readyBody.commercialBoundary),
      } : null;
    if (!readyResponse.ok() || observations.length !== AUTHENTICATED_E2E_REQUIRED_CHECKS.length) {
      throw new Error('authenticated E2E receipt requires every exact check observation');
    }
    const sourceOutput = `${receiptPath}.observations.json`;
    const source = writeAuthenticatedE2ESource({
      artifactPath: path.relative(process.cwd(), sourceOutput), generatedAt,
      target: new URL(baseURL).origin, observations: observations as never,
    });
    const receipt = buildAuthenticatedCommercialE2EReceipt({
      generatedAt, target: new URL(baseURL).origin, release,
      observations: observations as never, ready, sourceBindings: [source.binding],
    });
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
});
