import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1', plan: 'free' } as { userId: string; plan: string } | null,
  access: { canEdit: true } as { canEdit: boolean } | null,
  allowed: true,
  load: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignUnifiedWorkspaceServer', () => ({ loadAiDesignUnifiedWorkspaceServerV10: mocks.load }));
vi.mock('@/lib/ai/aiDesignConceptProposalStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/aiDesignConceptProposalStore')>();
  return { ...actual, createAiDesignConceptProposalV1: mocks.create };
});
import { POST } from './route';

const requestBody = {
  request: {
    schema: 'nexyfab.ai-design-concept-preview-request.v1', kind: 'concept-preview-request',
    requestId: 'request-1', projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 4,
    gaugeId: 'gauge-1', adjustment: { mode: 'fine', direction: 1 },
    previewOnly: true, persistent: false, exactExecution: false, verificationPass: false,
  },
};

function req(body: unknown) {
  return new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/preview?locale=ko', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  mocks.auth = { userId: 'user-1', plan: 'free' }; mocks.access = { canEdit: true }; mocks.allowed = true;
  mocks.load.mockReset().mockResolvedValue({ model: { projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4, complexRevision: 2, staleAgainstRuntime: false, workspace: { assemblyGauges: [{ gaugeId: 'gauge-1' }], base: { gauges: [] } } }, unified: {} });
  mocks.create.mockReset().mockReturnValue({ evidence: { proposalId: 'proposal-1', proposalDigest: 'a'.repeat(64), baseRuntimeRevision: 4, baseRevisionToken: 'runtime-4:complex-2', affectedRefs: [{ kind: 'parameter', id: 'gauge-1' }], summaryCodes: ['concept_preview_only'], previewOnly: true, verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' } } });
});

describe('AI Design concept preview route', () => {
  it('returns non-cached evidence and a server-authored decision card', async () => {
    const response = await POST(req(requestBody));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ evidence: { previewOnly: true, verification: { geometry: 'NOT_RUN' } }, decisionCard: { references: { proposalId: 'proposal-1' } } });
  });

  it('rejects stale revisions and unknown gauges without creating a proposal', async () => {
    mocks.load.mockResolvedValueOnce({ model: { runtimeRevision: 5, complexRevision: 2, staleAgainstRuntime: false, workspace: { assemblyGauges: [], base: { gauges: [] } } }, unified: {} });
    expect((await POST(req(requestBody))).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('requires editor access', async () => {
    mocks.access = { canEdit: false };
    expect((await POST(req(requestBody))).status).toBe(403);
  });
});
