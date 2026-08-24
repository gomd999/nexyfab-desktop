import { describe, expect, it } from 'vitest';
import { createCivilSiteAccessRoadDrainageContract, hashCivilElevationGrid, type CivilSiteAccessRoadDrainageContract } from './contract';
import { qualifyCivilProduct, qualifyCivilSiteAccessRoadDrainage } from './qualify';

const H = 'a'.repeat(64);
const revision = { id: 'civil-r1', sha256: H };
const source = (id: string) => ({ sourceId: id, sourceRef: `original:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const, sourceRevision: revision });
const input = <T extends Record<string, unknown>>(values: T) => ({ source: source(`criteria-${Object.keys(values).join('-')}`), inputSha256: H, declaredOnly: true as const, values });

function validContract(): CivilSiteAccessRoadDrainageContract {
  const points = [
    { id: 'p1', point: { x: 0, y: 0, z: 100 }, source: source('p1'), contentSha256: H, sourceRevision: revision }, { id: 'p2', point: { x: 10, y: 0, z: 99.5 }, source: source('p2'), contentSha256: H, sourceRevision: revision },
    { id: 'p3', point: { x: 10, y: 10, z: 99 }, source: source('p3'), contentSha256: H, sourceRevision: revision }, { id: 'p4', point: { x: 0, y: 10, z: 99.5 }, source: source('p4'), contentSha256: H, sourceRevision: revision }, { id: 'pc', point: { x: 5, y: 5, z: 99.5 }, source: source('pc'), contentSha256: H, sourceRevision: revision },
  ];
  const tri = (id: string, surface: 'existing' | 'proposed', vertexPointIds: [string, string, string], neighbors: string[]) => ({ id, surface, vertexPointIds, neighborTriangleIds: neighbors, source: source(id), contentSha256: H, sourceRevision: revision });
  const existing = [tri('e1', 'existing', ['p1', 'p2', 'pc'], ['e2']), tri('e2', 'existing', ['p2', 'p3', 'pc'], ['e1']), tri('e3', 'existing', ['p3', 'p4', 'pc'], ['e4']), tri('e4', 'existing', ['p4', 'p1', 'pc'], ['e3'])];
  const proposed = existing.map(item => ({ ...item, id: item.id.replace('e', 'q'), surface: 'proposed' as const, neighborTriangleIds: item.neighborTriangleIds.map(id => id.replace('e', 'q')) }));
  const entity = (id: string) => ({ source: source(id), contentSha256: H, sourceRevision: revision });
  const section = (id: string, station: number) => ({ id, station, samples: [{ offsetM: -5, elevationM: 100 }, { offsetM: 5, elevationM: 100 }], ...entity(id) });
  const node = (id: string, kind: 'inlet' | 'outfall', z: number) => ({ id, kind, point: { x: kind === 'inlet' ? 0 : 10, y: 2, z }, ...entity(id) });
  const earth = (id: string, kind: 'existing' | 'proposed', triangleIds: string[]) => ({ id, kind, triangleIds, ...entity(id) });
  const grid = (id: string, surfaceId: string, elevationsM: number[]) => { const values = { origin: { x: 0, y: 0 }, cellSizeM: 1, rows: 2, columns: 2, elevationsM }; return { id, surfaceId, ...values, gridSha256: hashCivilElevationGrid(values), ...entity(id) }; };
  return createCivilSiteAccessRoadDrainageContract({
    schema: 'nexyfab.civil.site-access-road-drainage.v1', units: { length: 'm', area: 'm2', volume: 'm3', slope: '%' }, authoritative: true,
    identity: { id: 'civil-site-01', revision }, authority: { survey: source('survey'), coordinateReference: { horizontalCrs: 'EPSG:0000', verticalDatum: 'VD-LOCAL', epoch: '2024', controlPointIds: ['p1', 'p2'], source: source('crs') } },
    criteria: { alignment: input({ maxGradePercent: 8, minRadiusM: 1, maxSuperelevationPercent: 8 }), profile: input({ maxGradePercent: 8, minVerticalCurveLengthM: 10, maxStationGapM: 200 }), corridor: input({ leftWidthM: 5, rightWidthM: 5, targetCrossfallPercent: 2, maxSideSlopePercent: 33 }), earthwork: input({ maxCutDepthM: 5, maxFillDepthM: 5, balanceToleranceM3: 100 }), drainage: input({ designFlowM3S: 0.1, maxVelocityMS: 2, minCoverM: 1, allowablePondingDepthM: 0.1 }) },
    surveyPoints: points, breaklines: [{ id: 'b1', kind: 'boundary', pointIds: ['p1', 'p2'], ...entity('b1') }], tinTriangles: [...existing, ...proposed],
    alignmentSegments: [{ id: 'a1', kind: 'line', startStation: 0, endStation: 100, startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 }, radiusM: null, ...entity('a1') }], profilePoints: [{ id: 'v0', kind: 'PVI', station: 0, elevationM: 100, ...entity('v0') }, { id: 'v1', kind: 'PVI', station: 100, elevationM: 99, ...entity('v1') }], verticalCurves: [{ id: 'vc1', startStation: 40, endStation: 60, startElevationM: 99.6, endElevationM: 99.4, lengthM: 20, ...entity('vc1') }], crossSections: [section('s1', 0), section('s2', 100)],
    corridorAssemblies: [{ id: 'co1', alignmentSegmentIds: ['a1'], crossSectionIds: ['s1', 's2'], targets: [{ id: 'width1', kind: 'width', value: 10, surfaceTriangleIds: ['e1'] }], ...entity('co1') }], catchments: [{ id: 'ca1', areaM2: 100, runoffCoefficientPercent: 50, outletNodeId: 'n1', ...entity('ca1') }], drainageNodes: [node('n1', 'inlet', 100), node('n2', 'outfall', 99)], pipes: [{ id: 'pi1', fromNodeId: 'n1', toNodeId: 'n2', lengthM: 10, diameterM: 1, slopePercent: 10, capacityM3S: 1, coverM: 1, ...entity('pi1') }], outfalls: [{ id: 'of1', nodeId: 'n2', dischargeElevationM: 99, ...entity('of1') }],
    earthworkSurfaces: [earth('exs', 'existing', ['e1', 'e2', 'e3', 'e4']), earth('prs', 'proposed', ['q1', 'q2', 'q3', 'q4'])], gridBindings: [grid('g1', 'exs', [100, 100, 100, 100]), grid('g2', 'prs', [99.5, 100.5, 99.5, 100.5])], constructionStages: [{ id: 'st1', name: 'earthwork', dependsOnStageIds: [], objectIds: ['co1'], ...entity('st1') }, { id: 'st2', name: 'drainage', dependsOnStageIds: ['st1'], objectIds: ['pi1'], ...entity('st2') }],
  });
}

describe('civil product qualification', () => {
  it('builds reproducible earthwork and a current one-case receipt but stays HOLD by external policy', () => {
    const result = qualifyCivilProduct(validContract());
    expect(result.status).toBe('HOLD'); expect(result.productReceiptPromotionReady).toBe(false); expect(result.evaluation?.status).toBe('HOLD');
    expect(result.verification.axisEvidence.every(axis => axis.caseCount === 1)).toBe(true); expect(result.artifact?.quantities.earthwork.status).toBe('CALCULATED');
  });
  it('rejects caller hash substitution and stale or detached common manifests', () => {
    const contract = validContract();
    const spoof = qualifyCivilProduct(contract, { semanticModelSha256: 'b'.repeat(64) });
    expect(spoof.blockers).toContain('caller_hash_mismatch:semanticModelSha256');
    const detached = qualifyCivilProduct(contract, { authorityManifest: { projectRevision: { id: 'old', sha256: H } } as never, deliverableManifest: { schema: 'bad' } as never });
    expect(detached.status).toBe('HOLD'); expect(detached.blockers).toEqual(expect.arrayContaining(['authority_manifest_revision_mismatch', expect.stringContaining('deliverable_manifest:')]));
  });
  it('cannot spoof PRODUCT_QUALIFIED with one synthetic case and no campaigns/reviews/pilots', () => {
    const result = qualifyCivilProduct(validContract(), { claimedState: 'PRODUCT_QUALIFIED' });
    expect(result.evaluation?.eligibleState).not.toBe('PRODUCT_QUALIFIED'); expect(result.evaluation?.status).toBe('HOLD'); expect(result.receipt?.pilots).toEqual([]);
  });
  it('keeps the stable entry point alias', () => expect(qualifyCivilSiteAccessRoadDrainage).toBe(qualifyCivilProduct));
});
