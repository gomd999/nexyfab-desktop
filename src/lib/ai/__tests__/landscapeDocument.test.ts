import { describe, expect, it } from 'vitest';
import { landscapeDomainDocument, landscapeReleaseReadiness, validateLandscapeDocument, type LandscapeDocument } from '../landscapeDocument';

const landscape = (): LandscapeDocument => ({
  schema: 'nexyfab.landscape.v1', revision: 0, coordinateSystemId: 'site', terrain: { civilDocumentId: 'civil', surfaceId: 'eg', civilRevision: 2 },
  sourceEvidence: [{ id: 'nursery-1', kind: 'nursery', sourceRef: 'catalog://2026', capturedAt: '2026-08-01T00:00:00Z' }], siteBoundaryM: [[0, 0], [100, 0], [100, 100], [0, 100]],
  plants: [{ id: 'tree-1', speciesCode: 'ZEL-SER', positionM: [10, 10, 10], installedHeightM: 3, matureCanopyDiameterM: 8, rootZoneDiameterM: 5, spacingM: 8, evidenceIds: ['nursery-1'] }],
  soilVolumes: [{ id: 'soil-1', boundaryM: [[5, 5], [15, 5], [15, 15], [5, 15]], depthM: 1.2, soilType: 'loam', drainageClass: 'well-drained' }],
  plantingZones: [{ id: 'plant-zone-1', boundaryM: [[5, 5], [15, 5], [15, 15], [5, 15]], plantIds: ['tree-1'], soilVolumeId: 'soil-1', targetCoveragePercent: 70 }],
  hardscapes: [{ id: 'path-1', kind: 'path', boundaryM: [[0, 0], [20, 0], [20, 2], [0, 2]], material: 'permeable paver', slopePercent: 1.5, accessible: true }],
  irrigationNodes: [{ id: 'water-1', kind: 'source', positionM: [0, 0, 10], pressureKpa: 300, flowLpm: 30 }, { id: 'valve-1', kind: 'valve', positionM: [5, 5, 10] }, { id: 'drip-1', kind: 'emitter', positionM: [10, 10, 10] }],
  irrigationPipes: [{ id: 'pipe-1', fromNodeId: 'water-1', toNodeId: 'valve-1', diameterMm: 25, lengthM: 10 }, { id: 'pipe-2', fromNodeId: 'valve-1', toNodeId: 'drip-1', diameterMm: 16, lengthM: 8 }],
  irrigationZones: [{ id: 'irrigation-1', valveNodeId: 'valve-1', emitterNodeIds: ['drip-1'], plantingZoneIds: ['plant-zone-1'], designFlowLpm: 10 }],
  drainagePaths: [{ id: 'swale-1', pointsM: [[0, 0, 10], [100, 0, 9]], outletObjectId: 'civil:outfall-1', minimumSlopePercent: 1 }],
  maintenanceZones: [{ id: 'maint-1', boundaryM: [[0, 0], [20, 0], [20, 20], [0, 20]], accessWidthM: 2, taskCodes: ['PRUNE', 'INSPECT'] }],
});

describe('LandscapeDocument', () => {
  it('preserves terrain, living systems, water and maintenance semantics', () => {
    const model = landscape();
    expect(validateLandscapeDocument(model)).toEqual([]);
    expect(Object.values(landscapeReleaseReadiness(model)).every(Boolean)).toBe(true);
    expect(landscapeDomainDocument(model).representations).toEqual(expect.arrayContaining(['gis', 'procedural']));
  });
  it('fails closed on missing provenance, soil, irrigation capacity and drainage evidence', () => {
    const model = landscape();
    model.plants[0]!.evidenceIds = ['missing'];
    model.plantingZones[0]!.soilVolumeId = 'missing';
    model.irrigationNodes[0]!.flowLpm = 1;
    model.drainagePaths[0]!.minimumSlopePercent = 0;
    expect(validateLandscapeDocument(model).join(' ')).toContain('plant geometry or provenance');
    const readiness = landscapeReleaseReadiness(model);
    expect(readiness).toMatchObject({ plant_provenance: false, soil_volume: false, irrigation_capacity: false, drainage: false });
  });
});
