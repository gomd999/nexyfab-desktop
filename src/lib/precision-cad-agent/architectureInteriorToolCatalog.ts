import { validateToolArguments, type JsonSchema } from './toolArgumentsValidator';

/**
 * Browser-only Architecture/Interior catalog.  It is deliberately separate
 * from the mechanical installer catalog: these tools describe deterministic
 * document operations and never accept a filesystem path, URL, credential,
 * or localized free-form instruction.
 */
export const ARCHITECTURE_INTERIOR_CATALOG_VERSION = 'nexyfab.precision-cad.architecture-interior.v1' as const;
export type ArchitectureInteriorToolScope = 'read' | 'propose' | 'apply' | 'export';

export type ArchitectureInteriorAdapterMetadata = {
  module: string;
  operation: string;
  deterministic: true;
  network: 'none';
  /** Catalog contract only. A server-side executor must explicitly promote this before exposure. */
  execution: 'contract_only';
};

export type ArchitectureInteriorToolDefinition = {
  name: string;
  scope: ArchitectureInteriorToolScope;
  descriptionCode: string;
  parameters: JsonSchema;
  adapter: ArchitectureInteriorAdapterMetadata;
};

const ID = { type: 'string', minLength: 1, maxLength: 128 } as const;
const CODE = { type: 'string', minLength: 1, maxLength: 96 } as const;
const REVISION = { type: 'integer', minimum: 0, maximum: 2_147_483_647 } as const;
const NUMBER = { type: 'number', minimum: -1_000_000_000, maximum: 1_000_000_000 } as const;
const POSITIVE = { type: 'number', minimum: 0.000001, maximum: 1_000_000_000 } as const;
const POINT2 = { type: 'array', items: NUMBER, minItems: 2, maxItems: 2 } as const;
const POINT3 = { type: 'array', items: NUMBER, minItems: 3, maxItems: 3 } as const;
const ID_LIST = { type: 'array', items: ID } as const;
const PATH_LIST = { type: 'array', items: CODE } as const;

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

const BOUND = {
  revision: REVISION,
  documentId: ID,
  objectId: ID,
  parameterPaths: PATH_LIST,
} as const;

const APPLY_REQUIRED = ['revision', 'documentId', 'objectId', 'parameterPaths', 'patch'];
const applySchema = (properties: Record<string, JsonSchema>, patchRequired: string[] = []): JsonSchema => objectSchema({ ...BOUND, patch: objectSchema(properties, patchRequired) }, APPLY_REQUIRED);
const readSchema = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => objectSchema({ revision: REVISION, documentId: ID, objectId: ID, ...properties }, required);
const renderSchema = objectSchema({ revision: REVISION, documentId: ID, viewCode: { type: 'string', enum: ['plan', 'section', 'axonometric', 'perspective'] }, objectIds: ID_LIST }, ['revision', 'documentId', 'viewCode']);
const exportSchema = objectSchema({ revision: REVISION, documentId: ID, formatCode: { type: 'string', enum: ['ifc', 'drawing', 'schedule'] }, selectionIds: ID_LIST }, ['revision', 'documentId', 'formatCode']);
const documentModule = 'src/lib/ai/architectureInteriorDocuments.ts';
const adapter = (operation: string, module = documentModule): ArchitectureInteriorAdapterMetadata => ({ module, operation, deterministic: true, network: 'none', execution: 'contract_only' });

function definition(
  name: string,
  scope: ArchitectureInteriorToolScope,
  parameters: JsonSchema,
  operation: string,
  descriptionCode = name,
): ArchitectureInteriorToolDefinition {
  return { name, scope, descriptionCode, parameters, adapter: adapter(operation) };
}

