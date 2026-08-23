import type { DomainDocument } from './unifiedDesignProject';

type V2 = [number, number];
type V3 = [number, number, number];

export interface LandscapeSourceEvidence { id: string; kind: 'survey' | 'soil' | 'ecology' | 'nursery' | 'authority'; sourceRef: string; capturedAt: string }
export interface LandscapeTerrainReference { civilDocumentId: string; surfaceId: string; civilRevision: number }
/**
 * A deterministic landscape-side edit to the civil terrain reference.
 *
 * This is intentionally a semantic modifier, not a claim that a TIN/grading
 * kernel has been rebuilt.  The modifier remains revision-bound to the
 * landscape document and is therefore safe to carry through the agent
 * transaction until a real terrain solver/exporter consumes it.
 */
export interface LandscapeTerrainModifier { id: string; boundaryM: V2[]; deltaM: number }
export interface LandscapePlant { id: string; speciesCode: string; positionM: V3; installedHeightM: number; matureCanopyDiameterM: number; rootZoneDiameterM: number; spacingM: number; evidenceIds: string[] }
export interface LandscapePlantingZone { id: string; boundaryM: V2[]; plantIds: string[]; soilVolumeId: string; targetCoveragePercent: number }
export interface LandscapeHardscape { id: string; kind: 'path' | 'plaza' | 'wall' | 'deck' | 'curb'; boundaryM: V2[]; material: string; slopePercent: number; accessible: boolean }
export interface LandscapeSoilVolume { id: string; boundaryM: V2[]; depthM: number; soilType: string; drainageClass: string }
export interface LandscapeIrrigationNode { id: string; kind: 'source' | 'valve' | 'emitter'; positionM: V3; pressureKpa?: number; flowLpm?: number }
export interface LandscapeIrrigationPipe { id: string; fromNodeId: string; toNodeId: string; diameterMm: number; lengthM: number }
export interface LandscapeIrrigationZone { id: string; valveNodeId: string; emitterNodeIds: string[]; plantingZoneIds: string[]; designFlowLpm: number }
export interface LandscapeDrainagePath { id: string; pointsM: V3[]; outletObjectId: string; minimumSlopePercent: number }
export interface LandscapeMaintenanceZone { id: string; boundaryM: V2[]; accessWidthM: number; taskCodes: string[] }

export interface LandscapeDocument {
  schema: 'nexyfab.landscape.v1';
  revision: number;
  coordinateSystemId: string;
  terrain: LandscapeTerrainReference;
  terrainModifiers?: LandscapeTerrainModifier[];
  sourceEvidence: LandscapeSourceEvidence[];
  siteBoundaryM: V2[];
  plants: LandscapePlant[];
  plantingZones: LandscapePlantingZone[];
  hardscapes: LandscapeHardscape[];
  soilVolumes: LandscapeSoilVolume[];
  irrigationNodes: LandscapeIrrigationNode[];
  irrigationPipes: LandscapeIrrigationPipe[];
  irrigationZones: LandscapeIrrigationZone[];
  drainagePaths: LandscapeDrainagePath[];
  maintenanceZones: LandscapeMaintenanceZone[];
}

const finite2 = (point: V2) => point.length === 2 && point.every(Number.isFinite);
const finite3 = (point: V3) => point.length === 3 && point.every(Number.isFinite);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const polygonArea2 = (points: V2[]) => points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);
const polygonValid = (points: V2[]) => points.length >= 3 && points.every(finite2) && Math.abs(polygonArea2(points)) > 1e-12;
function pointInsideOrOnBoundary(point: V2, polygon: V2[]): boolean {
  if (!finite2(point) || !polygonValid(polygon)) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]!, b = polygon[index]!;
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    const onSegment = Math.abs(cross) <= 1e-9 && point[0] >= Math.min(a[0], b[0]) - 1e-9 && point[0] <= Math.max(a[0], b[0]) + 1e-9 && point[1] >= Math.min(a[1], b[1]) - 1e-9 && point[1] <= Math.max(a[1], b[1]) + 1e-9;
    if (onSegment) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const polygonInsideSite = (points: V2[], site: V2[]) => points.every(point => pointInsideOrOnBoundary(point, site));

