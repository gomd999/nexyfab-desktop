/**
 * assemblyMateSolve — bridge the AI agent's loose mates (string handles +
 * face tags) onto the REAL assembly solver (iterativeSolve), so solve_mates
 * actually repositions parts instead of returning the inert origin-stub.
 *
 * Stage 4 follow-up of the scad-agent (ADR-013). Given per-handle anchors
 * (world position + optional bbox), it:
 *   1. builds an AssemblyState (one PartInstance per handle; first = fixed),
 *   2. maps each AssemblyMate → assembly Mate IR (kind + faceTag → MateRef),
 *   3. resolves face tags to world geometry from the anchor bbox,
 *   4. runs iterativeSolve and returns the per-handle world delta.
 *
 * Scope: iterativeSolve resolves concentric + coplanar (→ coincident plane)
 * analytically (translation). distance is carried; tangent/parallel/
 * perpendicular need rotation and surface as a non-zero residual (reported,
 * not silently wrong). Pure logic — no DOM/worker.
 */

import {
  IDENTITY_QUAT,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';
import type { Mate, MateRef, MateRefKind } from '@/lib/assembly/mate';
import {
  iterativeSolve,
  type GeometryResolver,
  type ResolvedGeometry,
  type IterativeSolverOptions,
} from '@/lib/assembly/iterativeSolver';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import type { AssemblyMate } from './types';

type Triple = [number, number, number];

export interface MateAnchor {
  /** World position of the part origin. */
  position: Triple;
  /** Local-frame AABB (mm). Defaults to a unit cube centred on the origin. */
  bbox?: { min: Triple; max: Triple };
  /** When true, 'side' / axis face tags resolve to the part's +Z axis. */
  cylindrical?: boolean;
}

export type AssemblyMateSolveResult =
  | {
      ok: true;
      /** Per-handle world delta (final − initial); only moved handles. */
      transforms: Record<string, Triple>;
      residual: number;
      iterations: number;
    }
  | { ok: false; reason: string };

const DEFAULT_BBOX = { min: [-0.5, -0.5, -0.5] as Triple, max: [0.5, 0.5, 0.5] as Triple };

// ─── kind + ref mapping ──────────────────────────────────────────────────

/** Map the agent's mate kind onto an assembly Mate IR node + ref kinds. */
function refKindForTag(tag: string | undefined, mateKind: AssemblyMate['kind']): MateRefKind {
  if (mateKind === 'concentric') return 'axis';
  if (!tag) return mateKind === 'coplanar' ? 'plane' : 'point';
  if (tag === 'side') return 'axis';
  // x+/x-/y+/y-/z+/z-/top/bottom → planar faces.
  return 'plane';
}

function buildMate(m: AssemblyMate): Mate | null {
  const a: MateRef = { partId: m.handleA, refId: m.faceTagA ?? 'center', refKind: refKindForTag(m.faceTagA, m.kind) };
  const b: MateRef = { partId: m.handleB, refId: m.faceTagB ?? 'center', refKind: refKindForTag(m.faceTagB, m.kind) };
  switch (m.kind) {
    case 'concentric':
      return { id: m.id, kind: 'concentric', a, b };
    case 'coplanar':
      // Flush faces = coincident planes.
      return { id: m.id, kind: 'coincident', a, b };
    case 'distance':
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return null;
      return { id: m.id, kind: 'distance', a, b, value: m.value };
    case 'tangent':
    case 'parallel':
    case 'perpendicular':
      // Carried so the solver reports a residual (needs rotation, v0 = none).
      return { id: m.id, kind: 'coincident', a, b };
    default:
      return null;
  }
}

// ─── geometry resolver from anchors ──────────────────────────────────────

function faceCenterOffset(tag: string, bbox: { min: Triple; max: Triple }): Triple {
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  switch (tag) {
    case 'x+': return [bbox.max[0], cy, cz];
    case 'x-': return [bbox.min[0], cy, cz];
    case 'y+': return [cx, bbox.max[1], cz];
    case 'y-': return [cx, bbox.min[1], cz];
    case 'z+': case 'top': return [cx, cy, bbox.max[2]];
    case 'z-': case 'bottom': return [cx, cy, bbox.min[2]];
    default: return [cx, cy, cz];
  }
}

const TAG_NORMAL: Record<string, Triple> = {
  'x+': [1, 0, 0], 'x-': [-1, 0, 0],
  'y+': [0, 1, 0], 'y-': [0, -1, 0],
  'z+': [0, 0, 1], 'z-': [0, 0, -1],
  top: [0, 0, 1], bottom: [0, 0, -1],
};

function makeResolver(anchors: Record<string, MateAnchor>): GeometryResolver {
  return (ref: MateRef, part: PartInstance): ResolvedGeometry | null => {
    const anchor = anchors[ref.partId];
    const bbox = anchor?.bbox ?? DEFAULT_BBOX;
    const tag = ref.refId;
    // World origin = current part position + the local face-centre offset.
    const off = faceCenterOffset(tag, bbox);
    const origin: Vec3 = { x: part.position.x + off[0], y: part.position.y + off[1], z: part.position.z + off[2] };
    if (ref.refKind === 'axis') {
      return { kind: 'axis', world: { origin, direction: { x: 0, y: 0, z: 1 } } };
    }
    if (ref.refKind === 'plane') {
      const n = TAG_NORMAL[tag] ?? [0, 0, 1];
      return { kind: 'plane', world: { origin, normal: { x: n[0], y: n[1], z: n[2] } } };
    }
    return { kind: 'point', world: origin };
  };
}

// ─── public API ──────────────────────────────────────────────────────────

export function assemblyMateSolve(
  mates: ReadonlyArray<AssemblyMate>,
  anchors: Record<string, MateAnchor>,
  opts: IterativeSolverOptions = {},
): AssemblyMateSolveResult {
  if (mates.length === 0) return { ok: true, transforms: {}, residual: 0, iterations: 0 };

  // Collect every handle referenced; preserve first-seen order so the anchor
  // (fixed) part is deterministic.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of mates) {
    for (const h of [m.handleA, m.handleB]) {
      if (!seen.has(h)) {
        seen.add(h);
        order.push(h);
      }
    }
  }

  const parts: PartInstance[] = order.map((h, i) => {
    const anchor = anchors[h];
    const p = anchor?.position ?? [0, 0, 0];
    return {
      id: h,
      name: h,
      partTemplateId: h,
      position: { x: p[0], y: p[1], z: p[2] },
      orientation: IDENTITY_QUAT,
      fixed: i === 0, // first handle anchors the assembly
    };
  });
  const initial = new Map(parts.map((p) => [p.id, { ...p.position }]));

  const mateIr: Mate[] = [];
  for (const m of mates) {
    const built = buildMate(m);
    if (!built) return { ok: false, reason: `mate ${m.id} (${m.kind}): unsupported or missing value` };
    mateIr.push(built);
  }

  const state: AssemblyState = { parts, mates: mateIr };
  const result = iterativeSolve(state, makeResolver(anchors), opts);

  const transforms: Record<string, Triple> = {};
  for (const p of result.state.parts) {
    const init = initial.get(p.id)!;
    const dx = p.position.x - init.x;
    const dy = p.position.y - init.y;
    const dz = p.position.z - init.z;
    if (Math.hypot(dx, dy, dz) > 1e-6) transforms[p.id] = [dx, dy, dz];
  }

  return {
    ok: true,
    transforms,
    residual: result.finalMaxResidual,
    iterations: result.iterations,
  };
}