const architecturePatch = {
  kind: { type: 'string', enum: ['line', 'arc'] }, storeyId: ID,
  startMm: POINT2, endMm: POINT2, centerMm: POINT2,
  radiusMm: POSITIVE, startAngleDeg: NUMBER, endAngleDeg: NUMBER,
  thicknessMm: POSITIVE, heightMm: POSITIVE,
};
const spacePatch = { storeyId: ID, name: CODE, usageCode: CODE, boundaryMm: { type: 'array', items: POINT2 }, wallIds: ID_LIST, slabId: ID, ceilingId: ID };
const spaceCreatePatch = { ...spacePatch, slabThicknessMm: POSITIVE, ceilingElevationMm: NUMBER, ceilingThicknessMm: POSITIVE };
const slabPatch = { storeyId: ID, spaceId: ID, boundaryMm: { type: 'array', items: POINT2 }, thicknessMm: POSITIVE };
const openingPatch = { kind: { type: 'string', enum: ['window', 'door'] }, hostWallId: ID, offsetMm: NUMBER, widthMm: POSITIVE, heightMm: POSITIVE, sillMm: NUMBER, positionMm: POINT3, connectsSpaceIds: ID_LIST, isExit: { type: 'boolean' } };
const editSlabPatch = { boundaryMm: { type: 'array', items: POINT2 }, thicknessMm: POSITIVE };
const editOpeningPatch = { offsetMm: NUMBER, widthMm: POSITIVE, heightMm: POSITIVE, sillMm: NUMBER };
const editCeilingPatch = { elevationMm: NUMBER, thicknessMm: POSITIVE };
const editFurniturePatch = { positionMm: POINT3, sizeMm: POINT3, clearanceMm: NUMBER, rotationDeg: NUMBER };
const editLightPatch = { positionMm: POINT3, suspensionMm: NUMBER, lumens: POSITIVE, cctK: POSITIVE };
const editFinishPatch = { hostId: ID, surfaceCode: { type: 'string', enum: ['floor', 'wall', 'ceiling'] }, materialCode: CODE };
const editMillworkPatch = { spaceId: ID, hostWallId: ID, positionMm: POINT3, sizeMm: POINT3, materialCode: CODE, clearanceMm: NUMBER };
const furnitureCreatePatch = { spaceId: ID, positionMm: POINT3, sizeMm: POINT3, clearanceMm: NUMBER, rotationDeg: NUMBER };
const lightCreatePatch = { spaceId: ID, hostCeilingId: ID, positionMm: POINT3, suspensionMm: NUMBER, lumens: POSITIVE, cctK: POSITIVE };
const finishCreatePatch = { spaceId: ID, hostId: ID, surfaceCode: { type: 'string', enum: ['floor', 'wall', 'ceiling'] }, materialCode: CODE };
const millworkCreatePatch = { spaceId: ID, hostWallId: ID, positionMm: POINT3, sizeMm: POINT3, materialCode: CODE, clearanceMm: NUMBER };
const ceilingSystemCreatePatch = { spaceId: ID, hostCeilingId: ID, kind: { type: 'string', enum: ['gypsum', 'grid', 'open', 'acoustic'] }, elevationMm: NUMBER, moduleMm: POINT2 };
const ceilingSystemEditPatch = { kind: { type: 'string', enum: ['gypsum', 'grid', 'open', 'acoustic'] }, elevationMm: NUMBER, moduleMm: POINT2 };
const stairPatch = { fromStoreyId: ID, toStoreyId: ID, widthMm: POSITIVE, riserCount: { type: 'integer', minimum: 1, maximum: 1000 }, treadDepthMm: POSITIVE, pathMm: { type: 'array', items: POINT3, minItems: 2 } };
const shaftPatch = { fromStoreyId: ID, toStoreyId: ID, boundaryMm: { type: 'array', items: POINT2, minItems: 3, maxItems: 256 }, hostSpaceIds: ID_LIST };
const editShaftPatch = shaftPatch;
const elevatorPatch = { shaftId: ID, servedStoreyIds: { type: 'array', items: ID, minItems: 2, maxItems: 128 } };
const editElevatorPatch = elevatorPatch;
const serviceOpeningPatch = { hostId: ID, sourceRouteId: ID, sourceSleeveId: ID, shape: { type: 'string', enum: ['round'] }, centerMm: POINT3, axis: POINT3, cutDiameterMm: POSITIVE, depthMm: POSITIVE, firestopAnnulusMm: { type: 'number', minimum: 0, maximum: 1_000_000_000 }, structuralApprovalId: ID };
const editServiceOpeningPatch = serviceOpeningPatch;
const gridPatch = { name: CODE, axis: { type: 'string', enum: ['x', 'y', 'radial'] }, startMm: POINT2, endMm: POINT2 };
const editGridPatch = { name: CODE, axis: { type: 'string', enum: ['x', 'y', 'radial'] }, startMm: POINT2, endMm: POINT2 };
const editStoreyPatch = { name: CODE, elevationMm: NUMBER, heightMm: POSITIVE };

