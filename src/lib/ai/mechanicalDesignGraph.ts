import { MECHANICAL_CORE_AI_EDITABLE_FEATURES } from './mechanicalCoreFeatureContract';

/**
 * Canonical, lossless AI <-> precision-CAD boundary.
 *
 * The graph keeps the exact JSON-safe NFAB source payload. AI edits are
 * expressed as small, revision-bound patches against existing numeric
 * parameters; unsupported feature nodes are never reconstructed or dropped.
 */

export const MECHANICAL_DESIGN_GRAPH_SCHEMA = 'nexyfab.mechanical-design-graph.v1' as const;
export const MECHANICAL_DESIGN_PATCH_SCHEMA = 'nexyfab.mechanical-design-patch.v1' as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

export interface MechanicalDesignGraphNodeV1 {
  id: string;
  kind: string;
  enabled: boolean;
  parentId: string | null;
  params: Record<string, number>;
  expressionKeys: string[];
  hasSelectionBinding: boolean;
  /** Exact persisted NFAB node. It is never regenerated from this summary. */
  source: JsonObject;
}

export interface MechanicalDesignGraphV1 {
  schema: typeof MECHANICAL_DESIGN_GRAPH_SCHEMA;
  units: 'mm';
  sourceFormat: 'nfab';
  sourceFormatVersion: number;
  revisionSha256: string;
  parentRevisionSha256: string | null;
  rootId: string;
  activeNodeId: string;
  base: {
    id: string;
    shapeId: string;
    params: Record<string, number>;
    expressionKeys: string[];
  };
  nodes: MechanicalDesignGraphNodeV1[];
  /** Full JSON-safe source. Applying a patch mutates a clone of this object. */
  sourceProject: JsonObject;
}

export type MechanicalDesignPatchOperationV1 =
  | {
      op: 'set_parameter';
      targetId: string;
      parameter: string;
      expectedValue: number;
      value: number;
    }
  | {
      op: 'set_enabled';
      targetId: string;
      expectedEnabled: boolean;
      enabled: boolean;
    };

export interface MechanicalDesignPatchV1 {
  schema: typeof MECHANICAL_DESIGN_PATCH_SCHEMA;
  baseRevisionSha256: string;
  operations: MechanicalDesignPatchOperationV1[];
}

export type MechanicalDesignPatchResult =
  | { ok: true; graph: MechanicalDesignGraphV1; appliedOperations: number }
  | { ok: false; graph: MechanicalDesignGraphV1; errors: string[] };

const SHA256 = /^[a-f0-9]{64}$/;
const AI_PARAMETER_EDITABLE_FEATURES = MECHANICAL_CORE_AI_EDITABLE_FEATURES;

function toJson(value: unknown, path = '$'): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`MECHANICAL_GRAPH_NON_FINITE:${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => toJson(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const output: JsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = toJson(item, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`MECHANICAL_GRAPH_UNSUPPORTED:${path}`);
}

function asObject(value: JsonValue | undefined, code: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(code);
  return value;
}

function asArray(value: JsonValue | undefined, code: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function finiteParams(value: JsonValue | undefined, path: string): Record<string, number> {
  const object = asObject(value ?? {}, `${path}_INVALID`);
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`${path}_NON_NUMERIC:${key}`);
    output[key] = item;
  }
  return output;
}

function stringKeys(value: JsonValue | undefined): string[] {
  if (!value || Array.isArray(value) || typeof value !== 'object') return [];
  return Object.keys(value).sort();
}

export function canonicalizeMechanicalDesign(value: unknown): string {
  const json = toJson(value);
  const render = (item: JsonValue): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(render).join(',')}]`;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${render(item[key]!)}`).join(',')}}`;
  };
  return render(json);
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function revisionPayload(project: JsonObject): JsonObject {
  const payload: JsonObject = {};
  for (const key of [
    'magic', 'version', 'tree', 'assembly', 'manufacturing',
    'configurations', 'activeConfigurationId', 'scadIntents', 'referenceGeometry',
  ]) {
    if (project[key] !== undefined) payload[key] = project[key]!;
  }
  const scene = asObject(project.scene, 'MECHANICAL_GRAPH_SCENE_REQUIRED');
  const designScene: JsonObject = {};
  for (const key of [
    'selectedId', 'params', 'paramExpressions', 'sketchPlane', 'sketchProfile',
    'sketchConfig', 'sketchFaceFrame', 'globalVariables',
  ]) {
    if (scene[key] !== undefined) designScene[key] = scene[key]!;
  }
  payload.scene = designScene;
  return payload;
}

function persistedParentRevision(project: JsonObject): string | null {
  if (!project.meta || Array.isArray(project.meta) || typeof project.meta !== 'object') return null;
  const binding = project.meta.nexyfabMechanicalDesignGraph;
  if (!binding || Array.isArray(binding) || typeof binding !== 'object') return null;
  return typeof binding.parentRevisionSha256 === 'string' && SHA256.test(binding.parentRevisionSha256)
    ? binding.parentRevisionSha256
    : null;
}

