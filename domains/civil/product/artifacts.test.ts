import { describe, expect, it } from 'vitest';
import { CIVIL_PRODUCT_CONTRACT_SCHEMA, createCivilSiteAccessRoadDrainageContract, hashCivilElevationGrid, type CivilProvenance, type CivilRevision } from './contract';
import { generateCivilNativeArtifacts, hashCivilNativeArtifacts } from './artifacts';
import { hashCivilCoordinateAuthority } from './verify';

const h = (n: number) => n.toString(16).padStart(64, '0');
const revision: CivilRevision = { id: 'civil-r1', sha256: h(1) };
const source = (id: string, origin: CivilProvenance['origin'] = 'ORIGINAL'): CivilProvenance => ({ sourceId: id, sourceRef: `rights-cleared://${id}`, contentSha256: h(id.length + 2), rightsReceiptSha256: h(id.length + 3), origin, rightsStatus: 'APPROVED', authorityStatus: 'APPROVED', sourceRevision: revision });
const entity = (id: string) => ({ contentSha256: h(id.length + 10), sourceRevision: revision, source: source(id) });
function contract() {
  const points = [
    { id: 'p0', point: { x: 0, y: 0, z: 10 }, ...entity('p0') }, { id: 'p1', point: { x: 20, y: 0, z: 10 }, ...entity('p1') },
    { id: 'p2', point: { x: 20, y: 20, z: 11 }, ...entity('p2') }, { id: 'p3', point: { x: 0, y: 20, z: 11 }, ...entity('p3') },
  ];
  const triangles = [{ id: 'te', surface: 'existing' as const, vertexPointIds: ['p0', 'p1', 'p2'] as [string, string, string], neighborTriangleIds: [], ...entity('te') }, { id: 'tp', surface: 'proposed' as const, vertexPointIds: ['p0', 'p2', 'p3'] as [string, string, string], neighborTriangleIds: [], ...entity('tp') }];
  const authorityInput = <T extends Record<string, number>>(values: T, id: string) => ({ source: source(id, 'PUBLIC_STANDARD_FACT'), inputSha256: h(id.length + 4), declaredOnly: true as const, values });
  const grid = (id: string, surfaceId: string, elevationsM: number[]) => {
    const values = { origin: { x: 0, y: 0 }, cellSizeM: 1, rows: 20, columns: 20, elevationsM };
    return { id, surfaceId, ...values, gridSha256: hashCivilElevationGrid(values), ...entity(id) };
  };
  return createCivilSiteAccessRoadDrainageContract({
    schema: CIVIL_PRODUCT_CONTRACT_SCHEMA, identity: { id: 'site-road-001', revision }, units: { length: 'm', area: 'm2', volume: 'm3', slope: '%' },
    authority: { survey: source('survey'), coordinateReference: { horizontalCrs: 'EPSG:0000-local', verticalDatum: 'local-bm', epoch: '2025-01-01', controlPointIds: ['p0'], source: source('crs') } },
    criteria: { alignment: authorityInput({ maxGradePercent: 8, minRadiusM: 15, maxSuperelevationPercent: 6 }, 'criteria-alignment'), profile: authorityInput({ maxGradePercent: 8, minVerticalCurveLengthM: 20, maxStationGapM: 100 }, 'criteria-profile'), corridor: authorityInput({ leftWidthM: 4, rightWidthM: 4, targetCrossfallPercent: 2, maxSideSlopePercent: 33 }, 'criteria-corridor'), earthwork: authorityInput({ maxCutDepthM: 5, maxFillDepthM: 5, balanceToleranceM3: 100 }, 'criteria-earthwork'), drainage: authorityInput({ designFlowM3S: 0.5, maxVelocityMS: 3, minCoverM: 0.6, allowablePondingDepthM: 0.1 }, 'criteria-drainage') },
    surveyPoints: points, breaklines: [{ id: 'bl-edge', kind: 'boundary', pointIds: ['p0', 'p1', 'p2'], ...entity('bl-edge') }], tinTriangles: triangles,
    alignmentSegments: [{ id: 'a0', kind: 'line', startStation: 0, endStation: 20, startPoint: { x: 0, y: 0 }, endPoint: { x: 20, y: 0 }, radiusM: null, ...entity('a0') }],
    profilePoints: [{ id: 'pvi0', kind: 'PVI', station: 0, elevationM: 10, ...entity('pvi0') }, { id: 'pvi1', kind: 'PVI', station: 20, elevationM: 11, ...entity('pvi1') }], verticalCurves: [{ id: 'vc0', startStation: 0, endStation: 20, startElevationM: 10, endElevationM: 11, lengthM: 20, ...entity('vc0') }], crossSections: [{ id: 'xs0', station: 10, samples: [{ offsetM: -4, elevationM: 10 }, { offsetM: 4, elevationM: 10 }], ...entity('xs0') }], corridorAssemblies: [{ id: 'cor0', alignmentSegmentIds: ['a0'], crossSectionIds: ['xs0'], targets: [{ id: 'target0', kind: 'surface', value: 0, surfaceTriangleIds: ['tp'] }], ...entity('cor0') }],
    catchments: [{ id: 'cat0', areaM2: 400, runoffCoefficientPercent: 60, outletNodeId: 'n-in', ...entity('cat0') }], drainageNodes: [{ id: 'n-in', kind: 'inlet', point: { x: 10, y: 0, z: 10 }, ...entity('n-in') }, { id: 'n-out', kind: 'outfall', point: { x: 20, y: 0, z: 9 }, ...entity('n-out') }], pipes: [{ id: 'pipe0', fromNodeId: 'n-in', toNodeId: 'n-out', lengthM: 10, diameterM: 0.3, slopePercent: 2, capacityM3S: 1, coverM: 0.8, ...entity('pipe0') }], outfalls: [{ id: 'out0', nodeId: 'n-out', dischargeElevationM: 9, ...entity('out0') }],
    earthworkSurfaces: [{ id: 'surface-existing', kind: 'existing', triangleIds: ['te'], ...entity('surface-existing') }, { id: 'surface-proposed', kind: 'proposed', triangleIds: ['tp'], ...entity('surface-proposed') }], gridBindings: [grid('grid-existing', 'surface-existing', Array(400).fill(10)), grid('grid-proposed', 'surface-proposed', Array(200).fill(9.9).concat(Array(200).fill(10.2)))], constructionStages: [{ id: 'stage-survey', name: 'survey and setout', dependsOnStageIds: [], objectIds: ['surface-existing'], ...entity('stage-survey') }, { id: 'stage-build', name: 'construct drainage', dependsOnStageIds: ['stage-survey'], objectIds: ['pipe0', 'surface-proposed'], ...entity('stage-build') }], authoritative: true,
  });
}

