import { describe, expect, it } from 'vitest';
import { partitionDrawingReferences } from './referenceReview';

describe('partitionDrawingReferences', () => {
  it('keeps unresolved annotations in review and out of active output', () => {
    const result = partitionDrawingReferences({
      validRefs: new Set(['f.cap.top']),
      dimensions: [{ id: 'd1', viewportId: 'front', kind: 'linear', refs: ['f.cap.top', 'f.side.9'] }],
      gdt: [{ id: 'g1', viewportId: 'top', kind: 'flatness', targetRef: 'f.side.9', toleranceValue: 0.1 }],
    });
    expect(result.dimensions).toEqual([]);
    expect(result.gdt).toEqual([]);
    expect(result.review.map(item => item.consumer)).toEqual(['dimension', 'gdt']);
  });
});
