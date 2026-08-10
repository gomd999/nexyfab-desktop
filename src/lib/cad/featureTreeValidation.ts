/**
 * Runtime validation for untrusted FeatureTree values.
 *
 * This module is deliberately free of React, browser storage, and migration
 * code so server routes can validate AI-produced CAD without pulling client
 * hooks into the server bundle.
 */
import {
  ALL_FEATURE_KINDS,
  validateTree,
  type FeatureKind,
  type FeatureNode,
  type FeaturePayload,
  type FeatureTree,
} from './featureTree';

export type FeatureTreeValidationResult =
  | { ok: true; tree: FeatureTree }
  | {
      ok: false;
      error: 'invalid_tree_shape' | 'invalid_node' | 'invalid_payload' | 'validate_tree_failed';
      message: string;
    };

const KNOWN_KINDS: ReadonlySet<string> = new Set(ALL_FEATURE_KINDS);

export function validateFeatureTreeValue(raw: unknown): FeatureTreeValidationResult {
  if (!isPlainObject(raw) || !Array.isArray(raw.nodes)) {
    return { ok: false, error: 'invalid_tree_shape', message: 'tree.nodes must be an array' };
  }

  const nodes: FeatureNode[] = [];
  for (let index = 0; index < raw.nodes.length; index += 1) {
    const nodeResult = validateNode(raw.nodes[index], index);
    if (!nodeResult.ok) return nodeResult;
    nodes.push(nodeResult.node);
  }

  const tree: FeatureTree = { nodes };
  try {
    validateTree(tree);
  } catch (error) {
    return {
      ok: false,
      error: 'validate_tree_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, tree };
}

type NodeValidationResult =
  | { ok: true; node: FeatureNode }
  | { ok: false; error: 'invalid_node' | 'invalid_payload'; message: string };

function validateNode(raw: unknown, index: number): NodeValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'invalid_node', message: `node[${index}] must be an object` };
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return { ok: false, error: 'invalid_node', message: `node[${index}].id must be a non-empty string` };
  }
  if (typeof raw.name !== 'string') {
    return { ok: false, error: 'invalid_node', message: `node[${index}].name must be string` };
  }
  if (!Array.isArray(raw.dependencies) || raw.dependencies.some(value => typeof value !== 'string')) {
    return { ok: false, error: 'invalid_node', message: `node[${index}].dependencies must contain only strings` };
  }
  if (raw.suppressed !== undefined && typeof raw.suppressed !== 'boolean') {
    return { ok: false, error: 'invalid_node', message: `node[${index}].suppressed must be boolean or absent` };
  }

  const payloadResult = validatePayload(raw.payload, index);
  if (!payloadResult.ok) return payloadResult;
  return {
    ok: true,
    node: {
      id: raw.id,
      name: raw.name,
      dependencies: raw.dependencies,
      payload: payloadResult.payload,
      ...(raw.suppressed === undefined ? {} : { suppressed: raw.suppressed }),
    },
  };
}

type PayloadValidationResult =
  | { ok: true; payload: FeaturePayload }
  | { ok: false; error: 'invalid_payload'; message: string };

