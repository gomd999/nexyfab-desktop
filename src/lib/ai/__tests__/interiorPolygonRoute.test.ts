import { describe, expect, it } from 'vitest';
import { verifyPolygonInteriorRoute } from '../interiorPolygonRoute';
import type { ArchitectureDocument, InteriorDocument } from '../architectureInteriorDocuments';

const architecture = { spaces: [{ id: 'room', boundaryMm: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]] }] } as ArchitectureDocument;
const interior: InteriorDocument = { schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', lights: [], finishes: [], furniture: [{ id: 'rotated', spaceId: 'room', positionMm: [5000, 3000, 0], sizeMm: [3000, 800, 800], clearanceMm: 400, rotationDeg: 35 }] };

describe('exact polygon interior route', () => {
  it('routes around a rotated furniture clearance polygon', () => {
    const result = verifyPolygonInteriorRoute(architecture, interior, 'room', [1000, 3000], [9000, 3000], 12000);
    expect(result.status).toBe('passed'); expect(result.method).toBe('exact_polygon_visibility_graph'); expect(result.pathMm.length).toBeGreaterThan(2); expect(result.distanceMm).toBeGreaterThan(8000);
  });
  it('fails when an endpoint lies in the rotated clearance polygon', () => expect(verifyPolygonInteriorRoute(architecture, interior, 'room', [5000, 3000], [9000, 3000], 12000).status).toBe('failed'));
});