export async function buildMechanicalDesignGraph(projectInput: unknown): Promise<MechanicalDesignGraphV1> {
  const sourceProject = asObject(toJson(projectInput), 'MECHANICAL_GRAPH_PROJECT_INVALID');
  const tree = asObject(sourceProject.tree, 'MECHANICAL_GRAPH_TREE_REQUIRED');
  const scene = asObject(sourceProject.scene, 'MECHANICAL_GRAPH_SCENE_REQUIRED');
  const rawNodes = asArray(tree.nodes, 'MECHANICAL_GRAPH_NODES_REQUIRED');
  const rootId = typeof tree.rootId === 'string' && tree.rootId.trim() ? tree.rootId : 'base';
  const activeNodeId = typeof tree.activeNodeId === 'string' && tree.activeNodeId.trim()
    ? tree.activeNodeId
    : rootId;
  const shapeId = typeof scene.selectedId === 'string' && scene.selectedId.trim()
    ? scene.selectedId
    : 'unknown';
  const ids = new Set<string>();
  const nodes = rawNodes.map((item, index): MechanicalDesignGraphNodeV1 => {
    const source = asObject(item, `MECHANICAL_GRAPH_NODE_INVALID:${index}`);
    const id = typeof source.id === 'string' && source.id.trim() ? source.id : '';
    if (!id) throw new Error(`MECHANICAL_GRAPH_NODE_ID_REQUIRED:${index}`);
    if (ids.has(id)) throw new Error(`MECHANICAL_GRAPH_NODE_ID_DUPLICATE:${id}`);
    ids.add(id);
    const kind = typeof source.featureType === 'string'
      ? source.featureType
      : (typeof source.type === 'string' ? source.type : 'unknown');
    return {
      id,
      kind,
      enabled: source.enabled !== false,
      parentId: typeof source.parentId === 'string' ? source.parentId : null,
      params: finiteParams(source.params, `MECHANICAL_GRAPH_NODE_PARAMS:${id}`),
      expressionKeys: stringKeys(source.paramExpressions),
      hasSelectionBinding: Array.isArray(source.edgeSelections) || Array.isArray(source.faceSelections),
      source,
    };
  });
  if (!ids.has(rootId) && rawNodes.length > 0) throw new Error('MECHANICAL_GRAPH_ROOT_MISSING');
  if (!ids.has(activeNodeId) && rawNodes.length > 0) throw new Error('MECHANICAL_GRAPH_ACTIVE_NODE_MISSING');
  const version = typeof sourceProject.version === 'number' ? sourceProject.version : 0;
  const revisionSha256 = await sha256(canonicalizeMechanicalDesign(revisionPayload(sourceProject)));
  return {
    schema: MECHANICAL_DESIGN_GRAPH_SCHEMA,
    units: 'mm',
    sourceFormat: 'nfab',
    sourceFormatVersion: version,
    revisionSha256,
    parentRevisionSha256: persistedParentRevision(sourceProject),
    rootId,
    activeNodeId,
    base: {
      id: rootId,
      shapeId,
      params: finiteParams(scene.params, 'MECHANICAL_GRAPH_BASE_PARAMS'),
      expressionKeys: stringKeys(scene.paramExpressions),
    },
    nodes,
    sourceProject,
  };
}

function sameNumber(actual: number, expected: number): boolean {
  return Object.is(actual, expected) || actual === expected;
}

/**
 * Applies the complete patch atomically. Any stale value, opaque target,
 * expression-driven parameter, invalid number, or lock conflict rejects the
 * entire batch and returns the original graph unchanged.
 */
