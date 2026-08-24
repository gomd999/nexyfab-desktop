import { describe, expect, it } from 'vitest';
import {
  createCivilSiteAccessRoadDrainageContract,
  hashCivilElevationGrid,
  type CivilSiteAccessRoadDrainageContract,
} from './contract';
import {
  CIVIL_CHECK_IDS,
  verifyCivilProduct,
  type CivilExternalEvidence,
} from './verify';

const H = 'a'.repeat(64);
const revision = { id: 'civil-r1', sha256: H };
const source = (id: string) => ({ sourceId: id, sourceRef: `original:${id}`, contentSha256: H, rightsReceiptSha256: H, origin: 'ORIGINAL' as const, rightsStatus: 'APPROVED' as const, authorityStatus: 'APPROVED' as const, sourceRevision: revision });
const input = <T extends Record<string, unknown>>(values: T) => ({ source: source(`criteria-${Object.keys(values).join('-')}`), inputSha256: H, declaredOnly: true as const, values });

function validContract(): CivilSiteAccessRoadDrainageContract {
  const points = [
    { id: 'p1', point: { x: 0, y: 0, z: 100 }, source: source('p1'), contentSha256: H, sourceRevision: revision },
    { id: 'p2', point: { x: 10, y: 0, z: 99.5 }, source: source('p2'), contentSha256: H, sourceRevision: revision },
    { id: 'p3', point: { x: 10, y: 10, z: 99 }, source: source('p3'), contentSha256: H, sourceRevision: revision },
    { id: 'p4', point: { x: 0, y: 10, z: 99.5 }, source: source('p4'), contentSha256: H, sourceRevision: revision },
    { id: 'pc', point: { x: 5, y: 5, z: 99.5 }, source: source('pc'), contentSha256: H, sourceRevision: revision },
  ];
  const tri = (id: string, surface: 'existing' | 'proposed', vertexPointIds: [string, string, string], neighbours: string[]) => ({ id, surface, vertexPointIds, neighborTriangleIds: neighbours, source: source(id), contentSha256: H, sourceRevision: revision });
  const existing = [tri('e1', 'existing', ['p1', 'p2', 'pc'], ['e2', 'e4', 'e3']), tri('e2', 'existing', ['p2', 'p3', 'pc'], ['e1', 'e3', 'e4']), tri('e3', 'existing', ['p3', 'p4', 'pc'], ['e1', 'e2', 'e4']), tri('e4', 'existing', ['p4', 'p1', 'pc'], ['e1', 'e2', 'e3'])];
  const proposed = existing.map(item => ({ ...item, id: item.id.replace('e', 'q'), surface: 'proposed' as const, neighborTriangleIds: item.neighborTriangleIds.map(id => id.replace('e', 'q')) }));
  const segment = { id: 'a1', kind: 'line' as const, startStation: 0, endStation: 100, startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 }, radiusM: null, source: source('a1'), contentSha256: H, sourceRevision: revision };
  const profilePoints = [0, 100].map((station, index) => ({ id: `v${index}`, kind: 'PVI' as const, station, elevationM: 100 - index, source: source(`v${index}`), contentSha256: H, sourceRevision: revision }));
  const section = (id: string, station: number) => ({ id, station, samples: [{ offsetM: -5, elevationM: 100 }, { offsetM: 5, elevationM: 100 }], source: source(id), contentSha256: H, sourceRevision: revision });
  const node = (id: string, kind: 'inlet' | 'outfall', z: number) => ({ id, kind, point: { x: kind === 'inlet' ? 0 : 10, y: 2, z }, source: source(id), contentSha256: H, sourceRevision: revision });
  const earth = (id: string, kind: 'existing' | 'proposed', triangleIds: string[]) => ({ id, kind, triangleIds, source: source(id), contentSha256: H, sourceRevision: revision });
  const grid = (id: string, surfaceId: string, elevationsM: number[]) => {
    const values = { origin: { x: 0, y: 0 }, cellSizeM: 1, rows: 2, columns: 2, elevationsM };
    return { id, surfaceId, ...values, gridSha256: hashCivilElevationGrid(values), source: source(id), contentSha256: H, sourceRevision: revision };
  };
  return createCivilSiteAccessRoadDrainageContract({
    schema: 'nexyfab.civil.site-access-road-drainage.v1', units: { length: 'm', area: 'm2', volume: 'm3', slope: '%' }, authoritative: true,
    authority: { survey: source('survey'), coordinateReference: { horizontalCrs: 'EPSG:0000', verticalDatum: 'VD-LOCAL', epoch: '2024', controlPointIds: ['p1', 'p2'], source: source('crs') } },
    criteria: { alignment: input({ maxGradePercent: 8, minRadiusM: 1, maxSuperelevationPercent: 8 }), profile: input({ maxGradePercent: 8, minVerticalCurveLengthM: 10, maxStationGapM: 200 }), corridor: input({ leftWidthM: 5, rightWidthM: 5, targetCrossfallPercent: 2, maxSideSlopePercent: 33 }), earthwork: input({ maxCutDepthM: 5, maxFillDepthM: 5, balanceToleranceM3: 100 }), drainage: input({ designFlowM3S: 0.1, maxVelocityMS: 2, minCoverM: 1, allowablePondingDepthM: 0.1 }) },
    surveyPoints: points,
    breaklines: [{ id: 'b1', kind: 'boundary', pointIds: ['p1', 'p2'], source: source('b1'), contentSha256: H, sourceRevision: revision }],
    tinTriangles: [...existing, ...proposed],
    alignmentSegments: [segment], profilePoints, verticalCurves: [{ id: 'vc1', startStation: 40, endStation: 60, startElevationM: 99.6, endElevationM: 99.4, lengthM: 20, source: source('vc1'), contentSha256: H, sourceRevision: revision }],
    crossSections: [section('s1', 0), section('s2', 100)],
    corridorAssemblies: [{ id: 'co1', alignmentSegmentIds: ['a1'], crossSectionIds: ['s1', 's2'], targets: [{ id: 'width1', kind: 'width', value: 10, surfaceTriangleIds: ['e1'] }], source: source('co1'), contentSha256: H, sourceRevision: revision }],
    catchments: [{ id: 'ca1', areaM2: 100, runoffCoefficientPercent: 50, outletNodeId: 'n1', source: source('ca1'), contentSha256: H, sourceRevision: revision }],
    drainageNodes: [node('n1', 'inlet', 100), node('n2', 'outfall', 99)],
    pipes: [{ id: 'pi1', fromNodeId: 'n1', toNodeId: 'n2', lengthM: 10, diameterM: 1, slopePercent: 10, capacityM3S: 1, coverM: 1, source: source('pi1'), contentSha256: H, sourceRevision: revision }],
    outfalls: [{ id: 'of1', nodeId: 'n2', dischargeElevationM: 99, source: source('of1'), contentSha256: H, sourceRevision: revision }],
    earthworkSurfaces: [earth('exs', 'existing', ['e1', 'e2', 'e3', 'e4']), earth('prs', 'proposed', ['q1', 'q2', 'q3', 'q4'])],
    gridBindings: [grid('g1', 'exs', [100, 100, 100, 100]), grid('g2', 'prs', [99.5, 100.5, 99.5, 100.5])],
    constructionStages: [{ id: 'st1', name: 'earthwork', dependsOnStageIds: [], objectIds: ['co1'], source: source('st1'), contentSha256: H, sourceRevision: revision }, { id: 'st2', name: 'drainage', dependsOnStageIds: ['st1'], objectIds: ['pi1'], source: source('st2'), contentSha256: H, sourceRevision: revision }],
    identity: { id: 'civil-site-01', revision },
  });
}

