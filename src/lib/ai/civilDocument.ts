import type { DomainDocument } from './unifiedDesignProject';

type V2 = [number, number];
type V3 = [number, number, number];

export interface CivilCrs { epsg: number; horizontalDatum: string; verticalDatum: string; units: 'm' }
export interface CivilSourceEvidence { id: string; kind: 'survey' | 'gis' | 'geotechnical' | 'utility' | 'authority'; sourceRef: string; capturedAt: string; accuracyMm?: number }
export interface CivilSurveyControl { id: string; name: string; positionM: V3; order: 'horizontal' | 'vertical' | 'combined'; evidenceId: string }
export interface CivilPoint { id: string; positionM: V3; code?: string; evidenceId?: string }
export interface CivilSurface { id: string; kind: 'existing' | 'proposed'; pointIds: string[]; triangles: [string, string, string][]; breaklines?: string[][]; sourceEvidenceIds: string[] }
export type CivilAlignmentSegment =
  | { id: string; kind: 'line'; startM: V2; endM: V2; startStationM: number }
  | { id: string; kind: 'arc'; centerM: V2; radiusM: number; startAngleDeg: number; endAngleDeg: number; clockwise: boolean; startStationM: number }
  | { id: string; kind: 'spiral'; startM: V2; endM: V2; startRadiusM: number | null; endRadiusM: number | null; startStationM: number };
export interface CivilAlignment { id: string; name: string; segments: CivilAlignmentSegment[] }
export interface CivilProfilePoint { stationM: number; elevationM: number }
export interface CivilProfile { id: string; alignmentId: string; kind: 'existing' | 'proposed'; points: CivilProfilePoint[] }
export interface CivilCrossSection { id: string; alignmentId: string; stationM: number; points: { offsetM: number; elevationM: number; code: string }[] }
export interface CivilCorridor { id: string; alignmentId: string; profileId: string; assemblyCode: string; targetSurfaceIds: string[]; startStationM: number; endStationM: number }
export interface CivilDrainageNode { id: string; kind: 'inlet' | 'manhole' | 'outfall'; positionM: V3; invertElevationM: number; rimElevationM: number }
export interface CivilDrainageLink { id: string; fromNodeId: string; toNodeId: string; diameterMm: number; lengthM: number; material: string }
export interface CivilCatchment { id: string; boundaryM: V2[]; outletNodeId: string; runoffCoefficient: number }
export interface CivilStructure { id: string; kind: 'retaining_wall' | 'culvert' | 'bridge' | 'utility'; alignmentId?: string; stationM?: number; sourceEvidenceIds: string[] }
export interface CivilStage { id: string; name: string; dependsOnStageIds: string[]; objectIds: string[] }

export interface CivilDocument {
  schema: 'nexyfab.civil.v1';
  revision: number;
  coordinateSystemId: string;
  crs: CivilCrs;
  sourceEvidence: CivilSourceEvidence[];
  surveyControls: CivilSurveyControl[];
  points: CivilPoint[];
  surfaces: CivilSurface[];
  alignments: CivilAlignment[];
  profiles: CivilProfile[];
  crossSections: CivilCrossSection[];
  corridors: CivilCorridor[];
  drainageNodes: CivilDrainageNode[];
  drainageLinks: CivilDrainageLink[];
  catchments: CivilCatchment[];
  structures: CivilStructure[];
  stages: CivilStage[];
}

const finite2 = (point: V2) => point.length === 2 && point.every(Number.isFinite);
const finite3 = (point: V3) => point.length === 3 && point.every(Number.isFinite);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const sortedStrictly = (values: number[]) => values.every((value, index) => index === 0 || value > values[index - 1]!);

function allCivilObjects(document: CivilDocument) {
  return [
    ...document.sourceEvidence, ...document.surveyControls, ...document.points, ...document.surfaces,
    ...document.alignments, ...document.alignments.flatMap(item => item.segments), ...document.profiles,
    ...document.crossSections, ...document.corridors, ...document.drainageNodes, ...document.drainageLinks,
    ...document.catchments, ...document.structures, ...document.stages,
  ];
}

function segmentStart(segment: CivilAlignmentSegment): V2 {
  if (segment.kind !== 'arc') return segment.startM;
  const angle = segment.startAngleDeg * Math.PI / 180;
  return [segment.centerM[0] + Math.cos(angle) * segment.radiusM, segment.centerM[1] + Math.sin(angle) * segment.radiusM];
}

