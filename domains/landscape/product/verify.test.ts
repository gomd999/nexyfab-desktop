import { describe, expect, it } from 'vitest';
import {
  createLandscapeProductContract,
  hashLandscapeObject,
  type LandscapeProductContract,
} from './contract';
import {
  LANDSCAPE_CHECK_IDS,
  verifyLandscapeProduct,
  type LandscapeCheckId,
  type LandscapeExternalEvidence,
  type LandscapeVerificationOptions,
} from './verify';

const H = 'a'.repeat(64); const revision = { id: 'plaza-r1', sha256: 'b'.repeat(64) };
const provenance = (id: string) => ({ sourceId: id, sourceRef: `client:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'CLIENT_PROVIDED' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const });
const stamp = <T extends Record<string, unknown>>(value: T) => ({ ...value, contentSha256: hashLandscapeObject(value) });
const base = <T extends Record<string, unknown>>(id: string, extra: T) => stamp({ id, revision, provenance: provenance(id), ...extra });
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
    schema: 'nexyfab.landscape.small-plaza-courtyard.v1', identity: { projectId: 'plaza-courtyard', revision },
    units: { length: 'm', area: 'm2', volume: 'm3', flow: 'lpm', pressure: 'kPa', slope: '%' },
    authority: {
      coordinateFrame: base('coordinate-frame-a', { kind: 'APPROVED_CARTESIAN' as const, crs: 'project-local', horizontalDatum: 'client-grid', verticalDatum: 'client-benchmark', epoch: '2026-01-01', origin: { x: 0, y: 0, z: 0 }, rotationDeg: 0, reviewStatus: 'APPROVED' as const }),
      terrainBinding: base('terrain-binding-a', { civilSurfaceId: 'civil-surface-a', civilSurfaceRevision: revision, civilSurfaceSha256: H, drainageOutletId: 'civil-outlet-a', drainageOutletSha256: H, approvedUse: true as const }),
      client: base('authority-client', { subject: 'CLIENT' as const, values: { projectBrief: 'plaza courtyard', accessibleRouteWidthM: 1.5 } }),
      code: base('authority-code', { subject: 'CODE' as const, values: { jurisdiction: 'project-jurisdiction', maxSlopePercent: 5 } }),
      hydraulic: base('authority-hydraulic', { subject: 'HYDRAULIC' as const, values: { sourcePressureKPa: 250, annualWaterLimitM3: 100 } }),
      catalog: base('authority-catalog', { subject: 'CATALOG' as const, values: { supplierRevision: 'supplier-r1' } }),
      maintenance: base('authority-maintenance', { subject: 'MAINTENANCE' as const, values: { inspectionIntervalDays: 30 } }),
    },
    siteBoundary: base('site-boundary-a', { polygon: [point(0, 0), point(20, 0), point(20, 16), point(0, 16), point(0, 0)] }),
    grading: { spotGrades: spots, breaklines: [base('breakline-a', { kind: 'EDGE' as const, pointRefs: ['spot-a', 'spot-b'] })], drainagePaths: [base('drainage-a', { pointRefs: ['spot-d', 'spot-c'], outletRef: 'outlet-a', flowDirection: 'DOWNHILL' as const })], outlets: [outlet] },
    hardscape: [base('hardscape-a', { kind: 'PAVING' as const, boundary: [point(2, 2), point(18, 2), point(18, 8), point(2, 8), point(2, 2)], thicknessM: 0.12, maxSlopePercent: 3, accessibilityCriterionRef: 'authority-code' })],
    soilZones: [soil], plantingZones: [planting], plants: [plant],
    irrigation: { source, valves: [valve], zones: [zone], pipes: [pipe], emitters: [emitter], waterBudget: base('water-budget-a', { annualDemandM3: 100, sourceCapacityLpm: 40, climateInputRef: 'authority-hydraulic', approvalStatus: 'APPROVED' as const }) },
    maintenance: { zones: [base('maintenance-zone-a', { objectRefs: ['planting-a', 'zone-a'], accessWidthM: 1.2, taskAuthorityRef: 'authority-maintenance' })], tasks: [base('maintenance-task-a', { zoneRef: 'maintenance-zone-a', taskCode: 'irrigation-inspection', intervalDays: 30, methodRef: 'authority-maintenance' })] },
    authoritative: true,
  });
}

function evidence(contract: LandscapeProductContract, checkId: LandscapeCheckId, coordinateAuthoritySha256: string): LandscapeExternalEvidence {
  return { status: 'PASS', sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256, resultSha256: H, validatorId: `independent-${checkId}`, validatorVersion: 'v1', reviewerId: 'reviewer-1', reason: 'independent current receipt' };
}

describe('landscape product verification', () => {
  it('holds an internally valid current revision until independent authority is supplied', () => {
    const result = verifyLandscapeProduct(validContract());
    expect(result.status).toBe('HOLD');
    expect(result.axisEvidence.map(axis => axis.axis)).toEqual(['terrain-grading', 'planting', 'mature-clearance', 'irrigation-hydraulics', 'water-budget', 'quantity-consistency', 'drawing-consistency']);
    expect(result.axisEvidence.find(axis => axis.axis === 'terrain-grading')?.status).toBe('PASS');
    expect(result.axisEvidence.find(axis => axis.axis === 'planting')?.status).toBe('PASS');
    expect(result.productReceiptPromotionReady).toBe(false);
  });

  it('keeps complete external receipts on HOLD until the site model binding is independently validated', () => {
    const contract = validContract(); const baseline = verifyLandscapeProduct(contract); const coordinate = baseline.coordinateAuthoritySha256!;
    const externalIds: LandscapeCheckId[] = ['irrigation-hydraulics', 'quantity-consistency', 'drawing-consistency', 'site-model-roundtrip', 'catalog-authority', 'code-authority', 'professional-review'];
    const externalEvidence = Object.fromEntries(externalIds.map(id => [id, evidence(contract, id, coordinate)])) as LandscapeVerificationOptions['externalEvidence'];
    const result = verifyLandscapeProduct(contract, { externalEvidence });
    expect(result.status).toBe('HOLD'); expect(result.currentRevisionVerified).toBe(false); expect(result.receipts.find(receipt => receipt.checkId === 'site-model-roundtrip')?.reason).toBe('site_model_binding_not_run'); expect(result.axisEvidence.every(axis => axis.caseCount === 1)).toBe(true); expect(result.productReceiptPromotionReady).toBe(false);
  });

  it('marks malformed and stale evidence as non-verifying', () => {
    const contract = validContract(); const baseline = verifyLandscapeProduct(contract);
    const stale = { ...evidence(contract, 'catalog-authority', baseline.coordinateAuthoritySha256!), sourceRevision: { id: 'plaza-r0', sha256: H } };
    const staleResult = verifyLandscapeProduct(contract, { externalEvidence: { 'catalog-authority': stale } });
    expect(staleResult.receipts.find(receipt => receipt.checkId === 'catalog-authority')?.status).toBe('STALE');
    const malformedResult = verifyLandscapeProduct(contract, { externalEvidence: { 'catalog-authority': { status: 'PASS' } as unknown as LandscapeExternalEvidence } });
    expect(malformedResult.receipts.find(receipt => receipt.checkId === 'catalog-authority')?.status).toBe('HOLD');
  });

  it('does not let external PASS override a mature-clearance failure', () => {
    const contract = validContract(); const broken = createLandscapeProductContract({ ...contract, identity: { projectId: contract.identity.projectId, revision }, plants: contract.plants.map(plant => { const changed = { ...plant, matureCanopyDiameterM: 40 }; return { ...changed, contentSha256: hashLandscapeObject(changed) }; }) });
    const baseline = verifyLandscapeProduct(broken);
    const result = verifyLandscapeProduct(broken, { externalEvidence: { 'professional-review': evidence(broken, 'professional-review', baseline.coordinateAuthoritySha256!) } });
    expect(result.status).toBe('FAIL'); expect(result.axisEvidence.find(axis => axis.axis === 'mature-clearance')?.status).toBe('FAIL');
  });

  it('rejects disconnected irrigation pipe topology and mature canopy collisions', () => {
    const contract = validContract();
    expect(() => createLandscapeProductContract({ ...contract, identity: { projectId: contract.identity.projectId, revision }, irrigation: { ...contract.irrigation, pipes: contract.irrigation.pipes.map(pipe => { const changed = { ...pipe, fromRef: 'valve-a', toRef: 'water-source-a' }; return { ...changed, contentSha256: hashLandscapeObject(changed) }; }) } })).toThrow('irrigation.pipes:disconnected');

    const secondPlant = base('plant-b', { plantingZoneRef: 'planting-a', speciesId: 'species:tree-b', supplierId: 'supplier:b', supplierProvenance: provenance('supplier-b'), point: point(7, 12), matureCanopyDiameterM: 4, matureRootDiameterM: 1 });
    const collision = createLandscapeProductContract({ ...contract, identity: { projectId: contract.identity.projectId, revision }, plants: [...contract.plants, secondPlant], irrigation: { ...contract.irrigation, emitters: contract.irrigation.emitters.map(emitter => { const changed = { ...emitter, plantRefs: [...emitter.plantRefs, 'plant-b'] }; return { ...changed, contentSha256: hashLandscapeObject(changed) }; }) } });
    const result = verifyLandscapeProduct(collision);
    expect(result.receipts.find(receipt => receipt.checkId === 'mature-clearance')?.reason).toContain('mature_canopy_collision');
  });

  it('keeps the check registry stable and all product promotion disabled', () => {
    const result = verifyLandscapeProduct(validContract());
    expect(result.receipts.map(receipt => receipt.checkId)).toEqual(LANDSCAPE_CHECK_IDS);
    expect(result.productReceiptPromotionReady).toBe(false);
  });
});
