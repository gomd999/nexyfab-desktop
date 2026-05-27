/**
 * frameTransformChain.ts — Chain of coordinate-frame transforms
 * (robot-style kinematic / assembly frame hierarchy).
 *
 * Every body in an assembly has a local frame. Sub-assemblies define
 * a frame relative to their parent. The same applies in robotics
 * (DH parameters) and motion-study (per-component pose).
 *
 * Module operations:
 *
 *   - Define named frames with parent reference.
 *   - Compute the absolute (world) pose of any frame.
 *   - Compose / invert / interpolate transforms.
 *   - Detect cycles in the parent graph.
 *
 * Transforms are 4×4 row-major matrices.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Frame {
  /** Frame id. */
  id: string;
  /** Parent frame id or null = world. */
  parentId: string | null;
  /** Local 4×4 matrix relative to parent. */
  localMatrix: number[];
}

export interface FrameRegistry {
  frames: Map<string, Frame>;
}

// ── Construction ───────────────────────────────────────────────

export function createRegistry(frames: Frame[]): FrameRegistry {
  const map = new Map<string, Frame>();
  for (const f of frames) map.set(f.id, { ...f, localMatrix: f.localMatrix.slice() });
  return { frames: map };
}

export function addFrame(registry: FrameRegistry, frame: Frame): void {
  registry.frames.set(frame.id, { ...frame, localMatrix: frame.localMatrix.slice() });
}

// ── World matrix computation ──────────────────────────────────

export interface WorldMatrixResult {
  /** id → 4×4 world matrix. */
  matrices: Map<string, number[]>;
  /** Cycles detected. */
  cycles: string[];
}

export function computeWorldMatrices(registry: FrameRegistry): WorldMatrixResult {
  const matrices = new Map<string, number[]>();
  const visiting = new Set<string>();
  const cycles: string[] = [];

  function compute(id: string): number[] {
    if (matrices.has(id)) return matrices.get(id)!;
    if (visiting.has(id)) {
      cycles.push(id);
      return identityMatrix();
    }
    visiting.add(id);
    const frame = registry.frames.get(id);
    if (!frame) {
      visiting.delete(id);
      return identityMatrix();
    }
    let world: number[];
    if (frame.parentId === null) {
      world = frame.localMatrix.slice();
    } else {
      const parentWorld = compute(frame.parentId);
      world = matrixMultiply(parentWorld, frame.localMatrix);
    }
    matrices.set(id, world);
    visiting.delete(id);
    return world;
  }

  for (const id of registry.frames.keys()) compute(id);
  return { matrices, cycles };
}

// ── Matrix operations ────────────────────────────────────────

export function identityMatrix(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function translationMatrix(t: Vec3): number[] {
  const m = identityMatrix();
  m[3] = t.x;
  m[7] = t.y;
  m[11] = t.z;
  return m;
}

export function rotationMatrixZ(angleRad: number): number[] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    c, -s, 0, 0,
    s,  c, 0, 0,
    0,  0, 1, 0,
    0,  0, 0, 1,
  ];
}

export function matrixMultiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        out[i * 4 + j] += a[i * 4 + k]! * b[k * 4 + j]!;
      }
    }
  }
  return out;
}

export function invertRigidTransform(m: number[]): number[] {
  // For a 4×4 with R (3×3 rotation) and t (3×1 translation):
  // inv = [Rᵀ, -Rᵀ·t; 0, 1].
  const r00 = m[0]!, r01 = m[1]!, r02 = m[2]!, tx = m[3]!;
  const r10 = m[4]!, r11 = m[5]!, r12 = m[6]!, ty = m[7]!;
  const r20 = m[8]!, r21 = m[9]!, r22 = m[10]!, tz = m[11]!;
  return [
    r00, r10, r20, -(r00 * tx + r10 * ty + r20 * tz),
    r01, r11, r21, -(r01 * tx + r11 * ty + r21 * tz),
    r02, r12, r22, -(r02 * tx + r12 * ty + r22 * tz),
    0, 0, 0, 1,
  ];
}

export function applyMatrix(m: number[], p: Vec3): Vec3 {
  return {
    x: m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + m[3]!,
    y: m[4]! * p.x + m[5]! * p.y + m[6]! * p.z + m[7]!,
    z: m[8]! * p.x + m[9]! * p.y + m[10]! * p.z + m[11]!,
  };
}

// ── Frame queries ─────────────────────────────────────────────

/** Get the path from frame A to frame B through their common ancestor. */
export function relativeTransform(registry: FrameRegistry, fromId: string, toId: string): number[] | null {
  const worlds = computeWorldMatrices(registry).matrices;
  const fromWorld = worlds.get(fromId);
  const toWorld = worlds.get(toId);
  if (!fromWorld || !toWorld) return null;
  // T_B_A = T_B_world × T_world_A = inv(toWorld) × fromWorld.
  return matrixMultiply(invertRigidTransform(toWorld), fromWorld);
}

/** Get the children of a frame. */
export function getChildren(registry: FrameRegistry, parentId: string | null): Frame[] {
  return [...registry.frames.values()].filter(f => f.parentId === parentId);
}

/** Walk path from a frame up to the root. */
export function ancestorChain(registry: FrameRegistry, id: string): Frame[] {
  const chain: Frame[] = [];
  let cur: string | null = id;
  const visited = new Set<string>();
  while (cur !== null) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const f = registry.frames.get(cur);
    if (!f) break;
    chain.push(f);
    cur = f.parentId;
  }
  return chain;
}

// ── Summary ────────────────────────────────────────────────────

export interface FrameSummary {
  frameCount: number;
  rootCount: number;
  maxDepth: number;
  hasCycles: boolean;
}

export function summarize(registry: FrameRegistry): FrameSummary {
  const computed = computeWorldMatrices(registry);
  let maxDepth = 0;
  for (const id of registry.frames.keys()) {
    const depth = ancestorChain(registry, id).length;
    if (depth > maxDepth) maxDepth = depth;
  }
  const roots = [...registry.frames.values()].filter(f => f.parentId === null);
  return {
    frameCount: registry.frames.size,
    rootCount: roots.length,
    maxDepth,
    hasCycles: computed.cycles.length > 0,
  };
}
