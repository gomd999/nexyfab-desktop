import { validateToolArguments, type JsonSchema } from './toolArgumentsValidator';

export const CIVIL_LANDSCAPE_TOOL_CATALOG_VERSION = 'nexyfab.precision-cad.civil-landscape.v1' as const;
export type CivilLandscapeDomain = 'civil' | 'landscape';
export type CivilLandscapeToolScope = 'read' | 'propose' | 'apply';
export type CivilLandscapeToolDefinition = {
  name: string;
  domain: CivilLandscapeDomain;
  scope: CivilLandscapeToolScope;
  descriptionCode: string;
  parameters: JsonSchema;
  execution: 'executable' | 'contract_only';
};

const ID = { type: 'string', minLength: 1, maxLength: 128 } as const;
const REV = { type: 'integer', minimum: 0, maximum: 2_147_483_647 } as const;
const HASH = { type: 'string', minLength: 64, maxLength: 64 } as const;
const NUM = { type: 'number', minimum: -1_000_000_000, maximum: 1_000_000_000 } as const;
const POS = { type: 'number', minimum: 0.000001, maximum: 1_000_000_000 } as const;
const P2 = { type: 'array', items: NUM, minItems: 2, maxItems: 2 } as const;
const P3 = { type: 'array', items: NUM, minItems: 3, maxItems: 3 } as const;
const IDS = { type: 'array', items: ID, maxItems: 100_000 } as const;
const BASE = { projectId: ID, documentId: ID, revision: REV, contentHash: HASH, objectId: ID } as const;
const nested = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const TRIANGLE = { type: 'array', items: ID, minItems: 3, maxItems: 3 } as const;
const ALIGNMENT_SEGMENT = nested({
  id: ID, kind: { type: 'string', enum: ['line', 'arc', 'spiral'] }, startStationM: NUM,
  startM: P2, endM: P2, centerM: P2, radiusM: POS, startAngleDeg: NUM, endAngleDeg: NUM,
  clockwise: { type: 'boolean' }, startRadiusM: POS, endRadiusM: POS,
}, ['id', 'kind', 'startStationM']);
const PROFILE_POINT = nested({ id: ID, stationM: NUM, elevationM: NUM }, ['stationM', 'elevationM']);
const schema = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', additionalProperties: false, properties: { ...BASE, ...properties }, required: [...Object.keys(BASE), ...required] });