describe('civil native artifacts', () => {
  it('generates deterministic schedules, geometry, and reproducible paired-grid earthwork quantities', () => {
    const value = contract(); const artifact = generateCivilNativeArtifacts(value);
    expect(artifact.status).toBe('GENERATED_WITH_HOLDS'); expect(artifact.quantities.alignmentLengthM).toBe(20); expect(artifact.quantities.corridorFootprintAreaM2).toBe(160); expect(artifact.quantities.earthwork).toMatchObject({ status: 'CALCULATED', method: 'PAIRED_CELL_CENTER_GRID', cellCount: 400 });
    expect(artifact.quantities.earthwork.cutVolumeM3).toBeCloseTo(20); expect(artifact.quantities.earthwork.fillVolumeM3).toBeCloseTo(40); expect(artifact.quantities.earthwork.netVolumeM3).toBeCloseTo(20);
    expect(artifact.artifactSha256).toBe(hashCivilNativeArtifacts(artifact)); expect(generateCivilNativeArtifacts(value).artifactSha256).toBe(artifact.artifactSha256); expect(Object.isFrozen(artifact.binding)).toBe(true);
    expect(Object.isFrozen(value.surveyPoints[0]!.point)).toBe(false);
  });
  it('rejects invalid contracts and stale expected bindings before generation', () => {
    const value = contract(); expect(() => generateCivilNativeArtifacts({ ...value, authoritative: false })).toThrow(/invalid_contract/);
    expect(() => generateCivilNativeArtifacts(value, { expectedBindings: { revision: { id: 'old', sha256: h(9) } } })).toThrow('stale_revision_binding');
    expect(() => generateCivilNativeArtifacts(value, { coordinateAuthoritySha256: h(8) })).toThrow('stale_coordinate_binding');
    expect(hashCivilCoordinateAuthority(value)).toBe(value ? generateCivilNativeArtifacts(value).binding.coordinate.authoritySha256 : '');
  });
});