export async function applyMechanicalDesignPatch(
  graph: MechanicalDesignGraphV1,
  patch: MechanicalDesignPatchV1,
  options: { lockedParameters?: ReadonlyArray<{ targetId: string; parameter: string }> } = {},
): Promise<MechanicalDesignPatchResult> {
  const errors: string[] = [];
  if (patch?.schema !== MECHANICAL_DESIGN_PATCH_SCHEMA) errors.push('PATCH_SCHEMA_INVALID');
  if (!SHA256.test(patch?.baseRevisionSha256 ?? '')) errors.push('PATCH_BASE_REVISION_INVALID');
  else if (patch.baseRevisionSha256 !== graph.revisionSha256) errors.push('PATCH_BASE_REVISION_STALE');
  if (!Array.isArray(patch?.operations) || patch.operations.length === 0) errors.push('PATCH_OPERATIONS_REQUIRED');
  if (errors.length) return { ok: false, graph, errors };

  const nextProject = asObject(toJson(graph.sourceProject), 'MECHANICAL_GRAPH_PROJECT_INVALID');
  const tree = asObject(nextProject.tree, 'MECHANICAL_GRAPH_TREE_REQUIRED');
  const scene = asObject(nextProject.scene, 'MECHANICAL_GRAPH_SCENE_REQUIRED');
  const nodes = asArray(tree.nodes, 'MECHANICAL_GRAPH_NODES_REQUIRED');
  const nodeById = new Map<string, JsonObject>();
  for (const item of nodes) {
    const node = asObject(item, 'MECHANICAL_GRAPH_NODE_INVALID');
    if (typeof node.id === 'string') nodeById.set(node.id, node);
  }
  const locked = new Set((options.lockedParameters ?? []).map(item => `${item.targetId}\u0000${item.parameter}`));

  for (const [index, operation] of patch.operations.entries()) {
    const prefix = `PATCH_OPERATION_${index}`;
    if (operation.op === 'set_parameter') {
      if (!Number.isFinite(operation.value) || !Number.isFinite(operation.expectedValue)) {
        errors.push(`${prefix}_NON_FINITE`);
        continue;
      }
      if (!operation.parameter.trim()) {
        errors.push(`${prefix}_PARAMETER_REQUIRED`);
        continue;
      }
      if (locked.has(`${operation.targetId}\u0000${operation.parameter}`)) {
        errors.push(`${prefix}_PARAMETER_LOCKED`);
        continue;
      }
      let params: JsonObject;
      let expressionKeys: string[];
      if (operation.targetId === graph.rootId) {
        if (graph.base.shapeId !== 'box' && graph.base.shapeId !== 'cylinder') {
          errors.push(`${prefix}_BASE_OPAQUE`);
          continue;
        }
        params = asObject(scene.params, 'MECHANICAL_GRAPH_BASE_PARAMS_INVALID');
        expressionKeys = stringKeys(scene.paramExpressions);
      } else {
        const summary = graph.nodes.find(node => node.id === operation.targetId);
        const node = nodeById.get(operation.targetId);
        if (!summary || !node) {
          errors.push(`${prefix}_TARGET_MISSING`);
          continue;
        }
        if (!AI_PARAMETER_EDITABLE_FEATURES.has(summary.kind)) {
          errors.push(`${prefix}_TARGET_OPAQUE:${summary.kind}`);
          continue;
        }
        params = asObject(node.params, `${prefix}_PARAMS_INVALID`);
        expressionKeys = stringKeys(node.paramExpressions);
      }
      if (expressionKeys.includes(operation.parameter)) {
        errors.push(`${prefix}_EXPRESSION_DRIVEN`);
        continue;
      }
      const current = params[operation.parameter];
      if (typeof current !== 'number') {
        errors.push(`${prefix}_PARAMETER_MISSING`);
        continue;
      }
      if (!sameNumber(current, operation.expectedValue)) {
        errors.push(`${prefix}_EXPECTED_VALUE_STALE`);
        continue;
      }
      if (sameNumber(current, operation.value)) {
        errors.push(`${prefix}_NO_CHANGE`);
        continue;
      }
      params[operation.parameter] = Object.is(operation.value, -0) ? 0 : operation.value;
    } else if (operation.op === 'set_enabled') {
      const summary = graph.nodes.find(node => node.id === operation.targetId);
      const node = nodeById.get(operation.targetId);
      if (!summary || !node || operation.targetId === graph.rootId) {
        errors.push(`${prefix}_TARGET_MISSING`);
        continue;
      }
      if (!AI_PARAMETER_EDITABLE_FEATURES.has(summary.kind)) {
        errors.push(`${prefix}_TARGET_OPAQUE:${summary.kind}`);
        continue;
      }
      const current = node.enabled !== false;
      if (current !== operation.expectedEnabled) {
        errors.push(`${prefix}_EXPECTED_ENABLED_STALE`);
        continue;
      }
      if (current === operation.enabled) {
        errors.push(`${prefix}_NO_CHANGE`);
        continue;
      }
      node.enabled = operation.enabled;
    } else {
      errors.push(`${prefix}_UNKNOWN`);
    }
  }
  if (errors.length) return { ok: false, graph, errors };
  const meta = nextProject.meta && !Array.isArray(nextProject.meta) && typeof nextProject.meta === 'object'
    ? nextProject.meta
    : {};
  meta.nexyfabMechanicalDesignGraph = {
    schema: 'nexyfab.mechanical-design-lineage.v1',
    parentRevisionSha256: graph.revisionSha256,
  };
  nextProject.meta = meta;
  const next = await buildMechanicalDesignGraph(nextProject);
  return { ok: true, graph: next, appliedOperations: patch.operations.length };
}

export function isMechanicalGraphNodeAiEditable(node: MechanicalDesignGraphNodeV1): boolean {
  return AI_PARAMETER_EDITABLE_FEATURES.has(node.kind);
}