const civilCreate = [
  ['create_survey_control', { name: ID, positionM: P3, order: { type: 'string', enum: ['horizontal', 'vertical', 'combined'] }, evidenceId: ID }, ['name', 'positionM', 'order', 'evidenceId']],
  ['create_point', { positionM: P3, code: ID, evidenceId: ID }, ['positionM']],
  ['create_surface', { kind: { type: 'string', enum: ['existing', 'proposed'] }, pointIds: IDS, triangles: { type: 'array', items: TRIANGLE }, breaklines: { type: 'array', items: IDS }, sourceEvidenceIds: IDS }, ['kind', 'pointIds', 'triangles', 'sourceEvidenceIds']],
  ['create_alignment', { name: ID, segments: { type: 'array', items: ALIGNMENT_SEGMENT } }, ['name', 'segments']],
  ['create_profile', { alignmentId: ID, kind: { type: 'string', enum: ['existing', 'proposed'] }, points: { type: 'array', items: PROFILE_POINT } }, ['alignmentId', 'kind', 'points']],
  ['create_vertical_curve', { profileId: ID, pviId: ID, startStationM: NUM, endStationM: NUM, lengthM: POS }, ['profileId', 'pviId', 'startStationM', 'endStationM', 'lengthM']],
  ['create_superelevation_region', { alignmentId: ID, startStationM: NUM, endStationM: NUM, leftCrossSlopePercent: NUM, rightCrossSlopePercent: NUM }, ['alignmentId', 'startStationM', 'endStationM', 'leftCrossSlopePercent', 'rightCrossSlopePercent']],
  ['create_corridor_target', { corridorId: ID, kind: { type: 'string', enum: ['surface', 'alignment', 'offset', 'elevation'] }, targetObjectId: ID, startStationM: NUM, endStationM: NUM, offsetM: NUM, elevationM: NUM }, ['corridorId', 'kind', 'startStationM', 'endStationM']],
  ['create_corridor', { alignmentId: ID, profileId: ID, assemblyCode: ID, targetSurfaceIds: IDS, startStationM: NUM, endStationM: NUM }, ['alignmentId', 'profileId', 'assemblyCode', 'targetSurfaceIds', 'startStationM', 'endStationM']],
  ['create_drainage_node', { kind: { type: 'string', enum: ['inlet', 'manhole', 'outfall'] }, positionM: P3, invertElevationM: NUM, rimElevationM: NUM }, ['kind', 'positionM', 'invertElevationM', 'rimElevationM']],
  ['create_drainage_link', { fromNodeId: ID, toNodeId: ID, diameterMm: POS, lengthM: POS, material: ID }, ['fromNodeId', 'toNodeId', 'diameterMm', 'lengthM', 'material']],
  // Resize or re-route an existing drainage pipe without changing its stable
  // object identity.  The civil document validator remains the authority for
  // node references and positive pipe geometry at commit time.
  ['edit_drainage_link', { fromNodeId: ID, toNodeId: ID, diameterMm: POS, lengthM: POS, material: ID }, ['objectId']],
  ['edit_survey_control', { name: ID, positionM: P3, order: { type: 'string', enum: ['horizontal', 'vertical', 'combined'] }, evidenceId: ID }, ['objectId']],
  ['edit_drainage_node', { kind: { type: 'string', enum: ['inlet', 'manhole', 'outfall'] }, positionM: P3, invertElevationM: NUM, rimElevationM: NUM }, ['objectId']],
  ['edit_point', { objectId: ID, positionM: P3, code: ID, evidenceId: ID }, ['objectId']],
  ['edit_surface', { kind: { type: 'string', enum: ['existing', 'proposed'] }, pointIds: IDS, triangles: { type: 'array', items: TRIANGLE }, breaklines: { type: 'array', items: IDS }, sourceEvidenceIds: IDS }, ['objectId']],
  ['edit_cross_section', { alignmentId: ID, stationM: NUM, points: { type: 'array', items: nested({ offsetM: NUM, elevationM: NUM, code: ID }, ['offsetM', 'elevationM', 'code']) } }, ['objectId']],
  ['edit_catchment', { boundaryM: { type: 'array', items: P2 }, outletNodeId: ID, runoffCoefficient: NUM }, ['objectId']],
  ['edit_structure', { kind: { type: 'string', enum: ['retaining_wall', 'culvert', 'bridge', 'utility'] }, alignmentId: ID, stationM: NUM, sourceEvidenceIds: IDS }, ['objectId']],
  ['edit_alignment', { objectId: ID, name: ID, segments: { type: 'array', items: ALIGNMENT_SEGMENT } }, ['objectId']],
  // Profile edits preserve the existing stable id; the CivilDocument
  // validator remains authoritative for alignment references and strict
  // station ordering after the optional fields are merged.
  ['edit_profile', { alignmentId: ID, kind: { type: 'string', enum: ['existing', 'proposed'] }, points: { type: 'array', items: PROFILE_POINT } }, ['objectId']],
  // A profile point becomes individually editable only when the persisted
  // document gives it a stable id. Legacy id-less points remain valid and can
  // be upgraded through edit_profile without inventing an identity here.
  ['edit_profile_point', { profileId: ID, stationM: NUM, elevationM: NUM }, ['objectId', 'profileId']],
  ['edit_vertical_curve', { profileId: ID, pviId: ID, startStationM: NUM, endStationM: NUM, lengthM: POS }, ['objectId']],
  ['edit_superelevation_region', { alignmentId: ID, startStationM: NUM, endStationM: NUM, leftCrossSlopePercent: NUM, rightCrossSlopePercent: NUM }, ['objectId']],
  ['edit_corridor_target', { corridorId: ID, kind: { type: 'string', enum: ['surface', 'alignment', 'offset', 'elevation'] }, targetObjectId: ID, startStationM: NUM, endStationM: NUM, offsetM: NUM, elevationM: NUM }, ['objectId']],
  // Corridor edits preserve the existing stable id and rely on the civil
  // validator for alignment/profile references and start < end station range.
  ['edit_corridor', { alignmentId: ID, profileId: ID, assemblyCode: ID, targetSurfaceIds: IDS, startStationM: NUM, endStationM: NUM }, ['objectId']],
] as const;

