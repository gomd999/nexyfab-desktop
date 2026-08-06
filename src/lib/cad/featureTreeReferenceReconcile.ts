import type { Mate } from '@/lib/assembly/mate';
import { listPartRefs } from '@/lib/assembly/geometryResolver';
import type { FeatureTree } from './featureTree';
import {
  propagateTopologyReferences,
  type ReferenceReviewItem,
} from './topologyReferencePropagation';
import type { TopologyRemapResult } from './topologyRemap';

export type FeatureTreeReferenceReconcileResult = {
  mates: Mate[];
  review: ReferenceReviewItem[];
  remaps: TopologyRemapResult[];
};

/**
 * Reconcile the references consumed by assembly mates after one part's
 * FeatureTree regenerates. Exact surviving references remain active; refs
 * that disappeared are deliberately marked broken rather than guessed.
 * Rich B-rep callers can feed geometric candidates through topologyRemap,
 * while this immediate FeatureTree path stays deterministic and safe.
 */
export function reconcileFeatureTreeMateReferences(input: {
  partId: string;
  before?: FeatureTree;
  after?: FeatureTree;
  mates: readonly Mate[];
}): FeatureTreeReferenceReconcileResult {
  const beforeRefs = new Set(listPartRefs(input.before ?? { nodes: [] }));
  const afterRefs = new Set(listPartRefs(input.after ?? { nodes: [] }));
  const consumedRefs = new Set<string>();

  for (const mate of input.mates) {
    if (mate.a.partId === input.partId) consumedRefs.add(mate.a.refId);
    if (mate.b.partId === input.partId) consumedRefs.add(mate.b.refId);
  }

  const remaps: TopologyRemapResult[] = [];
  for (const refId of consumedRefs) {
    if (afterRefs.has(refId)) {
      remaps.push({
        previousRef: `${input.partId}:${refId}`,
        mappedRef: refId,
        quality: 'persistent',
        score: 1,
        reason: 'The same generated reference is present after regeneration.',
      });
    } else if (beforeRefs.has(refId)) {
      remaps.push({
        previousRef: `${input.partId}:${refId}`,
        quality: 'broken',
        score: 0,
        reason: `Reference ${refId} disappeared when part ${input.partId} regenerated.`,
      });
    }
  }

  const propagated = propagateTopologyReferences({ remaps, mates: input.mates });
  return { mates: propagated.mates, review: propagated.review, remaps };
}
