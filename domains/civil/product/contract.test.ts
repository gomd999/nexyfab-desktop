import { describe, expect, it } from 'vitest';
import {
  CIVIL_PRODUCT_CONTRACT_SCHEMA,
  createCivilSiteAccessRoadDrainageContract,
  hashCivilElevationGrid,
  hashCivilSiteAccessRoadDrainageContract,
  validateCivilSiteAccessRoadDrainageContract,
  type CivilProvenance,
  type CivilRevision,
} from './contract';

const h = (n: number) => n.toString(16).padStart(64, '0');
const revision: CivilRevision = { id: 'civil-r1', sha256: h(1) };
const source = (id: string, origin: CivilProvenance['origin'] = 'ORIGINAL'): CivilProvenance => ({
  sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: h(id.length + 2), rightsReceiptSha256: h(id.length + 3),
  origin, rightsStatus: 'APPROVED', authorityStatus: 'APPROVED', sourceRevision: revision,
});
const entity = (id: string) => ({ contentSha256: h(id.length + 10), sourceRevision: revision, source: source(id) });

function input() {
  const points = [
    { id: 'p0', point: { x: 0, y: 0, z: 10 }, ...entity('p0') },
    { id: 'p1', point: { x: 20, y: 0, z: 10 }, ...entity('p1') },
    { id: 'p2', point: { x: 20, y: 20, z: 11 }, ...entity('p2') },
    { id: 'p3', point: { x: 0, y: 20, z: 11 }, ...entity('p3') },
  ];
  const triangles = [
    { id: 'te', surface: 'existing' as const, vertexPointIds: ['p0', 'p1', 'p2'] as [string, string, string], neighborTriangleIds: [], ...entity('te') },
    { id: 'tp', surface: 'proposed' as const, vertexPointIds: ['p0', 'p2', 'p3'] as [string, string, string], neighborTriangleIds: [], ...entity('tp') },
  ];
  const authorityInput = <T extends Record<string, number>>(values: T, id: string) => ({ source: source(id, 'PUBLIC_STANDARD_FACT'), inputSha256: h(id.length + 4), declaredOnly: true as const, values });
  const grid = (id: string, surfaceId: string, elevationsM: number[]) => {
    const values = { origin: { x: 0, y: 0 }, cellSizeM: 1, rows: 20, columns: 20, elevationsM };
    return { id, surfaceId, ...values, gridSha256: hashCivilElevationGrid(values), ...entity(id) };
  };
  return {
    schema: CIVIL_PRODUCT_CONTRACT_SCHEMA,
    identity: { id: 'site-road-001', revision },
    units: { length: 'm' as const, area: 'm2' as const, volume: 'm3' as const, slope: '%' as const },
    authority: {
      survey: source('survey'),
      coordinateReference: { horizontalCrs: 'EPSG:0000-local', verticalDatum: 'local-bm', epoch: '2025-01-01', controlPointIds: ['p0'], source: source('crs') },
    },
    criteria: {
      alignment: authorityInput({ maxGradePercent: 8, minRadiusM: 15, maxSuperelevationPercent: 6 }, 'criteria-alignment'),
      profile: authorityInput({ maxGradePercent: 8, minVerticalCurveLengthM: 20, maxStationGapM: 100 }, 'criteria-profile'),
      corridor: authorityInput({ leftWidthM: 4, rightWidthM: 4, targetCrossfallPercent: 2, maxSideSlopePercent: 33 }, 'criteria-corridor'),
      earthwork: authorityInput({ maxCutDepthM: 5, maxFillDepthM: 5, balanceToleranceM3: 100 }, 'criteria-earthwork'),
      drainage: authorityInput({ designFlowM3S: 0.5, maxVelocityMS: 3, minCoverM: 0.6, allowablePondingDepthM: 0.1 }, 'criteria-drainage'),
    },
    surveyPoints: points,
    breaklines: [{ id: 'bl-edge', kind: 'boundary' as const, pointIds: ['p0', 'p1', 'p2'], ...entity('bl-edge') }],
    tinTriangles: triangles,
    alignmentSegments: [{ id: 'a0', kind: 'line' as const, startStation: 0, endStation: 20, startPoint: { x: 0, y: 0 }, endPoint: { x: 20, y: 0 }, radiusM: null, ...entity('a0') }],
    profilePoints: [
      { id: 'pvi0', kind: 'PVI' as const, station: 0, elevationM: 10, ...entity('pvi0') },
      { id: 'pvi1', kind: 'PVI' as const, station: 20, elevationM: 11, ...entity('pvi1') },
    ],
    verticalCurves: [{ id: 'vc0', startStation: 0, endStation: 20, startElevationM: 10, endElevationM: 11, lengthM: 20, ...entity('vc0') }],
    crossSections: [{ id: 'xs0', station: 10, samples: [{ offsetM: -4, elevationM: 10 }, { offsetM: 4, elevationM: 10 }], ...entity('xs0') }],
    corridorAssemblies: [{ id: 'cor0', alignmentSegmentIds: ['a0'], crossSectionIds: ['xs0'], targets: [{ id: 'target0', kind: 'surface' as const, value: 0, surfaceTriangleIds: ['tp'] }], ...entity('cor0') }],
    catchments: [{ id: 'cat0', areaM2: 400, runoffCoefficientPercent: 60, outletNodeId: 'n-in', ...entity('cat0') }],
    drainageNodes: [
      { id: 'n-in', kind: 'inlet' as const, point: { x: 10, y: 0, z: 10 }, ...entity('n-in') },
      { id: 'n-out', kind: 'outfall' as const, point: { x: 20, y: 0, z: 9 }, ...entity('n-out') },
    ],
    pipes: [{ id: 'pipe0', fromNodeId: 'n-in', toNodeId: 'n-out', lengthM: 10, diameterM: 0.3, slopePercent: 2, capacityM3S: 1, coverM: 0.8, ...entity('pipe0') }],
    outfalls: [{ id: 'out0', nodeId: 'n-out', dischargeElevationM: 9, ...entity('out0') }],
    earthworkSurfaces: [
      { id: 'surface-existing', kind: 'existing' as const, triangleIds: ['te'], ...entity('surface-existing') },
      { id: 'surface-proposed', kind: 'proposed' as const, triangleIds: ['tp'], ...entity('surface-proposed') },
    ],
    gridBindings: [grid('grid-existing', 'surface-existing', Array(400).fill(10)), grid('grid-proposed', 'surface-proposed', Array(400).fill(10.1))],
    constructionStages: [
      { id: 'stage-survey', name: 'survey and setout', dependsOnStageIds: [], objectIds: ['surface-existing'], ...entity('stage-survey') },
      { id: 'stage-build', name: 'construct drainage', dependsOnStageIds: ['stage-survey'], objectIds: ['pipe0', 'surface-proposed'], ...entity('stage-build') },
    ],
    authoritative: true as const,
  };
}

