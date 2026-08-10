import { describe, expect, it } from 'vitest';
import { decideReconstructionReview } from './reconstructionReviewPolicy';
import type { ReconstructedFeatureTree } from './stepReverseEngineer';

function tree(overrides: Partial<ReconstructedFeatureTree> = {}): ReconstructedFeatureTree {
  return {
    baseShape: { type: 'box', label: 'box', params: {}, confidence: 0.9 },
    features: [], bbox: {
      width: 1, height: 1, depth: 1, cx: 0, cy: 0, cz: 0,
      sphereRadius: 1, cylinderRadius: 0.5, cylinderHeight: 1,
      aspectXY: 1, aspectXZ: 1, aspectYZ: 1,
    },
    meshStats: { vertices: 8, triangles: 12 }, overallConfidence: 0.9, limitations: [],
    ...overrides,
  };
}

describe('decideReconstructionReview', () => {
  it('allows only a sufficiently confident analytic candidate', () => {
    expect(decideReconstructionReview(tree())).toEqual({ status: 'candidate', grade: 'A', canApplyBase: true, reasons: [] });
  });
  it('blocks application when detection did not run', () => {
    const result = decideReconstructionReview(tree({ limitations: ['Topology map unavailable.'] }));
    expect(result.status).toBe('review_required');
    expect(result.grade).toBe('C');
    expect(result.canApplyBase).toBe(false);
  });
  it('keeps an imported mesh reference-only', () => {
    const result = decideReconstructionReview(tree({ baseShape: { type: 'imported_mesh', label: 'mesh', params: {}, confidence: 0.9 } }));
    expect(result.status).toBe('reference_only');
    expect(result.grade).toBe('C');
    expect(result.canApplyBase).toBe(false);
  });
  it('classifies a verified but lower-confidence analytic candidate as B', () => {
    const result = decideReconstructionReview(tree({
      overallConfidence: 0.82,
      baseShape: { type: 'box', label: 'box', params: {}, confidence: 0.84 },
    }));
    expect(result).toMatchObject({ status: 'candidate', grade: 'B', canApplyBase: true });
  });
});
