import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1', plan: 'free' } as { userId: string; plan: string } | null,
  access: { canEdit: true } as { canEdit: boolean } | null,
  execute: vi.fn(), load: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignWorkspaceActionService', () => ({ executeAiDesignWorkspaceClientCommand: mocks.execute }));
vi.mock('@/lib/ai/aiDesignServerRuntimeArtifacts', () => ({ aiDesignServerRuntimeArtifacts: {} }));
vi.mock('@/lib/ai/aiDesignUnifiedWorkspaceServer', () => ({ loadAiDesignUnifiedWorkspaceServerV10: mocks.load }));

import { POST } from './route';

const handoff = {
  schema: 'nexyfab.ai-design-precision-cad-handoff.v1', kind: 'precision-cad-handoff', requestId: 'precision-1',
  projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 4, expectedComplexRevision: 2,
  candidateId: 'candidate-1', explicitCommitRequired: true, exactExecution: false, verificationPass: false, manufacturingReleaseReady: false,
};
function req(body: unknown) { return new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/precision-handoff', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }

beforeEach(() => {
  mocks.auth = { userId: 'user-1', plan: 'free' }; mocks.access = { canEdit: true };
  mocks.load.mockReset()
    .mockResolvedValueOnce({ model: { runtimeRevision: 4, complexRevision: 2, staleAgainstRuntime: false, workspace: { base: { candidates: { selectedCandidateId: 'candidate-1' } } } }, unified: {} })
    .mockResolvedValueOnce({ model: { runtimeRevision: 5, complexRevision: 2 }, ux: {}, unified: {} });
  mocks.execute.mockReset().mockResolvedValue({ ok: true, state: { runtimeRevision: 5 }, replayed: false, receipts: [], generationRequested: false });
});
describe('AI Design Precision handoff route', () => {
  it('queues a bounded request without claiming exact execution or PASS', async () => {
    const response = await POST(req({ handoff, explicitConfirmation: true }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ precisionRequestAccepted: true, exactExecution: false, verificationPass: false, manufacturingReleaseReady: false });
    expect(mocks.execute).toHaveBeenCalledWith('user-1:project-1', 'free', expect.objectContaining({ type: 'REQUEST_PRECISION', expectedRuntimeRevision: 4 }), expect.anything());
  });

  it('rejects a candidate or revision mismatch before mutation', async () => {
    mocks.load.mockReset().mockResolvedValue({ model: { runtimeRevision: 4, complexRevision: 2, staleAgainstRuntime: false, workspace: { base: { candidates: { selectedCandidateId: 'candidate-2' } } } }, unified: {} });
    expect((await POST(req({ handoff, explicitConfirmation: true }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
