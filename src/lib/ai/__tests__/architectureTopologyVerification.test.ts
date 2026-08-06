import { describe, expect, it } from 'vitest';
import { planWallOpeningBooleans, verifyArchitectureTopology } from '../architectureTopologyVerification';
import type { ArchitectureDocument } from '../architectureInteriorDocuments';

const document = (): ArchitectureDocument => ({ schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'r1', storeyId: 'l1', name: 'R', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 's1', ceilingId: 'c1' }], walls: [{ id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 }, { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 's1', storeyId: 'l1', spaceId: 'r1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }], ceilings: [{ id: 'c1', storeyId: 'l1', spaceId: 'r1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2600 }], openings: [{ id: 'win', kind: 'window', hostWallId: 'w1', offsetMm: 2000, widthMm: 1200, heightMm: 1200, sillMm: 900, positionMm: [2000, 0, 900] }] });

describe('architectural topology and opening boolean contract', () => {
  it('proves a straight room loop and produces a complete wall-local cut', () => {
    const result = verifyArchitectureTopology(document());
    expect(result.releaseReady).toBe(true);
    expect(planWallOpeningBooleans(document())).toEqual([{ wallId: 'w1', wallKind: 'line', cuts: [{ openingId: 'win', alongStartMm: 1400, alongEndMm: 2600, bottomMm: 900, topMm: 2100, depthMm: 200 }] }]);
  });
  it('rejects full-width overflow, vertical overflow, overlap, and mismatched wall loops', () => {
    const model = document();
    model.openings[0]!.offsetMm = 300; model.openings[0]!.sillMm = 2000;
    model.openings.push({ ...model.openings[0]!, id: 'win2', offsetMm: 500, sillMm: 0 });
    model.walls[1] = { ...model.walls[1]!, kind: 'line', startMm: [4100, 0], endMm: [4100, 3000] };
    const result = verifyArchitectureTopology(model);
    expect(result.gates.filter(gate => gate.status === 'failed').map(gate => gate.id)).toEqual(expect.arrayContaining(['space-wall-loop', 'opening-host-range', 'opening-overlap', 'opening-vertical-fit']));
    expect(() => planWallOpeningBooleans(model)).toThrow();
  });
  it('reports curved space topology as not_run without arc-edge boundary evidence', () => {
    const model = document(); model.walls[0] = { id: 'w1', kind: 'arc', storeyId: 'l1', centerMm: [0, 0], radiusMm: 4000, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 200, heightMm: 3000 };
    expect(verifyArchitectureTopology(model).gates[0]).toMatchObject({ status: 'not_run' });
  });
  it('proves a closed mixed arc-line boundary and measures its exact area', () => {
    const model = document();
    model.spaces[0] = { ...model.spaces[0]!, boundaryMm: [[4000, 0], [0, 4000], [-4000, 0]], boundaryEdges: [{ kind: 'arc', centerMm: [0, 0], radiusMm: 4000, startAngleDeg: 0, endAngleDeg: 180 }, { kind: 'line', startMm: [-4000, 0], endMm: [4000, 0] }], wallIds: ['w1', 'w2'] };
    model.walls = [{ id: 'w1', kind: 'arc', storeyId: 'l1', centerMm: [0, 0], radiusMm: 4000, startAngleDeg: 0, endAngleDeg: 180, thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [-4000, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 }];
    model.openings = [];
    const result = verifyArchitectureTopology(model);
    expect(result.gates[0]).toMatchObject({ status: 'passed' });
    expect(result.spaceAreasMm2.r1).toBeCloseTo(Math.PI * 4000 ** 2 / 2, 3);
  });
});
