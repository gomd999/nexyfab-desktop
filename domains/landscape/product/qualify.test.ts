import { describe, expect, it } from 'vitest';
import { createLandscapeProductContract, hashLandscapeObject, type LandscapeProductContract } from './contract';
import { qualifyLandscapeProduct, qualifyLandscapeSite } from './qualify';

const H = 'a'.repeat(64); const R = { id: 'plaza-r1', sha256: 'b'.repeat(64) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `client:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'CLIENT_PROVIDED' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const stamp = <T extends Record<string, unknown>>(value: T) => ({ ...value, contentSha256: hashLandscapeObject(value) });
const base = <T extends Record<string, unknown>>(id: string, extra: T) => stamp({ id, revision: R, provenance: provenance(id), ...extra });
const point = (x: number, y: number) => ({ x, y });

function validContract(): LandscapeProductContract {
  const spots = [base('spot-a', { point: { x: 0, y: 0, z: 10 } }), base('spot-b', { point: { x: 20, y: 0, z: 9.8 } }), base('spot-c', { point: { x: 20, y: 16, z: 9.6 } }), base('spot-d', { point: { x: 0, y: 16, z: 9.9 } })];
  const outlet = base('outlet-a', { civilOutletRef: 'civil-outlet-a', elevationM: 9.6, approvalStatus: 'APPROVED' as const });
  const soilBoundary = [point(1, 10), point(9, 10), point(9, 15), point(1, 15), point(1, 10)];
  const soil = base('soil-a', { boundary: soilBoundary, depthM: 0.8, volumeM3: 32, soilTypeRef: 'soil:loam' });
  const planting = base('planting-a', { soilZoneRef: 'soil-a', boundary: soilBoundary, irrigationZoneRef: 'zone-a' });
  const plant = base('plant-a', { plantingZoneRef: 'planting-a', speciesId: 'species:tree-a', supplierId: 'supplier:a', supplierProvenance: provenance('supplier-a'), point: point(5, 12), matureCanopyDiameterM: 4, matureRootDiameterM: 3 });
  const source = base('water-source-a', { pressureKPa: 250, maxFlowLpm: 40, authorityInputRef: 'authority-hydraulic' });
  const valve = base('valve-a', { sourceRef: 'water-source-a', zoneRef: 'zone-a', ratedFlowLpm: 20, catalogAuthorityRef: 'authority-catalog' });
  const zone = base('zone-a', { plantingZoneRefs: ['planting-a'], valveRef: 'valve-a', designFlowLpm: 12, waterBudgetM3PerYear: 100 });
  const pipe = base('pipe-a', { fromRef: 'water-source-a', toRef: 'valve-a', diameterMm: 25, lengthM: 12, designFlowLpm: 20 });
  const emitter = base('emitter-a', { valveRef: 'valve-a', plantRefs: ['plant-a'], flowLpm: 2, spacingM: 1 });
  return createLandscapeProductContract({
    schema: 'nexyfab.landscape.small-plaza-courtyard.v1', identity: { projectId: 'plaza-courtyard', revision: R }, units: { length: 'm', area: 'm2', volume: 'm3', flow: 'lpm', pressure: 'kPa', slope: '%' },
    authority: { coordinateFrame: base('coordinate-frame-a', { kind: 'APPROVED_CARTESIAN' as const, crs: 'project-local', horizontalDatum: 'client-grid', verticalDatum: 'client-benchmark', epoch: '2026-01-01', origin: { x: 0, y: 0, z: 0 }, rotationDeg: 0, reviewStatus: 'APPROVED' as const }), terrainBinding: base('terrain-binding-a', { civilSurfaceId: 'civil-surface-a', civilSurfaceRevision: R, civilSurfaceSha256: H, drainageOutletId: 'civil-outlet-a', drainageOutletSha256: H, approvedUse: true as const }), client: base('authority-client', { subject: 'CLIENT' as const, values: { projectBrief: 'plaza courtyard', accessibleRouteWidthM: 1.5 } }), code: base('authority-code', { subject: 'CODE' as const, values: { jurisdiction: 'project-jurisdiction', maxSlopePercent: 5 } }), hydraulic: base('authority-hydraulic', { subject: 'HYDRAULIC' as const, values: { sourcePressureKPa: 250, annualWaterLimitM3: 100 } }), catalog: base('authority-catalog', { subject: 'CATALOG' as const, values: { supplierRevision: 'supplier-r1' } }), maintenance: base('authority-maintenance', { subject: 'MAINTENANCE' as const, values: { inspectionIntervalDays: 30 } }) },
    siteBoundary: base('site-boundary-a', { polygon: [point(0, 0), point(20, 0), point(20, 16), point(0, 16), point(0, 0)] }), grading: { spotGrades: spots, breaklines: [base('breakline-a', { kind: 'EDGE' as const, pointRefs: ['spot-a', 'spot-b'] })], drainagePaths: [base('drainage-a', { pointRefs: ['spot-d', 'spot-c'], outletRef: 'outlet-a', flowDirection: 'DOWNHILL' as const })], outlets: [outlet] },
    hardscape: [base('hardscape-a', { kind: 'PAVING' as const, boundary: [point(2, 2), point(18, 2), point(18, 8), point(2, 8), point(2, 2)], thicknessM: 0.12, maxSlopePercent: 3, accessibilityCriterionRef: 'authority-code' })], soilZones: [soil], plantingZones: [planting], plants: [plant],
    irrigation: { source, valves: [valve], zones: [zone], pipes: [pipe], emitters: [emitter], waterBudget: base('water-budget-a', { annualDemandM3: 100, sourceCapacityLpm: 40, climateInputRef: 'authority-hydraulic', approvalStatus: 'APPROVED' as const }) }, maintenance: { zones: [base('maintenance-zone-a', { objectRefs: ['planting-a', 'zone-a'], accessWidthM: 1.2, taskAuthorityRef: 'authority-maintenance' })], tasks: [base('maintenance-task-a', { zoneRef: 'maintenance-zone-a', taskCode: 'irrigation-inspection', intervalDays: 30, methodRef: 'authority-maintenance' })] }, authoritative: true,
  });
}

describe('landscape product qualification', () => {
  it('builds a current one-case receipt but stays HOLD without external evidence', () => {
    const result = qualifyLandscapeProduct(validContract());
    expect(result.status).toBe('HOLD'); expect(result.productReceiptPromotionReady).toBe(false); expect(result.evaluation?.status).toBe('HOLD');
    expect(result.verification.axisEvidence.every(axis => axis.caseCount === 1)).toBe(true); expect(result.blockers.some(blocker => blocker.includes('irrigation-hydraulics'))).toBe(true);
  });
  it('rejects caller hash substitution and stale or detached common manifests', () => {
    const contract = validContract();
    const spoof = qualifyLandscapeProduct(contract, { geometryOrModelSha256: 'c'.repeat(64) });
    expect(spoof.blockers).toContain('caller_hash_mismatch:geometryOrModelSha256');
    const detached = qualifyLandscapeProduct(contract, { authorityManifest: { projectRevision: { id: 'old', sha256: H } } as never, deliverableManifest: { schema: 'bad' } as never });
    expect(detached.status).toBe('HOLD'); expect(detached.blockers).toEqual(expect.arrayContaining(['authority_manifest_revision_mismatch', expect.stringContaining('deliverable_manifest:')]));
  });
  it('cannot spoof PRODUCT_QUALIFIED with one synthetic case and no campaigns/reviews/pilots', () => {
    const result = qualifyLandscapeProduct(validContract(), { claimedState: 'PRODUCT_QUALIFIED' });
    expect(result.evaluation?.eligibleState).not.toBe('PRODUCT_QUALIFIED'); expect(result.evaluation?.status).toBe('HOLD'); expect(result.receipt?.pilots).toEqual([]);
  });
  it('keeps the stable entry point alias', () => expect(qualifyLandscapeSite).toBe(qualifyLandscapeProduct));
});
