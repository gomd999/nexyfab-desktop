import type { AssemblyState, PartInstance, Quat } from '@/lib/assembly/assemblyState';
import type { PartRefSpec } from '@/lib/assembly/api';
import type { Mate, MateKind, MateRef, MateRefKind } from '@/lib/assembly/mate';
import type { AssemblyMate, MateType } from './AssemblyMates';
import type { PlacedPart } from './PartPlacementPanel';
import { buildShapeResult, normalizeShapeParams, SHAPE_MAP } from '../shapes';
import { spurGearDimensions } from '../shapes/gearProfile';
import { faceRefFromPlacedFace } from './faceRefResolver';

export type AssemblyBridgeIssueCode =
  | 'UNSUPPORTED_LEGACY_MATE'
  | 'UNSUPPORTED_CANONICAL_MATE'
  | 'DERIVED_TOPOLOGY_REFERENCE'
  | 'UNRESOLVED_DERIVED_REFERENCE'
  | 'MISSING_PART_REFERENCE';

export interface AssemblyBridgeIssue {
  code: AssemblyBridgeIssueCode;
  mateId: string;
  message: string;
  blocking: boolean;
}

export interface CanonicalBridgeResult {
  state: AssemblyState;
  issues: AssemblyBridgeIssue[];
}

export interface LegacyBridgeResult {
  placedParts: PlacedPart[];
  assemblyMates: AssemblyMate[];
  issues: AssemblyBridgeIssue[];
}

const LEGACY_TO_CANONICAL: Partial<Record<MateType, MateKind>> = {
  coincident: 'coincident',
  concentric: 'concentric',
  distance: 'distance',
  angle: 'angle',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  hinge: 'hinge',
  slider: 'slot',
  gear: 'gear',
};

const CANONICAL_TO_LEGACY: Partial<Record<MateKind, MateType>> = {
  coincident: 'coincident',
  concentric: 'concentric',
  distance: 'distance',
  angle: 'angle',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  hinge: 'hinge',
  slot: 'slider',
  gear: 'gear',
};

