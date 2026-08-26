import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  evaluateAiDesignCandidateWithCritics,
  verifyAiDesignCriticReceipt,
  type AiDesignCriticSubjectV1,
} from './aiDesignMultiCriticEvaluation';

const hash = (character: string) => character.repeat(64);
const secret = 'multi-critic-signing-secret-at-least-32-bytes';
const now = new Date('2026-08-24T09:00:00.000Z');

function subject(): AiDesignCriticSubjectV1 {
  return {
    projectId: 'project-1', sessionId: 'session-1', runId: 'run-1', candidateId: 'candidate-1',
    candidateManifestDigest: hash('a'), checkpointDigest: hash('b'),
    intentNodeIds: ['intent-purpose'], parameterIds: ['thickness'], featureIds: ['body', 'rib'],
    candidateSet: [
      { id: 'candidate-1', title: 'Compact cell', summary: 'Compact service cell', parameterKeys: ['thickness'], featureKeys: ['body', 'rib'] },
      { id: 'candidate-2', title: 'Accessible cell', summary: 'Wide service access', parameterKeys: ['clearance'], featureKeys: ['frame', 'door'] },
    ],
    structure: { digest: hash('c'), productRootCount: 1, componentCount: 8, interfaceCount: 7, orphanCount: 0, cycleCount: 0, unresolvedInterfaceCount: 0 },
    crossDomain: { digest: hash('d'), domainCount: 3, constraintCount: 5, conflictCount: 0, unresolvedCount: 0 },
    changeImpact: { digest: hash('e'), affectedArtifactCount: 2, requiredReverificationCount: 4, unsafePassCount: 0 },
    claimedExactVerificationStatus: 'NOT_RUN', claimedManufacturingReleaseReady: false,
  };
}

describe('AI Design multi-critic evaluation', () => {
  it('runs all conceptual critics, signs each result, and never escalates engineering authority', async () => {
    const input = subject();
    const bundle = await evaluateAiDesignCandidateWithCritics(input, { signingSecret: secret, now: () => now });
    expect(bundle).toMatchObject({ status: 'PASS', conceptReviewReady: true, engineeringVerified: false, manufacturingReleaseReady: false });
    expect(bundle.receipts).toHaveLength(7);
    expect(bundle.receipts.every(item => item.status === 'PASS' && item.evidenceScope === 'concept' && item.exactGeometryAuthority === false)).toBe(true);
    for (const receipt of bundle.receipts) expect(verifyAiDesignCriticReceipt(receipt, secret, input, new Date('2026-08-24T09:05:00.000Z'))).toEqual([]);
  });

  it('returns INCOMPLETE for unavailable sidecars but keeps core concept review usable', async () => {
    const input = { ...subject(), structure: null, crossDomain: null, changeImpact: null };
    const bundle = await evaluateAiDesignCandidateWithCritics(input, { signingSecret: secret, now: () => now });
    expect(bundle).toMatchObject({ status: 'INCOMPLETE', conceptReviewReady: true });
    expect(bundle.pendingCritics).toEqual(['assembly_integrity', 'interface_completeness', 'cross_domain_consistency', 'change_safety']);
  });

  it('fails closed on structure defects, near-duplicate concepts, timeouts, and tampering', async () => {
    const input = subject();
    const duplicateSet = input.candidateSet.map(item => ({ ...item, title: 'Same', summary: 'Same', parameterKeys: ['x'], featureKeys: ['x'] }));
    const bundle = await evaluateAiDesignCandidateWithCritics(
      { ...input, candidateSet: duplicateSet, structure: { ...input.structure!, cycleCount: 1 } },
      { signingSecret: secret, now: () => now, timeoutMs: 5, critics: { change_safety: async () => new Promise(() => undefined) } },
    );
    expect(bundle.status).toBe('FAIL');
    expect(bundle.failedCritics).toEqual(expect.arrayContaining(['assembly_integrity', 'candidate_diversity', 'change_safety']));
    const tampered = { ...bundle.receipts[0]!, status: 'FAIL' as const };
    expect(verifyAiDesignCriticReceipt(tampered, secret, input, new Date('2026-08-24T09:05:00.000Z'))).toContain('AI_DESIGN_CRITIC_RECEIPT_SIGNATURE_INVALID');
  });

  it('rejects browser-style authority escalation before running critics', async () => {
    await expect(evaluateAiDesignCandidateWithCritics({ ...subject(), claimedExactVerificationStatus: 'PASS' } as unknown as AiDesignCriticSubjectV1, { signingSecret: secret })).rejects.toThrow('AI_DESIGN_CRITIC_AUTHORITY_ESCALATION_FORBIDDEN');
  });
});