function allLandscapeObjects(document: LandscapeDocument) {
  return [...document.sourceEvidence, ...(document.terrainModifiers ?? []), ...document.plants, ...document.plantingZones, ...document.hardscapes, ...document.soilVolumes, ...document.irrigationNodes, ...document.irrigationPipes, ...document.irrigationZones, ...document.drainagePaths, ...document.maintenanceZones];
}

export function validateLandscapeDocument(document: LandscapeDocument): string[] {
  const issues: string[] = [], ids = new Set<string>();
  const register = (id: string) => { if (!id.trim() || ids.has(id)) issues.push(`Duplicate or empty landscape id ${id || '(empty)'}.`); ids.add(id); };
  if (document.schema !== 'nexyfab.landscape.v1' || !Number.isSafeInteger(document.revision) || document.revision < 0 || !document.coordinateSystemId.trim() || !document.terrain.civilDocumentId.trim() || !document.terrain.surfaceId.trim() || !Number.isSafeInteger(document.terrain.civilRevision) || document.terrain.civilRevision < 0) issues.push('Invalid landscape header or terrain reference.');
  if (!polygonValid(document.siteBoundaryM)) issues.push('Landscape site boundary requires at least three finite points.');
  allLandscapeObjects(document).forEach(item => register(item.id));
  const evidence = new Set(document.sourceEvidence.map(item => item.id));
  document.sourceEvidence.forEach(item => { if (!item.sourceRef.trim() || Number.isNaN(Date.parse(item.capturedAt))) issues.push(`${item.id}: invalid landscape source evidence.`); });
  (document.terrainModifiers ?? []).forEach(item => {
    if (!polygonValid(item.boundaryM) || !polygonInsideSite(item.boundaryM, document.siteBoundaryM) || !Number.isFinite(item.deltaM)) issues.push(`${item.id}: invalid terrain modifier.`);
  });
  document.plants.forEach(item => { if (!item.speciesCode.trim() || !finite3(item.positionM) || !pointInsideOrOnBoundary([item.positionM[0], item.positionM[1]], document.siteBoundaryM) || !positive(item.installedHeightM) || !positive(item.matureCanopyDiameterM) || !positive(item.rootZoneDiameterM) || !positive(item.spacingM) || item.evidenceIds.some(id => !evidence.has(id))) issues.push(`${item.id}: invalid plant geometry or provenance.`); });
  const plantIds = new Set(document.plants.map(item => item.id)), soilIds = new Set(document.soilVolumes.map(item => item.id));
  document.plantingZones.forEach(item => { if (!polygonValid(item.boundaryM) || !polygonInsideSite(item.boundaryM, document.siteBoundaryM) || new Set(item.plantIds).size !== item.plantIds.length || item.plantIds.some(id => !plantIds.has(id)) || !soilIds.has(item.soilVolumeId) || !Number.isFinite(item.targetCoveragePercent) || item.targetCoveragePercent < 0 || item.targetCoveragePercent > 100) issues.push(`${item.id}: invalid planting zone.`); });
  document.hardscapes.forEach(item => { if (!polygonValid(item.boundaryM) || !polygonInsideSite(item.boundaryM, document.siteBoundaryM) || !item.material.trim() || !Number.isFinite(item.slopePercent) || Math.abs(item.slopePercent) > 50) issues.push(`${item.id}: invalid hardscape.`); });
  document.soilVolumes.forEach(item => { if (!polygonValid(item.boundaryM) || !polygonInsideSite(item.boundaryM, document.siteBoundaryM) || !positive(item.depthM) || !item.soilType.trim() || !item.drainageClass.trim()) issues.push(`${item.id}: invalid soil volume.`); });
  const nodeIds = new Set(document.irrigationNodes.map(item => item.id));
  document.irrigationNodes.forEach(item => { if (!finite3(item.positionM) || !pointInsideOrOnBoundary([item.positionM[0], item.positionM[1]], document.siteBoundaryM) || (item.pressureKpa !== undefined && !positive(item.pressureKpa)) || (item.flowLpm !== undefined && !positive(item.flowLpm)) || (item.kind === 'source' && (!positive(item.pressureKpa ?? 0) || !positive(item.flowLpm ?? 0)))) issues.push(`${item.id}: invalid irrigation node or source capacity.`); });
  document.irrigationPipes.forEach(item => { if (!nodeIds.has(item.fromNodeId) || !nodeIds.has(item.toNodeId) || item.fromNodeId === item.toNodeId || !positive(item.diameterMm) || !positive(item.lengthM)) issues.push(`${item.id}: invalid irrigation pipe.`); });
  const plantingZoneIds = new Set(document.plantingZones.map(item => item.id));
  const nodeById = new Map(document.irrigationNodes.map(item => [item.id, item]));
  document.irrigationZones.forEach(item => { if (nodeById.get(item.valveNodeId)?.kind !== 'valve' || new Set(item.emitterNodeIds).size !== item.emitterNodeIds.length || new Set(item.plantingZoneIds).size !== item.plantingZoneIds.length || item.emitterNodeIds.some(id => nodeById.get(id)?.kind !== 'emitter') || item.plantingZoneIds.some(id => !plantingZoneIds.has(id)) || !positive(item.designFlowLpm)) issues.push(`${item.id}: invalid irrigation zone.`); });
  document.drainagePaths.forEach(item => {
    const slopesValid = item.pointsM.every((point, index) => {
      const next = item.pointsM[index + 1];
      if (!next) return true;
      const horizontal = Math.hypot(next[0] - point[0], next[1] - point[1]);
      return horizontal > 0 && ((point[2] - next[2]) / horizontal) * 100 + 1e-9 >= item.minimumSlopePercent;
    });
    if (item.pointsM.length < 2 || item.pointsM.some(point => !finite3(point) || !pointInsideOrOnBoundary([point[0], point[1]], document.siteBoundaryM)) || !item.outletObjectId.trim() || !positive(item.minimumSlopePercent) || !slopesValid) issues.push(`${item.id}: invalid landscape drainage path.`);
  });
  document.maintenanceZones.forEach(item => { if (!polygonValid(item.boundaryM) || !polygonInsideSite(item.boundaryM, document.siteBoundaryM) || !positive(item.accessWidthM) || !item.taskCodes.length || new Set(item.taskCodes).size !== item.taskCodes.length || item.taskCodes.some(code => !code.trim())) issues.push(`${item.id}: invalid maintenance zone.`); });
  return issues;
}