function segmentEnd(segment: CivilAlignmentSegment): V2 {
  if (segment.kind !== 'arc') return segment.endM;
  const angle = segment.endAngleDeg * Math.PI / 180;
  return [segment.centerM[0] + Math.cos(angle) * segment.radiusM, segment.centerM[1] + Math.sin(angle) * segment.radiusM];
}

export function validateCivilDocument(document: CivilDocument): string[] {
  const issues: string[] = [], ids = new Set<string>();
  const register = (id: string) => { if (!id.trim() || ids.has(id)) issues.push(`Duplicate or empty civil id ${id || '(empty)'}.`); ids.add(id); };
  if (document.schema !== 'nexyfab.civil.v1' || !Number.isSafeInteger(document.revision) || document.revision < 0 || !document.coordinateSystemId.trim()) issues.push('Invalid civil header.');
  if (!Number.isSafeInteger(document.crs.epsg) || document.crs.epsg <= 0 || !document.crs.horizontalDatum.trim() || !document.crs.verticalDatum.trim() || document.crs.units !== 'm') issues.push('Civil CRS requires EPSG, horizontal datum, vertical datum, and metre units.');
  allCivilObjects(document).forEach(item => register(item.id));
  const evidence = new Set(document.sourceEvidence.map(item => item.id));
  document.sourceEvidence.forEach(item => { if (!item.sourceRef.trim() || Number.isNaN(Date.parse(item.capturedAt)) || (item.accuracyMm !== undefined && !positive(item.accuracyMm))) issues.push(`${item.id}: invalid civil source evidence.`); });
  document.surveyControls.forEach(item => { if (!item.name.trim() || !finite3(item.positionM) || !evidence.has(item.evidenceId)) issues.push(`${item.id}: invalid survey control or evidence.`); });
  document.points.forEach(item => { if (!finite3(item.positionM) || (item.evidenceId !== undefined && !evidence.has(item.evidenceId))) issues.push(`${item.id}: invalid civil point or evidence.`); });
  const pointIds = new Set(document.points.map(item => item.id));
  document.surfaces.forEach(item => {
    if (item.pointIds.length < 3 || item.pointIds.some(id => !pointIds.has(id)) || item.sourceEvidenceIds.some(id => !evidence.has(id))) issues.push(`${item.id}: invalid surface points or evidence.`);
    if (item.triangles.some(triangle => new Set(triangle).size !== 3 || triangle.some(id => !item.pointIds.includes(id)))) issues.push(`${item.id}: invalid TIN triangle.`);
    if (item.breaklines?.some(line => line.length < 2 || line.some(id => !item.pointIds.includes(id)))) issues.push(`${item.id}: invalid surface breakline.`);
  });
  const alignmentIds = new Set(document.alignments.map(item => item.id));
  document.alignments.forEach(alignment => {
    if (!alignment.name.trim() || !alignment.segments.length || !sortedStrictly(alignment.segments.map(item => item.startStationM))) issues.push(`${alignment.id}: invalid alignment name or station order.`);
    alignment.segments.forEach((segment, index) => {
      if (!Number.isFinite(segment.startStationM)) issues.push(`${segment.id}: invalid start station.`);
      if (segment.kind === 'line' && (!finite2(segment.startM) || !finite2(segment.endM) || Math.hypot(segment.endM[0] - segment.startM[0], segment.endM[1] - segment.startM[1]) === 0)) issues.push(`${segment.id}: invalid line segment.`);
      if (segment.kind === 'arc' && (!finite2(segment.centerM) || !positive(segment.radiusM) || !Number.isFinite(segment.startAngleDeg) || !Number.isFinite(segment.endAngleDeg) || segment.startAngleDeg === segment.endAngleDeg)) issues.push(`${segment.id}: invalid arc segment.`);
      if (segment.kind === 'spiral' && (
        !finite2(segment.startM)
        || !finite2(segment.endM)
        || (segment.startRadiusM !== null && !positive(segment.startRadiusM))
        || (segment.endRadiusM !== null && !positive(segment.endRadiusM))
      )) issues.push(`${segment.id}: invalid spiral segment.`);
      const previous = alignment.segments[index - 1];
      if (previous) { const a = segmentEnd(previous), b = segmentStart(segment); if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.001) issues.push(`${segment.id}: alignment is not position-continuous within 1 mm.`); }
    });
  });
  const profileIds = new Set(document.profiles.map(item => item.id));
  document.profiles.forEach(item => { if (!alignmentIds.has(item.alignmentId) || item.points.length < 2 || !sortedStrictly(item.points.map(point => point.stationM)) || item.points.some(point => !Number.isFinite(point.elevationM))) issues.push(`${item.id}: invalid profile or station order.`); });
  document.crossSections.forEach(item => { if (!alignmentIds.has(item.alignmentId) || !Number.isFinite(item.stationM) || item.points.length < 2 || item.points.some(point => !Number.isFinite(point.offsetM) || !Number.isFinite(point.elevationM) || !point.code.trim())) issues.push(`${item.id}: invalid cross section.`); });
  const surfaceIds = new Set(document.surfaces.map(item => item.id));
  document.corridors.forEach(item => { if (!alignmentIds.has(item.alignmentId) || !profileIds.has(item.profileId) || !item.assemblyCode.trim() || item.targetSurfaceIds.some(id => !surfaceIds.has(id)) || !Number.isFinite(item.startStationM) || !Number.isFinite(item.endStationM) || item.endStationM <= item.startStationM) issues.push(`${item.id}: invalid corridor references or station range.`); });
  const nodeIds = new Set(document.drainageNodes.map(item => item.id));
  document.drainageNodes.forEach(item => { if (!finite3(item.positionM) || !Number.isFinite(item.invertElevationM) || !Number.isFinite(item.rimElevationM) || item.rimElevationM <= item.invertElevationM) issues.push(`${item.id}: invalid drainage node elevations.`); });
  document.drainageLinks.forEach(item => { if (!nodeIds.has(item.fromNodeId) || !nodeIds.has(item.toNodeId) || item.fromNodeId === item.toNodeId || !positive(item.diameterMm) || !positive(item.lengthM) || !item.material.trim()) issues.push(`${item.id}: invalid drainage link.`); });
  document.catchments.forEach(item => { if (item.boundaryM.length < 3 || item.boundaryM.some(point => !finite2(point)) || !nodeIds.has(item.outletNodeId) || !Number.isFinite(item.runoffCoefficient) || item.runoffCoefficient < 0 || item.runoffCoefficient > 1) issues.push(`${item.id}: invalid catchment.`); });
  document.structures.forEach(item => { if ((item.alignmentId !== undefined && !alignmentIds.has(item.alignmentId)) || (item.stationM !== undefined && !Number.isFinite(item.stationM)) || item.sourceEvidenceIds.some(id => !evidence.has(id))) issues.push(`${item.id}: invalid civil structure reference.`); });
  const stageIds = new Set(document.stages.map(item => item.id)), objectIds = new Set(allCivilObjects(document).map(item => item.id));
  document.stages.forEach(item => { if (!item.name.trim() || item.dependsOnStageIds.some(id => !stageIds.has(id) || id === item.id) || item.objectIds.some(id => !objectIds.has(id))) issues.push(`${item.id}: invalid construction stage.`); });
  const visit = (id: string, path: Set<string>): boolean => path.has(id) || (document.stages.find(item => item.id === id)?.dependsOnStageIds.some(parent => visit(parent, new Set(path).add(id))) ?? false);
  if (document.stages.some(item => visit(item.id, new Set()))) issues.push('Civil construction stages contain a dependency cycle.');
  return issues;
}

