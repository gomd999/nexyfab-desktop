import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1', plan: 'free' } as { userId: string; plan: string } | null,
  access: { canEdit: true } as { canEdit: boolean } | null,
  proposal: vi.fn(), execute: vi.fn(), load: vi.fn(), consume: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignConceptProposalStore', () => ({ getAiDesignConceptProposalV1: mocks.proposal, consumeAiDesignConceptProposalV1: mocks.consume }));
vi.mock('@/lib/ai/aiDesignWorkspaceActionService', () => ({ executeAiDesignWorkspaceClientCommand: mocks.execute }));
vi.mock('@/lib/ai/aiDesignServerRuntimeArtifacts', () => ({ aiDesignServerRuntimeArtifacts: {} }));
vi.mock('@/lib/ai/aiDesignUnifiedWorkspaceServer', () => ({ loadAiDesignUnifiedWorkspaceServerV10: mocks.load }));

import { POST } from './route';

const apply = {
  schema: 'nexyfab.ai-design-concept-apply-request.v1', kind: 'concept-apply-request', requestId: 'apply-1',
  projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 4, proposalId: 'proposal-1',
  explicitConfirmationRequired: true, mutation: 'concept-session-only', exactExecution: false,
  verificationPass: false, manufacturingReleaseReady: false,
};
function req(body: unknown) { return new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/concept-apply', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }

beforeEach(() => {
  mocks.auth = { userId: 'user-1', plan: 'free' }; mocks.access = { canEdit: true };
  mocks.proposal.mockReset().mockReturnValue({ proposalId: 'proposal-1', ownerKey: 'user-1:project-1', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, complexRevision: 2, gaugeId: 'gauge-1', adjustment: { mode: 'fine', direction: 1 } });
  mocks.execute.mockReset().mockResolvedValue({ ok: true, state: { runtimeRevision: 5 }, replayed: false, receipts: [], generationRequested: false });
  mocks.load.mockReset()
    .mockResolvedValueOnce({ model: { runtimeRevision: 4, complexRevision: 2, staleAgainstRuntime: false }, ux: {}, unified: {} })
    .mockResolvedValueOnce({ model: { runtimeRevision: 5, complexRevision: 2, staleAgainstRuntime: false }, ux: {}, unified: {} });
  mocks.consume.mockReset();
});

describe('AI Design concept apply route', () => {
  it('requires a literal explicit confirmation', async () => {
    expect((await POST(req({ request: apply, explicitConfirmation: false }))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('applies only the server-stored proposal and returns a newer snapshot', async () => {
    const response = await POST(req({ request: apply, explicitConfirmation: true }));
    expect(response.status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith('user-1:project-1', 'free', expect.objectContaining({ type: 'ADJUST_GAUGE', payload: { gaugeId: 'gauge-1', mode: 'fine', direction: 1 } }), expect.anything());
    expect(mocks.consume).toHaveBeenCalledWith('proposal-1');
    await expect(response.json()).resolves.toMatchObject({ completedRequestId: 'apply-1', model: { runtimeRevision: 5 } });
  });

  it('rejects a missing or mismatched proposal', async () => {
    mocks.proposal.mockReturnValueOnce(null);
    expect((await POST(req({ request: apply, explicitConfirmation: true }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects a proposal when the complex projection changed', async () => {
    mocks.load.mockReset().mockResolvedValue({ model: { runtimeRevision: 4, complexRevision: 3, staleAgainstRuntime: false }, ux: {}, unified: {} });
    expect((await POST(req({ request: apply, explicitConfirmation: true }))).status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
