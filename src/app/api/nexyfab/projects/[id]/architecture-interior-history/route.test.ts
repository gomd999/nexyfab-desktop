import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(), resolveProjectAccess: vi.fn(), getDbAdapter: vi.fn(),
  ensureWorkspace: vi.fn(), ensureHistory: vi.fn(), readWorkspace: vi.fn(),
  persistWorkspace: vi.fn(), readHistory: vi.fn(), appendHistory: vi.fn(),
  checkOrigin: vi.fn(), makeApproval: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.checkOrigin }));
vi.mock('@/lib/artifacts/directArtifactUploadStore', () => ({ resolveArtifactTenantId: vi.fn(() => 'personal:owner-1') }));
vi.mock('@/lib/precision-cad-agent/remoteApprovalToken', () => ({ makeRemoteApprovalToken: mocks.makeApproval }));
vi.mock('@/lib/ai/architectureInteriorWorkspaceStore', () => ({
  ensureArchitectureInteriorWorkspaceTables: mocks.ensureWorkspace,
  readArchitectureInteriorWorkspace: mocks.readWorkspace,
  persistArchitectureInteriorWorkspace: mocks.persistWorkspace,
}));
vi.mock('@/lib/ai/architectureInteriorHistoryStore', () => ({
  ensureArchitectureInteriorHistoryTables: mocks.ensureHistory,
  readArchitectureInteriorHistory: mocks.readHistory,
  appendArchitectureInteriorHistoryEvent: mocks.appendHistory,
  appendArchitectureInteriorHistoryEventInTransaction: mocks.appendHistory,
}));
// The route tests persistence/CAS and routing behavior; workspace invariants
// are covered by architectureInteriorWorkspace.test.ts.
vi.mock('@/lib/ai/architectureInteriorWorkspace', () => ({
  hashArchitectureInteriorEvidenceV2: vi.fn(() => 'e'.repeat(64)),
  hashArchitectureInteriorWorkspaceV2: vi.fn(() => 'h'.repeat(64)),
  validateArchitectureInteriorWorkspaceV2: vi.fn(() => []),
}));

import { GET, POST } from './route';
import type { ArchitectureInteriorWorkspaceV2 } from '@/lib/ai/architectureInteriorWorkspace';
import type { ArchitectureInteriorHistoryEvent } from '@/lib/ai/architectureInteriorHistoryStore';

const workspace = {
  schema: 'nexyfab.architecture-interior-workspace.v2', projectId: 'project-1',
  workspace: { projectId: 'project-1', revision: 3, contentHash: 'b'.repeat(64), track: 'ai_design', maturity: 'concept' },
  contentHash: 'b'.repeat(64),
  architecture: { document: { revision: 3 }, geometry: { payload: { kind: 'architecture' } }, semantic: { payload: { document: { revision: 3 } } } },
  interior: { document: { revision: 3 }, geometry: { payload: { kind: 'interior' } }, semantic: { payload: { document: { revision: 3 } } } },
  artifactGraph: { revision: 3, artifacts: [] },
} as unknown as ArchitectureInteriorWorkspaceV2;
const targetWorkspace = { ...workspace, workspace: { ...workspace.workspace, revision: 2, contentHash: 'a'.repeat(64) }, contentHash: 'a'.repeat(64) } as ArchitectureInteriorWorkspaceV2;
const savedWorkspace = { ...workspace, workspace: { ...workspace.workspace, revision: 4, contentHash: 'c'.repeat(64) }, contentHash: 'c'.repeat(64) } as ArchitectureInteriorWorkspaceV2;
const event: ArchitectureInteriorHistoryEvent = {
  id: 'history-1', sequence: 1, operation: 'apply', lineageId: 'lineage-1', actorUserId: 'user-1', commandId: 'apply-1',
  sourceRevision: 2, sourceContentHash: 'a'.repeat(64), targetRevision: 3, targetContentHash: 'b'.repeat(64), createdAt: 1,
};
const auth = { userId: 'user-1', email: 'u@example.test', orgIds: [], activeOrgId: null, orgContextStatus: 'personal', emailVerified: true };
type TestDb = { backend: 'sqlite'; transaction: <T>(fn: (tx: TestDb) => Promise<T>) => Promise<T> };
const db: TestDb = { backend: 'sqlite', transaction: async fn => fn(db) };
const params = { params: Promise.resolve({ id: 'project-1' }) };

