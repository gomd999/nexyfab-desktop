import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  resolveProjectAccess: vi.fn(),
  getDbAdapter: vi.fn(),
  ensureTables: vi.fn(),
  ensureHistoryTables: vi.fn(),
  appendHistory: vi.fn(),
  readWorkspace: vi.fn(),
  persistWorkspace: vi.fn(),
  executeGateway: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceStore', () => ({
  ensureArchitectureInteriorWorkspaceTables: mocks.ensureTables,
  readArchitectureInteriorWorkspace: mocks.readWorkspace,
  persistArchitectureInteriorWorkspace: mocks.persistWorkspace,
}));
vi.mock('@/lib/ai/architectureInteriorHistoryStore', () => ({
  ensureArchitectureInteriorHistoryTables: mocks.ensureHistoryTables,
  appendArchitectureInteriorHistoryEvent: mocks.appendHistory,
  appendArchitectureInteriorHistoryEventInTransaction: mocks.appendHistory,
}));
vi.mock('@/lib/precision-cad-agent/architectureInteriorBrowserGateway', () => ({
  executeArchitectureInteriorBrowserTool: mocks.executeGateway,
  hashArchitectureInteriorBrowserApproval: vi.fn(() => 'a'.repeat(64)),
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIpOrUndefined: vi.fn(() => undefined) }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ resolveArtifactTenantId: vi.fn(() => 'personal:owner-1') }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));

