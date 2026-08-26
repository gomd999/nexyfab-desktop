import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SPATIAL_EVALUATION_RECEIPT_SCHEMA,
  evaluateSpatialEvaluationReceipt,
  hashSpatialEvaluationReceipt,
  type SpatialEvaluationReceipt,
  validateSpatialEvaluationReceipt,
} from './spatialEvaluationReceipt';

const h = (s: string) => createHash('sha256').update(s).digest('hex');
const RECEIPT_EVALUATION_TIME = new Date('2026-08-24T01:00:00Z');
const base = (): SpatialEvaluationReceipt => ({
  schema: SPATIAL_EVALUATION_RECEIPT_SCHEMA, domain: 'interior', projectId: 'office-1',
  modelRevision: { id: 'rev-1', sha256: h('revision') }, inputSha256s: [h('survey'), h('program')], modelSha256: h('model'), resultSha256: h('result'),
  axis: 'egress', checkId: 'egress-clearance-v1', status: 'PASS', validator: { id: 'interior-validator', version: '1.0.0' },
  tolerance: { value: 0.001, unit: 'm', coordinateFrameSha256: h('frame') }, workerIdentity: 'worker-1', reviewerIdentity: 'reviewer-1',
  safetyGate: { status: 'PASS', artifactSha256: h('safety') }, authorityGate: { status: 'PASS', artifactSha256: h('authority') },
  issuedAt: '2026-08-24T00:00:00Z', expiresAt: '2026-08-25T00:00:00Z', blockers: [],
});

describe('spatial evaluation receipt', () => {
  it('validates and hashes canonically', () => {
    const r = base();
    expect(validateSpatialEvaluationReceipt(r)).toEqual([]);
    expect(hashSpatialEvaluationReceipt(r)).toMatch(/^[a-f0-9]{64}$/);
    const reordered = { ...r, tolerance: { ...r.tolerance } };
    expect(hashSpatialEvaluationReceipt(reordered)).toBe(hashSpatialEvaluationReceipt(r));
  });

  it('marks expected input, model, revision, and expiry mismatches stale', () => {
    const r = base();
    const result = evaluateSpatialEvaluationReceipt(r, { projectId: 'office-1', modelRevision: { id: 'rev-2', sha256: h('other') }, inputSha256s: [h('new')], modelSha256: h('new-model'), coordinateFrameSha256: h('new-frame') }, new Date('2026-08-24T01:00:00Z'));
    expect(result.status).toBe('STALE');
    expect(result.blockers).toEqual(expect.arrayContaining(['model_revision_stale', 'input_hashes_stale', 'model_hash_stale', 'coordinate_frame_stale']));
  });

  it('does not allow missing safety or authority gates to pass', () => {
    const r = { ...base(), safetyGate: null, authorityGate: null };
    const result = evaluateSpatialEvaluationReceipt(r, {}, RECEIPT_EVALUATION_TIME);
    expect(result.status).toBe('HOLD');
    expect(result.blockers).toEqual(expect.arrayContaining(['safety_gate_not_pass', 'authority_gate_not_pass']));
  });

  it('preserves non-pass statuses and rejects unknown keys', () => {
    const r = { ...base(), status: 'NOT_RUN' as const };
    expect(evaluateSpatialEvaluationReceipt(r, {}, RECEIPT_EVALUATION_TIME)).toMatchObject({ status: 'NOT_RUN', blockers: ['status_not_run_reason_required'] });
    expect(validateSpatialEvaluationReceipt({ ...r, extra: true })).toEqual(['receipt_keys_invalid']);
  });
});
