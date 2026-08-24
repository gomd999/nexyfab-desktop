import { describe, expect, it } from 'vitest';
import {
  DIRECT_MANIPULATION_INTENT_SCHEMA,
  planDirectManipulation,
  type DirectManipulationIntent,
} from './directManipulation';
import {
  guardPrecisionCadDirectEditReceipt,
  PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA,
  type PrecisionCadDirectEditReceipt,
} from './precisionCadDirectEditReceipt';

const hash = (char: string) => char.repeat(64);

function proposal() {
  const intent: DirectManipulationIntent = {
    schema: DIRECT_MANIPULATION_INTENT_SCHEMA,
    version: 1,
    intentId: 'intent-1',
    gestureId: 'gesture-1',
    sessionId: 'session-1',
    sequence: 4,
    idempotencyKey: 'commit-1',
    phase: 'commit',
    createdAt: '2026-08-24T00:00:00.000Z',
    projectId: 'project-1',
    baseRevision: 'rev-1',
    coordinateFrame: 'world',
    viewportRevision: 'viewport-1',
    device: { platform: 'desktop', pointer: 'numeric', pointerCount: 0 },
    origin: 'user_gauge',
    userCommand: 'set depth to 12mm',
    selection: {
      version: 1,
      projectRevision: 'rev-1',
      assemblyPath: ['main'],
      partInstanceId: 'part-1',
      featureId: 'extrude-1',
      topology: [],
      sketchEntityIds: [],
      mateIds: [],
      coordinateFrame: 'world',
      units: 'mm',
    },
    binding: { kind: 'feature_parameter', partId: 'part-1', featureId: 'extrude-1', parameter: 'depth', unit: 'mm' },
    measurement: { semantics: 'absolute', startValue: 10, targetValue: 12, delta: 2, unit: 'mm' },
    rollback: { snapshotId: 'snapshot:rev-1', snapshotDigestSha256: hash('9'), baseRevision: 'rev-1' },
  };
  const result = planDirectManipulation(intent, 'rev-1');
  if (!result.ok) throw new Error(result.issues.join(','));
  return result.proposal;
}

function receipt(overrides: Partial<PrecisionCadDirectEditReceipt> = {}): PrecisionCadDirectEditReceipt {
  return {
    schema: PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA,
    receiptId: 'receipt-1',
    proposalId: 'proposal:intent-1',
    intentId: 'intent-1',
    projectId: 'project-1',
    idempotencyKey: 'commit-1',
    baseRevision: 'rev-1',
    proposalDigestSha256: hash('a'),
    status: 'APPLIED',
    resultRevision: 'rev-2',
    resultDigestSha256: hash('b'),
    rollback: { snapshotId: 'snapshot-1', snapshotDigestSha256: hash('c') },
    verification: {
      geometry: { status: 'NOT_RUN' },
      topology: { status: 'NOT_RUN' },
      manufacturing: { status: 'NOT_RUN' },
    },
    issues: [],
    issuedAt: '2026-08-24T00:00:01.000Z',
    ...overrides,
  };
}

describe('Precision CAD direct-edit receipt guard', () => {
  it('accepts an applied receipt while keeping verification NOT_RUN', () => {
    expect(guardPrecisionCadDirectEditReceipt({
      proposal: proposal(),
      receipt: receipt(),
      proposalDigestSha256: hash('a'),
    })).toEqual({ accepted: true, issues: [] });
  });

  it('rejects a receipt rebound to different proposal bytes or revision', () => {
    const result = guardPrecisionCadDirectEditReceipt({
      proposal: proposal(),
      receipt: receipt({ baseRevision: 'rev-other' }),
      proposalDigestSha256: hash('d'),
    });
    expect(result.issues).toEqual(expect.arrayContaining(['proposal_digest_mismatch', 'proposal_binding_mismatch']));
  });

  it('requires bound evidence before claiming precision verification', () => {
    const result = guardPrecisionCadDirectEditReceipt({
      proposal: proposal(),
      receipt: receipt({ status: 'VERIFIED' }),
      proposalDigestSha256: hash('a'),
    });
    expect(result.issues).toContain('precision_verification_incomplete');

    const verified = receipt({
      status: 'VERIFIED',
      verification: {
        geometry: { status: 'PASS', sourceId: 'geometry-receipt', sourceHash: hash('d') },
        topology: { status: 'PASS', sourceId: 'topology-receipt', sourceHash: hash('e') },
        manufacturing: { status: 'NOT_RUN' },
      },
    });
    expect(guardPrecisionCadDirectEditReceipt({ proposal: proposal(), receipt: verified, proposalDigestSha256: hash('a') }).accepted).toBe(true);
  });

  it('fails closed when evidence reports a failure', () => {
    const failed = receipt({
      verification: {
        geometry: { status: 'FAIL', sourceId: 'geometry-receipt', sourceHash: hash('f') },
        topology: { status: 'NOT_RUN' },
        manufacturing: { status: 'NOT_RUN' },
      },
    });
    expect(guardPrecisionCadDirectEditReceipt({ proposal: proposal(), receipt: failed, proposalDigestSha256: hash('a') }).issues)
      .toContain('failed_verification_must_fail_closed');
  });

  it('requires rollback linkage and source receipt identity', () => {
    const rolledBack = receipt({
      status: 'ROLLED_BACK',
      resultRevision: 'rev-3',
      rollback: { snapshotId: 'snapshot-1', snapshotDigestSha256: hash('c') },
    });
    expect(guardPrecisionCadDirectEditReceipt({ proposal: proposal(), receipt: rolledBack, proposalDigestSha256: hash('a') }).issues)
      .toContain('rollback_source_receipt_required');
  });
});
