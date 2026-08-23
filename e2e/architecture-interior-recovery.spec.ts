import { createHash } from 'node:crypto';
import { expect, request as requestFactory, test, type APIRequestContext, type APIResponse, type BrowserContext } from '@playwright/test';
import { assertStagingMutationSafety } from './helpers/staging-safety';
import {
  assertObjectIdentity,
  clearConfiguredArchitectureInteriorRecoveryEvidence,
  writeArchitectureInteriorRecoveryEvidence,
  workspaceSnapshot,
  type RecoveryObservationId,
  type RecoveryRawObservation,
  type WorkspaceSnapshot,
} from './architecture-interior-recovery-evidence';

type Credentials = { email: string; password: string };
type JsonObject = Record<string, unknown>;
type WorkspaceEnvelope = JsonObject & {
  workspace: { revision: number };
  architecture: { documentId: string; document: JsonObject };
  interior: { documentId: string; document: JsonObject };
  contentHash: string;
};

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function credentials(prefix: string, fallbackPrefix?: string): Credentials | null {
  const email = process.env[`${prefix}_EMAIL`] ?? (fallbackPrefix ? process.env[`${fallbackPrefix}_EMAIL`] : undefined);
  const password = process.env[`${prefix}_PASSWORD`] ?? (fallbackPrefix ? process.env[`${fallbackPrefix}_PASSWORD`] : undefined);
  return email && password ? { email, password } : null;
}

function requiredCredentials(): { owner: Credentials; viewer: Credentials } | null {
  const owner = credentials('E2E_ARCHITECTURE_INTERIOR_RECOVERY_OWNER', 'E2E_STAGING_OWNER');
  const viewer = credentials('E2E_ARCHITECTURE_INTERIOR_RECOVERY_VIEWER', 'E2E_M6_MEMBER');
  return owner && viewer ? { owner, viewer } : null;
}

async function json(response: { json: () => Promise<unknown> }): Promise<JsonObject> {
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected JSON object');
  return value as JsonObject;
}

async function captureApiResponse(
  observations: RecoveryRawObservation[],
  id: RecoveryObservationId,
  method: string,
  pathname: string,
  response: APIResponse,
): Promise<JsonObject> {
  const bytes = await response.body();
  observations.push({
    id,
    request: { method, pathname },
    httpStatus: response.status(),
    contentType: response.headers()['content-type'] ?? '',
    bodyBytes: bytes.byteLength,
    bodySha256: createHash('sha256').update(bytes).digest('hex'),
    bodyBase64: bytes.toString('base64'),
  });
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isJsonObject(value)) throw new Error(`${id} did not return a JSON object`);
  return value;
}

