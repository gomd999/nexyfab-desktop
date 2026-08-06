import { describe, expect, it } from 'vitest';
import { hashCadGroundTruthCanonical, isGroundTruthKpiEligible, serializeCadGroundTruthCanonical, validateCadGroundTruthV1, type CadGroundTruthV1 } from './cadGroundTruthV1';

const hash = 'b'.repeat(64);
const valid = (): CadGroundTruthV1 => ({
  groundTruthVersion: 1, fixtureId: 'A07', sourceHash: hash,
  geometry: { solidCount: { value: 1, provenance: 'kernel-measured', tolerancePolicy: 'relative-v1', evidenceRefs: ['shape:source'], kpiEligible: true } },
  features: [{ id: 'feature.pattern.1', kind: 'circular-pattern', parameters: { count: 4 }, importance: 'functional', provenance: 'reviewed-inferred', evidenceRefs: ['face-signature:1'], kpiEligible: true, inferenceApproved: true }],
  unknown: ['original-feature-order'], review: { status: 'approved', reviewRevision: 1, reviewer: 'reviewer-1' },
});

describe('CadGroundTruthV1', () => {
  it('validates a reviewed fixture and makes approved inferred labels KPI eligible', () => {
    const fixture = valid();
    expect(validateCadGroundTruthV1(fixture)).toEqual({ ok: true, value: fixture, issues: [] });
    expect(isGroundTruthKpiEligible(fixture.features[0]!, fixture.review.status)).toBe(true);
  });
  it('forbids reviewed-inferred KPI labels without local and fixture approval', () => {
    const local = valid(); delete local.features[0]!.inferenceApproved;
    expect(validateCadGroundTruthV1(local).ok).toBe(false);
    const review = valid(); review.review.status = 'in_review';
    expect(validateCadGroundTruthV1(review).ok).toBe(false);
    expect(isGroundTruthKpiEligible(review.features[0]!, review.review.status)).toBe(false);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite values: %s', bad => {
    const geometry = valid(); geometry.geometry.solidCount!.value = bad;
    expect(validateCadGroundTruthV1(geometry).ok).toBe(false);
    const feature = valid(); feature.features[0]!.parameters = { nested: { bad } };
    expect(validateCadGroundTruthV1(feature).ok).toBe(false);
  });
  it('rejects malformed hashes, duplicate feature ids, evidence refs, and unknown labels', () => {
    const fixture = valid(); fixture.sourceHash = 'bad'; fixture.features.push({ ...fixture.features[0]! });
    fixture.geometry.solidCount!.evidenceRefs = ['same', 'same']; fixture.unknown.push('original-feature-order');
    const result = validateCadGroundTruthV1(fixture);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(item => item.path)).toEqual(expect.arrayContaining(['sourceHash', 'features[1].id', 'geometry.solidCount.evidenceRefs[1]', 'unknown[1]']));
  });
  it('uses sorted object keys for stable canonical serialization and hashing', () => {
    const fixture = valid();
    const reordered = { review: fixture.review, unknown: fixture.unknown, features: fixture.features, geometry: fixture.geometry, sourceHash: fixture.sourceHash, fixtureId: fixture.fixtureId, groundTruthVersion: 1 } as CadGroundTruthV1;
    expect(serializeCadGroundTruthCanonical(fixture)).toBe(serializeCadGroundTruthCanonical(reordered));
    expect(hashCadGroundTruthCanonical(fixture)).toBe(hashCadGroundTruthCanonical(reordered));
    expect(hashCadGroundTruthCanonical(fixture)).toMatch(/^[a-f0-9]{64}$/);
  });
});
