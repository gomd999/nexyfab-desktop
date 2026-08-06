import { describe, expect, it } from 'vitest';
import { verifyExactFurnitureClearance } from '../interiorFurnitureGeometry';
import type { ArchitectureDocument, InteriorDocument } from '../architectureInteriorDocuments';

const architecture = { schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'room', storeyId: 'l1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [8000, 0], [8000, 8000], [0, 8000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 's', ceilingId: 'c' }], walls: [], slabs: [], ceilings: [], openings: [] } as unknown as ArchitectureDocument;
const interior = (offset: number): InteriorDocument => ({ schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', lights: [], finishes: [], furniture: [{ id: 'a', spaceId: 'room', positionMm: [3000, 3000, 0], sizeMm: [2000, 200, 700], clearanceMm: 0, rotationDeg: 45 }, { id: 'b', spaceId: 'room', positionMm: [3000 - offset, 3000 + offset, 0], sizeMm: [2000, 200, 700], clearanceMm: 0, rotationDeg: 45 }] });

describe('oriented furniture clearance geometry', () => {
  it('does not report an AABB false positive for separated rotated furniture', () => {
    const result = verifyExactFurnitureClearance(architecture, interior(350), 'room');
    expect(result.status).toBe('passed'); expect(result.method).toBe('oriented_polygon_sat');
  });
  it('detects actual overlap after rotation and declared clearance', () => {
    const design = interior(50); design.furniture[0]!.clearanceMm = 100; design.furniture[1]!.clearanceMm = 100;
    expect(verifyExactFurnitureClearance(architecture, design, 'room').failures[0]).toMatchObject({ reason: 'CLEARANCE_OVERLAP' });
  });
});
