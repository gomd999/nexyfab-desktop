import type { Dimension, GdtCallout } from './dimension';

export type DrawingReferenceReviewItem = {
  consumer: 'dimension' | 'gdt';
  id: string;
  refs: string[];
  reason: 'unresolved-ref';
};

export function partitionDrawingReferences(input: {
  validRefs: ReadonlySet<string> | null;
  dimensions: readonly Dimension[];
  gdt: readonly GdtCallout[];
}) {
  if (input.validRefs === null) {
    return {
      dimensions: [...input.dimensions], reviewDimensions: [] as Dimension[],
      gdt: [...input.gdt], reviewGdt: [] as GdtCallout[], review: [] as DrawingReferenceReviewItem[],
    };
  }
  const dimensions: Dimension[] = []; const reviewDimensions: Dimension[] = [];
  const gdt: GdtCallout[] = []; const reviewGdt: GdtCallout[] = [];
  const review: DrawingReferenceReviewItem[] = [];
  for (const dimension of input.dimensions) {
    const missing = dimension.refs.filter(ref => !input.validRefs!.has(ref));
    (missing.length === 0 ? dimensions : reviewDimensions).push(dimension);
    if (missing.length > 0) review.push({ consumer: 'dimension', id: dimension.id, refs: missing, reason: 'unresolved-ref' });
  }
  for (const callout of input.gdt) {
    if (input.validRefs.has(callout.targetRef)) gdt.push(callout);
    else {
      reviewGdt.push(callout);
      review.push({ consumer: 'gdt', id: callout.id, refs: [callout.targetRef], reason: 'unresolved-ref' });
    }
  }
  return { dimensions, reviewDimensions, gdt, reviewGdt, review };
}