async function login(api: APIRequestContext, account: Credentials, observations?: RecoveryRawObservation[]): Promise<void> {
  const response = await api.post('/api/auth/login', { data: account });
  const body = observations
    ? await captureApiResponse(observations, 'owner_login', 'POST', '/api/auth/login', response)
    : await json(response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
}

async function workspaceFrom(api: APIRequestContext, projectId: string, observations: RecoveryRawObservation[]): Promise<WorkspaceEnvelope> {
  const pathname = `/api/nexyfab/projects/${encodeURIComponent(projectId)}/architecture-interior-agent`;
  const response = await api.get(pathname);
  const body = await captureApiResponse(observations, 'workspace_initialized', 'GET', pathname, response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.session).toBeTruthy();
  if (!body.workspace || typeof body.workspace !== 'object') throw new Error('agent workspace missing');
  return body.workspace as WorkspaceEnvelope;
}

async function initializeWorkspace(api: APIRequestContext, projectPath: string, runId: string): Promise<JsonObject> {
  const proposalResponse = await api.post(`${projectPath}/architecture-interior-ai-design`, {
    data: {
      proposalId: `${runId}-proposal`,
      designBrief: 'Create exactly one empty 4 m by 3 m office with one 0.9 m door. Use exactly four rectangular boundary corners and do not repeat the first point at the end. Return empty furniture, lights, and finishes arrays.',
      sourceLength: 'm',
      construction: { wallThickness: 0.2, slabThickness: 0.2, ceilingThickness: 0.1 },
      constraints: { storeyCount: 1, storeyHeight: 3, maximumFootprintWidth: 12, maximumFootprintDepth: 12 },
      locale: 'en',
    },
  });
  const proposal = await json(proposalResponse);
  expect(proposalResponse.status(), JSON.stringify(proposal)).toBe(200);
  const approval = proposal.approval as JsonObject | undefined;
  expect(approval).toMatchObject({ status: 'ready' });
  const commitResponse = await api.post(`${projectPath}/architecture-interior-ai-design/commit`, {
    data: {
      proposalId: `${runId}-proposal`, proposalHash: approval?.proposalHash, candidateHash: approval?.candidateHash,
      candidate: proposal.candidate, approvalToken: approval?.token,
    },
  });
  const committed = await json(commitResponse);
  expect(commitResponse.status(), JSON.stringify(committed)).toBe(200);
  expect(committed).toMatchObject({ ok: true, code: 'CONCEPT_COMMITTED', persisted: true });
  return committed;
}

async function applyWallResize(api: APIRequestContext, projectPath: string, workspace: WorkspaceEnvelope, wall: JsonObject, observations: RecoveryRawObservation[]): Promise<JsonObject> {
  const args = {
    revision: workspace.workspace.revision,
    documentId: workspace.architecture.documentId,
    objectId: wall.id,
    parameterPaths: ['heightMm'],
    patch: { heightMm: Number(wall.heightMm) + 50 },
  };
  const base = { tool: 'edit_wall', requestedScope: 'apply', requestedProfile: 'architecture-interior', requestedDomain: 'architecture-interior', arguments: args, locale: 'en' };
  const challengeResponse = await api.post(`${projectPath}/architecture-interior-agent`, { data: base });
  const challenge = await json(challengeResponse);
  expect(challengeResponse.status(), JSON.stringify(challenge)).toBe(409);
  expect(challenge.code).toBe('APPROVAL_REQUIRED');
  const receiptHash = (challenge.approval as JsonObject | undefined)?.receiptHash;
  expect(typeof receiptHash).toBe('string');
  const pathname = `${projectPath}/architecture-interior-agent`;
  const response = await api.post(pathname, { data: { ...base, approval: { approved: true, receiptHash } } });
  const body = await captureApiResponse(observations, 'apply_edit', 'POST', pathname, response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.ok).toBe(true);
  return body;
}

async function historyAction(api: APIRequestContext, projectPath: string, action: 'undo' | 'redo', snapshot: WorkspaceSnapshot, observations: RecoveryRawObservation[]): Promise<JsonObject> {
  const base = { action, expectedRevision: snapshot.revision, expectedContentHash: snapshot.contentHash };
  const challengeResponse = await api.post(`${projectPath}/architecture-interior-history`, { data: base });
  const challenge = await json(challengeResponse);
  expect(challengeResponse.status(), JSON.stringify(challenge)).toBe(409);
  expect(challenge.code).toBe('APPROVAL_REQUIRED');
  const receiptHash = (challenge.approval as JsonObject | undefined)?.receiptHash;
  expect(typeof receiptHash).toBe('string');
  const pathname = `${projectPath}/architecture-interior-history`;
  const response = await api.post(pathname, { data: { ...base, approved: true, receiptHash } });
  const body = await captureApiResponse(observations, action, 'POST', pathname, response);
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.ok).toBe(true);
  return body;
}

type BrowserCapturedResponse = {
  body: JsonObject;
  observation: Omit<RecoveryRawObservation, 'id' | 'request'>;
};

