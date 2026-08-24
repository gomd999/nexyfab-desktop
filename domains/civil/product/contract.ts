import { createHash } from 'node:crypto';

/**
 * The civil contract deliberately describes design inputs, not copied code or
 * standards.  Code/hydraulic material is represented by a rights-cleared
 * authority receipt and an input hash only; its prose is never embedded here.
 */
export const CIVIL_PRODUCT_CONTRACT_SCHEMA = 'nexyfab.civil.site-access-road-drainage.v1' as const;

export type CivilRevision = { id: string; sha256: string };
export type CivilPoint = { x: number; y: number; z?: number };
export type CivilProvenance = {
  sourceId: string;
  sourceRef: string;
  contentSha256: string;
  rightsReceiptSha256: string;
  origin: 'ORIGINAL' | 'LICENSED' | 'CLIENT_PROVIDED' | 'PUBLIC_STANDARD_FACT';
  rightsStatus: 'APPROVED';
  authorityStatus: 'APPROVED';
  sourceRevision: CivilRevision;
};
export type CivilAuthorityInput<T extends Record<string, unknown> = Record<string, unknown>> = {
  source: CivilProvenance;
  inputSha256: string;
  declaredOnly: true;
  values: T;
};
export type CivilIdentity = { id: string; revision: CivilRevision; contentSha256: string };
export type CivilUnits = { length: 'm'; area: 'm2'; volume: 'm3'; slope: '%' };

