/**
 * staticLinearSolver.ts — Tiny static linear FEA solver for 1D truss
 * / spring assemblies.
 *
 * Solves K·u = f where:
 *
 *   - u = nodal displacement vector (per-DOF).
 *   - f = applied load vector.
 *   - K = global stiffness assembled from element stiffness matrices.
 *
 * Module supports two element types:
 *
 *   - **Linear spring** (1D, between two nodes along the x axis).
 *   - **Truss** (2D, axial force only, between two 2D nodes).
 *
 * Pinned (fixed) nodes are constrained by reducing the system. For
 * teaching / preview use cases only — production FEA requires
 * higher-order elements + adaptive meshing.
 */

export interface Node {
  id: string;
  /** Position. For 1D springs only x is used. */
  x: number;
  y?: number;
  /** Fixed (anchored)? */
  fixed?: boolean;
}

export interface SpringElement {
  kind: 'spring';
  id: string;
  nodeA: string;
  nodeB: string;
  /** Stiffness k (N/mm). */
  stiffness: number;
}

export interface TrussElement {
  kind: 'truss';
  id: string;
  nodeA: string;
  nodeB: string;
  /** Young's modulus (MPa). */
  youngMpa: number;
  /** Cross-section area (mm²). */
  areaMm2: number;
}

export type Element = SpringElement | TrussElement;

export interface AppliedLoad {
  nodeId: string;
  /** Force in N. For springs: x-direction; for truss: { x, y }. */
  fx: number;
  fy?: number;
}

export interface SolveResult {
  /** Per-node displacement. */
  displacements: Map<string, { dx: number; dy: number }>;
  /** Per-element internal force (N) and stress (MPa). */
  elementForces: Map<string, { force: number; stress: number; strain: number }>;
  /** Reaction forces at fixed nodes. */
  reactions: Map<string, { fx: number; fy: number }>;
  /** Did the solver succeed? */
  ok: boolean;
  message?: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function solveStatic(nodes: Node[], elements: Element[], loads: AppliedLoad[]): SolveResult {
  if (nodes.length === 0 || elements.length === 0) {
    return { displacements: new Map(), elementForces: new Map(), reactions: new Map(), ok: false, message: 'empty system' };
  }
  // Determine DOFs per node: 1 (spring assembly) or 2 (truss).
  const has2D = elements.some(e => e.kind === 'truss') || nodes.some(n => n.y !== undefined);
  const dofPerNode = has2D ? 2 : 1;
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));
  const totalDof = nodes.length * dofPerNode;

  // Assemble global stiffness.
  const K = createMatrix(totalDof);
  for (const e of elements) {
    const a = nodeIndex.get(e.nodeA);
    const b = nodeIndex.get(e.nodeB);
    if (a === undefined || b === undefined) continue;
    if (e.kind === 'spring') {
      assembleSpring(K, a, b, e.stiffness, dofPerNode);
    } else {
      const nodeA = nodes[a]!;
      const nodeB = nodes[b]!;
      assembleTruss(K, a, b, nodeA, nodeB, e, dofPerNode);
    }
  }

  // Build load vector.
  const f = new Array(totalDof).fill(0);
  for (const load of loads) {
    const idx = nodeIndex.get(load.nodeId);
    if (idx === undefined) continue;
    f[idx * dofPerNode] = (f[idx * dofPerNode] ?? 0) + load.fx;
    if (dofPerNode === 2) f[idx * dofPerNode + 1] = (f[idx * dofPerNode + 1] ?? 0) + (load.fy ?? 0);
  }

  // Apply boundary conditions.
  const fixedDofs = new Set<number>();
  nodes.forEach((n, i) => {
    if (n.fixed) {
      fixedDofs.add(i * dofPerNode);
      if (dofPerNode === 2) fixedDofs.add(i * dofPerNode + 1);
    }
  });

  // Reduce system + solve.
  const u = new Array(totalDof).fill(0);
  const freeDofs: number[] = [];
  for (let i = 0; i < totalDof; i++) if (!fixedDofs.has(i)) freeDofs.push(i);
  if (freeDofs.length === 0) {
    return { displacements: new Map(), elementForces: new Map(), reactions: new Map(), ok: false, message: 'all nodes fixed' };
  }
  const Kff = createMatrix(freeDofs.length);
  const ff = new Array(freeDofs.length).fill(0);
  for (let i = 0; i < freeDofs.length; i++) {
    const gi = freeDofs[i]!;
    ff[i] = f[gi]!;
    for (let j = 0; j < freeDofs.length; j++) {
      Kff[i]![j] = K[gi]![freeDofs[j]!]!;
    }
  }
  const uFree = gaussSolve(Kff, ff);
  if (!uFree) {
    return { displacements: new Map(), elementForces: new Map(), reactions: new Map(), ok: false, message: 'singular stiffness' };
  }
  for (let i = 0; i < freeDofs.length; i++) u[freeDofs[i]!] = uFree[i]!;

  // Build per-node displacement map.
  const displacements = new Map<string, { dx: number; dy: number }>();
  for (let i = 0; i < nodes.length; i++) {
    displacements.set(nodes[i]!.id, {
      dx: u[i * dofPerNode]!,
      dy: dofPerNode === 2 ? u[i * dofPerNode + 1]! : 0,
    });
  }

  // Element forces / stresses.
  const elementForces = new Map<string, { force: number; stress: number; strain: number }>();
  for (const e of elements) {
    const a = nodeIndex.get(e.nodeA);
    const b = nodeIndex.get(e.nodeB);
    if (a === undefined || b === undefined) continue;
    if (e.kind === 'spring') {
      const ua = u[a * dofPerNode]!;
      const ub = u[b * dofPerNode]!;
      const force = e.stiffness * (ub - ua);
      elementForces.set(e.id, { force, stress: 0, strain: 0 });
    } else {
      const nodeA = nodes[a]!;
      const nodeB = nodes[b]!;
      const L = Math.hypot((nodeB.x - nodeA.x), (nodeB.y ?? 0) - (nodeA.y ?? 0));
      const cx = (nodeB.x - nodeA.x) / L;
      const cy = ((nodeB.y ?? 0) - (nodeA.y ?? 0)) / L;
      const uA = { x: u[a * 2]!, y: u[a * 2 + 1]! };
      const uB = { x: u[b * 2]!, y: u[b * 2 + 1]! };
      const elongation = (uB.x - uA.x) * cx + (uB.y - uA.y) * cy;
      const strain = elongation / L;
      const stress = e.youngMpa * strain;
      const force = stress * e.areaMm2;
      elementForces.set(e.id, { force, stress, strain });
    }
  }

  // Reactions at fixed nodes: R = K·u - f.
  const Ku = multiplyMatrixVector(K, u);
  const reactions = new Map<string, { fx: number; fy: number }>();
  nodes.forEach((n, i) => {
    if (n.fixed) {
      reactions.set(n.id, {
        fx: Ku[i * dofPerNode]! - f[i * dofPerNode]!,
        fy: dofPerNode === 2 ? (Ku[i * dofPerNode + 1]! - f[i * dofPerNode + 1]!) : 0,
      });
    }
  });

  return { displacements, elementForces, reactions, ok: true };
}

