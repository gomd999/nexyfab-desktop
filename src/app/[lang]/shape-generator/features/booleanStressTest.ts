/**
 * booleanStressTest.ts — Auto-reattempt boolean with progressive relaxation.
 *
 * three-bvh-csg + Manifold + OCCT all fail on the same edge cases:
 * coplanar coincidence, near-tangent surfaces, sub-tolerance vertex
 * splits. The standard workaround is "if it failed, jitter slightly
 * and retry". This module wraps that pattern with a deterministic
 * retry ladder so failures don't hang the UI:
 *
 *   - Pass 1: original inputs.
 *   - Pass 2: weld coincident verts within ε.
 *   - Pass 3: snap to grid (10 × ε).
 *   - Pass 4: jitter B's positions by ε to break ties.
 *   - Pass 5: increase tolerance + retry.
 *
 * Each pass tracks elapsed time + result quality. Returns the first
 * successful pass + diagnostics so the UI can show "this took retry
 * #3 with snap-to-grid".
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';

/** Caller-supplied boolean — returns null on failure. */
export type BooleanFn = (a: MeshArrays, b: MeshArrays, op: BooleanOp) => MeshArrays | null;

export interface RelaxationPass {
  /** Name shown in diagnostics. */
  name: string;
  /** Description for the UI. */
  description: string;
  /** Transform applied to A. */
  transformA?: (mesh: MeshArrays, tolerance: number) => MeshArrays;
  /** Transform applied to B. */
  transformB?: (mesh: MeshArrays, tolerance: number) => MeshArrays;
  /** Tolerance multiplier (1 = ε, 10 = 10×ε, …). */
  toleranceMultiplier: number;
}

export interface StressTestOptions {
  /** Base tolerance (mm). */
  baseToleranceMm: number;
  /** Cap on total wall-clock time (ms). */
  maxTotalTimeMs: number;
  /** Custom relaxation ladder (else default). */
  passes?: RelaxationPass[];
}

export const DEFAULT_STRESS_OPTIONS: StressTestOptions = {
  baseToleranceMm: 1e-4,
  maxTotalTimeMs: 30_000,
};

export interface StressResult {
  /** Successful mesh, or null if all passes failed. */
  mesh: MeshArrays | null;
  /** Index of the pass that succeeded. */
  successPass: number | null;
  /** Per-pass diagnostics. */
  passReports: PassReport[];
  /** Total elapsed time (ms). */
  totalTimeMs: number;
  /** True if any pass succeeded. */
  succeeded: boolean;
}

export interface PassReport {
  index: number;
  name: string;
  description: string;
  /** Time spent (ms). */
  elapsedMs: number;
  /** Was the boolean successful in this pass? */
  succeeded: boolean;
  /** Optional notes. */
  notes?: string;
}

// ── Default relaxation ladder ──────────────────────────────────

export const DEFAULT_PASSES: RelaxationPass[] = [
  { name: 'baseline', description: 'Original inputs', toleranceMultiplier: 1 },
  { name: 'weld', description: 'Weld coincident vertices', toleranceMultiplier: 1, transformA: weldVertices, transformB: weldVertices },
  { name: 'snap-grid', description: 'Snap to 10ε grid', toleranceMultiplier: 1, transformA: snapToGrid, transformB: snapToGrid },
  { name: 'jitter-b', description: 'Jitter B by ε to break ties', toleranceMultiplier: 1, transformB: jitterPositions },
  { name: 'loose-tolerance', description: 'Relax tolerance 100×', toleranceMultiplier: 100 },
];

// ── Top-level entry ─────────────────────────────────────────────