export type LandscapeReleaseGate = 'terrain_revision' | 'plant_provenance' | 'soil_volume' | 'irrigation_capacity' | 'drainage' | 'maintenance_access';
export function landscapeReleaseReadiness(document: LandscapeDocument): Record<LandscapeReleaseGate, boolean> {
  const sources = document.irrigationNodes.filter(item => item.kind === 'source');
  const evidence = new Set(document.sourceEvidence.map(item => item.id));
  return {
    terrain_revision: Number.isSafeInteger(document.terrain.civilRevision) && document.terrain.civilRevision >= 0,
    plant_provenance: document.plants.length > 0 && document.plants.every(item => item.evidenceIds.length > 0 && item.evidenceIds.every(id => evidence.has(id))),
    soil_volume: document.plantingZones.length > 0 && document.plantingZones.every(item => document.soilVolumes.some(soil => soil.id === item.soilVolumeId)),
    irrigation_capacity: document.irrigationZones.length > 0 && sources.some(source => (source.flowLpm ?? 0) >= document.irrigationZones.reduce((sum, zone) => sum + zone.designFlowLpm, 0)),
    drainage: document.drainagePaths.length > 0 && document.drainagePaths.every(item => item.minimumSlopePercent > 0),
    maintenance_access: document.maintenanceZones.length > 0 && document.maintenanceZones.every(item => item.accessWidthM > 0),
  };
}

export function landscapeDomainDocument(model: LandscapeDocument, id = 'landscape'): DomainDocument<LandscapeDocument> {
  return { id, domain: 'landscape', profileId: 'landscape', profileVersion: 1, schema: model.schema, revision: model.revision, coordinateSystemId: model.coordinateSystemId, representations: ['surface', 'gis', 'graph', 'procedural'], objectIds: allLandscapeObjects(model).map(item => item.id), payload: structuredClone(model) };
}