import { GET, POST } from './route';
import type { ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';

const workspace = {
  projectId: 'project-1',
  workspace: { revision: 3, contentHash: 'b'.repeat(64) },
  contentHash: 'b'.repeat(64),
} as unknown as ArchitectureInteriorWorkspaceV2;
type TestDb = { backend: 'sqlite'; transaction: <T>(fn: (tx: TestDb) => Promise<T>) => Promise<T> };
const db: TestDb = { backend: 'sqlite', transaction: async fn => fn(db) };
const auth = { userId: 'user-1', email: 'u@example.test', orgIds: [], activeOrgId: null, orgContextStatus: 'personal', emailVerified: true };

function req(body?: unknown, locale?: string) {
  return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-agent', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: 'http://localhost', ...(locale ? { 'accept-language': locale } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = { params: Promise.resolve({ id: 'project-1' }) };

describe('architecture/interior browser agent route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.getDbAdapter.mockReturnValue(db);
    mocks.resolveProjectAccess.mockResolvedValue({ row: { id: 'project-1', org_id: null, user_id: 'owner-1' }, role: 'editor', canEdit: true, ownerUserId: 'owner-1' });
    mocks.readWorkspace.mockResolvedValue({ ok: true, workspace, revisionId: 'rev-3', createdAt: 1 });
    mocks.appendHistory.mockResolvedValue({ id: 'history-1', sequence: 1 });
    mocks.persistWorkspace.mockResolvedValue({ ok: true, revisionId: 'rev-4', workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, createdAt: 2 });
    process.env.NEXYFAB_AGENT_APPROVAL_SECRET = 'test-architecture-interior-approval-secret';
  });

  it('requires authentication and project access', async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await GET(req(), params)).status).toBe(401);
    mocks.getAuthUser.mockResolvedValueOnce(auth);
    mocks.resolveProjectAccess.mockResolvedValueOnce(null);
    expect((await GET(req(), params)).status).toBe(404);
  });

  it('does not accept client workspace/profile/capability spoofing', async () => {
    const response = await POST(req({ tool: 'verify_architecture', arguments: {}, workspace, profile: 'other', capabilities: ['edit'] }), params);
    expect(response.status).toBe(400);
    expect(mocks.executeGateway).not.toHaveBeenCalled();
  });

  it('measures chunked bytes despite a falsely small length and cancels the source', async () => {
    let cancelled = false;
    const init = {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-length': '1' },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"tool":"verify_architecture","arguments":{"padding":"'));
          controller.enqueue(new Uint8Array(256 * 1024));
        },
        cancel() { cancelled = true; },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await POST(new NextRequest(
      'http://localhost/api/nexyfab/projects/project-1/architecture-interior-agent',
      init as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>,
    ), params);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(mocks.executeGateway).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 as the existing bad-request contract', async () => {
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-agent', {
      method: 'POST', headers: { origin: 'http://localhost' }, body: new Uint8Array([0xff]),
    }), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('executes a read without persisting and exposes only stable contract fields', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'verify_architecture', scope: 'read', result: { pass: true }, audit: { receiptHash: 'r'.repeat(64) } });
    const response = await POST(req({ tool: 'verify_architecture', arguments: { revision: 3, documentId: 'architecture' }, locale: 'ko' }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, tool: 'verify_architecture', result: { pass: true } });
    expect(mocks.persistWorkspace).not.toHaveBeenCalled();
  });

  it('requires approval for mutation, then persists with the current workspace CAS', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'edit_wall', scope: 'apply', result: { affectedObjectIds: ['w1'] }, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-1', receiptHash: 'r'.repeat(64) } });
    const call = { tool: 'edit_wall', arguments: { revision: 3, documentId: 'architecture', objectId: 'w1', patch: { kind: 'line', startMm: [0, 0], endMm: [10, 0] } } };
    const challengeResponse = await POST(req(call), params);
    expect(challengeResponse.status).toBe(409);
    const challenge = await challengeResponse.json() as { approval: { receiptHash: string } };
    expect(mocks.executeGateway).not.toHaveBeenCalled();
    const approved = { ...call, approval: { approved: true, receiptHash: challenge.approval.receiptHash } };
    expect((await POST(req(approved), params)).status).toBe(200);
    expect(mocks.executeGateway).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ approvedActionHashes: ['a'.repeat(64)] }), call: expect.objectContaining({ approval: { approved: true, receiptHash: 'a'.repeat(64) } }) }));
    expect(mocks.persistWorkspace).toHaveBeenCalledWith(db, expect.anything(), 'project-1', 3, expect.anything(), expect.objectContaining({ baseContentHash: 'b'.repeat(64), transactionalAdapter: db }));
  });

  it('maps a stale persistence CAS to a conflict and locale does not alter the contract', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'edit_space', scope: 'apply', result: {}, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-2', receiptHash: 'r'.repeat(64) } });
    mocks.persistWorkspace.mockResolvedValue({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 4, currentContentHash: 'c'.repeat(64), conflictPaths: ['architecture'] });
    const unapproved = { tool: 'edit_space', arguments: { revision: 3, documentId: 'architecture', objectId: 'sp', patch: { boundaryMm: [[0, 0], [1, 0], [0, 1]] } } };
    const challenge = await (await POST(req(unapproved), params)).json() as { approval: { receiptHash: string } };
    const body = { ...unapproved, approval: { approved: true, receiptHash: challenge.approval.receiptHash } };
    const ko = await POST(req(body, 'ko'), params);
    const ar = await POST(req(body, 'ar'), params);
    expect(ko.status).toBe(409);
    expect(ar.status).toBe(409);
    expect(await ko.json()).toEqual(await ar.json());
  });

  it('allows approved existing-object interior edits through the route allowlist', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'edit_furniture', scope: 'apply', result: { affectedObjectIds: ['desk-1'] }, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-3', receiptHash: 'r'.repeat(64) } });
    const call = { tool: 'edit_furniture', arguments: { revision: 3, documentId: 'interior', objectId: 'desk-1', parameterPaths: ['positionMm'], patch: { positionMm: [10, 10, 0] } } };
    const challenge = await (await POST(req(call), params)).json() as { approval: { receiptHash: string } };
    expect(challenge.approval.receiptHash).toBeTruthy();
    const response = await POST(req({ ...call, approval: { approved: true, receiptHash: challenge.approval.receiptHash } }), params);
    expect(response.status).toBe(200);
    expect(mocks.executeGateway).toHaveBeenCalledWith(expect.objectContaining({ call: expect.objectContaining({ tool: 'edit_furniture' }) }));
  });

  it('exposes finish and millwork creation through the same approval/CAS route', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'create_finish', scope: 'apply', result: { affectedObjectIds: ['finish-1'] }, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-create-finish', receiptHash: 'r'.repeat(64) } });
    const call = { tool: 'create_finish', arguments: { revision: 3, documentId: 'interior', objectId: 'finish-1', parameterPaths: ['spaceId', 'hostId', 'surfaceCode', 'materialCode'], patch: { spaceId: 'sp', hostId: 'slab-1', surfaceCode: 'floor', materialCode: 'oak' } } };
    const challenge = await (await POST(req(call), params)).json() as { approval: { receiptHash: string } };
    expect(challenge.approval.receiptHash).toBeTruthy();
    const response = await POST(req({ ...call, approval: { approved: true, receiptHash: challenge.approval.receiptHash } }), params);
    expect(response.status).toBe(200);
    expect(mocks.executeGateway).toHaveBeenCalledWith(expect.objectContaining({ call: expect.objectContaining({ tool: 'create_finish' }) }));
  });

  it('exposes bounded vertical circulation tools through the approval/CAS route', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'create_elevator', scope: 'apply', result: { affectedObjectIds: ['elevator-1'] }, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-create-elevator', receiptHash: 'r'.repeat(64) } });
    const call = { tool: 'create_elevator', arguments: { revision: 3, documentId: 'architecture', objectId: 'elevator-1', parameterPaths: ['shaftId', 'servedStoreyIds'], patch: { shaftId: 'shaft-1', servedStoreyIds: ['storey-1', 'storey-2'] } } };
    const challenge = await (await POST(req(call), params)).json() as { approval: { receiptHash: string } };
    expect(challenge.approval.receiptHash).toBeTruthy();
    const response = await POST(req({ ...call, approval: { approved: true, receiptHash: challenge.approval.receiptHash } }), params);
    expect(response.status).toBe(200);
    expect(mocks.executeGateway).toHaveBeenCalledWith(expect.objectContaining({ call: expect.objectContaining({ tool: 'create_elevator' }) }));
  });
  it('exposes service opening create/edit through the approval/CAS route', async () => {
    mocks.executeGateway.mockReturnValue({ ok: true, profile: 'architecture-interior', domain: 'architecture-interior', tool: 'create_service_opening', scope: 'apply', result: { affectedObjectIds: ['svc-1'] }, workspace: { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) }, audit: { auditId: 'audit-create-service-opening', receiptHash: 'r'.repeat(64) } });
    const call = { tool: 'create_service_opening', arguments: { revision: 3, documentId: 'architecture', objectId: 'svc-1', parameterPaths: ['hostId', 'sourceRouteId', 'sourceSleeveId', 'shape', 'centerMm', 'axis', 'cutDiameterMm', 'depthMm', 'firestopAnnulusMm'], patch: { hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', shape: 'round', centerMm: [20, 0, 1500], axis: [1, 0, 0], cutDiameterMm: 100, depthMm: 200, firestopAnnulusMm: 25 } } };
    const challenge = await (await POST(req(call), params)).json() as { approval: { receiptHash: string } };
    expect(challenge.approval.receiptHash).toBeTruthy();
    const response = await POST(req({ ...call, approval: { approved: true, receiptHash: challenge.approval.receiptHash } }), params);
    expect(response.status).toBe(200);
    expect(mocks.executeGateway).toHaveBeenCalledWith(expect.objectContaining({ call: expect.objectContaining({ tool: 'create_service_opening' }) }));
  });
});
