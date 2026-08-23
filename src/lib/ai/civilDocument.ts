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
export interface CivilProfilePoint { id?: string; stationM: number; elevationM: number }
export interface CivilProfile { id: string; alignmentId: string; kind: 'existing' | 'proposed'; points: CivilProfilePoint[] }
/**
 * Bounded semantic vertical-curve contract.  This is intentionally a
 * profile-owned parameter record, not a native profile solid or code check.
 * Curves must reference a stable PVI id; legacy profiles may remain id-less
 * as long as they do not carry vertical curves.
 */
export interface CivilVerticalCurve {
  id: string;
  profileId: string;
  pviId: string;
  startStationM: number;
  endStationM: number;
  lengthM: number;
}
/** Bounded semantic superelevation region; no corridor application or code
 * compliance is implied by this record. */
export interface CivilSuperelevationRegion {
  id: string;
  alignmentId: string;
  startStationM: number;
  endStationM: number;
  leftCrossSlopePercent: number;
  rightCrossSlopePercent: number;
}
export interface CivilCrossSection { id: string; alignmentId: string; stationM: number; points: { offsetM: number; elevationM: number; code: string }[] }
export interface CivilCorridor { id: string; alignmentId: string; profileId: string; assemblyCode: string; targetSurfaceIds: string[]; startStationM: number; endStationM: number }
export type CivilCorridorTargetKind = 'surface' | 'alignment' | 'offset' | 'elevation';
/** Optional semantic corridor target. This is a binding record only; no
 * corridor solver, cross-section application, or grading result is implied. */
export interface CivilCorridorTarget {
  id: string;
  corridorId: string;
  kind: CivilCorridorTargetKind;
  targetObjectId?: string;
  startStationM: number;
  endStationM: number;
  offsetM?: number;
  elevationM?: number;
}
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
  /** Optional for backwards compatibility with existing id-less profiles. */
  verticalCurves?: CivilVerticalCurve[];
  /** Optional for backwards compatibility with documents without superelevation. */
  superelevations?: CivilSuperelevationRegion[];
  crossSections: CivilCrossSection[];
  corridors: CivilCorridor[];
  /** Optional for backwards compatibility with simple targetSurfaceIds. */
  corridorTargets?: CivilCorridorTarget[];
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
const polygonArea2 = (points: V2[]) => points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0);

