import { createHash } from 'node:crypto';
import {
  calculateCivilEarthworkGrid,
  validateCivilSiteAccessRoadDrainageContract,
  type CivilPoint,
  type CivilRevision,
  type CivilSiteAccessRoadDrainageContract,
} from './contract';
import { hashCivilCoordinateAuthority } from './verify';

/** Deterministic native schedules are authored from the contract only.  They
 * are not an exchange-file or an external verification receipt. */
export const CIVIL_NATIVE_ARTIFACT_SCHEMA = 'nexyfab.civil.native-artifacts.v1' as const;
type Sha256 = string;
type CoordinateBinding = { horizontalCrs: string; verticalDatum: string; epoch: string; authoritySha256: Sha256 };
export interface CivilNativeBindingHeader {
  revision: CivilRevision;
  modelSha256: Sha256;
  coordinate: CoordinateBinding;
}
export interface CivilNativeArtifactExpectations {
  revision?: CivilRevision;
  modelSha256?: Sha256;
  coordinateAuthoritySha256?: Sha256;
  expectedBindings?: { revision?: CivilRevision; modelSha256?: Sha256; coordinate?: Partial<CoordinateBinding> };
}
export interface CivilNativeArtifactOptions extends CivilNativeArtifactExpectations {}
export interface CivilNativeArtifact {
  schema: typeof CIVIL_NATIVE_ARTIFACT_SCHEMA;
  domain: 'civil';
  status: 'GENERATED_WITH_HOLDS';
  binding: CivilNativeBindingHeader;
  geometry: {
    surveyPoints: Array<{ id: string; point: CivilPoint }>;
    breaklines: Array<{ id: string; kind: string; pointIds: string[] }>;
    tinTriangles: Array<{ id: string; surface: string; vertexPointIds: [string, string, string] }>;
  };
  schedules: {
    alignment: Array<{ id: string; kind: string; startStation: number; endStation: number; lengthM: number; radiusM: number | null }>;
    profile: Array<{ id: string; kind: string; station: number; elevationM: number }>;
    verticalCurves: Array<{ id: string; startStation: number; endStation: number; lengthM: number }>;
    crossSections: Array<{ id: string; station: number; sampleCount: number; offsetsM: number[] }>;
    corridor: Array<{ id: string; alignmentSegmentIds: string[]; crossSectionIds: string[]; targetCount: number }>;
    catchments: Array<{ id: string; areaM2: number; runoffCoefficientPercent: number; outletNodeId: string }>;
    drainage: Array<{ id: string; fromNodeId: string; toNodeId: string; lengthM: number; diameterM: number; capacityM3S: number; coverM: number }>;
    constructionStages: Array<{ id: string; name: string; dependsOnStageIds: string[]; objectIds: string[] }>;
  };
  quantities: {
    alignmentLengthM: number;
    corridorFootprintAreaM2: number;
    catchmentAreaM2: number;
    drainagePipeLengthM: number;
    drainagePipeInternalVolumeM3: number;
    earthwork: ReturnType<typeof calculateCivilEarthworkGrid> & { status: 'CALCULATED' };
  };
  limitations: readonly ['EXTERNAL_LANDXML_NOT_GENERATED', 'EXTERNAL_SURVEY_NOT_GENERATED'];
  artifactSha256: Sha256;
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): Sha256 => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const equalRevision = (a: CivilRevision | undefined, b: CivilRevision): boolean => !!a && a.id === b.id && a.sha256 === b.sha256;
const finiteNonNegative = (value: number, path: string): void => { if (!Number.isFinite(value) || value < 0) throw new Error(`civil_artifact:invalid_derived_quantity:${path}`); };
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };
function segmentLength(segment: CivilSiteAccessRoadDrainageContract['alignmentSegments'][number]): number {
  // Stationing is authoritative. Arc center/sweep are intentionally absent
  // from this contract, so a chord must not be misreported as curve length.
  return segment.endStation - segment.startStation;
}
function expectedBindings(options: CivilNativeArtifactOptions): CivilNativeArtifactExpectations {
  return options.expectedBindings ? { ...options, ...options.expectedBindings } : options;
}
function checkExpected(header: CivilNativeBindingHeader, options: CivilNativeArtifactOptions): void {
  const expected = expectedBindings(options);
  if (expected.revision && !equalRevision(expected.revision, header.revision)) throw new Error('civil_artifact:stale_revision_binding');
  if (expected.modelSha256 && expected.modelSha256 !== header.modelSha256) throw new Error('civil_artifact:stale_model_binding');
  if (expected.coordinateAuthoritySha256 && expected.coordinateAuthoritySha256 !== header.coordinate.authoritySha256) throw new Error('civil_artifact:stale_coordinate_binding');
  if (expected.expectedBindings?.coordinate?.authoritySha256 && expected.expectedBindings.coordinate.authoritySha256 !== header.coordinate.authoritySha256) throw new Error('civil_artifact:stale_coordinate_binding');
}

