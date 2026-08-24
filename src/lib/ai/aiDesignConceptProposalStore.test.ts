import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  consumeAiDesignConceptProposalV1,
  createAiDesignConceptProposalV1,
  getAiDesignConceptProposalV1,
  isAiDesignConceptPreviewRequestV1,
  resetAiDesignConceptProposalStoreForTests,
} from './aiDesignConceptProposalStore';

const request = {
  schema: 'nexyfab.ai-design-concept-preview-request.v1' as const,
  kind: 'concept-preview-request' as const,
  requestId: 'request-1', projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision: 4,
  gaugeId: 'gauge-1', adjustment: { mode: 'fine' as const, direction: 1 as const },
  previewOnly: true as const, persistent: false as const, exactExecution: false as const, verificationPass: false as const,
};

beforeEach(resetAiDesignConceptProposalStoreForTests);

describe('AI Design concept proposal store', () => {
  it('stores only an owner/revision-bound, expiring proposal', () => {
    expect(isAiDesignConceptPreviewRequestV1(request)).toBe(true);
    const created = createAiDesignConceptProposalV1({ ownerKey: 'owner-1', request, complexRevision: 2, now: 100 });
    expect(created.evidence).toMatchObject({ baseRuntimeRevision: 4, baseRevisionToken: 'runtime-4:complex-2', previewOnly: true, verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' } });
    expect(created.evidence.proposalDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(getAiDesignConceptProposalV1('owner-2', created.proposal.proposalId, 101)).toBeNull();
    expect(getAiDesignConceptProposalV1('owner-1', created.proposal.proposalId, 101)).toMatchObject({ gaugeId: 'gauge-1' });
    expect(getAiDesignConceptProposalV1('owner-1', created.proposal.proposalId, created.proposal.expiresAt)).toBeNull();
  });

  it('consumes a proposal after a successful apply', () => {
    const created = createAiDesignConceptProposalV1({ ownerKey: 'owner-1', request, complexRevision: 2 });
    consumeAiDesignConceptProposalV1(created.proposal.proposalId);
    expect(getAiDesignConceptProposalV1('owner-1', created.proposal.proposalId)).toBeNull();
  });
});