export type CivilReleaseGate = 'crs' | 'survey_control' | 'existing_surface' | 'alignment_profile' | 'drainage' | 'source_provenance';
export function civilReleaseReadiness(document: CivilDocument): Record<CivilReleaseGate, boolean> {
  return {
    crs: Number.isSafeInteger(document.crs.epsg) && Boolean(document.crs.verticalDatum.trim()),
    survey_control: document.surveyControls.length >= 2,
    existing_surface: document.surfaces.some(item => item.kind === 'existing' && item.triangles.length > 0),
    alignment_profile: document.alignments.length > 0 && document.alignments.every(item => document.profiles.some(profile => profile.alignmentId === item.id && profile.kind === 'proposed')),
    drainage: document.drainageLinks.length > 0 && document.drainageLinks.every(item => document.drainageNodes.some(node => node.id === item.fromNodeId) && document.drainageNodes.some(node => node.id === item.toNodeId)),
    source_provenance: document.sourceEvidence.length > 0 && allCivilObjects(document).length > 0,
  };
}

export function civilDomainDocument(model: CivilDocument, id = 'civil'): DomainDocument<CivilDocument> {
  return { id, domain: 'civil', profileId: 'civil', profileVersion: 1, schema: model.schema, revision: model.revision, coordinateSystemId: model.coordinateSystemId, representations: ['tin', 'alignment', 'surface', 'graph', 'gis'], objectIds: allCivilObjects(model).map(item => item.id), payload: structuredClone(model) };
}
