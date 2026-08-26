import { describe, expect, it } from 'vitest';
import {
  AI_DESIGN_RELEASE_DOMAINS,
  AI_DESIGN_RELEASE_EVIDENCE_TARGETS,
  createAiDesignReleaseEvidence,
  InMemoryAiDesignReleaseEvidenceLedger,
  type AiDesignReleaseDomain,
  type AiDesignReleaseEvidenceKind,
} from './aiDesignReleaseEvidenceLedger';

const hash = (character: string) => character.repeat(64);

function evidence(domain: AiDesignReleaseDomain, kind: AiDesignReleaseEvidenceKind, index: number, overrides: Partial<Parameters<typeof createAiDesignReleaseEvidence>[0]> = {}) {
  return createAiDesignReleaseEvidence({
    evidenceId: `${domain}:${kind}:${index}`,
    domain,
    kind,
    result: 'PASS',
    externallyVerified: true,
    independentOfImplementationTeam: true,
    rights: kind === 'deterministic_campaign' ? 'synthetic' : 'permissioned',
    rightsReceiptDigest: hash('a'), artifactDigest: hash('b'), attestationDigest: hash('c'),
    independentlyWrittenSummary: `${domain} ${kind} evidence ${index}`,
    createdAt: '2026-08-24T08:00:00.000Z',
    ...overrides,
  }, { trustedServer: true });
}

describe('AI Design release evidence ledger', () => {
  it('holds rollout until every domain meets every independent evidence target', async () => {
    const ledger = new InMemoryAiDesignReleaseEvidenceLedger();
    await ledger.appendImmutable(evidence('mechanical', 'independent_case', 0));
    expect(ledger.readiness()).toMatchObject({ governedRolloutStatus: 'HOLD', domains: { mechanical: { counts: { independent_case: 1 }, status: 'HOLD' } } });

    for (const domain of AI_DESIGN_RELEASE_DOMAINS) {
      for (const [kind, target] of Object.entries(AI_DESIGN_RELEASE_EVIDENCE_TARGETS) as Array<[AiDesignReleaseEvidenceKind, number]>) {
        for (let index = 0; index < target; index += 1) await ledger.appendImmutable(evidence(domain, kind, index));
      }
    }
    const readiness = ledger.readiness();
    expect(readiness.governedRolloutStatus).toBe('ELIGIBLE_FOR_HUMAN_RELEASE_REVIEW');
    expect(Object.values(readiness.domains).every(domain => domain.status === 'TARGET_MET')).toBe(true);
    expect(readiness.authority).toEqual({ evidenceGateOnly: true, exactCadVerifiedByAi: false, manufacturingReleaseReady: false, humanReleaseDecisionRequired: true });
    expect(ledger.list()).toHaveLength(5 * (20 + 3 + 2 + 3));
  });

  it('does not count failed or unverified entries and keeps evidence IDs immutable', async () => {
    const ledger = new InMemoryAiDesignReleaseEvidenceLedger();
    const unverified = evidence('civil', 'physical_pilot', 1, { externallyVerified: false });
    const failed = evidence('civil', 'physical_pilot', 2, { result: 'FAIL' });
    await ledger.appendImmutable(unverified);
    await ledger.appendImmutable(failed);
    expect(ledger.readiness().domains.civil.counts.physical_pilot).toBe(0);
    await expect(ledger.appendImmutable(evidence('civil', 'physical_pilot', 1, { independentlyWrittenSummary: 'Conflicting replacement' }))).rejects.toThrow('AI_DESIGN_RELEASE_EVIDENCE_IMMUTABILITY_CONFLICT');
  });

  it('rejects synthetic external evidence and commercial in-memory persistence', () => {
    expect(() => evidence('interior', 'expert_review', 0, { rights: 'synthetic' })).toThrow('release_evidence_external_kind_must_not_be_synthetic');
    expect(() => new InMemoryAiDesignReleaseEvidenceLedger({ commercialDeployment: true })).toThrow('AI_DESIGN_RELEASE_EVIDENCE_POSTGRES_REQUIRED');
  });
});
