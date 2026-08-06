import { describe, expect, it } from 'vitest';
import { handleTopologyReconcile } from './handler';

const face = (persistentRef: string, z: number) => ({
  kind: 'face' as const, persistentRef, semanticRole: 'top', centroid: [0, 0, z] as [number, number, number],
  direction: [0, 0, 1] as [number, number, number], measure: 100,
});

describe('CAD v1 topology reconcile handler', () => {
  it('propagates one contract across dimensions, GD&T and PMI', () => {
    const result = handleTopologyReconcile({
      previous: [face('old', 10)], current: [face('new', 10.1)],
      dimensions: [{ id: 'd', viewportId: 'v', kind: 'radial', refs: ['old'] }],
      gdt: [{ id: 'g', viewportId: 'v', kind: 'flatness', targetRef: 'old', toleranceValue: 0.1 }],
      pmi: [{ id: 'p', topoHashes: ['old'] }],
    });
    expect(result.status).toBe(200);
    expect((result.payload.dimensions as Array<{ refs: string[] }>)[0]?.refs).toEqual(['new']);
    expect(result.payload.review).toEqual([]);
  });

  it('rejects missing topology arrays', () => {
    expect(handleTopologyReconcile({}).status).toBe(400);
  });

  it('rejects malformed topology instead of producing NaN remap scores', () => {
    expect(handleTopologyReconcile({ previous: [{ kind: 'face' } as never], current: [] }).status).toBe(422);
  });
});
