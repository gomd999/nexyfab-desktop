import { describe, expect, it } from 'vitest';
import {
  createLandscapeProductContract,
  hashLandscapeObject,
  validateLandscapeProductContract,
  type LandscapeProductContract,
} from './contract';

const H = 'a'.repeat(64); const R = { id: 'plaza-r1', sha256: 'b'.repeat(64) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `client:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'CLIENT_PROVIDED' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const stamp = <T extends Record<string, unknown>>(value: T): T & { contentSha256: string } => ({ ...value, contentSha256: hashLandscapeObject(value) });
const base = <T extends Record<string, unknown>>(id: string, extra: T): T & { id: string; revision: typeof R; provenance: ReturnType<typeof provenance>; contentSha256: string } => stamp({ id, revision: R, provenance: provenance(id), ...extra });
const point = (x: number, y: number) => ({ x, y });
const boundary = [[0, 0], [20, 0], [20, 16], [0, 16], [0, 0]].map(([x, y]) => point(x, y));

function validContract(): LandscapeProductContract {
  const spots = [
    base('spot-a', { point: { x: 0, y: 0, z: 10 } }), base('spot-b', { point: { x: 20, y: 0, z: 9.8 } }),
    base('spot-c', { point: { x: 20, y: 16, z: 9.6 } }), base('spot-d', { point: { x: 0, y: 16, z: 9.9 } }),
  ];
  const outlet = base('outlet-a', { civilOutletRef: 'civil-outlet-a', elevationM: 9.6, approvalStatus: 'APPROVED' as const });
  const soil = base('soil-a', { boundary: [[1, 10], [9, 10], [9, 15], [1, 15], [1, 10]].map(([x, y]) => point(x, y)), depthM: 0.8, volumeM3: 32, soilTypeRef: 'soil:loam' });
  const planting = base('planting-a', { soilZoneRef: 'soil-a', boundary: [[1, 10], [9, 10], [9, 15], [1, 15], [1, 10]].map(([x, y]) => point(x, y)), irrigationZoneRef: 'zone-a' });
  const plant = base('plant-a', { plantingZoneRef: 'planting-a', speciesId: 'species:tree-a', supplierId: 'supplier:a', supplierProvenance: provenance('supplier-a'), point: point(5, 12), matureCanopyDiameterM: 4, matureRootDiameterM: 3 });
  const source = base('water-source-a', { pressureKPa: 250, maxFlowLpm: 40, authorityInputRef: 'authority-hydraulic' });
  const valve = base('valve-a', { sourceRef: 'water-source-a', zoneRef: 'zone-a', ratedFlowLpm: 20, catalogAuthorityRef: 'authority-catalog' });
  const zone = base('zone-a', { plantingZoneRefs: ['planting-a'], valveRef: 'valve-a', designFlowLpm: 12, waterBudgetM3PerYear: 100 });
  const pipe = base('pipe-a', { fromRef: 'water-source-a', toRef: 'valve-a', diameterMm: 25, lengthM: 12, designFlowLpm: 20 });
  const emitter = base('emitter-a', { valveRef: 'valve-a', plantRefs: ['plant-a'], flowLpm: 2, spacingM: 1 });
  const contractInput = {
    schema: 'nexyfab.landscape.small-plaza-courtyard.v1' as const,
    identity: { projectId: 'plaza-courtyard', revision: R },
    units: { length: 'm' as const, area: 'm2' as const, volume: 'm3' as const, flow: 'lpm' as const, pressure: 'kPa' as const, slope: '%' as const },
    authority: {
      coordinateFrame: base('coordinate-frame-a', { kind: 'APPROVED_CARTESIAN' as const, crs: 'project-local', horizontalDatum: 'client-grid', verticalDatum: 'client-benchmark', epoch: '2026-01-01', origin: { x: 0, y: 0, z: 0 }, rotationDeg: 0, reviewStatus: 'APPROVED' as const }),
      terrainBinding: base('terrain-binding-a', { civilSurfaceId: 'civil-surface-a', civilSurfaceRevision: R, civilSurfaceSha256: H, drainageOutletId: 'civil-outlet-a', drainageOutletSha256: H, approvedUse: true as const }),
      client: base('authority-client', { subject: 'CLIENT' as const, values: { projectBrief: 'plaza courtyard', accessibleRouteWidthM: 1.5 } }),
      code: base('authority-code', { subject: 'CODE' as const, values: { jurisdiction: 'project-jurisdiction', maxSlopePercent: 5 } }),
      hydraulic: base('authority-hydraulic', { subject: 'HYDRAULIC' as const, values: { sourcePressureKPa: 250, annualWaterLimitM3: 100 } }),
      catalog: base('authority-catalog', { subject: 'CATALOG' as const, values: { supplierRevision: 'supplier-r1' } }),
      maintenance: base('authority-maintenance', { subject: 'MAINTENANCE' as const, values: { inspectionIntervalDays: 30 } }),
    },
    siteBoundary: base('site-boundary-a', { polygon: boundary }),
    grading: {
      spotGrades: spots,
      breaklines: [base('breakline-a', { kind: 'EDGE' as const, pointRefs: ['spot-a', 'spot-b'] })],
      drainagePaths: [base('drainage-a', { pointRefs: ['spot-d', 'spot-c'], outletRef: 'outlet-a', flowDirection: 'DOWNHILL' as const })],
      outlets: [outlet],
    },
    hardscape: [base('hardscape-a', { kind: 'PAVING' as const, boundary: [[2, 2], [18, 2], [18, 8], [2, 8], [2, 2]].map(([x, y]) => point(x, y)), thicknessM: 0.12, maxSlopePercent: 3, accessibilityCriterionRef: 'authority-code' })],
    soilZones: [soil], plantingZones: [planting], plants: [plant],
    irrigation: { source, valves: [valve], zones: [zone], pipes: [pipe], emitters: [emitter], waterBudget: base('water-budget-a', { annualDemandM3: 100, sourceCapacityLpm: 40, climateInputRef: 'authority-hydraulic', approvalStatus: 'APPROVED' as const }) },
    maintenance: {
      zones: [base('maintenance-zone-a', { objectRefs: ['planting-a', 'zone-a'], accessWidthM: 1.2, taskAuthorityRef: 'authority-maintenance' })],
      tasks: [base('maintenance-task-a', { zoneRef: 'maintenance-zone-a', taskCode: 'irrigation-inspection', intervalDays: 30, methodRef: 'authority-maintenance' })],
    },
    authoritative: true as const,
  };
  return createLandscapeProductContract(contractInput);
}

describe('landscape product contract', () => {
  it('accepts a fully hashed authoritative courtyard contract', () => {
    const contract = validContract();
    expect(validateLandscapeProductContract(contract)).toEqual([]);
    expect(contract.identity.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects preview, synthetic, unapproved, and stale authority inputs', () => {
    const contract = validContract();
    const preview = structuredClone(contract); preview.authority.catalog.provenance.sourceRef = 'preview:catalog';
    expect(validateLandscapeProductContract(preview)).toContain('authority.catalog.provenance.sourceRef');
    const stale = structuredClone(contract); stale.authority.terrainBinding.civilSurfaceRevision = { id: 'civil-r0', sha256: H };
    expect(validateLandscapeProductContract(stale).some(issue => issue.includes('civilSurfaceRevision') || issue.includes('contentSha256:mismatch'))).toBe(true);
  });

  it('rejects dangling references, duplicate IDs, and an irrigation cycle', () => {
    const contract = validContract();
    const dangling = structuredClone(contract); dangling.plantingZones[0].soilZoneRef = 'missing-soil';
    expect(validateLandscapeProductContract(dangling)).toContain('plantingZones[0].soilZoneRef:dangling');
    const duplicate = structuredClone(contract); duplicate.plants.push(structuredClone(duplicate.plants[0]));
    expect(validateLandscapeProductContract(duplicate)).toContain('plants[1].id:duplicate');
    const cycle = structuredClone(contract); cycle.irrigation.pipes.push({ ...structuredClone(cycle.irrigation.pipes[0]), id: 'pipe-cycle', fromRef: 'valve-a', toRef: 'water-source-a', contentSha256: '' });
    expect(validateLandscapeProductContract(cycle)).toContain('irrigation.pipes:cycle');
  });

  it('rejects open or degenerate site geometry and missing required collections', () => {
    const contract = validContract();
    const open = structuredClone(contract); open.siteBoundary.polygon[open.siteBoundary.polygon.length - 1] = { x: 4, y: 4 };
    expect(validateLandscapeProductContract(open)).toContain('siteBoundary.polygon:not_closed');
    const missing = structuredClone(contract); missing.grading.breaklines = [];
    expect(validateLandscapeProductContract(missing)).toContain('grading.breaklines:required');
  });
  it('binds criterion, irrigation, and maintenance references to authoritative objects', () => {
    const contract = validContract();
    const criterion = structuredClone(contract); criterion.hardscape[0].accessibilityCriterionRef = 'missing-code';
    expect(validateLandscapeProductContract(criterion)).toContain('hardscape[0].accessibilityCriterionRef:dangling');
    const zone = structuredClone(contract); zone.irrigation.valves[0].zoneRef = 'missing-zone';
    expect(validateLandscapeProductContract(zone)).toContain('irrigation.valves[0].zoneRef:dangling');
    const maintenance = structuredClone(contract); maintenance.maintenance.tasks[0].methodRef = 'missing-method';
    expect(validateLandscapeProductContract(maintenance)).toContain('maintenance.tasks[0].methodRef:dangling');
  });
});