const landscapeCreate = [
  ['create_plant', { speciesCode: ID, positionM: P3, installedHeightM: POS, matureCanopyDiameterM: POS, rootZoneDiameterM: POS, spacingM: POS, evidenceIds: IDS }, ['speciesCode', 'positionM', 'installedHeightM', 'matureCanopyDiameterM', 'rootZoneDiameterM', 'spacingM', 'evidenceIds']],
  ['create_soil_volume', { boundaryM: { type: 'array', items: P2 }, depthM: POS, soilType: ID, drainageClass: ID }, ['boundaryM', 'depthM', 'soilType', 'drainageClass']],
  ['create_planting_zone', { boundaryM: { type: 'array', items: P2 }, plantIds: IDS, soilVolumeId: ID, targetCoveragePercent: NUM }, ['boundaryM', 'plantIds', 'soilVolumeId', 'targetCoveragePercent']],
  ['create_hardscape', { kind: { type: 'string', enum: ['path', 'plaza', 'wall', 'deck', 'curb'] }, boundaryM: { type: 'array', items: P2 }, material: ID, slopePercent: NUM, accessible: { type: 'boolean' } }, ['kind', 'boundaryM', 'material', 'slopePercent', 'accessible']],
  ['create_irrigation_node', { kind: { type: 'string', enum: ['source', 'valve', 'emitter'] }, positionM: P3, pressureKpa: POS, flowLpm: POS }, ['kind', 'positionM']],
  ['create_irrigation_pipe', { fromNodeId: ID, toNodeId: ID, diameterMm: POS, lengthM: POS }, ['fromNodeId', 'toNodeId', 'diameterMm', 'lengthM']],
  // Resize or re-route an existing irrigation pipe while preserving its
  // stable object id.  The landscape document validator remains authoritative
  // for node kind/reference integrity at commit time.
  ['edit_irrigation_pipe', { fromNodeId: ID, toNodeId: ID, diameterMm: POS, lengthM: POS }, ['objectId']],
  ['edit_irrigation_node', { kind: { type: 'string', enum: ['source', 'valve', 'emitter'] }, positionM: P3, pressureKpa: POS, flowLpm: POS }, ['objectId']],
  ['create_irrigation_zone', { valveNodeId: ID, emitterNodeIds: IDS, plantingZoneIds: IDS, designFlowLpm: POS }, ['valveNodeId', 'emitterNodeIds', 'plantingZoneIds', 'designFlowLpm']],
  // Planting-zone edits retain the stable zone id.  Boundary, coverage, soil,
  // and plant membership are merged and then checked by the full landscape
  // document validator.
  ['edit_planting_zone', { boundaryM: { type: 'array', items: P2 }, plantIds: IDS, soilVolumeId: ID, targetCoveragePercent: NUM }, ['objectId']],
  // Irrigation-zone edits retain the stable zone id.  Valve/emitter/planting
  // membership and positive design flow remain validator-authoritative.
  ['edit_irrigation_zone', { valveNodeId: ID, emitterNodeIds: IDS, plantingZoneIds: IDS, designFlowLpm: POS }, ['objectId']],
  // Maintenance-zone edits retain the stable zone id.  Boundary containment,
  // access width, and nonempty unique task codes are validator-authoritative;
  // the optional fields are merged atomically by the executor.
  ['edit_maintenance_zone', { boundaryM: { type: 'array', items: P2 }, accessWidthM: POS, taskCodes: IDS }, ['objectId']],
  ['create_drainage_path', { pointsM: { type: 'array', items: P3 }, outletObjectId: ID, minimumSlopePercent: POS }, ['pointsM', 'outletObjectId', 'minimumSlopePercent']],
  ['edit_plant', { objectId: ID, speciesCode: ID, positionM: P3, installedHeightM: POS, matureCanopyDiameterM: POS, rootZoneDiameterM: POS, spacingM: POS, evidenceIds: IDS }, ['objectId']],
  ['edit_soil_volume', { boundaryM: { type: 'array', items: P2 }, depthM: POS, soilType: ID, drainageClass: ID }, ['objectId']],
  ['edit_hardscape', { objectId: ID, boundaryM: { type: 'array', items: P2 }, material: ID, slopePercent: NUM, accessible: { type: 'boolean' } }, ['objectId']],
  ['edit_drainage_path', { pointsM: { type: 'array', items: P3 }, outletObjectId: ID, minimumSlopePercent: POS }, ['objectId']],
] as const;