async function browserHistoryAction(page: import('@playwright/test').Page, projectId: string, action: 'undo' | 'redo', snapshot: WorkspaceSnapshot): Promise<BrowserCapturedResponse> {
  return page.evaluate(async ({ projectId: id, action: operation, snapshot: state }) => {
    const endpoint = `/api/nexyfab/projects/${encodeURIComponent(id)}/architecture-interior-history`;
    const base = { action: operation, expectedRevision: state.revision, expectedContentHash: state.contentHash };
    const challengeResponse = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base) });
    const challenge = await challengeResponse.json();
    if (challengeResponse.status !== 409 || challenge.code !== 'APPROVAL_REQUIRED' || typeof challenge.approval?.receiptHash !== 'string') throw new Error('browser history approval challenge invalid');
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, approved: true, receiptHash: challenge.approval.receiptHash }) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const body = JSON.parse(text);
    if (!response.ok || body.ok !== true) throw new Error(`browser history ${operation} failed: ${body.code ?? response.status}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const bodySha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return {
      body,
      observation: {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? '',
        bodyBytes: bytes.byteLength,
        bodySha256,
        bodyBase64: btoa(binary),
      },
    };
  }, { projectId, action, snapshot });
}

async function browserWorkspace(page: import('@playwright/test').Page, projectId: string): Promise<BrowserCapturedResponse> {
  return page.evaluate(async id => {
    const response = await fetch(`/api/nexyfab/projects/${encodeURIComponent(id)}/architecture-interior-agent`, { credentials: 'same-origin', cache: 'no-store' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!response.ok || !body.workspace) throw new Error(`browser reconnect failed: ${response.status}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const bodySha256 = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return {
      body,
      observation: {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? '',
        bodyBytes: bytes.byteLength,
        bodySha256,
        bodyBase64: btoa(binary),
      },
    };
  }, projectId);
}