export function stressBoolean(
  a: MeshArrays,
  b: MeshArrays,
  op: BooleanOp,
  booleanFn: BooleanFn,
  options: Partial<StressTestOptions> = {},
): StressResult {
  const opts = { ...DEFAULT_STRESS_OPTIONS, ...options };
  const passes = opts.passes ?? DEFAULT_PASSES;
  const reports: PassReport[] = [];
  const start = nowMs();
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i]!;
    if (nowMs() - start > opts.maxTotalTimeMs) {
      reports.push({ index: i, name: pass.name, description: pass.description, elapsedMs: 0, succeeded: false, notes: 'Skipped — time budget exhausted' });
      break;
    }
    const passStart = nowMs();
    const tol = opts.baseToleranceMm * pass.toleranceMultiplier;
    const aTransformed = pass.transformA ? pass.transformA(a, tol) : a;
    const bTransformed = pass.transformB ? pass.transformB(b, tol) : b;
    let result: MeshArrays | null = null;
    try {
      result = booleanFn(aTransformed, bTransformed, op);
    } catch {
      result = null;
    }
    const elapsed = nowMs() - passStart;
    const succeeded = result !== null && result.indices.length > 0;
    reports.push({
      index: i,
      name: pass.name,
      description: pass.description,
      elapsedMs: elapsed,
      succeeded,
    });
    if (succeeded) {
      return {
        mesh: result,
        successPass: i,
        passReports: reports,
        totalTimeMs: nowMs() - start,
        succeeded: true,
      };
    }
  }
  return {
    mesh: null,
    successPass: null,
    passReports: reports,
    totalTimeMs: nowMs() - start,
    succeeded: false,
  };
}

// ── Transforms ──────────────────────────────────────────────────

export function weldVertices(mesh: MeshArrays, tolerance: number): MeshArrays {
  const quant = (x: number) => Math.round(x / tolerance);
  const map = new Map<string, number>();
  const newPositions: number[] = [];
  const oldToNew = new Array(mesh.positions.length / 3);
  for (let i = 0; i < oldToNew.length; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${quant(x)}_${quant(y)}_${quant(z)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = newPositions.length / 3;
      map.set(key, idx);
      newPositions.push(x, y, z);
    }
    oldToNew[i] = idx;
  }
  // Drop degenerate triangles (after weld, some may collapse).
  const newIndices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = oldToNew[mesh.indices[t]!]!;
    const i1 = oldToNew[mesh.indices[t + 1]!]!;
    const i2 = oldToNew[mesh.indices[t + 2]!]!;
    if (i0 !== i1 && i1 !== i2 && i2 !== i0) newIndices.push(i0, i1, i2);
  }
  return { positions: newPositions, indices: newIndices };
}

export function snapToGrid(mesh: MeshArrays, tolerance: number): MeshArrays {
  const grid = tolerance * 10;
  const positions = mesh.positions.map(v => Math.round(v / grid) * grid);
  return { positions, indices: mesh.indices.slice() };
}

export function jitterPositions(mesh: MeshArrays, tolerance: number): MeshArrays {
  const positions = mesh.positions.slice();
  // Deterministic jitter via index-based pseudo-random.
  for (let i = 0; i < positions.length; i++) {
    const r = ((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    positions[i] += (r - 0.5) * tolerance;
  }
  return { positions, indices: mesh.indices.slice() };
}

// ── Diagnostics ─────────────────────────────────────────────────

export interface StressSummary {
  totalPasses: number;
  passesAttempted: number;
  successPassName: string | null;
  totalElapsedMs: number;
  averagePassTimeMs: number;
}

export function summarize(result: StressResult): StressSummary {
  const attempted = result.passReports.length;
  const successName = result.successPass !== null && result.passReports[result.successPass]
    ? result.passReports[result.successPass]!.name
    : null;
  const elapsedSum = result.passReports.reduce((s, r) => s + r.elapsedMs, 0);
  return {
    totalPasses: DEFAULT_PASSES.length,
    passesAttempted: attempted,
    successPassName: successName,
    totalElapsedMs: result.totalTimeMs,
    averagePassTimeMs: attempted > 0 ? elapsedSum / attempted : 0,
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}