const definitions: CivilLandscapeToolDefinition[] = [
  ...civilCreate.map(([name, properties, required]) => ({ name, domain: 'civil' as const, scope: 'apply' as const, descriptionCode: `civil.${name}`, parameters: schema(properties, [...required, ...(name.startsWith('edit_') ? [] : ['objectId'])]), execution: 'executable' as const })),
  ...landscapeCreate.map(([name, properties, required]) => ({ name, domain: 'landscape' as const, scope: 'apply' as const, descriptionCode: `landscape.${name}`, parameters: schema(properties, [...required, ...(name.startsWith('edit_') ? [] : ['objectId'])]), execution: 'executable' as const })),
  // Terrain modifiers are semantic, revision-bound edits.  They do not claim
  // that a TIN/grading kernel has run; the downstream solver/export remains a
  // separate TARGET capability until it has an independent verifier.
  { name: 'create_terrain_modifier', domain: 'landscape', scope: 'apply', descriptionCode: 'landscape.create_terrain_modifier', parameters: schema({ objectId: ID, boundaryM: { type: 'array', items: P2 }, deltaM: NUM }, ['objectId', 'boundaryM', 'deltaM']), execution: 'executable' },
  { name: 'export_landxml', domain: 'civil', scope: 'propose', descriptionCode: 'civil.export_landxml', parameters: schema({ format: { type: 'string', enum: ['landxml'] } }, ['format']), execution: 'contract_only' },
  { name: 'export_dxf', domain: 'civil', scope: 'propose', descriptionCode: 'civil.export_dxf', parameters: schema({ format: { type: 'string', enum: ['dxf'] } }, ['format']), execution: 'contract_only' },
];

export const CIVIL_LANDSCAPE_TOOL_CATALOG: readonly CivilLandscapeToolDefinition[] = Object.freeze(definitions);
export function getCivilLandscapeToolCatalog(): readonly CivilLandscapeToolDefinition[] { return CIVIL_LANDSCAPE_TOOL_CATALOG; }
export function getCivilLandscapeTool(name: string): CivilLandscapeToolDefinition | undefined { return CIVIL_LANDSCAPE_TOOL_CATALOG.find(item => item.name === name); }
export function validateCivilLandscapeToolCatalog(value: unknown = CIVIL_LANDSCAPE_TOOL_CATALOG): string[] {
  if (!Array.isArray(value)) return ['catalog_not_array'];
  const issues: string[] = [], names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') { issues.push('catalog_entry_invalid'); continue; }
    const tool = item as Partial<CivilLandscapeToolDefinition>;
    if (typeof tool.name !== 'string' || names.has(tool.name)) issues.push(`catalog_name_invalid:${String(tool.name)}`); else names.add(tool.name);
    if (!['civil', 'landscape'].includes(String(tool.domain)) || !['read', 'propose', 'apply'].includes(String(tool.scope)) || !['executable', 'contract_only'].includes(String(tool.execution))) issues.push(`catalog_metadata_invalid:${String(tool.name)}`);
    const result = validateToolArguments(tool.parameters as JsonSchema, {});
    if (!result.ok && result.error.code === 'INVALID_TOOL_SCHEMA') issues.push(`catalog_schema_invalid:${String(tool.name)}`);
    if (tool.parameters === undefined || typeof tool.parameters !== 'object') issues.push(`catalog_schema_invalid:${String(tool.name)}`);
  }
  return issues.filter((issue, index, all) => all.indexOf(issue) === index);
}

export function validateCivilLandscapeToolArguments(name: string, value: unknown): string[] {
  const tool = getCivilLandscapeTool(name);
  if (!tool) return ['tool_not_found'];
  const result = validateToolArguments(tool.parameters, value);
  return result.ok ? [] : ['arguments_invalid'];
}
