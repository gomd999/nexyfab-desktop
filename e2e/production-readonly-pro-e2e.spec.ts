import fs from 'node:fs';
import path from 'node:path';
import { expect, request as requestFactory, test, type APIRequestContext } from '@playwright/test';

/**
 * Production Pro read-only E2E.
 *
 * This file deliberately has one write-shaped call: POST /api/auth/login is
 * needed to establish a session. Every project, workspace, exact-CAD and
 * artifact operation below is GET-only. Do not add signup, project saves,
 * proposal/exact/artifact commits, cleanup DELETEs, or any other mutation.
 *
 * Required when intentionally running against production:
 *   E2E_PRODUCTION_READONLY=1
 *   E2E_BASE_URL=https://nexyfab.com (or https://www.nexyfab.com)
 *   E2E_PRODUCTION_PROJECT_ID=<pre-existing project owned/shared to the account>
 *
 * Credentials are read from E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD or the existing
 * ignored .e2e-credentials.json. Values are never logged or attached to the
 * report. The suite is skipped unless the explicit opt-in flag is present.
 */

const PRODUCTION_HOSTS = new Set(['nexyfab.com', 'www.nexyfab.com']);
const UNSUPPORTED_STATUSES = new Set([404, 409]);

type Credentials = { email: string; password: string };
type Surface = {
  name: string;
  path: string;
  status: number;
  supported: boolean;
  code?: string;
};

function requiredProductionOrigin(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('E2E_BASE_URL is required for the production read-only suite');
  const target = new URL(baseURL);
  if (target.protocol !== 'https:' || !PRODUCTION_HOSTS.has(target.hostname.toLowerCase())) {
    throw new Error('Production read-only E2E accepts only https://nexyfab.com or https://www.nexyfab.com');
  }
  return target.origin;
}

function readCredentials(): Credentials {
  const credentialsPath = path.resolve(process.cwd(), '.e2e-credentials.json');
  let fileCredentials: Partial<Credentials> = {};
  if (fs.existsSync(credentialsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as Record<string, unknown>;
      fileCredentials = {
        email: typeof parsed.email === 'string' ? parsed.email : undefined,
        password: typeof parsed.password === 'string' ? parsed.password : undefined,
      };
    } catch {
      throw new Error('Unable to read the ignored .e2e-credentials.json');
    }
  }

  const email = process.env.E2E_AUTH_EMAIL ?? fileCredentials.email;
  const password = process.env.E2E_AUTH_PASSWORD ?? fileCredentials.password;
  if (!email || !password) {
    throw new Error('E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD or ignored .e2e-credentials.json are required');
  }
  return { email, password };
}

async function jsonCode(response: { json: () => Promise<unknown> }): Promise<string | undefined> {
  try {
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.code === 'string') return value.code;
    if (typeof value.error === 'string') return value.error.slice(0, 120);
  } catch {
    // A non-JSON unsupported response is still reported by status.
  }
  return undefined;
}

async function readOptionalSurface(
  api: APIRequestContext,
  surfaces: Surface[],
  name: string,
  endpoint: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await api.get(endpoint);
  const code = await jsonCode(response);
  const supported = response.status() === 200;
  if (!supported && !UNSUPPORTED_STATUSES.has(response.status())) {
    throw new Error(`${name} GET returned unexpected HTTP ${response.status()}`);
  }
  surfaces.push({ name, path: endpoint, status: response.status(), supported, ...(code ? { code } : {}) });
  if (!supported) return undefined;
  // Parse a second time is not possible after jsonCode consumed the body. The
  // response body is intentionally read once by this helper, so the optional
  // caller only needs the support/status result for reporting and reload.
  return undefined;
}

async function readOptionalSurfacePayload(
  api: APIRequestContext,
  surfaces: Surface[],
  name: string,
  endpoint: string,
): Promise<Record<string, unknown> | undefined> {
  const response = await api.get(endpoint);
  let payload: Record<string, unknown> | undefined;
  let code: string | undefined;
  try {
    const value = await response.json() as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      payload = value as Record<string, unknown>;
      if (typeof payload.code === 'string') code = payload.code;
      else if (typeof payload.error === 'string') code = payload.error.slice(0, 120);
    }
  } catch {
    // Status remains sufficient for an unsupported surface report.
  }
  const supported = response.status() === 200;
  if (!supported && !UNSUPPORTED_STATUSES.has(response.status())) {
    throw new Error(`${name} GET returned unexpected HTTP ${response.status()}`);
  }
  surfaces.push({ name, path: endpoint, status: response.status(), supported, ...(code ? { code } : {}) });
  return supported ? payload : undefined;
}

async function login(api: APIRequestContext, credentials: Credentials): Promise<void> {
  const response = await api.post('/api/auth/login', {
    data: credentials,
  });
  // Do not include response text: a production auth error must not be copied
  // into a report alongside any request context.
  expect(response.status()).toBe(200);
}

