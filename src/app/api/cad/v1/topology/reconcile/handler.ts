import type { Mate } from '@/lib/assembly/mate';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { remapTopologyEntities, type TopologyEntitySnapshot } from '@/lib/cad/topologyRemap';
import { propagateTopologyReferences, type PmiTopologyRecord } from '@/lib/cad/topologyReferencePropagation';

export type TopologyReconcileBody = {
  previous?: TopologyEntitySnapshot[];
  current?: TopologyEntitySnapshot[];
  mates?: Mate[];
  dimensions?: Dimension[];
  gdt?: GdtCallout[];
  pmi?: PmiTopologyRecord[];
};

export function handleTopologyReconcile(body: TopologyReconcileBody): { status: number; payload: Record<string, unknown> } {
  if (!Array.isArray(body.previous) || !Array.isArray(body.current)) {
    return { status: 400, payload: { ok: false, code: 'BAD_REQUEST', message: 'previous and current topology arrays are required' } };
  }
  if (body.previous.length > 10_000 || body.current.length > 10_000) {
    return { status: 413, payload: { ok: false, code: 'TOO_LARGE', message: 'topology arrays are limited to 10000 entities' } };
  }
  if (![...body.previous, ...body.current].every(isTopologyEntity)) {
    return { status: 422, payload: { ok: false, code: 'INVALID_TOPOLOGY', message: 'each topology entity requires kind, persistentRef, centroid[3], and finite non-negative measure' } };
  }
  try {
    const remaps = remapTopologyEntities(body.previous, body.current);
    const propagated = propagateTopologyReferences({
      remaps,
      mates: body.mates,
      dimensions: body.dimensions,
      gdt: body.gdt,
      pmi: body.pmi,
    });
    return {
      status: 200,
      payload: {
        ok: true,
        remaps,
        mates: propagated.mates,
        dimensions: propagated.activeDimensions,
        reviewDimensions: propagated.reviewDimensions,
        gdt: propagated.activeGdt,
        reviewGdt: propagated.reviewGdt,
        pmi: propagated.activePmi,
        reviewPmi: propagated.reviewPmi,
        review: propagated.review,
      },
    };
  } catch (error) {
    return { status: 422, payload: { ok: false, code: 'INVALID_TOPOLOGY', message: error instanceof Error ? error.message : 'invalid topology payload' } };
  }
}

function isTopologyEntity(value: unknown): value is TopologyEntitySnapshot {
  if (!value || typeof value !== 'object') return false;
  const entity = value as Partial<TopologyEntitySnapshot>;
  return (entity.kind === 'face' || entity.kind === 'edge' || entity.kind === 'vertex') &&
    typeof entity.persistentRef === 'string' && entity.persistentRef.length > 0 &&
    Array.isArray(entity.centroid) && entity.centroid.length === 3 && entity.centroid.every(Number.isFinite) &&
    Number.isFinite(entity.measure) && (entity.measure ?? -1) >= 0 &&
    (entity.direction === undefined || (Array.isArray(entity.direction) && entity.direction.length === 3 && entity.direction.every(Number.isFinite)));
}
