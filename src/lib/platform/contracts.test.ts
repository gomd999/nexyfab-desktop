import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CONTRACT_VERSION,
  CAD_CONTRACT_VERSION,
  JOB_CONTRACT_VERSION,
  validateCadArtifact,
  validateCadJobReceipt,
  validateCadJobTransportReceipt,
  validateToolDefinition,
} from './contracts';

const hash = (character: string) => character.repeat(64);

describe('modular platform contract compatibility boundary', () => {
  it('accepts an explicit working tool and rejects a decorative blocked tool', () => {
    expect(validateToolDefinition({
      id: 'mechanical.extrude',
      domain: 'mechanical',
      contractVersion: CAD_CONTRACT_VERSION,
      requiredSelection: { minimum: 1, kinds: ['closed_profile'] },
      parameterSchema: { type: 'object' },
      previewCapability: 'EXACT',
      executeCapability: 'EXACT',
      undoPolicy: 'SINGLE_REVISION',
      requiredPermission: 'cad:edit',
      requiredEvidence: ['brep_receipt'],
      state: 'WORKING',
    })).toEqual([]);

    expect(validateToolDefinition({
      id: 'civil.pipe-network',
      domain: 'civil',
      contractVersion: CAD_CONTRACT_VERSION,
      requiredSelection: { minimum: 0, kinds: [] },
      parameterSchema: {},
      previewCapability: 'NOT_IMPLEMENTED',
      executeCapability: 'NOT_IMPLEMENTED',
      undoPolicy: 'NOT_AVAILABLE',
      requiredPermission: 'cad:edit',
      requiredEvidence: [],
      state: 'NOT_IMPLEMENTED',
    })).toContain('unavailable_reason_required');
  });

  it('keeps artifact and receipt PASS fail-closed', () => {
    expect(validateCadArtifact({
      contractVersion: ARTIFACT_CONTRACT_VERSION,
      artifactId: 'artifact-1',
      projectId: 'project-1',
      tenantId: 'tenant-1',
      objectKey: 'tenant-1/project-1/artifact-1.step',
      mediaType: 'model/step',
      format: 'STEP',
      byteLength: 1024,
      contentSha256: hash('a'),
      shapeIdentitySha256: hash('b'),
      producerBuildId: 'build-1',
      kernelIdentity: 'occt-7.9',
      createdAt: '2026-08-13T00:00:00.000Z',
      immutabilityState: 'IMMUTABLE',
    })).toEqual([]);

    expect(validateCadJobReceipt({
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: 'job-1',
      workerIdentitySha256: hash('c'),
      kernelIdentitySha256: hash('d'),
      inputArtifacts: [],
      outputArtifacts: [],
      execution: 'PASS',
      startedAt: '2026-08-13T00:00:00.000Z',
      completedAt: '2026-08-13T00:00:01.000Z',
      receiptSha256: hash('e'),
      failureReasons: [],
    })).toContain('pass_requires_output_artifact');
  });

  it('prevents transport evidence from being promoted to execution evidence', () => {
    expect(validateCadJobTransportReceipt({
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: 'job-1',
      transportState: 'QUEUE_PERSISTED',
      execution: 'PASS' as never,
      releaseVerification: 'NOT_RUN',
      observedAt: '2026-08-13T00:00:00.000Z',
      issues: [],
    })).toContain('transport_cannot_claim_execution');
  });
});
