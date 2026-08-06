import { describe, expect, it } from 'vitest';
import { verifyDoorSwingClearance } from '@/lib/assembly/doorSwingClearance';
import { buildDoorSwingInput, verifyFurnitureClearance, verifyInteriorLighting, verifyInteriorRoute } from '../interiorSpatialSystems';
import type { ArchitectureDocument, InteriorDocument } from '../architectureInteriorDocuments';

const architecture = (): ArchitectureDocument => ({ schema: 'nexyfab.architecture.v1', revision: 0, storeys: [{ id: 'l1', name: 'L1', elevationMm: 0, heightMm: 3000 }], spaces: [{ id: 'room', storeyId: 'l1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]], wallIds: ['w1', 'w2', 'w3', 'w4'], slabId: 'slab', ceilingId: 'ceiling' }], walls: [{ id: 'w1', kind: 'line', storeyId: 'l1', startMm: [0, 0], endMm: [10000, 0], thicknessMm: 200, heightMm: 3000 }, { id: 'w2', kind: 'line', storeyId: 'l1', startMm: [10000, 0], endMm: [10000, 6000], thicknessMm: 200, heightMm: 3000 }, { id: 'w3', kind: 'line', storeyId: 'l1', startMm: [10000, 6000], endMm: [0, 6000], thicknessMm: 200, heightMm: 3000 }, { id: 'w4', kind: 'line', storeyId: 'l1', startMm: [0, 6000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 }], slabs: [{ id: 'slab', storeyId: 'l1', spaceId: 'room', boundaryMm: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]], thicknessMm: 180 }], ceilings: [{ id: 'ceiling', storeyId: 'l1', spaceId: 'room', boundaryMm: [[0, 0], [10000, 0], [10000, 6000], [0, 6000]], elevationMm: 2700 }], openings: [{ id: 'door', kind: 'door', hostWallId: 'w1', offsetMm: 1000, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [1000, 0, 0], connectsSpaceIds: ['room'], doorOperation: { pivotMm: [550, 0], closedAngleDeg: 0, openAngleDeg: 90, leafThicknessMm: 40, requiredClearanceMm: 20 } }] });
const interior = (): InteriorDocument => ({ schema: 'nexyfab.interior.v1', revision: 0, architectureDocumentId: 'architecture', lights: [{ id: 'light', spaceId: 'room', hostCeilingId: 'ceiling', positionMm: [5000, 3000, 2600], suspensionMm: 100, lumens: 12000, cctK: 4000 }], furniture: [{ id: 'island', spaceId: 'room', positionMm: [5000, 3000, 0], sizeMm: [2000, 2000, 900], clearanceMm: 500 }], finishes: [] });

describe('interior spatial and lighting systems', () => {
  it('finds a clearance-respecting route around furniture instead of using a centroid line', () => {
    const result = verifyInteriorRoute(architecture(), interior(), 'room', [1000, 3000], [9000, 3000], 12000);
    expect(result.status).toBe('passed'); expect(result.pathMm.length).toBeGreaterThan(2); expect(result.distanceMm).toBeGreaterThan(8000);
  });
  it('reports furniture use-clearance overlap and room overflow', () => {
    const design = interior(); design.furniture.push({ id: 'desk', spaceId: 'room', positionMm: [6500, 3000, 0], sizeMm: [1000, 1000, 750], clearanceMm: 600 }, { id: 'cabinet', spaceId: 'room', positionMm: [200, 200, 0], sizeMm: [1000, 1000, 2000], clearanceMm: 300 });
    const result = verifyFurnitureClearance(architecture(), design, 'room');
    expect(result.failures.map(item => item.reason)).toEqual(expect.arrayContaining(['CLEARANCE_OVERLAP', 'OUTSIDE_SPACE']));
  });
  it('requires explicit hinge data and feeds it to continuous door-swing verification', () => {
    const model = architecture(), obstacle = [{ id: 'island', polygon: [{ x: 500, y: 500 }, { x: 1500, y: 500 }, { x: 1500, y: 1500 }, { x: 500, y: 1500 }] }];
    const input = buildDoorSwingInput(model, 'door', obstacle); expect(input).not.toBeNull(); expect(verifyDoorSwingClearance(input!).clear).toBe(false);
    delete model.openings[0]!.doorOperation; expect(buildDoorSwingInput(model, 'door', obstacle)).toBeNull();
  });
  it('creates a calculation plane but blocks release-level lighting without IES evidence', () => {
    const preview = verifyInteriorLighting(interior(), 'room', architecture().spaces[0]!.boundaryMm, { targetAverageLux: 300, calculationAreaMm2: 60_000_000, coefficientOfUtilization: 0.7, lightLossFactor: 0.8, requirePhotometricEvidence: true });
    expect(preview).toMatchObject({ status: 'not_run', estimatedAverageLux: 112 }); expect(preview.calculationPoints.length).toBeGreaterThan(0);
    const evidenced = interior(); evidenced.lights[0]!.iesProfileId = 'ies:sha256:test';
    expect(verifyInteriorLighting(evidenced, 'room', architecture().spaces[0]!.boundaryMm, { targetAverageLux: 100, calculationAreaMm2: 60_000_000, coefficientOfUtilization: 0.7, lightLossFactor: 0.8, requirePhotometricEvidence: true }).status).toBe('not_run');
    expect(verifyInteriorLighting(evidenced, 'room', architecture().spaces[0]!.boundaryMm, { targetAverageLux: 100, calculationAreaMm2: 60_000_000, coefficientOfUtilization: 0.7, lightLossFactor: 0.8, requirePhotometricEvidence: true }, 1000, { ran: true, averageLux: 145, minimumLux: 90, iesProfileIds: ['ies:sha256:test'] })).toMatchObject({ status: 'passed', method: 'ies_calculation_evidence', measuredAverageLux: 145 });
  });
});