test.describe('production Pro read-only architecture/interior E2E', () => {
  test('login → session → project/workspace/exact/artifact GET → reload', async ({ baseURL }) => {
    test.skip(process.env.E2E_PRODUCTION_READONLY !== '1', 'requires explicit E2E_PRODUCTION_READONLY=1 opt-in');
    test.setTimeout(120_000);

    const origin = requiredProductionOrigin(baseURL);
    const projectId = process.env.E2E_PRODUCTION_PROJECT_ID?.trim();
    if (!projectId) throw new Error('E2E_PRODUCTION_PROJECT_ID must identify a pre-existing project');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(projectId)) {
      throw new Error('E2E_PRODUCTION_PROJECT_ID contains unsupported characters');
    }

    const credentials = readCredentials();
    const api = await requestFactory.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Production-ReadOnly-E2E/1.0' },
    });
    const surfaces: Surface[] = [];

    try {
      await login(api, credentials);

      const session = await api.get('/api/auth/session');
      expect(session.status()).toBe(200);
      const sessionPayload = await session.json() as { authenticated?: boolean; user?: { plan?: string } };
      expect(sessionPayload.authenticated).toBe(true);
      expect(['pro', 'team', 'enterprise']).toContain(sessionPayload.user?.plan);

      const projects = await api.get('/api/nexyfab/projects?limit=50');
      expect(projects.status()).toBe(200);
      const projectList = await projects.json() as { projects?: Array<{ id?: string }> };
      let projectListed = projectList.projects?.some(project => project.id === projectId) ?? false;
      if (!projectListed) {
        // A project may be shared to the Pro account rather than owned by it.
        // The fallback remains GET-only and exercises the separate ACL list.
        const shared = await api.get('/api/nexyfab/projects?shared=true&limit=50');
        expect(shared.status()).toBe(200);
        const sharedPayload = await shared.json() as { projects?: Array<{ id?: string }> };
        projectListed = sharedPayload.projects?.some(project => project.id === projectId) ?? false;
      }
      expect(projectListed).toBe(true);

      const project = await api.get(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`);
      expect(project.status()).toBe(200);
      const projectPayload = await project.json() as { project?: { id?: string; updatedAt?: number } };
      expect(projectPayload.project?.id).toBe(projectId);
      const originalUpdatedAt = projectPayload.project?.updatedAt;

      const workspaceEndpoint = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`;
      const workspace = await readOptionalSurfacePayload(api, surfaces, 'architecture-interior workspace', workspaceEndpoint);
      if (workspace) {
        expect(workspace.ok).toBe(true);
        expect(workspace.session).toBeDefined();
        expect(workspace.workspace).toBeDefined();
      }

      // This GET-only revision listing is supported independently of the
      // architecture/interior workspace and helps distinguish an unseeded
      // project from an unavailable domain surface.
      await readOptionalSurface(api, surfaces, 'CAD workspace revisions', `/api/nexyfab/projects/${encodeURIComponent(projectId)}/cad-revisions?list=1&limit=20`);

      const exactEndpoint = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-exact`;
      const exact = await readOptionalSurfacePayload(api, surfaces, 'exact CAD status', exactEndpoint);
      if (exact) {
        expect(exact.projectId ?? projectId).toBe(projectId);
        expect(exact.exact).toBeDefined();
      }

      const artifactEndpoint = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-artifacts`;
      const artifact = await readOptionalSurfacePayload(api, surfaces, 'architecture/interior artifact bundle', artifactEndpoint);
      if (artifact) {
        expect(artifact.projectId ?? projectId).toBe(projectId);
        expect(artifact.bundle).toBeDefined();
      }

      const state = await api.storageState();
      const reconnected = await requestFactory.newContext({
        baseURL: origin,
        storageState: state,
        extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Production-ReadOnly-E2E/1.0-reload' },
      });
      try {
        const reloaded = await reconnected.get(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`);
        expect(reloaded.status()).toBe(200);
        const reloadedPayload = await reloaded.json() as { project?: { id?: string; updatedAt?: number } };
        expect(reloadedPayload.project?.id).toBe(projectId);
        expect(reloadedPayload.project?.updatedAt).toBe(originalUpdatedAt);

        if (workspace) {
          const reloadedWorkspace = await reconnected.get(workspaceEndpoint);
          expect(reloadedWorkspace.status()).toBe(200);
          const payload = await reloadedWorkspace.json() as { session?: { revision?: number; contentHash?: string } };
          const originalSession = workspace.session as { revision?: number; contentHash?: string };
          expect(payload.session?.revision).toBe(originalSession.revision);
          expect(payload.session?.contentHash).toBe(originalSession.contentHash);
        }
        if (exact) {
          const reloadedExact = await reconnected.get(exactEndpoint);
          expect(reloadedExact.status()).toBe(200);
        }
        if (artifact) {
          const reloadedArtifact = await reconnected.get(artifactEndpoint);
          expect(reloadedArtifact.status()).toBe(200);
        }
      } finally {
        await reconnected.dispose();
      }

    } finally {
      if (surfaces.length > 0) {
        // Keep unsupported GET surfaces explicit in the Playwright artifact,
        // including when a later reload assertion fails.
        await test.info().attach('production-readonly-surface-report.json', {
          body: JSON.stringify({ schema: 'nexyfab.production-readonly-e2e.v1', target: origin, projectId, surfaces }, null, 2),
          contentType: 'application/json',
        });
        for (const surface of surfaces.filter(item => !item.supported)) {
          test.info().annotations.push({
            type: 'unsupported-surface',
            description: `${surface.name}: GET ${surface.path} returned HTTP ${surface.status}${surface.code ? ` (${surface.code})` : ''}`,
          });
        }
      }
      await api.dispose();
    }
  });
});
