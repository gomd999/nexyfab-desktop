import { describe, expect, it } from 'vitest';
import {
  attachCommercialLineageRef,
  createManufacturingLineage,
  invalidateManufacturingLineage,
  validateManufacturingLineage,
} from './manufacturingLineage';

const released = () => createManufacturingLineage({
  lineageId: 'lineage-1',
  userId: 'user-1',
  projectId: 'project-1',
  documentVersionId: 'version-7',
  generationRunId: 'generation-2',
  verificationRunId: 'verification-4',
  artifact: {
    artifactId: 'sha256:step-a',
    sha256: 'a'.repeat(64),
    releaseStatus: 'authorized',
    authorizedAt: '2026-08-07T10:00:00.000Z',
    authorizedBy: 'reviewer-1',
  },
});

describe('manufacturing artifact lineage', () => {
  it('binds commercial records in order to one authorized artifact', () => {
    const rfq = attachCommercialLineageRef(released(), 'rfq', 'rfq-1');
    const quote = attachCommercialLineageRef(rfq, 'quote', 'quote-1');
    const order = attachCommercialLineageRef(quote, 'order', 'order-1');
    expect(validateManufacturingLineage(order)).toMatchObject({ valid: true, releaseReady: true });
    expect(order.commercial.order?.artifactId).toBe('sha256:step-a');
  });

  it('fails closed when a stage is skipped or the artifact is not authorized', () => {
    expect(() => attachCommercialLineageRef(released(), 'order', 'order-1')).toThrow(/PREREQUISITE/);
    const draft = released();
    draft.artifact.releaseStatus = 'verified';
    expect(() => attachCommercialLineageRef(draft, 'rfq', 'rfq-1')).toThrow(/NOT_RELEASE_READY/);
  });

  it('clears quotes and orders when geometry changes', () => {
    const quoted = attachCommercialLineageRef(attachCommercialLineageRef(released(), 'rfq', 'rfq-1'), 'quote', 'quote-1');
    const changed = invalidateManufacturingLineage(quoted, 'hole diameter changed', {
      artifactId: 'sha256:step-b',
      sha256: 'b'.repeat(64),
    });
    expect(changed.artifact.releaseStatus).toBe('revoked');
    expect(changed.commercial).toEqual({});
    expect(changed.invalidationReasons).toEqual(['hole diameter changed']);
    expect(validateManufacturingLineage(changed)).toMatchObject({ valid: true, releaseReady: false });
  });

  it('detects an artifact swap inside an existing commercial chain', () => {
    const rfq = attachCommercialLineageRef(released(), 'rfq', 'rfq-1');
    rfq.commercial.rfq!.artifactId = 'different-artifact';
    expect(validateManufacturingLineage(rfq).errors).toContain('ARTIFACT_MISMATCH:rfq');
  });
});