export interface CivilAuthority {
  survey: CivilProvenance;
  coordinateReference: {
    horizontalCrs: string;
    verticalDatum: string;
    epoch: string;
    controlPointIds: string[];
    source: CivilProvenance;
  };
}
export interface CivilCriteria {
  alignment: CivilAuthorityInput<{ maxGradePercent: number; minRadiusM: number; maxSuperelevationPercent: number }>;
  profile: CivilAuthorityInput<{ maxGradePercent: number; minVerticalCurveLengthM: number; maxStationGapM: number }>;
  corridor: CivilAuthorityInput<{ leftWidthM: number; rightWidthM: number; targetCrossfallPercent: number; maxSideSlopePercent: number }>;
  earthwork: CivilAuthorityInput<{ maxCutDepthM: number; maxFillDepthM: number; balanceToleranceM3: number }>;
  drainage: CivilAuthorityInput<{ designFlowM3S: number; maxVelocityMS: number; minCoverM: number; allowablePondingDepthM: number }>;
}
export interface CivilSurveyPoint { id: string; point: CivilPoint; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilBreakline { id: string; kind: 'boundary' | 'ridge' | 'valley' | 'feature'; pointIds: string[]; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilTinTriangle { id: string; surface: 'existing' | 'proposed'; vertexPointIds: [string, string, string]; neighborTriangleIds: string[]; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilAlignmentSegment {
  id: string; kind: 'line' | 'arc'; startStation: number; endStation: number; startPoint: CivilPoint; endPoint: CivilPoint;
  radiusM: number | null; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision;
}
export interface CivilProfilePoint { id: string; kind: 'PVI' | 'grade-break'; station: number; elevationM: number; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilVerticalCurve { id: string; startStation: number; endStation: number; startElevationM: number; endElevationM: number; lengthM: number; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilCrossSection { id: string; station: number; samples: Array<{ offsetM: number; elevationM: number }>; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilCorridorTarget { id: string; kind: 'surface' | 'slope' | 'width' | 'elevation'; value: number; surfaceTriangleIds: string[] }
export interface CivilCorridorAssembly { id: string; alignmentSegmentIds: string[]; crossSectionIds: string[]; targets: CivilCorridorTarget[]; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilCatchment { id: string; areaM2: number; runoffCoefficientPercent: number; outletNodeId: string; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilDrainageNode { id: string; kind: 'inlet' | 'manhole' | 'junction' | 'outfall'; point: CivilPoint; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilPipe { id: string; fromNodeId: string; toNodeId: string; lengthM: number; diameterM: number; slopePercent: number; capacityM3S: number; coverM: number; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilOutfall { id: string; nodeId: string; dischargeElevationM: number; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilEarthworkSurface { id: string; kind: 'existing' | 'proposed'; triangleIds: string[]; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilGridBinding { id: string; surfaceId: string; origin: CivilPoint; cellSizeM: number; rows: number; columns: number; elevationsM: number[]; gridSha256: string; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }
export interface CivilConstructionStage { id: string; name: string; dependsOnStageIds: string[]; objectIds: string[]; source: CivilProvenance; contentSha256: string; sourceRevision: CivilRevision }

export interface CivilSiteAccessRoadDrainageContract {
  schema: typeof CIVIL_PRODUCT_CONTRACT_SCHEMA;
  identity: CivilIdentity;
  units: CivilUnits;
  authority: CivilAuthority;
  criteria: CivilCriteria;
  surveyPoints: CivilSurveyPoint[];
  breaklines: CivilBreakline[];
  tinTriangles: CivilTinTriangle[];
  alignmentSegments: CivilAlignmentSegment[];
  profilePoints: CivilProfilePoint[];
  verticalCurves: CivilVerticalCurve[];
  crossSections: CivilCrossSection[];
  corridorAssemblies: CivilCorridorAssembly[];
  catchments: CivilCatchment[];
  drainageNodes: CivilDrainageNode[];
  pipes: CivilPipe[];
  outfalls: CivilOutfall[];
  earthworkSurfaces: CivilEarthworkSurface[];
  gridBindings: CivilGridBinding[];
  constructionStages: CivilConstructionStage[];
  authoritative: true;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REV = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const CRS = /^[A-Za-z0-9][A-Za-z0-9 .:_/+-]{0,127}$/;
const MAX = 10000;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]): boolean => isRecord(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const text = (v: unknown, re: RegExp = /./, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && re.test(v);
const finite = (v: unknown, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isRecord(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';

export function canonicalCivilSiteAccessRoadDrainageJson(contract: CivilSiteAccessRoadDrainageContract, includeHash = true): string {
  return canonical(includeHash ? contract : { ...contract, identity: { ...contract.identity, contentSha256: undefined } });
}
export function hashCivilSiteAccessRoadDrainageContract(contract: CivilSiteAccessRoadDrainageContract): string {
  return createHash('sha256').update(canonicalCivilSiteAccessRoadDrainageJson(contract, false), 'utf8').digest('hex');
}

export function hashCivilElevationGrid(grid: Pick<CivilGridBinding, 'origin' | 'cellSizeM' | 'rows' | 'columns' | 'elevationsM'>): string {
  return createHash('sha256').update(canonical({ origin: grid.origin, cellSizeM: grid.cellSizeM, rows: grid.rows, columns: grid.columns, elevationsM: grid.elevationsM }), 'utf8').digest('hex');
}

export interface CivilEarthworkGridResult {
  method: 'PAIRED_CELL_CENTER_GRID';
  cellCount: number;
  cellAreaM2: number;
  cutVolumeM3: number;
  fillVolumeM3: number;
  netVolumeM3: number;
  maxCutDepthM: number;
  maxFillDepthM: number;
}

export function calculateCivilEarthworkGrid(contract: CivilSiteAccessRoadDrainageContract): CivilEarthworkGridResult {
  const kindBySurface = new Map(contract.earthworkSurfaces.map(surface => [surface.id, surface.kind]));
  const existing = contract.gridBindings.find(grid => kindBySurface.get(grid.surfaceId) === 'existing');
  const proposed = contract.gridBindings.find(grid => kindBySurface.get(grid.surfaceId) === 'proposed');
  if (!existing || !proposed) throw new Error('civil_earthwork_grid_pair_missing');
  const sameLayout = existing.rows === proposed.rows && existing.columns === proposed.columns
    && existing.cellSizeM === proposed.cellSizeM && existing.origin.x === proposed.origin.x
    && existing.origin.y === proposed.origin.y && (existing.origin.z ?? 0) === (proposed.origin.z ?? 0);
  if (!sameLayout || existing.elevationsM.length !== proposed.elevationsM.length) throw new Error('civil_earthwork_grid_layout_mismatch');
  const cellAreaM2 = existing.cellSizeM ** 2;
  let cutVolumeM3 = 0, fillVolumeM3 = 0, maxCutDepthM = 0, maxFillDepthM = 0;
  for (let index = 0; index < existing.elevationsM.length; index += 1) {
    const delta = proposed.elevationsM[index]! - existing.elevationsM[index]!;
    if (delta < 0) { const depth = -delta; cutVolumeM3 += depth * cellAreaM2; maxCutDepthM = Math.max(maxCutDepthM, depth); }
    else { fillVolumeM3 += delta * cellAreaM2; maxFillDepthM = Math.max(maxFillDepthM, delta); }
  }
  return { method: 'PAIRED_CELL_CENTER_GRID', cellCount: existing.elevationsM.length, cellAreaM2, cutVolumeM3, fillVolumeM3, netVolumeM3: fillVolumeM3 - cutVolumeM3, maxCutDepthM, maxFillDepthM };
}

const PROV_KEYS = ['sourceId', 'sourceRef', 'contentSha256', 'rightsReceiptSha256', 'origin', 'rightsStatus', 'authorityStatus', 'sourceRevision'];
const REV_KEYS = ['id', 'sha256'];
function provenance(v: unknown, path: string, issues: string[], expectedRevision?: CivilRevision): v is CivilProvenance {
  if (!exact(v, PROV_KEYS)) { issues.push(`${path}:keys`); return false; }
  const p = v as Record<string, unknown>;
  if (!text(p.sourceId, ID)) issues.push(`${path}.sourceId`);
  if (!text(p.sourceRef, /^(?!ai:|preview:|synthetic:|catalog-unverified:).+/i, 1024)) issues.push(`${path}.sourceRef`);
  if (!text(p.contentSha256, SHA)) issues.push(`${path}.contentSha256`);
  if (!text(p.rightsReceiptSha256, SHA)) issues.push(`${path}.rightsReceiptSha256`);
  if (!['ORIGINAL', 'LICENSED', 'CLIENT_PROVIDED', 'PUBLIC_STANDARD_FACT'].includes(p.origin as string)) issues.push(`${path}.origin`);
  if (p.rightsStatus !== 'APPROVED' || p.authorityStatus !== 'APPROVED') issues.push(`${path}:not_authoritative`);
  if (!revision(p.sourceRevision, `${path}.sourceRevision`, issues)
    || (expectedRevision && isRecord(p.sourceRevision)
      && (p.sourceRevision.id !== expectedRevision.id || p.sourceRevision.sha256 !== expectedRevision.sha256))) {
    issues.push(`${path}.sourceRevision:mismatch`);
  }
  return true;
}
function revision(v: unknown, path: string, issues: string[]): v is CivilRevision {
  if (!exact(v, REV_KEYS)) { issues.push(`${path}:keys`); return false; }
  const r = v as Record<string, unknown>;
  if (!text(r.id, REV)) issues.push(`${path}.id`);
  if (!text(r.sha256, SHA)) issues.push(`${path}.sha256`);
  return true;
}
function point(v: unknown, path: string, issues: string[], zRequired = false): void {
  const keys = zRequired ? ['x', 'y', 'z'] : ['x', 'y'];
  if (!exact(v, keys)) { issues.push(`${path}:keys`); return; }
  const p = v as Record<string, unknown>;
  if (!finite(p.x, -1e8, 1e8)) issues.push(`${path}.x`);
  if (!finite(p.y, -1e8, 1e8)) issues.push(`${path}.y`);
  if (zRequired && !finite(p.z, -1e5, 1e5)) issues.push(`${path}.z`);
}
function collection<T extends Record<string, unknown>>(value: unknown, key: string, keys: readonly string[], revisionValue: CivilRevision | undefined, issues: string[], each: (v: T, path: string, ids: Set<string>) => void): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX) { issues.push(`${key}:count`); return ids; }
  value.forEach((raw, i) => {
    const path = `${key}[${i}]`;
    if (!exact(raw, keys)) { issues.push(`${path}:keys`); return; }
    const v = raw as T;
    if (!text(v.id, ID) || ids.has(v.id as string)) issues.push(`${path}.id`); else ids.add(v.id as string);
    if (!revision(v.sourceRevision, `${path}.sourceRevision`, issues) || (revisionValue && isRecord(v.sourceRevision) && (v.sourceRevision.id !== revisionValue.id || v.sourceRevision.sha256 !== revisionValue.sha256))) issues.push(`${path}.sourceRevision:mismatch`);
    if (!text(v.contentSha256, SHA)) issues.push(`${path}.contentSha256`);
    provenance(v.source, `${path}.source`, issues, revisionValue);
    each(v, path, ids);
  });
  return ids;
}
function authorityInput(v: unknown, path: string, revisionValue: CivilRevision | undefined, valueKeys: readonly string[], issues: string[]): void {
  if (!exact(v, ['source', 'inputSha256', 'declaredOnly', 'values'])) { issues.push(`${path}:keys`); return; }
  const a = v as Record<string, unknown>;
  provenance(a.source, `${path}.source`, issues, revisionValue);
  if (!text(a.inputSha256, SHA)) issues.push(`${path}.inputSha256`);
  if (a.declaredOnly !== true) issues.push(`${path}.declaredOnly`);
  if (!exact(a.values, valueKeys)) issues.push(`${path}.values:keys`);
  if (isRecord(a.values)) for (const key of valueKeys) if (!finite(a.values[key], 0, 1e9)) issues.push(`${path}.values.${key}`);
  if (revisionValue && isRecord(a.source) && !text(a.source.sourceId, ID)) issues.push(`${path}.source:invalid`);
}

export function validateCivilSiteAccessRoadDrainageContract(input: unknown): string[] {
  const issues: string[] = [];
  const keys = ['schema', 'identity', 'units', 'authority', 'criteria', 'surveyPoints', 'breaklines', 'tinTriangles', 'alignmentSegments', 'profilePoints', 'verticalCurves', 'crossSections', 'corridorAssemblies', 'catchments', 'drainageNodes', 'pipes', 'outfalls', 'earthworkSurfaces', 'gridBindings', 'constructionStages', 'authoritative'] as const;
  if (!exact(input, keys)) return ['contract:keys'];
  const c = input as unknown as CivilSiteAccessRoadDrainageContract;
  if (c.schema !== CIVIL_PRODUCT_CONTRACT_SCHEMA || c.authoritative !== true) issues.push('contract:not_authoritative');
  if (!exact(c.identity, ['id', 'revision', 'contentSha256'])) issues.push('identity:keys');
  let rev: CivilRevision | undefined;
  if (isRecord(c.identity)) {
    if (!text(c.identity.id, ID)) issues.push('identity.id');
    if (!revision(c.identity.revision, 'identity.revision', issues)) { /* issue already recorded */ } else rev = c.identity.revision as CivilRevision;
    if (!text(c.identity.contentSha256, SHA)) issues.push('identity.contentSha256');
    else if (c.identity.contentSha256 !== hashCivilSiteAccessRoadDrainageContract(c)) issues.push('identity.contentSha256:mismatch');
  }
  if (!exact(c.units, ['length', 'area', 'volume', 'slope']) || c.units.length !== 'm' || c.units.area !== 'm2' || c.units.volume !== 'm3' || c.units.slope !== '%') issues.push('units:invalid');
  if (!exact(c.authority, ['survey', 'coordinateReference'])) issues.push('authority:keys');
  else {
    provenance(c.authority.survey, 'authority.survey', issues, rev);
    if (!exact(c.authority.coordinateReference, ['horizontalCrs', 'verticalDatum', 'epoch', 'controlPointIds', 'source'])) issues.push('authority.coordinateReference:keys');
    else {
      const crs = c.authority.coordinateReference;
      if (!text(crs.horizontalCrs, CRS)) issues.push('authority.coordinateReference.horizontalCrs');
      if (!text(crs.verticalDatum, CRS)) issues.push('authority.coordinateReference.verticalDatum');
      if (!text(crs.epoch, /^[0-9]{4}([-/][0-9]{2})?([-/][0-9]{2})?$/, 32)) issues.push('authority.coordinateReference.epoch');
      if (!Array.isArray(crs.controlPointIds) || crs.controlPointIds.length === 0 || crs.controlPointIds.some(id => !text(id, ID))) issues.push('authority.coordinateReference.controlPointIds');
      provenance(crs.source, 'authority.coordinateReference.source', issues, rev);
    }
  }
  if (!exact(c.criteria, ['alignment', 'profile', 'corridor', 'earthwork', 'drainage'])) issues.push('criteria:keys');
  else {
    authorityInput(c.criteria.alignment, 'criteria.alignment', rev, ['maxGradePercent', 'minRadiusM', 'maxSuperelevationPercent'], issues);
    authorityInput(c.criteria.profile, 'criteria.profile', rev, ['maxGradePercent', 'minVerticalCurveLengthM', 'maxStationGapM'], issues);
    authorityInput(c.criteria.corridor, 'criteria.corridor', rev, ['leftWidthM', 'rightWidthM', 'targetCrossfallPercent', 'maxSideSlopePercent'], issues);
    authorityInput(c.criteria.earthwork, 'criteria.earthwork', rev, ['maxCutDepthM', 'maxFillDepthM', 'balanceToleranceM3'], issues);
    authorityInput(c.criteria.drainage, 'criteria.drainage', rev, ['designFlowM3S', 'maxVelocityMS', 'minCoverM', 'allowablePondingDepthM'], issues);
  }

  const pointIds = collection(c.surveyPoints as unknown, 'surveyPoints', ['id', 'point', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => point(v.point, `${p}.point`, issues, true));
  if (isRecord(c.authority) && isRecord(c.authority.coordinateReference)) {
    const controls = c.authority.coordinateReference.controlPointIds;
    if (Array.isArray(controls)) for (const id of controls) if (!pointIds.has(id)) issues.push(`authority.coordinateReference.controlPointIds:dangling:${id}`);
  }
  const breaklineIds = collection(c.breaklines as unknown, 'breaklines', ['id', 'kind', 'pointIds', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => {
    if (!['boundary', 'ridge', 'valley', 'feature'].includes(v.kind as string)) issues.push(`${p}.kind`);
    if (!Array.isArray(v.pointIds) || v.pointIds.length < 2 || v.pointIds.some(id => !pointIds.has(id as string))) issues.push(`${p}.pointIds`);
  });
  const triangles = collection(c.tinTriangles as unknown, 'tinTriangles', ['id', 'surface', 'vertexPointIds', 'neighborTriangleIds', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => {
    if (!['existing', 'proposed'].includes(v.surface as string)) issues.push(`${p}.surface`);
    if (!Array.isArray(v.vertexPointIds) || v.vertexPointIds.length !== 3 || new Set(v.vertexPointIds as string[]).size !== 3 || (v.vertexPointIds as string[]).some(id => !pointIds.has(id))) issues.push(`${p}.vertexPointIds`);
    if (!Array.isArray(v.neighborTriangleIds) || (v.neighborTriangleIds as string[]).some(id => !text(id, ID))) issues.push(`${p}.neighborTriangleIds`);
  });
  for (const surface of ['existing', 'proposed'] as const) if (!(c.tinTriangles as CivilTinTriangle[]).some(triangle => triangle.surface === surface)) issues.push(`tinTriangles:required_surface_missing:${surface}`);
  const segmentIds = collection(c.alignmentSegments as unknown, 'alignmentSegments', ['id', 'kind', 'startStation', 'endStation', 'startPoint', 'endPoint', 'radiusM', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => {
    if (!['line', 'arc'].includes(v.kind as string)) issues.push(`${p}.kind`); point(v.startPoint, `${p}.startPoint`, issues); point(v.endPoint, `${p}.endPoint`, issues);
    if (!finite(v.startStation, 0, 1e9) || !finite(v.endStation, 0, 1e9) || (v.endStation as number) <= (v.startStation as number)) issues.push(`${p}:station_range`);
    if (v.kind === 'line' && v.radiusM !== null) issues.push(`${p}.radiusM`); if (v.kind === 'arc' && !finite(v.radiusM, 0.001, 1e9)) issues.push(`${p}.radiusM`);
  });
  const profileIds = collection(c.profilePoints as unknown, 'profilePoints', ['id', 'kind', 'station', 'elevationM', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!['PVI', 'grade-break'].includes(v.kind as string)) issues.push(`${p}.kind`); if (!finite(v.station, 0, 1e9) || !finite(v.elevationM, -1e5, 1e5)) issues.push(`${p}:value`); });
  const curveIds = collection(c.verticalCurves as unknown, 'verticalCurves', ['id', 'startStation', 'endStation', 'startElevationM', 'endElevationM', 'lengthM', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!finite(v.startStation, 0, 1e9) || !finite(v.endStation, 0, 1e9) || (v.endStation as number) <= (v.startStation as number) || !finite(v.lengthM, 0.001, 1e9)) issues.push(`${p}:range`); if (!finite(v.startElevationM, -1e5, 1e5) || !finite(v.endElevationM, -1e5, 1e5)) issues.push(`${p}:elevation`); });
  const sectionIds = collection(c.crossSections as unknown, 'crossSections', ['id', 'station', 'samples', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!finite(v.station, 0, 1e9) || !Array.isArray(v.samples) || v.samples.length < 2 || (v.samples as Array<Record<string, unknown>>).some(s => !exact(s, ['offsetM', 'elevationM']) || !finite(s.offsetM) || !finite(s.elevationM, -1e5, 1e5))) issues.push(`${p}:samples`); });
  const corridorIds = collection(c.corridorAssemblies as unknown, 'corridorAssemblies', ['id', 'alignmentSegmentIds', 'crossSectionIds', 'targets', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!Array.isArray(v.alignmentSegmentIds) || (v.alignmentSegmentIds as string[]).some(id => !segmentIds.has(id))) issues.push(`${p}.alignmentSegmentIds`); if (!Array.isArray(v.crossSectionIds) || (v.crossSectionIds as string[]).some(id => !sectionIds.has(id))) issues.push(`${p}.crossSectionIds`); if (!Array.isArray(v.targets) || v.targets.length === 0) issues.push(`${p}.targets`); else (v.targets as Array<Record<string, unknown>>).forEach((t, i) => { if (!exact(t, ['id', 'kind', 'value', 'surfaceTriangleIds']) || !text(t.id, ID) || !['surface', 'slope', 'width', 'elevation'].includes(t.kind as string) || !finite(t.value) || !Array.isArray(t.surfaceTriangleIds) || (t.surfaceTriangleIds as string[]).some(id => !triangles.has(id))) issues.push(`${p}.targets[${i}]`); }); });
  const nodeIds = collection(c.drainageNodes as unknown, 'drainageNodes', ['id', 'kind', 'point', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!['inlet', 'manhole', 'junction', 'outfall'].includes(v.kind as string)) issues.push(`${p}.kind`); point(v.point, `${p}.point`, issues, true); });
  const outfallIds = collection(c.outfalls as unknown, 'outfalls', ['id', 'nodeId', 'dischargeElevationM', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!nodeIds.has(v.nodeId as string) || !finite(v.dischargeElevationM, -1e5, 1e5)) issues.push(`${p}:node_ref`); });
  collection(c.catchments as unknown, 'catchments', ['id', 'areaM2', 'runoffCoefficientPercent', 'outletNodeId', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!finite(v.areaM2, 0.001, 1e12) || !finite(v.runoffCoefficientPercent, 0, 100) || !nodeIds.has(v.outletNodeId as string)) issues.push(`${p}:drainage_ref`); });
  const pipeIds = collection(c.pipes as unknown, 'pipes', ['id', 'fromNodeId', 'toNodeId', 'lengthM', 'diameterM', 'slopePercent', 'capacityM3S', 'coverM', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!nodeIds.has(v.fromNodeId as string) || !nodeIds.has(v.toNodeId as string) || v.fromNodeId === v.toNodeId) issues.push(`${p}:direction_ref`); if (!finite(v.lengthM, 0.001) || !finite(v.diameterM, 0.001) || !finite(v.slopePercent, -100, 100) || !finite(v.capacityM3S, 0.000001) || !finite(v.coverM, 0)) issues.push(`${p}:hydraulic_value`); });
  const surfaceIds = collection(c.earthworkSurfaces as unknown, 'earthworkSurfaces', ['id', 'kind', 'triangleIds', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!['existing', 'proposed'].includes(v.kind as string) || !Array.isArray(v.triangleIds) || (v.triangleIds as string[]).some(id => !triangles.has(id))) issues.push(`${p}:triangle_ref`); });
  for (const kind of ['existing', 'proposed'] as const) if (!(c.earthworkSurfaces as CivilEarthworkSurface[]).some(surface => surface.kind === kind)) issues.push(`earthworkSurfaces:required_kind_missing:${kind}`);
  collection(c.gridBindings as unknown, 'gridBindings', ['id', 'surfaceId', 'origin', 'cellSizeM', 'rows', 'columns', 'elevationsM', 'gridSha256', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => {
    if (!surfaceIds.has(v.surfaceId as string)) issues.push(`${p}.surfaceId`);
    point(v.origin, `${p}.origin`, issues);
    const rows = v.rows as number, columns = v.columns as number;
    const dimensionsValid = finite(v.cellSizeM, 0.0001) && Number.isInteger(rows) && rows >= 1 && Number.isInteger(columns) && columns >= 1 && rows * columns <= MAX;
    if (!dimensionsValid || !Array.isArray(v.elevationsM) || v.elevationsM.length !== rows * columns || v.elevationsM.some(value => !finite(value)) || !text(v.gridSha256, SHA)) issues.push(`${p}:grid`);
    else if (hashCivilElevationGrid(v as unknown as CivilGridBinding) !== v.gridSha256) issues.push(`${p}.gridSha256:mismatch`);
  });
  const surfaceKindById = new Map(c.earthworkSurfaces.map(surface => [surface.id, surface.kind]));
  for (const kind of ['existing', 'proposed'] as const) {
    const grids = c.gridBindings.filter(grid => surfaceKindById.get(grid.surfaceId) === kind);
    if (grids.length !== 1) issues.push(`gridBindings:${kind}_exactly_one_required`);
  }
  const existingGrid = c.gridBindings.find(grid => surfaceKindById.get(grid.surfaceId) === 'existing');
  const proposedGrid = c.gridBindings.find(grid => surfaceKindById.get(grid.surfaceId) === 'proposed');
  if (existingGrid && proposedGrid && (existingGrid.rows !== proposedGrid.rows || existingGrid.columns !== proposedGrid.columns || existingGrid.cellSizeM !== proposedGrid.cellSizeM || existingGrid.origin.x !== proposedGrid.origin.x || existingGrid.origin.y !== proposedGrid.origin.y || (existingGrid.origin.z ?? 0) !== (proposedGrid.origin.z ?? 0))) issues.push('gridBindings:layout_mismatch');
  const stageIds = collection(c.constructionStages as unknown, 'constructionStages', ['id', 'name', 'dependsOnStageIds', 'objectIds', 'source', 'contentSha256', 'sourceRevision'], rev, issues, (v, p) => { if (!text(v.name, /./, 256) || !Array.isArray(v.dependsOnStageIds) || !Array.isArray(v.objectIds)) issues.push(`${p}:stage`); });
  const globalIds = new Set<string>();
  for (const [collectionName, values] of [
    ['surveyPoints', c.surveyPoints], ['breaklines', c.breaklines], ['tinTriangles', c.tinTriangles],
    ['alignmentSegments', c.alignmentSegments], ['profilePoints', c.profilePoints], ['verticalCurves', c.verticalCurves],
    ['crossSections', c.crossSections], ['corridorAssemblies', c.corridorAssemblies], ['catchments', c.catchments],
    ['drainageNodes', c.drainageNodes], ['pipes', c.pipes], ['outfalls', c.outfalls],
    ['earthworkSurfaces', c.earthworkSurfaces], ['gridBindings', c.gridBindings], ['constructionStages', c.constructionStages],
  ] as const) for (const value of Array.isArray(values) ? values : []) {
    if (globalIds.has(value.id)) issues.push(`${collectionName}:global_id_duplicate:${value.id}`);
    globalIds.add(value.id);
  }
  const knownArtifactIds = new Set([...pointIds, ...breaklineIds, ...triangles, ...segmentIds, ...profileIds, ...curveIds, ...sectionIds, ...corridorIds, ...nodeIds, ...pipeIds, ...outfallIds, ...surfaceIds, ...stageIds]);
  for (const stage of c.constructionStages as CivilConstructionStage[]) for (const objectId of stage.objectIds ?? []) if (!knownArtifactIds.has(objectId)) issues.push(`constructionStages:${stage.id}:object_dangling:${objectId}`);

  // Topological and continuity checks are deliberately local and deterministic.
  const allTri = Array.isArray(c.tinTriangles) ? c.tinTriangles : [];
  const edgeCounts = new Map<string, number>();
  for (const tri of allTri) {
    const vertices = tri.vertexPointIds;
    if (!Array.isArray(vertices) || vertices.length !== 3) continue;
    const p = vertices.map(id => (c.surveyPoints as CivilSurveyPoint[]).find(s => s.id === id)?.point);
    if (p.some(q => !q)) continue;
    const [a, b, d] = p as CivilPoint[]; const area = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x); if (Math.abs(area) < 1e-10) issues.push(`tinTriangles:${tri.id}:degenerate`);
    for (const edge of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) { const e = `${tri.surface}|${[...edge].sort().join('|')}`; edgeCounts.set(e, (edgeCounts.get(e) ?? 0) + 1); }
  }
  for (const [edge, count] of edgeCounts) if (count > 2) issues.push(`tinTriangles:nonmanifold:${edge}`);
  const ordered = (c.alignmentSegments as CivilAlignmentSegment[]).slice().sort((a, b) => a.startStation - b.startStation);
  for (let i = 1; i < ordered.length; i++) { const prev = ordered[i - 1]!; const next = ordered[i]!; if (next.startStation < prev.endStation || Math.abs(next.startStation - prev.endStation) > 1e-6) issues.push(`alignmentSegments:station_continuity:${next.id}`); const dx = next.startPoint.x - prev.endPoint.x; const dy = next.startPoint.y - prev.endPoint.y; if (Math.hypot(dx, dy) > 1e-6) issues.push(`alignmentSegments:geometry_continuity:${next.id}`); }
  const profile = (c.profilePoints as CivilProfilePoint[]).slice().sort((a, b) => a.station - b.station); for (let i = 1; i < profile.length; i++) if (profile[i]!.station <= profile[i - 1]!.station) issues.push(`profilePoints:station_order:${profile[i]!.id}`);
  const stageMap = new Map((c.constructionStages as CivilConstructionStage[]).map(s => [s.id, s])); const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) { issues.push(`constructionStages:cycle:${id}`); return; } if (visited.has(id)) return; visiting.add(id); const s = stageMap.get(id); if (s) for (const dep of s.dependsOnStageIds) { if (!stageMap.has(dep)) issues.push(`constructionStages:${id}:dangling:${dep}`); else visit(dep); } visiting.delete(id); visited.add(id); };
  for (const id of stageMap.keys()) visit(id);
  for (const tri of allTri) for (const n of tri.neighborTriangleIds ?? []) {
    const neighbor = allTri.find(other => other.id === n);
    if (!neighbor) issues.push(`tinTriangles:${tri.id}:neighbor_dangling:${n}`);
    else if (neighbor.surface !== tri.surface) issues.push(`tinTriangles:${tri.id}:neighbor_surface_mismatch:${n}`);
  }
  for (const surface of c.earthworkSurfaces as CivilEarthworkSurface[]) for (const triangleId of surface.triangleIds) {
    const triangle = allTri.find(item => item.id === triangleId);
    if (triangle && triangle.surface !== surface.kind) issues.push(`earthworkSurfaces:${surface.id}:triangle_surface_mismatch:${triangleId}`);
  }
  for (const outfall of c.outfalls as CivilOutfall[]) if (!(c.drainageNodes as CivilDrainageNode[]).some(n => n.id === outfall.nodeId && n.kind === 'outfall')) issues.push(`outfalls:${outfall.id}:outfall_node_required`);
  return [...new Set(issues)];
}

export function createCivilSiteAccessRoadDrainageContract(input: Omit<CivilSiteAccessRoadDrainageContract, 'identity'> & { identity: Omit<CivilIdentity, 'contentSha256'> }): CivilSiteAccessRoadDrainageContract {
  const draft = { ...input, identity: { ...input.identity, contentSha256: '0'.repeat(64) } } as CivilSiteAccessRoadDrainageContract;
  const contract = { ...draft, identity: { ...draft.identity, contentSha256: hashCivilSiteAccessRoadDrainageContract(draft) } };
  const issues = validateCivilSiteAccessRoadDrainageContract(contract); if (issues.length) throw new Error(`invalid_civil_site_access_road_drainage_contract:${issues.join(',')}`); return contract;
}