function allCivilObjects(document: CivilDocument) {
  return [
    ...document.sourceEvidence, ...document.surveyControls, ...document.points, ...document.surfaces,
    ...document.alignments, ...document.alignments.flatMap(item => item.segments), ...document.profiles,
    ...document.profiles.flatMap(item => item.points.filter((point): point is CivilProfilePoint & { id: string } => typeof point.id === 'string')),
    ...(document.verticalCurves ?? []),
    ...(document.superelevations ?? []),
    ...(document.corridorTargets ?? []),
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

function segmentStationLength(segment: CivilAlignmentSegment): number {
  if (segment.kind === 'line' || segment.kind === 'spiral') return Math.hypot(segment.endM[0] - segment.startM[0], segment.endM[1] - segment.startM[1]);
  return Math.abs(segment.endAngleDeg - segment.startAngleDeg) * Math.PI / 180 * segment.radiusM;
}

function alignmentStationRange(alignment: CivilAlignment): [number, number] | null {
  const first = alignment.segments[0], last = alignment.segments.at(-1);
  if (!first || !last || !Number.isFinite(first.startStationM) || !Number.isFinite(last.startStationM)) return null;
  for (let index = 1; index < alignment.segments.length; index += 1) {
    const previous = alignment.segments[index - 1]!;
    const current = alignment.segments[index]!;
    const expectedStart = previous.startStationM + segmentStationLength(previous);
    if (!Number.isFinite(expectedStart) || Math.abs(current.startStationM - expectedStart) > 1e-6) return null;
  }
  const end = last.startStationM + segmentStationLength(last);
  return Number.isFinite(end) && end > first.startStationM ? [first.startStationM, end] : null;
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
  const pointById = new Map(document.points.map(item => [item.id, item]));
  document.surfaces.forEach(item => {
    if (item.pointIds.length < 3 || new Set(item.pointIds).size !== item.pointIds.length || item.pointIds.some(id => !pointIds.has(id)) || new Set(item.sourceEvidenceIds).size !== item.sourceEvidenceIds.length || item.sourceEvidenceIds.some(id => !evidence.has(id))) issues.push(`${item.id}: invalid surface points or evidence.`);
    const triangleKeys = new Set<string>();
    if (item.triangles.some(triangle => {
      if (!Array.isArray(triangle) || triangle.length !== 3 || new Set(triangle).size !== 3 || triangle.some(id => !item.pointIds.includes(id))) return true;
      const key = [...triangle].sort().join('|');
      if (triangleKeys.has(key)) return true;
      triangleKeys.add(key);
      const [a, b, c] = triangle.map(id => pointById.get(id)?.positionM);
      return !a || !b || !c || Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) <= 1e-12;
    })) issues.push(`${item.id}: invalid TIN triangle.`);
    const breaklineKeys = new Set<string>();
    if (item.breaklines?.some(line => {
      if (line.length < 2 || line.some((id, index) => !item.pointIds.includes(id) || (index > 0 && id === line[index - 1]))) return true;
      const forward = line.join('|'), reverse = [...line].reverse().join('|'), key = forward < reverse ? forward : reverse;
      if (breaklineKeys.has(key)) return true;
      breaklineKeys.add(key);
      return false;
    })) issues.push(`${item.id}: invalid surface breakline.`);
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
  const profilesById = new Map(document.profiles.map(item => [item.id, item]));
  document.profiles.forEach(item => {
    const stablePointCount = item.points.filter(point => point.id !== undefined).length;
    if (!alignmentIds.has(item.alignmentId) || item.points.length < 2 || (stablePointCount > 0 && stablePointCount !== item.points.length) || !sortedStrictly(item.points.map(point => point.stationM)) || item.points.some(point => !Number.isFinite(point.stationM) || !Number.isFinite(point.elevationM) || (point.id !== undefined && !point.id.trim()))) issues.push(`${item.id}: invalid profile or station order.`);
  });
  const profilePointIds = new Map(document.profiles.map(profile => [profile.id, new Map(profile.points.flatMap(point => point.id ? [[point.id, point] as const] : []))]));
  const curvesByProfile = new Map<string, CivilVerticalCurve[]>();
  for (const curve of document.verticalCurves ?? []) {
    const profile = profilesById.get(curve.profileId);
    const pvi = profilePointIds.get(curve.profileId)?.get(curve.pviId);
    const profileStart = profile?.points[0]?.stationM;
    const profileEnd = profile?.points.at(-1)?.stationM;
    const range = Number.isFinite(curve.startStationM) && Number.isFinite(curve.endStationM)
      && curve.startStationM < curve.endStationM
      && Number.isFinite(curve.lengthM) && curve.lengthM > 0
      && Math.abs((curve.endStationM - curve.startStationM) - curve.lengthM) <= 1e-9;
    const inProfileRange = profileStart !== undefined && profileEnd !== undefined
      && curve.startStationM >= profileStart && curve.endStationM <= profileEnd;
    const pviInCurve = Boolean(pvi && pvi.stationM > curve.startStationM && pvi.stationM < curve.endStationM);
    if (!profile || !pvi || !range || !inProfileRange || !pviInCurve) issues.push(`${curve.id}: invalid vertical curve profile/PVI reference or station range.`);
    const curves = curvesByProfile.get(curve.profileId) ?? [];
    curves.push(curve);
    curvesByProfile.set(curve.profileId, curves);
  }
  for (const [profileId, curves] of curvesByProfile) {
    const ordered = [...curves].sort((left, right) => left.startStationM - right.startStationM || left.endStationM - right.endStationM);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.startStationM < ordered[index - 1]!.endStationM) issues.push(`${profileId}: vertical curves overlap.`);
    }
    const pvis = new Set<string>();
    for (const curve of ordered) if (pvis.has(curve.pviId)) issues.push(`${curve.id}: vertical curve PVI is already owned by another curve.`); else pvis.add(curve.pviId);
  }
  const superelevationsByAlignment = new Map<string, CivilSuperelevationRegion[]>();
  for (const region of document.superelevations ?? []) {
    const alignment = document.alignments.find(candidate => candidate.id === region.alignmentId);
    const stationRange = alignment ? alignmentStationRange(alignment) : null;
    const boundedSlopes = Number.isFinite(region.leftCrossSlopePercent) && Math.abs(region.leftCrossSlopePercent) <= 100
      && Number.isFinite(region.rightCrossSlopePercent) && Math.abs(region.rightCrossSlopePercent) <= 100;
    const validRange = Number.isFinite(region.startStationM) && Number.isFinite(region.endStationM)
      && region.startStationM < region.endStationM;
    const withinAlignment = Boolean(stationRange
      && region.startStationM >= stationRange[0]
      && region.endStationM <= stationRange[1]);
    if (!alignment || !validRange || !withinAlignment || !boundedSlopes) issues.push(`${region.id}: invalid superelevation alignment, station range, or bounded cross slope.`);
    const regions = superelevationsByAlignment.get(region.alignmentId) ?? [];
    regions.push(region);
    superelevationsByAlignment.set(region.alignmentId, regions);
  }
  for (const [alignmentId, regions] of superelevationsByAlignment) {
    const ordered = [...regions].sort((left, right) => left.startStationM - right.startStationM || left.endStationM - right.endStationM);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.startStationM < ordered[index - 1]!.endStationM) issues.push(`${alignmentId}: superelevation regions overlap.`);
    }
  }
  document.crossSections.forEach(item => { if (!alignmentIds.has(item.alignmentId) || !Number.isFinite(item.stationM) || item.points.length < 2 || !sortedStrictly(item.points.map(point => point.offsetM)) || item.points.some(point => !Number.isFinite(point.offsetM) || !Number.isFinite(point.elevationM) || !point.code.trim())) issues.push(`${item.id}: invalid cross section.`); });
  const surfaceIds = new Set(document.surfaces.map(item => item.id));
  document.corridors.forEach(item => {
    const profile = profilesById.get(item.profileId);
    const profileStart = profile?.points[0]?.stationM;
    const profileEnd = profile?.points.at(-1)?.stationM;
    if (!alignmentIds.has(item.alignmentId) || !profile || profile.alignmentId !== item.alignmentId || !item.assemblyCode.trim() || item.targetSurfaceIds.some(id => !surfaceIds.has(id)) || !Number.isFinite(item.startStationM) || !Number.isFinite(item.endStationM) || item.endStationM <= item.startStationM || profileStart === undefined || profileEnd === undefined || item.startStationM < profileStart || item.endStationM > profileEnd) issues.push(`${item.id}: invalid corridor references or station range.`);
  });
  const corridorsById = new Map(document.corridors.map(item => [item.id, item]));
  const corridorTargetRoles = new Map<string, CivilCorridorTarget[]>();
  for (const target of document.corridorTargets ?? []) {
    const corridor = corridorsById.get(target.corridorId);
    const validRange = Number.isFinite(target.startStationM) && Number.isFinite(target.endStationM)
      && target.startStationM < target.endStationM;
    const withinCorridor = Boolean(corridor && validRange
      && target.startStationM >= corridor.startStationM
      && target.endStationM <= corridor.endStationM);
    const noExtra = target.offsetM === undefined && target.elevationM === undefined;
    let validKind = false;
    if (target.kind === 'surface') {
      validKind = noExtra && typeof target.targetObjectId === 'string' && surfaceIds.has(target.targetObjectId)
        && Boolean(corridor?.targetSurfaceIds.includes(target.targetObjectId));
    } else if (target.kind === 'alignment') {
      validKind = noExtra && target.targetObjectId === corridor?.alignmentId;
    } else if (target.kind === 'offset') {
      validKind = target.targetObjectId === undefined && target.elevationM === undefined
        && typeof target.offsetM === 'number' && Number.isFinite(target.offsetM) && Math.abs(target.offsetM) <= 1_000_000_000;
    } else if (target.kind === 'elevation') {
      validKind = target.targetObjectId === undefined && target.offsetM === undefined
        && typeof target.elevationM === 'number' && Number.isFinite(target.elevationM) && Math.abs(target.elevationM) <= 1_000_000_000;
    }
    if (!corridor || !withinCorridor || !validKind) issues.push(`${target.id}: invalid corridor target ownership, kind, or station range.`);
    const role = `${target.corridorId}|${target.kind}|${target.targetObjectId ?? ''}`;
    const roleTargets = corridorTargetRoles.get(role) ?? [];
    roleTargets.push(target);
    corridorTargetRoles.set(role, roleTargets);
  }
  for (const [role, targets] of corridorTargetRoles) {
    const ordered = [...targets].sort((left, right) => left.startStationM - right.startStationM || left.endStationM - right.endStationM);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]!.startStationM < ordered[index - 1]!.endStationM) issues.push(`${role}: corridor targets overlap.`);
    }
  }
  const nodeIds = new Set(document.drainageNodes.map(item => item.id));
  document.drainageNodes.forEach(item => { if (!finite3(item.positionM) || !Number.isFinite(item.invertElevationM) || !Number.isFinite(item.rimElevationM) || item.rimElevationM <= item.invertElevationM) issues.push(`${item.id}: invalid drainage node elevations.`); });
  document.drainageLinks.forEach(item => { if (!nodeIds.has(item.fromNodeId) || !nodeIds.has(item.toNodeId) || item.fromNodeId === item.toNodeId || !positive(item.diameterMm) || !positive(item.lengthM) || !item.material.trim()) issues.push(`${item.id}: invalid drainage link.`); });
  document.catchments.forEach(item => { if (item.boundaryM.length < 3 || item.boundaryM.some(point => !finite2(point)) || Math.abs(polygonArea2(item.boundaryM)) <= 1e-12 || !nodeIds.has(item.outletNodeId) || !Number.isFinite(item.runoffCoefficient) || item.runoffCoefficient < 0 || item.runoffCoefficient > 1) issues.push(`${item.id}: invalid catchment.`); });
  document.structures.forEach(item => { if ((item.alignmentId !== undefined && !alignmentIds.has(item.alignmentId)) || (item.stationM !== undefined && !Number.isFinite(item.stationM)) || new Set(item.sourceEvidenceIds).size !== item.sourceEvidenceIds.length || item.sourceEvidenceIds.some(id => !evidence.has(id))) issues.push(`${item.id}: invalid civil structure reference.`); });
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