function degreesToQuaternion(rotation: [number, number, number]): Quat {
  const [rx, ry, rz] = rotation.map(value => (value * Math.PI) / 180);
  const cx = Math.cos(rx / 2); const sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2); const sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2); const sz = Math.sin(rz / 2);
  return {
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

function quaternionToDegrees(q: Quat): [number, number, number] {
  const norm = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  const x = q.x / norm; const y = q.y / norm; const z = q.z / norm; const w = q.w / norm;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const rx = Math.atan2(sinr, cosr);
  const sinp = 2 * (w * y - z * x);
  const ry = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const rz = Math.atan2(siny, cosy);
  return [rx, ry, rz].map(value => (value * 180) / Math.PI) as [number, number, number];
}

function refKindFor(kind: MateKind, side: 'a' | 'b'): MateRefKind {
  if (kind === 'concentric' || kind === 'hinge' || kind === 'gear') return 'axis';
  if (kind === 'slot') return side === 'a' ? 'edge' : 'axis';
  return 'face';
}

function legacyRef(partId: string, face: number | undefined, kind: MateRefKind): MateRef {
  const index = Number.isInteger(face) && (face ?? -1) >= 0 ? face : 0;
  return { partId, refId: `legacy-${kind}:${index}`, refKind: kind };
}

function refFaceIndex(ref: MateRef): number | undefined {
  const match = /:(\d+)$/.exec(ref.refId);
  return match ? Number(match[1]) : undefined;
}

function toCanonicalMate(mate: AssemblyMate): Mate | null {
  const kind = LEGACY_TO_CANONICAL[mate.type];
  if (!kind) return null;
  const base = {
    id: mate.id,
    a: legacyRef(mate.partA, mate.faceA, refKindFor(kind, 'a')),
    b: legacyRef(mate.partB, mate.faceB, refKindFor(kind, 'b')),
    suppressed: mate.locked || undefined,
  };
  if (kind === 'distance' || kind === 'angle') return { ...base, kind, value: mate.value ?? 0 };
  if (kind === 'hinge') {
    return {
      ...base,
      kind,
      ...(mate.min !== undefined && mate.max !== undefined
        ? { limit: { minAngleDeg: mate.min, maxAngleDeg: mate.max } }
        : {}),
    };
  }
  if (kind === 'slot') return { ...base, kind };
  if (kind === 'gear') return { ...base, kind, ratio: Math.max(Number.EPSILON, mate.value ?? 1) };
  return { ...base, kind } as Mate;
}

/** Stable, named design references owned by the parametric part definition. */
export function placedPartSemanticRefs(part: PlacedPart): Record<string, PartRefSpec> {
  const shape = SHAPE_MAP[part.shapeId];
  const params = shape ? normalizeShapeParams(shape, part.params).params : part.params;
  const origin = { x: 0, y: 0, z: 0 };
  const refs: Record<string, PartRefSpec> = {};
  const axis = (direction: { x: number; y: number; z: number }, at = origin): PartRefSpec => ({
    kind: 'axis', origin: at, direction,
  });

  if (part.shapeId === 'gear') {
    const dimensions = spurGearDimensions({
      teeth: params.teeth!,
      module: params.module!,
      boreDiameter: params.boreDiameter!,
      pressureAngle: params.pressureAngle!,
    });
    refs.rotation_axis = axis({ x: 0, y: 0, z: 1 });
    refs.shaft_axis = axis({ x: 0, y: 0, z: 1 });
    refs.pitch_axis = axis({ x: 0, y: 0, z: 1 });
    refs.pitch_plane = { kind: 'plane', origin, normal: { x: 0, y: 0, z: 1 } };
    refs.pitch_point = { kind: 'point', origin: { x: dimensions.pitchRadius, y: 0, z: 0 } };
    return refs;
  }

  if (['cylinder', 'disk', 'cone', 'pipe', 'washer'].includes(part.shapeId)) {
    refs.rotation_axis = axis({ x: 0, y: 1, z: 0 });
    refs.shaft_axis = axis({ x: 0, y: 1, z: 0 });
  }

  if (part.shapeId === 'box') {
    const topY = (params.height ?? 0) / 2;
    const startX = -(params.width ?? 0) / 2;
    refs.linear_axis = axis({ x: 1, y: 0, z: 0 });
    // The rack-pinion solver resolves edge-like paths as an oriented local
    // line. The mate retains refKind=edge while this semantic registry owns
    // the durable origin/direction instead of a renderer triangle index.
    refs.rack_path = axis({ x: 1, y: 0, z: 0 }, { x: startX, y: topY, z: 0 });
    refs.rack_pitch_plane = { kind: 'plane', origin: { x: 0, y: topY, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  } else if (['lBracket', 'wedge', 'tSlot', 'iBeam'].includes(part.shapeId)) {
    refs.linear_axis = axis({ x: 1, y: 0, z: 0 });
    refs.rack_path = axis({ x: 1, y: 0, z: 0 });
  }
  return refs;
}

/** Convert the live modeler's CRDT assembly snapshot into the canonical assembly IR. */
export function legacyAssemblyToCanonical(
  placedParts: ReadonlyArray<PlacedPart>,
  assemblyMates: ReadonlyArray<AssemblyMate>,
): CanonicalBridgeResult {
  const parts: PartInstance[] = placedParts.map((part, index) => {
    const refs = placedPartSemanticRefs(part);
    return {
      id: part.id,
      name: part.name,
      partTemplateId: part.shapeId,
      position: { x: part.position[0], y: part.position[1], z: part.position[2] },
      orientation: degreesToQuaternion(part.rotation),
      fixed: part.fixed ?? index === 0,
      ...(Object.keys(refs).length > 0 ? { refs } : {}),
    };
  });
  const partIds = new Set(parts.map(part => part.id));
  const partById = new Map(parts.map(part => [part.id, part]));
  const sourcePartById = new Map(placedParts.map(part => [part.id, part]));
  const geometryByPartId = new Map<string, ReturnType<typeof buildShapeResult>>();
  const mates: Mate[] = [];
  const issues: AssemblyBridgeIssue[] = [];

  const attachLegacyFaceRef = (
    partId: string,
    faceIndex: number | undefined,
    refId: string,
    mateType: AssemblyMate['type'],
  ): boolean => {
    const sourcePart = sourcePartById.get(partId);
    const canonicalPart = partById.get(partId);
    if (!sourcePart || !canonicalPart) return false;
    let built = geometryByPartId.get(partId);
    if (built === undefined) {
      built = buildShapeResult(sourcePart.shapeId, sourcePart.params);
      geometryByPartId.set(partId, built);
    }
    if (!built?.geometry) return false;
    try {
      const resolved = faceRefFromPlacedFace(built.geometry, faceIndex ?? 0, mateType);
      canonicalPart.refs = { ...(canonicalPart.refs ?? {}), [refId]: resolved };
      return true;
    } catch {
      return false;
    }
  };

  for (const mate of assemblyMates) {
    if (!partIds.has(mate.partA) || !partIds.has(mate.partB)) {
      issues.push({
        code: 'MISSING_PART_REFERENCE', mateId: mate.id, blocking: true,
        message: `Mate ${mate.id} references a part that is not present.`,
      });
      continue;
    }
    const converted = toCanonicalMate(mate);
    if (!converted) {
      issues.push({
        code: 'UNSUPPORTED_LEGACY_MATE', mateId: mate.id, blocking: true,
        message: `Legacy mate type ${mate.type} is retained but cannot be edited in the canonical workspace.`,
      });
      continue;
    }
    if (mate.type === 'gear') {
      const a = partById.get(mate.partA);
      const b = partById.get(mate.partB);
      if (a?.refs?.rotation_axis && b?.refs?.rotation_axis) {
        converted.a = { partId: mate.partA, refId: 'rotation_axis', refKind: 'axis' };
        converted.b = { partId: mate.partB, refId: 'rotation_axis', refKind: 'axis' };
        mates.push(converted);
        continue;
      }
    }
    mates.push(converted);
    const refAResolved = attachLegacyFaceRef(mate.partA, mate.faceA, converted.a.refId, mate.type);
    const refBResolved = attachLegacyFaceRef(mate.partB, mate.faceB, converted.b.refId, mate.type);
    issues.push(refAResolved && refBResolved
      ? {
          code: 'DERIVED_TOPOLOGY_REFERENCE', mateId: mate.id, blocking: true,
          message: `Mate ${mate.id} has solver geometry, but its triangle-face reference must be replaced with a stable semantic reference before release.`,
        }
      : {
          code: 'UNRESOLVED_DERIVED_REFERENCE', mateId: mate.id, blocking: true,
          message: `Mate ${mate.id} face geometry could not be resolved; select new semantic references before solve or release.`,
        });
  }
  return { state: { parts, mates }, issues };
}

function toLegacyMate(mate: Mate): AssemblyMate | null {
  const type = CANONICAL_TO_LEGACY[mate.kind];
  if (!type) return null;
  const common: AssemblyMate = {
    id: mate.id,
    type,
    partA: mate.a.partId,
    partB: mate.b.partId,
    faceA: refFaceIndex(mate.a),
    faceB: refFaceIndex(mate.b),
    locked: Boolean(mate.suppressed),
  };
  if (mate.kind === 'distance' || mate.kind === 'angle') common.value = mate.value;
  if (mate.kind === 'hinge' && mate.limit) {
    common.min = mate.limit.minAngleDeg;
    common.max = mate.limit.maxAngleDeg;
  }
  if (mate.kind === 'gear') common.value = mate.ratio;
  return common;
}

/** Convert canonical edits back without dropping legacy-only constraints. */
export function canonicalAssemblyToLegacy(
  state: AssemblyState,
  previousParts: ReadonlyArray<PlacedPart>,
  previousMates: ReadonlyArray<AssemblyMate>,
): LegacyBridgeResult {
  const previousPartById = new Map(previousParts.map(part => [part.id, part]));
  const placedParts = state.parts.map(part => {
    const previous = previousPartById.get(part.id);
    return {
      id: part.id,
      name: part.name,
      shapeId: previous?.shapeId ?? part.partTemplateId,
      params: previous?.params ?? {},
      qty: previous?.qty ?? 1,
      position: [part.position.x, part.position.y, part.position.z] as [number, number, number],
      rotation: quaternionToDegrees(part.orientation),
      materialId: previous?.materialId,
      color: previous?.color,
      fixed: Boolean(part.fixed),
    };
  });
  const issues: AssemblyBridgeIssue[] = [];
  const converted: AssemblyMate[] = [];
  for (const mate of state.mates) {
    const legacy = toLegacyMate(mate);
    if (!legacy) {
      issues.push({
        code: 'UNSUPPORTED_CANONICAL_MATE', mateId: mate.id, blocking: true,
        message: `Canonical mate type ${mate.kind} cannot be saved to the legacy modeler.`,
      });
      continue;
    }
    converted.push(legacy);
  }
  const legacyOnly = previousMates.filter(mate => !LEGACY_TO_CANONICAL[mate.type]);
  return { placedParts, assemblyMates: [...converted, ...legacyOnly], issues };
}