export const ARCHITECTURE_INTERIOR_TOOL_CATALOG: readonly ArchitectureInteriorToolDefinition[] = Object.freeze([
  definition('get_project_context', 'read', readSchema({ contextCode: CODE }, ['revision', 'documentId', 'contextCode']), 'architectureDomainDocument'),
  definition('list_storeys_spaces', 'read', readSchema({ storeyId: ID }, ['revision', 'documentId']), 'architectureDomainDocument'),
  definition('inspect_element', 'read', readSchema({ includeRelations: { type: 'boolean' } }, ['revision', 'documentId', 'objectId']), 'architectureDomainDocument'),
  definition('measure_element', 'read', readSchema({ measureCode: { type: 'string', enum: ['length', 'area', 'height', 'clearance', 'volume'] } }, ['revision', 'documentId', 'objectId', 'measureCode']), 'architectureDomainDocument'),
  definition('verify_architecture', 'read', readSchema({ checkCode: CODE }, ['revision', 'documentId', 'checkCode']), 'validateArchitectureDocument'),
  definition('verify_interior', 'read', readSchema({ checkCode: CODE }, ['revision', 'documentId', 'checkCode']), 'validateInteriorDocument'),
  definition('verify_space', 'read', readSchema({ checkCode: { type: 'string', enum: ['topology', 'boundary', 'furniture_clearance'] } }, ['revision', 'documentId', 'objectId', 'checkCode']), 'verifyArchitectureTopology'),
  definition('verify_egress', 'read', readSchema({ checkCode: CODE }, ['revision', 'documentId', 'checkCode']), 'verifyArchitecturalCirculation', 'verify.egress'),
  definition('verify_door', 'read', readSchema({ checkCode: { type: 'string', enum: ['host_range', 'swing_clearance', 'space_connection'] } }, ['revision', 'documentId', 'objectId', 'checkCode']), 'buildDoorSwingInput', 'verify.door'),
  definition('verify_mep', 'read', readSchema({ checkCode: CODE }, ['revision', 'documentId', 'checkCode']), 'architectureDomainDocument', 'verify.mep'),
  definition('verify_daylight', 'read', readSchema({ checkCode: CODE }, ['revision', 'documentId', 'checkCode']), 'architectureDomainDocument', 'verify.daylight'),

  definition('render_plan', 'propose', renderSchema, 'render.plan'),
  definition('render_section', 'propose', renderSchema, 'render.section'),
  definition('render_3d', 'propose', renderSchema, 'render.3d'),

  definition('create_storey', 'apply', applySchema({ name: CODE, elevationMm: NUMBER, heightMm: POSITIVE }), 'applyArchitectureInteriorEdit'),
  definition('edit_storey', 'apply', applySchema(editStoreyPatch), 'applyArchitectureInteriorEdit'),
  definition('create_wall', 'apply', applySchema(architecturePatch), 'applyArchitectureInteriorEdit'),
  definition('edit_wall', 'apply', applySchema(architecturePatch), 'applyArchitectureInteriorEdit'),
  definition('create_space', 'apply', applySchema(spaceCreatePatch, ['storeyId', 'name', 'usageCode', 'boundaryMm', 'wallIds', 'slabId', 'ceilingId', 'slabThicknessMm', 'ceilingElevationMm', 'ceilingThicknessMm']), 'applyArchitectureInteriorEdit'),
  definition('edit_space', 'apply', applySchema(spacePatch), 'applyArchitectureInteriorEdit'),
  definition('create_slab', 'apply', applySchema(slabPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_slab', 'apply', applySchema(editSlabPatch), 'applyArchitectureInteriorEdit'),
  definition('create_opening', 'apply', applySchema(openingPatch), 'applyArchitectureInteriorEdit'),
  definition('create_grid', 'apply', applySchema(gridPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_grid', 'apply', applySchema(editGridPatch), 'applyArchitectureInteriorEdit'),
  definition('create_furniture', 'apply', applySchema(furnitureCreatePatch, ['spaceId', 'positionMm', 'sizeMm', 'clearanceMm']), 'applyArchitectureInteriorEdit'),
  definition('create_light', 'apply', applySchema(lightCreatePatch, ['spaceId', 'hostCeilingId', 'positionMm', 'suspensionMm', 'lumens', 'cctK']), 'applyArchitectureInteriorEdit'),
  definition('create_finish', 'apply', applySchema(finishCreatePatch, ['spaceId', 'hostId', 'surfaceCode', 'materialCode']), 'applyArchitectureInteriorEdit'),
  definition('create_millwork', 'apply', applySchema(millworkCreatePatch, ['spaceId', 'positionMm', 'sizeMm', 'materialCode', 'clearanceMm']), 'applyArchitectureInteriorEdit'),
  definition('create_ceiling_system', 'apply', applySchema(ceilingSystemCreatePatch, ['spaceId', 'hostCeilingId', 'kind', 'elevationMm']), 'applyArchitectureInteriorEdit'),
  definition('edit_opening', 'apply', applySchema(editOpeningPatch), 'applyArchitectureInteriorEdit'),
  definition('create_stair', 'apply', applySchema(stairPatch, ['fromStoreyId', 'toStoreyId', 'widthMm', 'riserCount', 'treadDepthMm', 'pathMm']), 'applyArchitectureInteriorEdit'),
  definition('create_shaft', 'apply', applySchema(shaftPatch, ['fromStoreyId', 'toStoreyId', 'boundaryMm', 'hostSpaceIds']), 'applyArchitectureInteriorEdit'),
  definition('create_elevator', 'apply', applySchema(elevatorPatch, ['shaftId', 'servedStoreyIds']), 'applyArchitectureInteriorEdit'),
  definition('create_service_opening', 'apply', applySchema(serviceOpeningPatch, ['hostId', 'sourceRouteId', 'sourceSleeveId', 'shape', 'centerMm', 'axis', 'cutDiameterMm', 'depthMm', 'firestopAnnulusMm']), 'applyArchitectureInteriorEdit'),
  definition('edit_stair', 'apply', applySchema(stairPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_shaft', 'apply', applySchema(editShaftPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_elevator', 'apply', applySchema(editElevatorPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_service_opening', 'apply', applySchema(editServiceOpeningPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_furniture', 'apply', applySchema(editFurniturePatch), 'applyArchitectureInteriorEdit'),
  definition('edit_finish', 'apply', applySchema(editFinishPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_ceiling', 'apply', applySchema(editCeilingPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_light', 'apply', applySchema(editLightPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_millwork', 'apply', applySchema(editMillworkPatch), 'applyArchitectureInteriorEdit'),
  definition('edit_ceiling_system', 'apply', applySchema(ceilingSystemEditPatch), 'applyArchitectureInteriorEdit'),

  definition('export_ifc', 'export', { ...exportSchema, properties: { ...(exportSchema.properties as Record<string, unknown>), formatCode: { type: 'string', enum: ['ifc'] } } }, 'export.ifc'),
  definition('export_drawing', 'export', { ...exportSchema, properties: { ...(exportSchema.properties as Record<string, unknown>), formatCode: { type: 'string', enum: ['drawing'] } } }, 'export.drawing'),
  definition('export_schedule', 'export', { ...exportSchema, properties: { ...(exportSchema.properties as Record<string, unknown>), formatCode: { type: 'string', enum: ['schedule'] } } }, 'export.schedule'),
]);

const TOOL_BY_NAME = new Map(ARCHITECTURE_INTERIOR_TOOL_CATALOG.map(tool => [tool.name, tool]));
const APPLY_SCOPES = new Set<ArchitectureInteriorToolScope>(['apply']);
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const FORBIDDEN_KEY = /(?:path|file|folder|directory|url|uri|secret|token|password|credential|api[-_]?key|base64)/i;
const FORBIDDEN_VALUE = /(?:^[a-z]:[\\/]|^[\\/]{1,2}|\.\.?[\\/]|^[a-z][a-z0-9+.-]{1,20}:\/\/|[\\/])/i;
const ALLOWED_GEOMETRY_KEYS = new Set(['parameterPaths', 'pathMm', 'pathPointMm']);
const IDENTIFIER_KEYS = new Set(['documentId', 'objectId', 'storeyId', 'spaceId', 'wallId', 'slabId', 'ceilingId', 'hostId', 'hostWallId', 'hostCeilingId', 'fromStoreyId', 'toStoreyId', 'shaftId', 'sourceRouteId', 'sourceSleeveId', 'structuralApprovalId', 'catalogCode', 'materialCode', 'iesProfileCode', 'contextCode', 'checkCode', 'measureCode', 'formatCode', 'viewCode', 'kindCode', 'surfaceCode', 'usageCode']);
const IDENTIFIER_ARRAY_KEYS = new Set(['objectIds', 'selectionIds', 'wallIds', 'connectsSpaceIds', 'hostSpaceIds', 'servedStoreyIds']);
// `centerMm` is used by both V2 wall arcs and V3 service openings; the
// per-tool schema owns its dimensionality, so it must not be globally
// constrained as a V2 point here.
const POINT2_KEYS = new Set(['startMm', 'endMm', 'moduleMm', 'boundaryPointMm']);
const POINT3_KEYS = new Set(['positionMm', 'sizeMm', 'pathPointMm']);

function inspectValue(value: unknown, key = '', depth = 0, seen = new Set<object>()): string[] {
  if (depth > 8) return ['arguments_depth_exceeded'];
  if (FORBIDDEN_KEY.test(key) && !ALLOWED_GEOMETRY_KEYS.has(key) && !/^pathPointMm\[\d+\]$/.test(key)) return [`forbidden_key:${key}`];
  if (typeof value === 'string') {
    if (value.length > 2048) return [`string_too_long:${key}`];
    if (/[\u0000-\u001f\u007f]/.test(value)) return [`control_character:${key}`];
    if (FORBIDDEN_VALUE.test(value)) return [`forbidden_path_or_url:${key}`];
    if (IDENTIFIER_KEYS.has(key) && !SAFE_CODE.test(value)) return [`stable_code_invalid:${key}`];
    if (key === 'parameterPaths' && !SAFE_CODE.test(value)) return [`parameter_path_invalid:${value}`];
    return [];
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return [];
  if (typeof value !== 'object') return [`value_type_invalid:${key}`];
  if (seen.has(value)) return ['arguments_cycle'];
  seen.add(value);
  const issues: string[] = [];
  if (Array.isArray(value)) {
    if (value.length > 128) issues.push(`array_too_large:${key}`);
    if (key === 'parameterPaths' && (value.length < 1 || value.length > 32)) issues.push('parameter_paths_bounds_invalid');
    if (POINT2_KEYS.has(key) && value.length !== 2) issues.push(`point2_bounds_invalid:${key}`);
    if (POINT3_KEYS.has(key) && value.length !== 3) issues.push(`point3_bounds_invalid:${key}`);
    if (key === 'boundaryMm' && (value.length < 3 || value.length > 256)) issues.push(`geometry_array_bounds_invalid:${key}`);
    if (key === 'pathMm' && (value.length < 2 || value.length > 256)) issues.push(`geometry_array_bounds_invalid:${key}`);
    value.slice(0, 129).forEach((item, index) => {
      const childKey = key === 'parameterPaths'
        ? 'parameterPaths'
        : IDENTIFIER_ARRAY_KEYS.has(key)
          ? 'objectId'
          : key === 'boundaryMm'
            ? 'boundaryPointMm'
            : key === 'pathMm'
              ? 'pathPointMm'
              : `${key}[${index}]`;
      issues.push(...inspectValue(item, childKey, depth + 1, seen));
    });
  } else {
    for (const [childKey, child] of Object.entries(value)) issues.push(...inspectValue(child, childKey, depth + 1, seen));
  }
  seen.delete(value);
  return issues;
}

function strictSchemaIssues(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`schema_invalid:${path}`];
  const value = schema as Record<string, unknown>;
  const issues: string[] = [];
  if (value.type === 'object') {
    if (value.additionalProperties !== false) issues.push(`schema_not_closed:${path}`);
    if (value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)) {
      for (const [key, child] of Object.entries(value.properties)) issues.push(...strictSchemaIssues(child, `${path}.${key}`));
    }
  } else if (value.type === 'array' && value.items !== undefined) issues.push(...strictSchemaIssues(value.items, `${path}[]`));
  return issues;
}

export function getArchitectureInteriorToolCatalog(): readonly ArchitectureInteriorToolDefinition[] {
  return ARCHITECTURE_INTERIOR_TOOL_CATALOG;
}

export function validateArchitectureInteriorToolCatalog(value: unknown = ARCHITECTURE_INTERIOR_TOOL_CATALOG): string[] {
  if (!Array.isArray(value) || value.length !== ARCHITECTURE_INTERIOR_TOOL_CATALOG.length) return ['catalog_count_invalid'];
  const issues: string[] = [], names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { issues.push('catalog_item_invalid'); continue; }
    const tool = item as Partial<ArchitectureInteriorToolDefinition>;
    if (typeof tool.name !== 'string' || !TOOL_BY_NAME.has(tool.name) || names.has(tool.name)) issues.push('catalog_name_invalid');
    if (typeof tool.name === 'string') names.add(tool.name);
    if (!['read', 'propose', 'apply', 'export'].includes(String(tool.scope))) issues.push('catalog_scope_invalid');
    if (typeof tool.descriptionCode !== 'string' || !SAFE_CODE.test(tool.descriptionCode)) issues.push('catalog_description_code_invalid');
    const schemaCheck = tool.parameters ? validateToolArguments(tool.parameters, {}) : { ok: false as const, error: { code: 'INVALID_TOOL_SCHEMA' as const } };
    if (!schemaCheck.ok && schemaCheck.error.code === 'INVALID_TOOL_SCHEMA') issues.push(`catalog_schema_invalid:${tool.name}`);
    if (strictSchemaIssues(tool.parameters).length) issues.push(`catalog_schema_invalid:${tool.name}`);
    if (!tool.adapter || tool.adapter.deterministic !== true || tool.adapter.network !== 'none' || tool.adapter.execution !== 'contract_only' || typeof tool.adapter.module !== 'string' || typeof tool.adapter.operation !== 'string') issues.push('catalog_adapter_invalid');
  }
  for (const tool of ARCHITECTURE_INTERIOR_TOOL_CATALOG) if (!names.has(tool.name)) issues.push(`catalog_missing:${tool.name}`);
  return [...new Set(issues)];
}

export function validateArchitectureInteriorToolArguments(name: string, value: unknown): string[] {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return ['tool_not_allowed'];
  const issues = inspectValue(value);
  const validation = validateToolArguments(tool.parameters, value);
  if (!validation.ok) issues.push(validation.error.code.toLowerCase());
  if (APPLY_SCOPES.has(tool.scope)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push('apply_binding_required');
    else {
      const input = value as Record<string, unknown>;
      const parameterPaths = Array.isArray(input.parameterPaths) ? input.parameterPaths.filter((item): item is string => typeof item === 'string') : [];
      const patchValue = input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch) ? input.patch as Record<string, unknown> : null;
      const patchKeys = patchValue ? Object.keys(patchValue) : [];
      if (!patchKeys.length) issues.push('apply_patch_required');
      for (const patchKey of patchKeys) if (!parameterPaths.some(path => path === patchKey || path.endsWith(`.${patchKey}`))) issues.push(`patch_parameter_path_missing:${patchKey}`);
      for (const path of parameterPaths) {
        const field = path.split('.').at(-1);
        if (field && !patchKeys.includes(field)) issues.push(`parameter_path_not_in_patch:${path}`);
      }
    }
  }
  return [...new Set(issues)];
}
