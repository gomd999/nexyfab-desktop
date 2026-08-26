import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1', plan: 'free' } as { userId: string; plan: string } | null,
  access: { canEdit: true } as { canEdit: boolean } | null,
  enqueue: vi.fn(), load: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignPrecisionHandoffCoordinator', () => ({ enqueueAiDesignPrecisionHandoff: mocks.enqueue }));
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
  mocks.load.mockReset().mockResolvedValue({ model: { runtimeRevision: 5, complexRevision: 3 }, ux: {}, unified: {} });
  mocks.enqueue.mockReset().mockResolvedValue({
    ok: true, replayed: false, precisionRequestId: 'precision-request:1', runtimeRevision: 5, complexRevision: 3,
    record: { status: 'PENDING', job: { jobId: 'bridge-job-1' } },
  });
});
describe('AI Design Precision handoff route', () => {
  it('queues a bounded request without claiming exact execution or PASS', async () => {
    const response = await POST(req({ handoff, explicitConfirmation: true }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      precisionRequestAccepted: true, precisionBridgeJobId: 'bridge-job-1', precisionBridgeStatus: 'PENDING',
      precisionRequestId: 'precision-request:1', exactExecution: false, verificationPass: false,
      manufacturingReleaseReady: false,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      ownerKey: 'user-1:project-1', authenticatedPlan: 'free', handoff,
    }), { db: {} });
  });

  it('returns a conflict without loading a post-mutation view', async () => {
    mocks.enqueue.mockResolvedValue({ ok: false, code: 'AI_DESIGN_PRECISION_HANDOFF_MISMATCH' });
    expect((await POST(req({ handoff, explicitConfirmation: true }))).status).toBe(409);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns an unprocessable hold when the product structure is not candidate-bound', async () => {
    mocks.enqueue.mockResolvedValue({ ok: false, code: 'AI_PRECISION_STRUCTURE_REBIND_REQUIRED' });
    expect((await POST(req({ handoff, explicitConfirmation: true }))).status).toBe(422);
  });
});