export function generateCivilNativeArtifacts(input: unknown, options: CivilNativeArtifactOptions = {}): CivilNativeArtifact {
  const issues = validateCivilSiteAccessRoadDrainageContract(input);
  if (issues.length) throw new Error(`civil_artifact:invalid_contract:${issues.join(',')}`);
  const contract = input as CivilSiteAccessRoadDrainageContract;
  const coordinate = contract.authority.coordinateReference;
  const binding: CivilNativeBindingHeader = {
    revision: { ...contract.identity.revision },
    modelSha256: contract.identity.contentSha256,
    coordinate: { horizontalCrs: coordinate.horizontalCrs, verticalDatum: coordinate.verticalDatum, epoch: coordinate.epoch, authoritySha256: hashCivilCoordinateAuthority(contract) },
  };
  checkExpected(binding, options);
  const alignment = contract.alignmentSegments.map((segment) => ({ id: segment.id, kind: segment.kind, startStation: segment.startStation, endStation: segment.endStation, lengthM: segmentLength(segment), radiusM: segment.radiusM }));
  const profile = contract.profilePoints.map((point) => ({ id: point.id, kind: point.kind, station: point.station, elevationM: point.elevationM }));
  const verticalCurves = contract.verticalCurves.map((curve) => ({ id: curve.id, startStation: curve.startStation, endStation: curve.endStation, lengthM: curve.lengthM }));
  const crossSections = contract.crossSections.map((section) => ({ id: section.id, station: section.station, sampleCount: section.samples.length, offsetsM: section.samples.map((sample) => sample.offsetM) }));
  const corridor = contract.corridorAssemblies.map((assembly) => ({ id: assembly.id, alignmentSegmentIds: [...assembly.alignmentSegmentIds], crossSectionIds: [...assembly.crossSectionIds], targetCount: assembly.targets.length }));
  const catchments = contract.catchments.map((catchment) => ({ id: catchment.id, areaM2: catchment.areaM2, runoffCoefficientPercent: catchment.runoffCoefficientPercent, outletNodeId: catchment.outletNodeId }));
  const drainage = contract.pipes.map((pipe) => ({ id: pipe.id, fromNodeId: pipe.fromNodeId, toNodeId: pipe.toNodeId, lengthM: pipe.lengthM, diameterM: pipe.diameterM, capacityM3S: pipe.capacityM3S, coverM: pipe.coverM }));
  const constructionStages = contract.constructionStages.map((stage) => ({ id: stage.id, name: stage.name, dependsOnStageIds: [...stage.dependsOnStageIds], objectIds: [...stage.objectIds] }));
  const quantities = {
    alignmentLengthM: alignment.reduce((sum, item) => sum + item.lengthM, 0),
    corridorFootprintAreaM2: alignment.reduce((sum, item) => sum + item.lengthM, 0) * (contract.criteria.corridor.values.leftWidthM + contract.criteria.corridor.values.rightWidthM),
    catchmentAreaM2: catchments.reduce((sum, item) => sum + item.areaM2, 0),
    drainagePipeLengthM: drainage.reduce((sum, item) => sum + item.lengthM, 0),
    drainagePipeInternalVolumeM3: drainage.reduce((sum, item) => sum + Math.PI * (item.diameterM / 2) ** 2 * item.lengthM, 0),
    earthwork: { status: 'CALCULATED' as const, ...calculateCivilEarthworkGrid(contract) },
  };
  for (const [key, value] of Object.entries(quantities)) if (key !== 'earthwork') finiteNonNegative(value as number, `quantities.${key}`);
  const artifactWithoutHash = {
    schema: CIVIL_NATIVE_ARTIFACT_SCHEMA, domain: 'civil' as const, status: 'GENERATED_WITH_HOLDS' as const, binding,
    geometry: { surveyPoints: contract.surveyPoints.map(({ id, point }) => ({ id, point: { ...point } })), breaklines: contract.breaklines.map(({ id, kind, pointIds }) => ({ id, kind, pointIds: [...pointIds] })), tinTriangles: contract.tinTriangles.map(({ id, surface, vertexPointIds }) => ({ id, surface, vertexPointIds: [...vertexPointIds] as [string, string, string] })) },
    schedules: { alignment, profile, verticalCurves, crossSections, corridor, catchments, drainage, constructionStages }, quantities,
    limitations: ['EXTERNAL_LANDXML_NOT_GENERATED', 'EXTERNAL_SURVEY_NOT_GENERATED'] as const,
  };
  const artifact = { ...artifactWithoutHash, artifactSha256: sha256(artifactWithoutHash) } as CivilNativeArtifact;
  return deepFreeze(artifact);
}

export function hashCivilNativeArtifacts(artifact: CivilNativeArtifact): Sha256 {
  const { artifactSha256: _ignored, ...withoutHash } = artifact;
  return sha256(withoutHash);
}