function req(body?: unknown) {
  return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-history', {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: 'http://localhost' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('architecture/interior persisted history route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.getDbAdapter.mockReturnValue(db);
    mocks.resolveProjectAccess.mockResolvedValue({ row: { id: 'project-1', org_id: null, user_id: 'owner-1' }, role: 'editor', canEdit: true, ownerUserId: 'owner-1' });
    mocks.ensureWorkspace.mockResolvedValue(undefined);
    mocks.ensureHistory.mockResolvedValue(undefined);
    mocks.checkOrigin.mockReturnValue(true);
    mocks.makeApproval.mockReturnValue('approval-token-architecture-interior-1234567890');
    mocks.readWorkspace.mockImplementation((_db: unknown, _scope: unknown, _projectId: string, revision?: number) => Promise.resolve({ ok: true, workspace: revision === 2 ? targetWorkspace : workspace, revisionId: `rev-${revision ?? 3}`, createdAt: 1 }));
    mocks.persistWorkspace.mockResolvedValue({ ok: true, revisionId: 'rev-4', workspace: { ...savedWorkspace }, createdAt: 2 });
    mocks.readHistory.mockResolvedValue({ events: [event], undo: event, redo: undefined });
    mocks.appendHistory.mockResolvedValue({ ...event, id: 'history-2', sequence: 2, operation: 'undo' });
  });

  it('exposes server-backed undo availability and requires origin/editor authorization', async () => {
    expect((await GET(req(), params)).status).toBe(200);
    expect(await (await GET(req(), params)).json()).toMatchObject({ ok: true, revision: 3, canUndo: true, canRedo: false, undo: { sequence: 1 } });
    mocks.checkOrigin.mockReturnValueOnce(false);
    expect((await POST(req({ action: 'undo', expectedRevision: 3, expectedContentHash: 'b'.repeat(64) }), params)).status).toBe(403);
    mocks.resolveProjectAccess.mockResolvedValueOnce({ row: { id: 'project-1', org_id: null, user_id: 'owner-1' }, role: 'viewer', canEdit: false, ownerUserId: 'owner-1' });
    expect((await POST(req({ action: 'undo', expectedRevision: 3, expectedContentHash: 'b'.repeat(64) }), params)).status).toBe(403);
  });

  it('uses explicit approval then performs revision+content-hash CAS and appends a bounded undo ledger row', async () => {
    const call = { action: 'undo', expectedRevision: 3, expectedContentHash: 'b'.repeat(64) };
    const challenge = await POST(req(call), params);
    expect(challenge.status).toBe(409);
    expect(await challenge.json()).toMatchObject({ code: 'APPROVAL_REQUIRED', approval: { receiptHash: 'approval-token-architecture-interior-1234567890' } });
    const response = await POST(req({ ...call, approved: true, receiptHash: 'approval-token-architecture-interior-1234567890' }), params);
    expect(response.status).toBe(200);
    expect(mocks.readWorkspace).toHaveBeenCalledWith(db, { tenantId: 'personal:owner-1' }, 'project-1', 2);
    expect(mocks.persistWorkspace).toHaveBeenCalledWith(db, { tenantId: 'personal:owner-1', userId: 'user-1' }, 'project-1', 3, expect.anything(), expect.objectContaining({ baseContentHash: 'b'.repeat(64), transactionalAdapter: db }));
    expect(mocks.appendHistory).toHaveBeenCalledWith(db, { tenantId: 'personal:owner-1', projectId: 'project-1' }, expect.objectContaining({ operation: 'undo', sourceSequence: 1, sourceRevision: 3, targetRevision: 4 }));
  });

  it('fails closed on stale reconnect state before reading a target snapshot', async () => {
    const response = await POST(req({ action: 'undo', expectedRevision: 2, expectedContentHash: 'a'.repeat(64) }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 3, currentContentHash: 'b'.repeat(64) });
    expect(mocks.persistWorkspace).not.toHaveBeenCalled();
  });

  it('fails closed when an unrelated revision advanced the workspace beyond the ledger', async () => {
    mocks.readHistory.mockResolvedValue({ events: [{ ...event, targetContentHash: 'd'.repeat(64) }], undo: event, redo: undefined });
    expect(await (await GET(req(), params)).json()).toMatchObject({ canUndo: false, canRedo: false });
    const response = await POST(req({ action: 'undo', expectedRevision: 3, expectedContentHash: 'b'.repeat(64) }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'HISTORY_DIVERGED' });
  });

  it('rejects oversized reconnect commands before parsing or persistence', async () => {
    const response = await POST(new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-history', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-length': String(8 * 1024 + 1) }, body: '{}',
    }), params);
    expect(response.status).toBe(400);
    expect(mocks.readHistory).not.toHaveBeenCalled();
  });
});