function evidence(contract: CivilSiteAccessRoadDrainageContract, checkId: CivilCheckId = 'survey-datum'): CivilExternalEvidence {
  const coordinateAuthoritySha256 = '0'.repeat(64); // replaced from the verifier result below
  return { status: 'PASS', sourceRevision: contract.identity.revision, modelSha256: contract.identity.contentSha256, coordinateAuthoritySha256, resultSha256: H, validatorId: `independent-${checkId}`, validatorVersion: 'v1', reviewerId: 'reviewer-1', reason: 'independent current receipt' };
}

describe('civil product verification', () => {
  it('holds a structurally valid current revision until external authority is supplied', () => {
    const result = verifyCivilProduct(validContract());
    expect(result.status).toBe('HOLD');
    expect(result.axisEvidence.map(axis => axis.axis)).toEqual(['survey-datum', 'surface', 'alignment-corridor', 'drainage-hydraulics', 'quantity-consistency', 'landxml-roundtrip']);
    expect(result.axisEvidence.find(axis => axis.axis === 'surface')?.status).toBe('PASS');
    expect(result.productReceiptPromotionReady).toBe(false);
  });

  it('accepts complete current external receipts only as one-case verification evidence', () => {
    const contract = validContract();
    const baseline = verifyCivilProduct(contract);
    const coordinate = baseline.coordinateAuthoritySha256!;
    const externalEvidence = Object.fromEntries(['survey-datum', 'drainage-hydraulics', 'quantity-consistency', 'landxml-roundtrip', 'professional-review'].map(id => [id, { ...evidence(contract, id as CivilCheckId), coordinateAuthoritySha256: coordinate }])) as CivilVerificationOptions['externalEvidence'];
    const result = verifyCivilProduct(contract, { externalEvidence });
    expect(result.status).toBe('PASS');
    expect(result.currentRevisionVerified).toBe(true);
    expect(result.axisEvidence.every(axis => axis.caseCount === 1)).toBe(true);
    expect(result.productReceiptPromotionReady).toBe(false);
  });

  it('marks stale and malformed evidence as non-verifying', () => {
    const contract = validContract();
    const baseline = verifyCivilProduct(contract);
    const stale = { ...evidence(contract), coordinateAuthoritySha256: baseline.coordinateAuthoritySha256!, sourceRevision: { id: 'civil-old', sha256: H } };
    const staleResult = verifyCivilProduct(contract, { externalEvidence: { 'survey-datum': stale } });
    expect(staleResult.receipts.find(receipt => receipt.checkId === 'survey-datum')?.status).toBe('STALE');
    const malformedResult = verifyCivilProduct(contract, { externalEvidence: { 'survey-datum': { status: 'PASS' } as unknown as CivilExternalEvidence } });
    expect(malformedResult.receipts.find(receipt => receipt.checkId === 'survey-datum')?.status).toBe('HOLD');
  });

  it('does not let an external PASS override an internal hydraulic failure', () => {
    const contract = validContract();
    const broken = createCivilSiteAccessRoadDrainageContract({ ...contract, identity: { id: contract.identity.id, revision }, pipes: contract.pipes.map(pipe => ({ ...pipe, slopePercent: 0 })) });
    const baseline = verifyCivilProduct(broken);
    const result = verifyCivilProduct(broken, { externalEvidence: { 'drainage-hydraulics': { ...evidence(broken, 'drainage-hydraulics'), coordinateAuthoritySha256: baseline.coordinateAuthoritySha256! } } });
    expect(result.status).toBe('FAIL');
    expect(result.axisEvidence.find(axis => axis.axis === 'drainage-hydraulics')?.status).toBe('FAIL');
  });

  it('fails earthwork when paired-grid depth exceeds the governed criterion', () => {
    const contract = validContract();
    const grids = contract.gridBindings.map(grid => {
      if (grid.surfaceId !== 'prs') return grid;
      const changed = { ...grid, elevationsM: [110, 110, 110, 110] };
      return { ...changed, gridSha256: hashCivilElevationGrid(changed) };
    });
    const broken = createCivilSiteAccessRoadDrainageContract({ ...contract, identity: { id: contract.identity.id, revision }, gridBindings: grids });
    const result = verifyCivilProduct(broken);
    expect(result.receipts.find(receipt => receipt.checkId === 'earthwork-grid')).toMatchObject({ status: 'FAIL', reason: 'earthwork_grid:earthwork_criteria_exceeded' });
    expect(result.axisEvidence.find(axis => axis.axis === 'quantity-consistency')?.status).toBe('FAIL');
  });
});

type CivilCheckId = typeof CIVIL_CHECK_IDS[number];
type CivilVerificationOptions = NonNullable<Parameters<typeof verifyCivilProduct>[1]>;