describe('civil site access road and drainage contract', () => {
  it('accepts a complete strict contract and verifies the project content hash', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    expect(validateCivilSiteAccessRoadDrainageContract(contract)).toEqual([]);
    expect(contract.identity.contentSha256).toBe(hashCivilSiteAccessRoadDrainageContract(contract));
  });

  it('blocks preview/synthetic authority, copied-unverified facts, and stale hidden edits', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    const candidate = structuredClone(contract);
    candidate.authority.survey.sourceRef = 'preview:survey';
    candidate.criteria.drainage.source.sourceRef = 'synthetic:hydraulic';
    candidate.identity.revision = { id: 'civil-r2', sha256: h(99) };
    expect(validateCivilSiteAccessRoadDrainageContract(candidate)).toEqual(expect.arrayContaining([
      'authority.survey.sourceRef', 'criteria.drainage.source.sourceRef', 'identity.contentSha256:mismatch',
    ]));
  });

  it('rejects dangling refs, degenerate/non-manifold TINs, station discontinuity, wrong drainage direction, and stage cycles', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    const candidate = structuredClone(contract);
    candidate.breaklines[0]!.pointIds = ['p0', 'missing-point'];
    candidate.tinTriangles[1]!.vertexPointIds = ['p0', 'p0', 'p2'];
    candidate.alignmentSegments[0]!.endStation = -1;
    candidate.profilePoints[1]!.station = 0;
    candidate.pipes[0]!.fromNodeId = 'missing-node';
    candidate.constructionStages[0]!.dependsOnStageIds = ['stage-build'];
    expect(validateCivilSiteAccessRoadDrainageContract(candidate)).toEqual(expect.arrayContaining([
      'breaklines[0].pointIds', 'tinTriangles[1].vertexPointIds', 'alignmentSegments[0]:station_range',
      'profilePoints:station_order:pvi1', 'pipes[0]:direction_ref', 'constructionStages:cycle:stage-survey',
    ]));
  });

  it('requires every authoritative collection and both existing/proposed surfaces', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    const candidate = structuredClone(contract);
    candidate.verticalCurves = [];
    candidate.earthworkSurfaces = candidate.earthworkSurfaces.filter(surface => surface.kind === 'existing');
    expect(validateCivilSiteAccessRoadDrainageContract(candidate)).toEqual(expect.arrayContaining([
      'verticalCurves:count',
      'earthworkSurfaces:required_kind_missing:proposed',
    ]));
  });

  it('binds every authority source revision and prevents cross-surface neighbors or global ID reuse', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    const stale = structuredClone(contract); stale.criteria.drainage.source.sourceRevision = { id: 'old', sha256: h(8) };
    expect(validateCivilSiteAccessRoadDrainageContract(stale)).toContain('criteria.drainage.source.sourceRevision:mismatch');
    const crossSurface = structuredClone(contract); crossSurface.tinTriangles[0]!.neighborTriangleIds = ['tp'];
    expect(validateCivilSiteAccessRoadDrainageContract(crossSurface)).toContain('tinTriangles:te:neighbor_surface_mismatch:tp');
    const duplicate = structuredClone(contract); duplicate.pipes[0]!.id = duplicate.drainageNodes[0]!.id;
    expect(validateCivilSiteAccessRoadDrainageContract(duplicate)).toContain('pipes:global_id_duplicate:n-in');
  });

  it('binds paired earthwork elevations to their grid hash and identical layout', () => {
    const contract = createCivilSiteAccessRoadDrainageContract(input());
    const tampered = structuredClone(contract); tampered.gridBindings[0]!.elevationsM[0] = 999;
    expect(validateCivilSiteAccessRoadDrainageContract(tampered)).toContain('gridBindings[0].gridSha256:mismatch');
    const layout = structuredClone(contract); layout.gridBindings[1]!.origin.x = 1; layout.gridBindings[1]!.gridSha256 = hashCivilElevationGrid(layout.gridBindings[1]!);
    expect(validateCivilSiteAccessRoadDrainageContract(layout)).toContain('gridBindings:layout_mismatch');
  });
});