test.describe('authenticated architecture/interior edit recovery', () => {
  test('apply edit -> undo -> browser reload/reconnect -> redo preserves identity and denies viewer writes', async ({ browser, baseURL }) => {
    clearConfiguredArchitectureInteriorRecoveryEvidence();
    const accounts = requiredCredentials();
    test.skip(process.env.E2E_ARCHITECTURE_INTERIOR_RECOVERY !== '1', 'set E2E_ARCHITECTURE_INTERIOR_RECOVERY=1 to run the isolated recovery flow');
    test.skip(!accounts, 'set owner and viewer credentials for the authenticated recovery flow');
    if (!baseURL) throw new Error('E2E baseURL is required');
    const target = new URL(baseURL);
    if (['127.0.0.1', 'localhost', '::1'].includes(target.hostname) && process.env.E2E_ARCHITECTURE_INTERIOR_RECOVERY_ALLOW_LOCAL !== '1') {
      test.skip(true, 'local authenticated recovery is NOT_RUN unless explicitly enabled');
    }
    assertStagingMutationSafety({ baseURL, confirmation: process.env.E2E_STAGING_MUTATION_CONFIRM, accountEmails: [accounts!.owner.email, accounts!.viewer.email], tenantMarker: process.env.E2E_STAGING_TENANT_MARKER ?? 'e2e' });
    test.setTimeout(240_000);

    const origin = target.origin;
    const owner = await requestFactory.newContext({ baseURL: origin, extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Architecture-Interior-Recovery-E2E/1.0' } });
    const viewer = await requestFactory.newContext({ baseURL: origin, extraHTTPHeaders: { origin, 'user-agent': 'NexyFab-Architecture-Interior-Recovery-E2E-viewer/1.0' } });
    const runId = `architecture-interior-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let projectId: string | null = null;
    let editedObjectId: string | null = null;
    let browserContext: BrowserContext | null = null;
    let evidence: { initial: WorkspaceSnapshot; applied: WorkspaceSnapshot; undone: WorkspaceSnapshot; redone: WorkspaceSnapshot } | null = null;
    let viewerDenial: { agentStatus: number; historyStatus: number } | null = null;
    let cleanupPassed = false;
    const observations: RecoveryRawObservation[] = [];
    try {
      await login(owner, accounts!.owner, observations);
      const createdResponse = await owner.post('/api/nexyfab/projects', { data: { name: runId, shapeId: 'architecture-interior', materialId: 'concrete', sceneData: JSON.stringify({ schema: 'nexyfab.architecture-interior-recovery-e2e.v1', runId }), tags: ['staging-e2e', 'architecture-interior-recovery', runId] } });
      const created = await captureApiResponse(observations, 'project_create', 'POST', '/api/nexyfab/projects', createdResponse);
      expect(createdResponse.status(), JSON.stringify(created)).toBe(201);
      projectId = String((created.project as JsonObject | undefined)?.id ?? '');
      expect(projectId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
      const projectPath = `/api/nexyfab/projects/${encodeURIComponent(projectId)}`;
      await initializeWorkspace(owner, projectPath, runId);
      const initialWorkspace = await workspaceFrom(owner, projectId, observations);
      const walls = initialWorkspace.architecture.document.walls;
      const wall = Array.isArray(walls) && isJsonObject(walls[0]) ? walls[0] : undefined;
      if (!wall || typeof wall.id !== 'string' || typeof wall.heightMm !== 'number') throw new Error('initialized architecture workspace has no editable wall');
      editedObjectId = wall.id;
      const initial = workspaceSnapshot(initialWorkspace, wall.id);

      const appliedBody = await applyWallResize(owner, projectPath, initialWorkspace, wall, observations);
      const appliedWorkspace = appliedBody.workspace as WorkspaceEnvelope;
      const applied = workspaceSnapshot(appliedWorkspace, wall.id);
      expect(applied.revision).toBe(initial.revision + 1);
      expect(applied.contentHash).not.toBe(initial.contentHash);
      assertObjectIdentity(initial, applied);
      expect((applied.editedObjectValue as JsonObject).heightMm).toBe(Number((initial.editedObjectValue as JsonObject).heightMm) + 50);

      const undoneBody = await historyAction(owner, projectPath, 'undo', applied, observations);
      const undone = workspaceSnapshot(undoneBody.workspace, wall.id);
      expect(undone.revision).toBe(applied.revision + 1);
      expect(undone.contentHash).not.toBe(applied.contentHash);
      assertObjectIdentity(initial, undone);
      expect((undone.editedObjectValue as JsonObject).heightMm).toBe((initial.editedObjectValue as JsonObject).heightMm);

      browserContext = await browser.newContext({ storageState: await owner.storageState() });
      const page = await browserContext.newPage();
      await page.goto(`${origin}/en/shape-generator/?expert=1&mode=expert&domain=building&experience=expert&workMode=precision_cad&project=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
      const beforeReloadResponse = await browserWorkspace(page, projectId);
      observations.push({ id: 'reconnect_before_reload', request: { method: 'GET', pathname: `${projectPath}/architecture-interior-agent` }, ...beforeReloadResponse.observation });
      const reconnectedBeforeReload = workspaceSnapshot(beforeReloadResponse.body.workspace, wall.id);
      expect(reconnectedBeforeReload.revision).toBe(undone.revision);
      expect(reconnectedBeforeReload.contentHash).toBe(undone.contentHash);
      assertObjectIdentity(undone, reconnectedBeforeReload);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const afterReloadResponse = await browserWorkspace(page, projectId);
      observations.push({ id: 'reconnect_after_reload', request: { method: 'GET', pathname: `${projectPath}/architecture-interior-agent` }, ...afterReloadResponse.observation });
      const reconnected = workspaceSnapshot(afterReloadResponse.body.workspace, wall.id);
      expect(reconnected.revision).toBe(undone.revision);
      expect(reconnected.contentHash).toBe(undone.contentHash);
      assertObjectIdentity(undone, reconnected);

      const redoneResponse = await browserHistoryAction(page, projectId, 'redo', reconnected);
      observations.push({ id: 'redo', request: { method: 'POST', pathname: `${projectPath}/architecture-interior-history` }, ...redoneResponse.observation });
      const redone = workspaceSnapshot(redoneResponse.body.workspace, wall.id);
      expect(redone.revision).toBe(undone.revision + 1);
      expect(redone.contentHash).not.toBe(undone.contentHash);
      assertObjectIdentity(applied, redone);
      expect((redone.editedObjectValue as JsonObject).heightMm).toBe((applied.editedObjectValue as JsonObject).heightMm);
      evidence = { initial, applied, undone, redone };

      await owner.post(`/api/nexyfab/projects/${encodeURIComponent(projectId)}/members`, { data: { email: accounts!.viewer.email, role: 'viewer' } }).then(async response => expect(response.ok(), await response.text()).toBeTruthy());
      await login(viewer, accounts!.viewer);
      const viewerProject = await viewer.get(projectPath);
      expect(viewerProject.status()).toBe(200);
      expect((await json(viewerProject)).project).toMatchObject({ role: 'viewer', canEdit: false });
      const viewerWorkspace = await viewer.get(`${projectPath}/architecture-interior-agent`);
      expect(viewerWorkspace.status()).toBe(200);
      const viewerBody = await json(viewerWorkspace);
      expect(viewerBody.session).toMatchObject({ role: 'viewer' });
      const viewerApply = await viewer.post(`${projectPath}/architecture-interior-agent`, { data: { tool: 'edit_wall', requestedScope: 'apply', requestedProfile: 'architecture-interior', requestedDomain: 'architecture-interior', arguments: { revision: redone.revision, documentId: redone.architectureDocumentId, objectId: wall.id, parameterPaths: ['heightMm'], patch: { heightMm: Number((redone.editedObjectValue as JsonObject).heightMm) + 50 } } } });
      const viewerApplyBody = await captureApiResponse(observations, 'viewer_agent_denied', 'POST', `${projectPath}/architecture-interior-agent`, viewerApply);
      expect(viewerApply.status()).toBe(403);
      expect(viewerApplyBody.code).toBe('EDITOR_REQUIRED');
      const viewerHistory = await viewer.post(`${projectPath}/architecture-interior-history`, { data: { action: 'undo', expectedRevision: redone.revision, expectedContentHash: redone.contentHash } });
      const viewerHistoryBody = await captureApiResponse(observations, 'viewer_history_denied', 'POST', `${projectPath}/architecture-interior-history`, viewerHistory);
      expect(viewerHistory.status()).toBe(403);
      expect(viewerHistoryBody.code).toBe('EDITOR_REQUIRED');
      viewerDenial = { agentStatus: viewerApply.status(), historyStatus: viewerHistory.status() };
    } finally {
      if (projectId) {
        const removed = await owner.delete(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`).catch(() => null);
        if (removed) {
          await captureApiResponse(observations, 'project_cleanup', 'DELETE', `/api/nexyfab/projects/${encodeURIComponent(projectId)}`, removed).catch(() => null);
        }
        cleanupPassed = Boolean(removed && removed.status() === 200);
        if (cleanupPassed) {
          const after = await owner.get(`/api/nexyfab/projects/${encodeURIComponent(projectId)}`).catch(() => null);
          if (after) {
            await captureApiResponse(observations, 'project_cleanup_confirm', 'GET', `/api/nexyfab/projects/${encodeURIComponent(projectId)}`, after).catch(() => null);
          }
          cleanupPassed = Boolean(after && after.status() === 404);
        }
      }
      await browserContext?.close().catch(() => undefined);
      await owner.post('/api/auth/logout').catch(() => undefined);
      await viewer.post('/api/auth/logout').catch(() => undefined);
      await owner.dispose();
      await viewer.dispose();
    }
    expect(cleanupPassed).toBe(true);
    if (evidence && viewerDenial && projectId && editedObjectId) {
      writeArchitectureInteriorRecoveryEvidence({ target: origin, projectId, editedObjectId, observations });
    }
  });
});
