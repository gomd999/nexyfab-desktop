import { createHash } from 'node:crypto';
import {
  hashLandscapeProductContract,
  validateLandscapeProductContract,
  type LandscapeProductContract,
  type LandscapeRevision,
} from './contract';

/** Native schedules are deterministic projections of the clean-room contract.
 * They do not claim survey, catalogue, hydraulic, IFC, or professional proof. */
export const LANDSCAPE_NATIVE_ARTIFACT_SCHEMA = 'nexyfab.landscape.native-artifacts.v1' as const;
type Sha256 = string;
export interface LandscapeNativeBindingHeader {
  revision: LandscapeRevision;
  modelSha256: Sha256;
  coordinate: { frameId: string; frameSha256: Sha256; crs: string; horizontalDatum: string; verticalDatum: string; epoch: string };
  terrain: { bindingId: string; bindingSha256: Sha256; civilSurfaceId: string; civilSurfaceRevision: LandscapeRevision; civilSurfaceSha256: Sha256 };
}
export interface LandscapeNativeArtifactExpectations {
  revision?: LandscapeRevision;
  modelSha256?: Sha256;
  coordinateFrameSha256?: Sha256;
  terrainSha256?: Sha256;
  expectedBindings?: { revision?: LandscapeRevision; modelSha256?: Sha256; coordinate?: Partial<LandscapeNativeBindingHeader['coordinate']>; terrain?: Partial<LandscapeNativeBindingHeader['terrain']> };
}
export interface LandscapeNativeArtifactOptions extends LandscapeNativeArtifactExpectations {}
export interface LandscapeNativeArtifact {
  schema: typeof LANDSCAPE_NATIVE_ARTIFACT_SCHEMA;
  domain: 'landscape';
  status: 'GENERATED_WITH_HOLDS';
  binding: LandscapeNativeBindingHeader;
  geometry: {
    siteBoundary: Array<{ x: number; y: number }>;
    grading: { spotGrades: Array<{ id: string; x: number; y: number; z: number }>; breaklines: Array<{ id: string; pointRefs: string[] }>; drainagePaths: Array<{ id: string; pointRefs: string[]; outletRef: string }> };
    hardscape: Array<{ id: string; kind: string; boundary: Array<{ x: number; y: number }> }>;
    planting: Array<{ id: string; boundary: Array<{ x: number; y: number }> }>;
    plants: Array<{ id: string; plantingZoneRef: string; speciesId: string; x: number; y: number }>;
  };
  schedules: {
    grading: Array<{ id: string; spotCount: number; breaklineCount: number; drainagePathCount: number }>;
    hardscape: Array<{ id: string; kind: string; areaM2: number; thicknessM: number; maxSlopePercent: number }>;
    soil: Array<{ id: string; areaM2: number; depthM: number; derivedVolumeM3: number; declaredVolumeM3: number; soilTypeRef: string }>;
    planting: Array<{ id: string; areaM2: number; soilZoneRef: string; irrigationZoneRef: string; plantCount: number }>;
    irrigation: { source: { id: string; maxFlowLpm: number; pressureKPa: number }; valves: Array<{ id: string; zoneRef: string; ratedFlowLpm: number }>; zones: Array<{ id: string; designFlowLpm: number; annualWaterBudgetM3: number }>; pipes: Array<{ id: string; fromRef: string; toRef: string; lengthM: number; designFlowLpm: number }>; emitters: Array<{ id: string; valveRef: string; plantCount: number; flowLpm: number }> };
    maintenance: { zones: Array<{ id: string; objectCount: number; accessWidthM: number }>; tasks: Array<{ id: string; zoneRef: string; taskCode: string; intervalDays: number }> };
  };
  quantities: {
    siteAreaM2: number;
    hardscapeAreaM2: number;
    soilDerivedVolumeM3: number;
    plantingAreaM2: number;
    plantCount: number;
    irrigationPipeLengthM: number;
    emitterFlowLpm: number;
    waterBudget: { annualDemandM3: number; zoneDemandM3: number; sourceCapacityLpm: number; status: 'DECLARED_ONLY'; reason: 'EXTERNAL_HYDRAULIC_AND_CLIMATE_EVIDENCE_NOT_GENERATED' };
  };
  limitations: readonly ['EXTERNAL_IFC_NOT_GENERATED', 'EXTERNAL_SURVEY_NOT_GENERATED', 'EXTERNAL_CATALOG_NOT_GENERATED', 'EXTERNAL_HYDRAULIC_EVIDENCE_NOT_GENERATED', 'PROFESSIONAL_REVIEW_NOT_GENERATED'];
  artifactSha256: Sha256;
}

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
const sha256 = (value: unknown): Sha256 => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const finiteNonNegative = (value: number, path: string): void => { if (!Number.isFinite(value) || value < 0) throw new Error(`landscape_artifact:invalid_derived_quantity:${path}`); };
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; };
const equalRevision = (a: LandscapeRevision | undefined, b: LandscapeRevision): boolean => !!a && a.id === b.id && a.sha256 === b.sha256;
const polygonArea = (polygon: readonly { x: number; y: number }[]): number => Math.abs(polygon.slice(0, -1).reduce((sum, point, index) => { const next = polygon[index + 1]!; return sum + point.x * next.y - next.x * point.y; }, 0) / 2);
function expectedBindings(options: LandscapeNativeArtifactOptions): LandscapeNativeArtifactExpectations {
  return options.expectedBindings ? { ...options, ...options.expectedBindings } : options;
}
function checkExpected(header: LandscapeNativeBindingHeader, options: LandscapeNativeArtifactOptions): void {
  const expected = expectedBindings(options);
  if (expected.revision && !equalRevision(expected.revision, header.revision)) throw new Error('landscape_artifact:stale_revision_binding');
  if (expected.modelSha256 && expected.modelSha256 !== header.modelSha256) throw new Error('landscape_artifact:stale_model_binding');
  if (expected.coordinateFrameSha256 && expected.coordinateFrameSha256 !== header.coordinate.frameSha256) throw new Error('landscape_artifact:stale_coordinate_binding');
  if (expected.terrainSha256 && expected.terrainSha256 !== header.terrain.bindingSha256) throw new Error('landscape_artifact:stale_terrain_binding');
  if (expected.expectedBindings?.coordinate?.frameSha256 && expected.expectedBindings.coordinate.frameSha256 !== header.coordinate.frameSha256) throw new Error('landscape_artifact:stale_coordinate_binding');
  if (expected.expectedBindings?.terrain?.bindingSha256 && expected.expectedBindings.terrain.bindingSha256 !== header.terrain.bindingSha256) throw new Error('landscape_artifact:stale_terrain_binding');
}

