import { describe, expect, it } from 'vitest';
import { applyArchitectureInteriorEdit, architectureInteriorBoundariesMatch, validateArchitectureDocument, validateInteriorDocument, type ArchitectureDocument, type InteriorDocument } from '../architectureInteriorDocuments';

const architecture = (): ArchitectureDocument => ({
  schema: 'nexyfab.architecture.v1', revision: 0,
  storeys: [{ id: 'level-1', name: 'L1', elevationMm: 0, heightMm: 3000 }],
  spaces: [{ id: 'room-1', storeyId: 'level-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
  walls: [
    { id: 'wall-1', kind: 'line', storeyId: 'level-1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-2', kind: 'line', storeyId: 'level-1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-3', kind: 'line', storeyId: 'level-1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 },
    { id: 'wall-4', kind: 'line', storeyId: 'level-1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
  ],
  slabs: [{ id: 'slab-1', storeyId: 'level-1', spaceId: 'room-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }],
  ceilings: [{ id: 'ceiling-1', storeyId: 'level-1', spaceId: 'room-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2600 }],
  openings: [{ id: 'window-1', kind: 'window', hostWallId: 'wall-1', offsetMm: 1000, widthMm: 1200, heightMm: 1200, sillMm: 900, positionMm: [1000, 0, 900] }],
});
const interior = (): InteriorDocument => ({ schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', lights: [{ id: 'light-1', spaceId: 'room-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 2500], suspensionMm: 100, lumens: 3000, cctK: 4000 }], furniture: [{ id: 'desk-1', spaceId: 'room-1', positionMm: [1500, 1200, 0], sizeMm: [1400, 700, 750], clearanceMm: 800 }], finishes: [{ id: 'floor-finish', spaceId: 'room-1', hostId: 'slab-1', surface: 'floor', material: 'oak' }] });

describe('separate architecture and interior semantic documents', () => {
  it('regenerates walls, slab, ceiling, and hosted openings from a room boundary', () => {
    const result = applyArchitectureInteriorEdit(architecture(), interior(), { kind: 'set_space_boundary', spaceId: 'room-1', boundaryMm: [[0, 0], [5000, 0], [5000, 3200], [0, 3200]] });
    expect(architectureInteriorBoundariesMatch(result.architecture)).toBe(true);
    expect(result.architecture.walls[0]).toMatchObject({ startMm: [0, 0], endMm: [5000, 0] });
    expect(result.architecture.openings[0]!.positionMm).toEqual([1000, 0, 900]);
    expect(result.invalidatedChecks).toContain('furniture_clearance');
  });
  it('moves lights deterministically with their host ceiling', () => {
    const result = applyArchitectureInteriorEdit(architecture(), interior(), { kind: 'set_ceiling_elevation', ceilingId: 'ceiling-1', elevationMm: 2800 });
    expect(result.interior.lights[0]!.positionMm[2]).toBe(2700);
    expect(result.affectedObjectIds).toEqual(expect.arrayContaining(['ceiling-1', 'light-1']));
    expect(result.invalidatedChecks).toContain('lighting');
  });
  it('keeps an opening parametrically hosted on a curved wall', () => {
    const arch = architecture();
    arch.walls[0] = { id: 'wall-1', kind: 'arc', storeyId: 'level-1', centerMm: [0, 0], radiusMm: 4000, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 200, heightMm: 3000 };
    const result = applyArchitectureInteriorEdit(arch, interior(), { kind: 'set_arc_wall', wallId: 'wall-1', centerMm: [0, 0], radiusMm: 5000, startAngleDeg: 0, endAngleDeg: 90 });
    expect(result.architecture.openings[0]!.positionMm[0]).toBeCloseTo(4900.33, 1);
    expect(result.architecture.openings[0]!.positionMm[1]).toBeCloseTo(993.35, 1);
    expect(result.invalidatedChecks).toContain('facade_panelization');
  });
  it('fails closed when topology or hosting becomes invalid', () => {
    expect(() => applyArchitectureInteriorEdit(architecture(), interior(), { kind: 'set_space_boundary', spaceId: 'room-1', boundaryMm: [[0, 0], [5000, 0], [0, 3000]] })).toThrow('edge count');
    const arch = architecture(); arch.openings[0]!.offsetMm = 9000;
    expect(validateArchitectureDocument(arch).some(issue => issue.includes('offset'))).toBe(true);
    expect(validateInteriorDocument(interior(), architecture())).toEqual([]);
  });
});
