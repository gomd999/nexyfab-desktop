import { describe, expect, it } from 'vitest';
import { createLandscapeProductContract, hashLandscapeObject, type LandscapeProductContract } from './contract';
import { generateLandscapeNativeArtifacts, hashLandscapeNativeArtifacts } from './artifacts';

const H = 'a'.repeat(64); const R = { id: 'plaza-r1', sha256: 'b'.repeat(64) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `client:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'CLIENT_PROVIDED' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const stamp = <T extends Record<string, unknown>>(value: T): T & { contentSha256: string } => ({ ...value, contentSha256: hashLandscapeObject(value) });
const base = <T extends Record<string, unknown>>(id: string, extra: T) => stamp({ id, revision: R, provenance: provenance(id), ...extra });
const point = (x: number, y: number) => ({ x, y });
const boundary = [[0, 0], [20, 0], [20, 16], [0, 16], [0, 0]].map(([x, y]) => point(x, y));
function contract(): LandscapeProductContract {
  const spots = [base('spot-a', { point: { x: 0, y: 0, z: 10 } }), base('spot-b', { point: { x: 20, y: 0, z: 9.8 } }), base('spot-c', { point: { x: 20, y: 16, z: 9.6 } }), base('spot-d', { point: { x: 0, y: 16, z: 9.9 } })];
  const outlet = base('outlet-a', { civilOutletRef: 'civil-outlet-a', elevationM: 9.6, approvalStatus: 'APPROVED' as const });
  const soil = base('soil-a', { boundary: [[1, 10], [9, 10], [9, 15], [1, 15], [1, 10]].map(([x, y]) => point(x, y)), depthM: 0.8, volumeM3: 32, soilTypeRef: 'soil:loam' });
  const planting = base('planting-a', { soilZoneRef: 'soil-a', boundary: [[1, 10], [9, 10], [9, 15], [1, 15], [1, 10]].map(([x, y]) => point(x, y)), irrigationZoneRef: 'zone-a' });
  const plant = base('plant-a', { plantingZoneRef: 'planting-a', speciesId: 'species:tree-a', supplierId: 'supplier:a', supplierProvenance: provenance('supplier-a'), point: point(5, 12), matureCanopyDiameterM: 4, matureRootDiameterM: 3 });
  const source = base('water-source-a', { pressureKPa: 250, maxFlowLpm: 40, authorityInputRef: 'authority-hydraulic' });
  const valve = base('valve-a', { sourceRef: 'water-source-a', zoneRef: 'zone-a', ratedFlowLpm: 20, catalogAuthorityRef: 'authority-catalog' });
  const zone = base('zone-a', { plantingZoneRefs: ['planting-a'], valveRef: 'valve-a', designFlowLpm: 12, waterBudgetM3PerYear: 100 });
  const pipe = base('pipe-a', { fromRef: 'water-source-a', toRef: 'valve-a', diameterMm: 25, lengthM: 12, designFlowLpm: 20 });
  const emitter = base('emitter-a', { valveRef: 'valve-a', plantRefs: ['plant-a'], flowLpm: 2, spacingM: 1 });
  return createLandscapeProductContract({
    schema: 'nexyfab.landscape.small-plaza-courtyard.v1', identity: { projectId: 'plaza-courtyard', revision: R }, units: { length: 'm', area: 'm2', volume: 'm3', flow: 'lpm', pressure: 'kPa', slope: '%' },
    authority: { coordinateFrame: base('coordinate-frame-a', { kind: 'APPROVED_CARTESIAN' as const, crs: 'project-local', horizontalDatum: 'client-grid', verticalDatum: 'client-benchmark', epoch: '2026-01-01', origin: { x: 0, y: 0, z: 0 }, rotationDeg: 0, reviewStatus: 'APPROVED' as const }), terrainBinding: base('terrain-binding-a', { civilSurfaceId: 'civil-surface-a', civilSurfaceRevision: R, civilSurfaceSha256: H, drainageOutletId: 'civil-outlet-a', drainageOutletSha256: H, approvedUse: true as const }), client: base('authority-client', { subject: 'CLIENT' as const, values: { projectBrief: 'plaza courtyard', accessibleRouteWidthM: 1.5 } }), code: base('authority-code', { subject: 'CODE' as const, values: { jurisdiction: 'project-jurisdiction', maxSlopePercent: 5 } }), hydraulic: base('authority-hydraulic', { subject: 'HYDRAULIC' as const, values: { sourcePressureKPa: 250, annualWaterLimitM3: 100 } }), catalog: base('authority-catalog', { subject: 'CATALOG' as const, values: { supplierRevision: 'supplier-r1' } }), maintenance: base('authority-maintenance', { subject: 'MAINTENANCE' as const, values: { inspectionIntervalDays: 30 } }) },
    siteBoundary: base('site-boundary-a', { polygon: boundary }), grading: { spotGrades: spots, breaklines: [base('breakline-a', { kind: 'EDGE' as const, pointRefs: ['spot-a', 'spot-b'] })], drainagePaths: [base('drainage-a', { pointRefs: ['spot-d', 'spot-c'], outletRef: 'outlet-a', flowDirection: 'DOWNHILL' as const })], outlets: [outlet] },
    hardscape: [base('hardscape-a', { kind: 'PAVING' as const, boundary: [[2, 2], [18, 2], [18, 8], [2, 8], [2, 2]].map(([x, y]) => point(x, y)), thicknessM: 0.12, maxSlopePercent: 3, accessibilityCriterionRef: 'authority-code' })], soilZones: [soil], plantingZones: [planting], plants: [plant],
    irrigation: { source, valves: [valve], zones: [zone], pipes: [pipe], emitters: [emitter], waterBudget: base('water-budget-a', { annualDemandM3: 100, sourceCapacityLpm: 40, climateInputRef: 'authority-hydraulic', approvalStatus: 'APPROVED' as const }) },
    maintenance: { zones: [base('maintenance-zone-a', { objectRefs: ['planting-a', 'zone-a'], accessWidthM: 1.2, taskAuthorityRef: 'authority-maintenance' })], tasks: [base('maintenance-task-a', { zoneRef: 'maintenance-zone-a', taskCode: 'irrigation-inspection', intervalDays: 30, methodRef: 'authority-maintenance' })] }, authoritative: true,
  });
}

describe('landscape native artifacts', () => {
  it('generates deterministic geometry, schedules, quantities, and a declared-only water budget', () => {
    const value = contract(); const artifact = generateLandscapeNativeArtifacts(value);
    expect(artifact.status).toBe('GENERATED_WITH_HOLDS');
    expect(artifact.quantities.siteAreaM2).toBe(320); expect(artifact.quantities.hardscapeAreaM2).toBe(96); expect(artifact.quantities.soilDerivedVolumeM3).toBe(32); expect(artifact.quantities.waterBudget.status).toBe('DECLARED_ONLY');
    expect(artifact.artifactSha256).toBe(hashLandscapeNativeArtifacts(artifact)); expect(generateLandscapeNativeArtifacts(value).artifactSha256).toBe(artifact.artifactSha256); expect(Object.isFrozen(artifact.binding)).toBe(true);
    expect(Object.isFrozen(value.siteBoundary.polygon)).toBe(false);
  });
  it('rejects invalid contracts and stale revision, coordinate, or terrain bindings', () => {
    const value = contract(); expect(() => generateLandscapeNativeArtifacts({ ...value, authoritative: false })).toThrow(/invalid_contract/);
    expect(() => generateLandscapeNativeArtifacts(value, { revision: { id: 'old', sha256: H } })).toThrow('stale_revision_binding');
    expect(() => generateLandscapeNativeArtifacts(value, { coordinateFrameSha256: H })).toThrow('stale_coordinate_binding');
    expect(() => generateLandscapeNativeArtifacts(value, { terrainSha256: H })).toThrow('stale_terrain_binding');
  });
});