export function generateLandscapeNativeArtifacts(input: unknown, options: LandscapeNativeArtifactOptions = {}): LandscapeNativeArtifact {
  const issues = validateLandscapeProductContract(input);
  if (issues.length) throw new Error(`landscape_artifact:invalid_contract:${issues.join(',')}`);
  const contract = input as LandscapeProductContract;
  const frame = contract.authority.coordinateFrame;
  const terrain = contract.authority.terrainBinding;
  const binding: LandscapeNativeBindingHeader = {
    revision: { ...contract.identity.revision }, modelSha256: contract.identity.contentSha256,
    coordinate: { frameId: frame.id, frameSha256: frame.contentSha256, crs: frame.crs, horizontalDatum: frame.horizontalDatum, verticalDatum: frame.verticalDatum, epoch: frame.epoch },
    terrain: { bindingId: terrain.id, bindingSha256: terrain.contentSha256, civilSurfaceId: terrain.civilSurfaceId, civilSurfaceRevision: { ...terrain.civilSurfaceRevision }, civilSurfaceSha256: terrain.civilSurfaceSha256 },
  };
  checkExpected(binding, options);
  const geometry = {
    siteBoundary: contract.siteBoundary.polygon.map((point) => ({ ...point })),
    grading: { spotGrades: contract.grading.spotGrades.map((item) => ({ id: item.id, ...item.point })), breaklines: contract.grading.breaklines.map((item) => ({ id: item.id, pointRefs: [...item.pointRefs] })), drainagePaths: contract.grading.drainagePaths.map((item) => ({ id: item.id, pointRefs: [...item.pointRefs], outletRef: item.outletRef })) },
    hardscape: contract.hardscape.map((item) => ({ id: item.id, kind: item.kind, boundary: item.boundary.map((point) => ({ ...point })) })),
    planting: contract.plantingZones.map((item) => ({ id: item.id, boundary: item.boundary.map((point) => ({ ...point })) })),
    plants: contract.plants.map((item) => ({ id: item.id, plantingZoneRef: item.plantingZoneRef, speciesId: item.speciesId, ...item.point })),
  };
  const hardscape = contract.hardscape.map((item) => ({ id: item.id, kind: item.kind, areaM2: polygonArea(item.boundary), thicknessM: item.thicknessM, maxSlopePercent: item.maxSlopePercent }));
  const soil = contract.soilZones.map((item) => ({ id: item.id, areaM2: polygonArea(item.boundary), depthM: item.depthM, derivedVolumeM3: polygonArea(item.boundary) * item.depthM, declaredVolumeM3: item.volumeM3, soilTypeRef: item.soilTypeRef }));
  const planting = contract.plantingZones.map((item) => ({ id: item.id, areaM2: polygonArea(item.boundary), soilZoneRef: item.soilZoneRef, irrigationZoneRef: item.irrigationZoneRef, plantCount: contract.plants.filter((plant) => plant.plantingZoneRef === item.id).length }));
  const irrigation = { source: { id: contract.irrigation.source.id, maxFlowLpm: contract.irrigation.source.maxFlowLpm, pressureKPa: contract.irrigation.source.pressureKPa }, valves: contract.irrigation.valves.map((item) => ({ id: item.id, zoneRef: item.zoneRef, ratedFlowLpm: item.ratedFlowLpm })), zones: contract.irrigation.zones.map((item) => ({ id: item.id, designFlowLpm: item.designFlowLpm, annualWaterBudgetM3: item.waterBudgetM3PerYear })), pipes: contract.irrigation.pipes.map((item) => ({ id: item.id, fromRef: item.fromRef, toRef: item.toRef, lengthM: item.lengthM, designFlowLpm: item.designFlowLpm })), emitters: contract.irrigation.emitters.map((item) => ({ id: item.id, valveRef: item.valveRef, plantCount: item.plantRefs.length, flowLpm: item.flowLpm })) };
  const schedules = {
    grading: [{ id: 'grading-package', spotCount: contract.grading.spotGrades.length, breaklineCount: contract.grading.breaklines.length, drainagePathCount: contract.grading.drainagePaths.length }],
    hardscape, soil, planting, irrigation,
    maintenance: { zones: contract.maintenance.zones.map((item) => ({ id: item.id, objectCount: item.objectRefs.length, accessWidthM: item.accessWidthM })), tasks: contract.maintenance.tasks.map((item) => ({ id: item.id, zoneRef: item.zoneRef, taskCode: item.taskCode, intervalDays: item.intervalDays })) },
  };
  const quantities = {
    siteAreaM2: polygonArea(contract.siteBoundary.polygon), hardscapeAreaM2: hardscape.reduce((sum, item) => sum + item.areaM2, 0), soilDerivedVolumeM3: soil.reduce((sum, item) => sum + item.derivedVolumeM3, 0), plantingAreaM2: planting.reduce((sum, item) => sum + item.areaM2, 0), plantCount: contract.plants.length, irrigationPipeLengthM: irrigation.pipes.reduce((sum, item) => sum + item.lengthM, 0), emitterFlowLpm: irrigation.emitters.reduce((sum, item) => sum + item.flowLpm, 0),
    waterBudget: { annualDemandM3: contract.irrigation.waterBudget.annualDemandM3, zoneDemandM3: irrigation.zones.reduce((sum, item) => sum + item.annualWaterBudgetM3, 0), sourceCapacityLpm: contract.irrigation.waterBudget.sourceCapacityLpm, status: 'DECLARED_ONLY' as const, reason: 'EXTERNAL_HYDRAULIC_AND_CLIMATE_EVIDENCE_NOT_GENERATED' as const },
  };
  for (const [key, value] of Object.entries(quantities)) if (key !== 'waterBudget') finiteNonNegative(value as number, `quantities.${key}`);
  const artifactWithoutHash = { schema: LANDSCAPE_NATIVE_ARTIFACT_SCHEMA, domain: 'landscape' as const, status: 'GENERATED_WITH_HOLDS' as const, binding, geometry, schedules, quantities, limitations: ['EXTERNAL_IFC_NOT_GENERATED', 'EXTERNAL_SURVEY_NOT_GENERATED', 'EXTERNAL_CATALOG_NOT_GENERATED', 'EXTERNAL_HYDRAULIC_EVIDENCE_NOT_GENERATED', 'PROFESSIONAL_REVIEW_NOT_GENERATED'] as const };
  const artifact = { ...artifactWithoutHash, artifactSha256: sha256(artifactWithoutHash) } as LandscapeNativeArtifact;
  return deepFreeze(artifact);
}

export function hashLandscapeNativeArtifacts(artifact: LandscapeNativeArtifact): Sha256 {
  const { artifactSha256: _ignored, ...withoutHash } = artifact;
  return sha256(withoutHash);
}