// ── Assembly helpers ──────────────────────────────────────────

function assembleSpring(K: number[][], a: number, b: number, k: number, dofPerNode: number): void {
  const ai = a * dofPerNode;
  const bi = b * dofPerNode;
  K[ai]![ai] = (K[ai]![ai] ?? 0) + k;
  K[ai]![bi] = (K[ai]![bi] ?? 0) - k;
  K[bi]![ai] = (K[bi]![ai] ?? 0) - k;
  K[bi]![bi] = (K[bi]![bi] ?? 0) + k;
}

function assembleTruss(K: number[][], a: number, b: number, nodeA: Node, nodeB: Node, elem: TrussElement, dofPerNode: number): void {
  const L = Math.hypot((nodeB.x - nodeA.x), (nodeB.y ?? 0) - (nodeA.y ?? 0));
  if (L < 1e-9) return;
  const cx = (nodeB.x - nodeA.x) / L;
  const cy = ((nodeB.y ?? 0) - (nodeA.y ?? 0)) / L;
  const k = (elem.youngMpa * elem.areaMm2) / L;
  // 4×4 element stiffness in global coords.
  const c2 = cx * cx;
  const s2 = cy * cy;
  const cs = cx * cy;
  const kel = [
    [c2, cs, -c2, -cs],
    [cs, s2, -cs, -s2],
    [-c2, -cs, c2, cs],
    [-cs, -s2, cs, s2],
  ].map(row => row.map(v => v * k));
  const dofs = [a * dofPerNode, a * dofPerNode + 1, b * dofPerNode, b * dofPerNode + 1];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      K[dofs[i]!]![dofs[j]!] = (K[dofs[i]!]![dofs[j]!] ?? 0) + kel[i]![j]!;
    }
  }
}

function createMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => new Array(size).fill(0));
}

function multiplyMatrixVector(M: number[][], v: number[]): number[] {
  const out = new Array(M.length).fill(0);
  for (let i = 0; i < M.length; i++) {
    let sum = 0;
    for (let j = 0; j < M[i]!.length; j++) {
      sum += M[i]![j]! * v[j]!;
    }
    out[i] = sum;
  }
  return out;
}

// ── Gauss elimination ─────────────────────────────────────────

function gaussSolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    // Pivot.
    let max = Math.abs(M[i]![i]!);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k]![i]!) > max) {
        max = Math.abs(M[k]![i]!);
        maxRow = k;
      }
    }
    if (max < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow]!, M[i]!];
    // Eliminate.
    for (let k = i + 1; k < n; k++) {
      const factor = M[k]![i]! / M[i]![i]!;
      for (let j = i; j <= n; j++) {
        M[k]![j] = M[k]![j]! - factor * M[i]![j]!;
      }
    }
  }
  // Back-substitute.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= M[i]![j]! * x[j]!;
    x[i] = sum / M[i]![i]!;
  }
  return x;
}

// ── Summary ────────────────────────────────────────────────────

export interface SolveSummary {
  nodeCount: number;
  elementCount: number;
  loadCount: number;
  maxDisplacementMm: number;
  maxStressMpa: number;
  solved: boolean;
}

export function summarize(nodes: Node[], elements: Element[], loads: AppliedLoad[], result: SolveResult): SolveSummary {
  let maxDisp = 0;
  for (const d of result.displacements.values()) {
    const m = Math.hypot(d.dx, d.dy);
    if (m > maxDisp) maxDisp = m;
  }
  let maxStress = 0;
  for (const f of result.elementForces.values()) {
    if (Math.abs(f.stress) > maxStress) maxStress = Math.abs(f.stress);
  }
  return {
    nodeCount: nodes.length,
    elementCount: elements.length,
    loadCount: loads.length,
    maxDisplacementMm: maxDisp,
    maxStressMpa: maxStress,
    solved: result.ok,
  };
}
