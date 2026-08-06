import { describe, expect, it } from 'vitest';
import { applyAssertionReviews, migrateAssertionGraphCase, validateAssertionGraph, type ComplexAssertionReviewRecord } from './complexAssertionReview';

const hash = (value: string) => value.repeat(64).slice(0, 64);
const migrated = () => migrateAssertionGraphCase({ caseId: 'gearbox-1', family: 'gearbox', tier: 'T2', holdoutGroup: 'g1', sourceHash: hash('a'), assertions: [{ id: 'parts', axis: 'part_definitions', tolerancePolicy: 'exact', artifactHashes: [hash('b')] }, { id: 'joints', axis: 'joints', tolerancePolicy: 'axis-0.01deg', artifactHashes: [hash('c')], dependsOn: ['parts'] }] });
const review = (): ComplexAssertionReviewRecord => ({ schema: 'nexyfab.complex-assertion-review.v1', caseId: 'gearbox-1', assertionId: 'parts', reviewerId: 'engineer-1', decision: 'approved', reviewedArtifactHashes: [hash('b')], tolerancePolicy: 'exact', note: 'Compared against native assembly.', reviewedAt: '2026-08-06T00:00:00.000Z' });

describe('complex assertion review', () => {
  it('migrates T1-T3 assertions as non-KPI until review', () => expect(migrated().caseValue.assertions.every(item => !item.kpiEligible && item.provenance === 'legacy-unreviewed')).toBe(true));
  it('promotes only an exact artifact-bound approval', () => { const value = migrated(); const result = applyAssertionReviews(value.caseValue, [review()]); expect(result.approvedAssertionIds).toEqual(['parts']); expect(result.caseValue.assertions[0]).toMatchObject({ kpiEligible: true, provenance: 'approved-manual' }); expect(result.caseValue.assertions[1]!.kpiEligible).toBe(false); });
  it('rejects stale artifacts and tolerance changes', () => { const value = migrated(); const stale = review(); stale.reviewedArtifactHashes = [hash('d')]; stale.tolerancePolicy = 'loose'; const result = applyAssertionReviews(value.caseValue, [stale]); expect(result.caseValue.assertions[0]!.kpiEligible).toBe(false); expect(result.issues).toEqual(expect.arrayContaining(['assertion_review_artifacts_mismatch:parts'])); });
  it('rejects assertion dependency cycles', () => { const value = migrated(); value.graph[0]!.dependsOn = ['joints']; expect(validateAssertionGraph(value.caseValue, value.graph)).toEqual(expect.arrayContaining(['assertion_graph_cycle:parts'])); });
});