function validatePayload(raw: unknown, nodeIndex: number): PayloadValidationResult {
  if (!isPlainObject(raw)) return invalidPayload(nodeIndex, 'payload must be an object');
  const kind = raw.kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    return invalidPayload(nodeIndex, `kind=${JSON.stringify(kind)} is not a known FeatureKind`);
  }

  const missing = (field: string): PayloadValidationResult =>
    invalidPayload(nodeIndex, `(kind=${kind}) missing required field: ${field}`);

  switch (kind as FeatureKind) {
    case 'extrude':
      if (!Array.isArray(raw.loop)) return missing('loop');
      if (typeof raw.depth !== 'number') return missing('depth');
      if (typeof raw.direction !== 'string') return missing('direction');
      if (typeof raw.mode !== 'string') return missing('mode');
      if (raw.profileOffsetZ !== undefined && !isFiniteNumber(raw.profileOffsetZ)) return missing('finite profileOffsetZ');
      break;
    case 'revolve':
      if (!Array.isArray(raw.loop)) return missing('loop');
      if (typeof raw.angleDegrees !== 'number') return missing('angleDegrees');
      if (typeof raw.mode !== 'string') return missing('mode');
      break;
    case 'sweep':
      if (!isPlainObject(raw.profile) || !Array.isArray(raw.profile.points)) return missing('profile.points');
      if (!Array.isArray(raw.path)) return missing('path');
      if (typeof raw.mode !== 'string') return missing('mode');
      break;
    case 'loft':
      if (!Array.isArray(raw.sections)) return missing('sections');
      for (let index = 0; index < raw.sections.length; index += 1) {
        const section = raw.sections[index];
        if (!isPlainObject(section)) return missing(`sections[${index}]`);
        if (!isPlainObject(section.profile) || !Array.isArray(section.profile.points)) return missing(`sections[${index}].profile.points`);
        if (typeof section.z !== 'number') return missing(`sections[${index}].z`);
      }
      if (typeof raw.mode !== 'string') return missing('mode');
      break;
    case 'linear_pattern':
      if (typeof raw.childScad !== 'string') return missing('childScad');
      if (typeof raw.count !== 'number') return missing('count');
      if (!isPlainObject(raw.direction)) return missing('direction');
      if (typeof raw.spacing !== 'number') return missing('spacing');
      break;
    case 'circular_pattern':
      if (typeof raw.childScad !== 'string') return missing('childScad');
      if (typeof raw.count !== 'number') return missing('count');
      if (!isPlainObject(raw.axisOrigin)) return missing('axisOrigin');
      if (!isPlainObject(raw.axisDirection)) return missing('axisDirection');
      if (typeof raw.totalAngleDegrees !== 'number') return missing('totalAngleDegrees');
      break;
    case 'hole':
      if (!isPlainObject(raw.center)) return missing('center');
      if (typeof raw.center.x !== 'number') return missing('center.x');
      if (typeof raw.center.y !== 'number') return missing('center.y');
      if (typeof raw.holeType !== 'string') return missing('holeType');
      if (typeof raw.diameter !== 'number') return missing('diameter');
      if (typeof raw.depth !== 'number') return missing('depth');
      break;
    case 'fillet':
    case 'chamfer':
      if (!isPlainObject(raw.childExtrude) || raw.childExtrude.kind !== 'extrude') return missing("childExtrude.kind='extrude'");
      if (kind === 'fillet' && typeof raw.radius !== 'number') return missing('radius');
      if (kind === 'chamfer' && typeof raw.distance !== 'number') return missing('distance');
      if (typeof raw.edgeSelection !== 'string') return missing('edgeSelection');
      if (raw.edgeRefs !== undefined && (!Array.isArray(raw.edgeRefs) || raw.edgeRefs.some(ref => typeof ref !== 'string'))) return missing('edgeRefs');
      break;
    case 'shell':
      if (!isPlainObject(raw.childExtrude) || raw.childExtrude.kind !== 'extrude') return missing("childExtrude.kind='extrude'");
      if (typeof raw.thickness !== 'number') return missing('thickness');
      if (raw.openTopFace !== undefined && typeof raw.openTopFace !== 'boolean') return missing('openTopFace');
      if (raw.openBottomFace !== undefined && typeof raw.openBottomFace !== 'boolean') return missing('openBottomFace');
      break;
    case 'rib':
      if (!isPoint2(raw.start)) return missing('start{x,y}');
      if (!isPoint2(raw.end)) return missing('end{x,y}');
      if (typeof raw.thickness !== 'number') return missing('thickness');
      if (typeof raw.height !== 'number') return missing('height');
      if (raw.centered !== undefined && typeof raw.centered !== 'boolean') return missing('centered');
      break;
    case 'sweep_path':
      if (!Array.isArray(raw.profile)) return missing('profile');
      if (!Array.isArray(raw.path)) return missing('path');
      break;
    case 'boolean':
      if (typeof raw.op !== 'string') return missing('op');
      if (!Array.isArray(raw.bodies) || raw.bodies.some(body => typeof body !== 'string')) return missing('bodies[]');
      break;
    default: {
      const exhaustive: never = kind as never;
      return invalidPayload(nodeIndex, `kind=${JSON.stringify(exhaustive)} has no validation schema`);
    }
  }

  return { ok: true, payload: raw as unknown as FeaturePayload };
}

function invalidPayload(nodeIndex: number, detail: string): PayloadValidationResult {
  return { ok: false, error: 'invalid_payload', message: `node[${nodeIndex}].payload ${detail}` };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPoint2(value: unknown): value is { x: number; y: number } {
  return isPlainObject(value) && typeof value.x === 'number' && typeof value.y === 'number';
}
