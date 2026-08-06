import { describe, expect, it } from 'vitest';
import { verifyEgressRoutes } from '@/lib/assembly/egressRouteVerification';
import { buildArchitectureEgressInput, planRepeatedOpenings } from '../architecturalOpeningPlanning';
import type { ArchitectureDocument } from '../architectureInteriorDocuments';

const base = (): ArchitectureDocument => ({ schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'a', storeyId: 'l1', name: 'A', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000]], wallIds: ['arc', 'other', 'third'], slabId: 'sa', ceilingId: 'ca' }, { id: 'b', storeyId: 'l1', name: 'B', usage: 'corridor', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000]], wallIds: ['other', 'third', 'arc'], slabId: 'sb', ceilingId: 'cb' }], walls: [{ id: 'arc', kind: 'arc', storeyId: 'l1', centerMm: [0, 0], radiusMm: 10000, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 200, heightMm: 3000 }, { id: 'other', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [8000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'third', kind: 'line', storeyId: 'l1', startMm: [8000, 0], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 'sa', storeyId: 'l1', spaceId: 'a', boundaryMm: [[0, 0], [4000, 0], [4000, 3000]], thicknessMm: 180 }, { id: 'sb', storeyId: 'l1', spaceId: 'b', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000]], thicknessMm: 180 }], ceilings: [{ id: 'ca', storeyId: 'l1', spaceId: 'a', boundaryMm: [[0, 0], [4000, 0], [4000, 3000]], elevationMm: 2600 }, { id: 'cb', storeyId: 'l1', spaceId: 'b', boundaryMm: [[4000, 0], [8000, 0], [8000, 3000]], elevationMm: 2600 }], openings: [] });

describe('curved facade opening and architecture egress planning', () => {
  it('places repeated windows by exact arc length within margins', () => {
    const openings = planRepeatedOpenings(base(), { wallId: 'arc', idPrefix: 'win', kind: 'window', count: 6, widthMm: 1200, heightMm: 1200, sillMm: 900, startMarginMm: 500, endMarginMm: 500, minimumGapMm: 300 });
    expect(openings).toHaveLength(6); expect(openings[0]!.offsetMm).toBe(1100);
    expect(openings.every((opening, index) => index === 0 || opening.offsetMm > openings[index - 1]!.offsetMm)).toBe(true);
  });
  it('rejects a repeated layout that cannot fit the host wall', () => expect(() => planRepeatedOpenings(base(), { wallId: 'other', idPrefix: 'win', kind: 'window', count: 8, widthMm: 1200, heightMm: 1200, sillMm: 900, startMarginMm: 500, endMarginMm: 500, minimumGapMm: 300 })).toThrow('available'));
  it('builds and verifies egress only from explicit door-space relations', () => {
    const model = base();
    model.openings = [{ id: 'door-ab', kind: 'door', hostWallId: 'other', offsetMm: 4000, widthMm: 1200, heightMm: 2100, sillMm: 0, positionMm: [4000, 0, 0], connectsSpaceIds: ['a', 'b'] }, { id: 'door-exit', kind: 'door', hostWallId: 'other', offsetMm: 7000, widthMm: 1200, heightMm: 2100, sillMm: 0, positionMm: [7000, 0, 0], connectsSpaceIds: ['b'], isExit: true }];
    const result = verifyEgressRoutes(buildArchitectureEgressInput(model, ['a'], { maximumTravelDistanceMm: 20000, minimumClearWidthMm: 1000 }));
    expect(result.passed).toBe(true); expect(result.originResults[0]!.pathEdgeIds).toEqual(['door:door-ab', 'exit-edge:door-exit']);
  });
  it('fails closed when door adjacency is missing', () => { const model = base(); model.openings = [{ id: 'door', kind: 'door', hostWallId: 'other', offsetMm: 1000, widthMm: 1000, heightMm: 2100, sillMm: 0, positionMm: [1000, 0, 0], isExit: true }]; expect(() => buildArchitectureEgressInput(model, ['a'], { maximumTravelDistanceMm: 10000, minimumClearWidthMm: 900 })).toThrow('explicit'); });
});
