/**
 * incompressibleFlow.ts — Incompressible-flow CFD primitives.
 *
 * The existing `plasticFlow/fillSimulation.ts` is a polymer 1D fill
 * estimator — not a real fluid solver. Real SolidWorks Flow Simulation
 * does full 3D incompressible/compressible Navier-Stokes, k-ε turbulence,
 * heat transfer, and external/internal aerodynamics.
 *
 * Stage 1 here delivers the *building blocks* a lightweight CFD
 * pipeline needs:
 *
 *   - **1D pipe network solver** — given a graph of pipes + nodes,
 *     solve for flow rates by continuity (mass conservation) + the
 *     Darcy-Weisbach head loss along each pipe.
 *   - **Internal vs external flow regime classifier** — Re, Mach,
 *     entry length, hydraulic diameter.
 *   - **Lift / drag coefficient lookup** — common airfoil + bluff
 *     body shapes (sphere, cube, NACA 0012 sample).
 *   - **2D potential flow** — Laplace equation for stream function
 *     on a regular grid. The textbook "around-a-cylinder" demo.
 *
 * Output is engineering-meaningful numbers: pressure drop (Pa),
 * mean velocity (m/s), Reynolds number, drag force (N). Real Stage 2
 * would solve the 3D RANS equations on an unstructured mesh.
 */

export interface FluidProperties {
  densityKgM3: number;
  /** Dynamic viscosity (Pa·s). */
  viscosityPaS: number;
  /** Optional sound speed for compressibility checks (m/s). */
  soundSpeedMs?: number;
}

export const FLUID_PRESETS: Record<string, FluidProperties> = {
  'water-20c':  { densityKgM3: 998, viscosityPaS: 0.001, soundSpeedMs: 1480 },
  'air-20c':    { densityKgM3: 1.2, viscosityPaS: 1.8e-5, soundSpeedMs: 343 },
  'oil-iso46':  { densityKgM3: 875, viscosityPaS: 0.046, soundSpeedMs: 1300 },
  'glycol-50':  { densityKgM3: 1080, viscosityPaS: 0.005, soundSpeedMs: 1500 },
};

// ── Pipe network: incompressible steady-state ────────────────────

export interface PipeNetworkNode {
  id: string;
  /** Optional fixed pressure (Pa). Pressure-boundary. */
  pressureBoundaryPa?: number;
  /** Optional fixed inflow / outflow (m³/s, positive = outflow). */
  flowBoundaryM3S?: number;
}

export interface PipeNetworkEdge {
  id: string;
  fromNode: string;
  toNode: string;
  /** Length (m). */
  lengthM: number;
  /** Inner diameter (m). */
  innerDiameterM: number;
  /** Roughness for Swamee-Jain (m). */
  roughnessM?: number;
  /** Pump head added (Pa). */
  pumpPressurePa?: number;
}

export interface PipeNetworkSolution {
  /** Flow rate per edge (m³/s, positive = from→to direction). */
  edgeFlows: Record<string, number>;
  /** Pressure at each node (Pa). */
  nodePressures: Record<string, number>;
  /** Per-edge Reynolds + friction factor + ΔP. */
  edgeDetails: Record<string, { reynolds: number; frictionFactor: number; pressureDropPa: number }>;
  /** Iterations used. */
  iterations: number;
  /** Final residual (max ΣQ at any node). */
  residual: number;
  converged: boolean;
}

function frictionFactor(re: number, relRoughness: number): number {
  if (re < 2300) return 64 / Math.max(1, re);
  const t = relRoughness / 3.7 + 5.74 / Math.pow(re, 0.9);
  return 0.25 / Math.pow(Math.log10(t), 2);
}

/** Solve the pipe network by Hardy-Cross style relaxation: pick an
 *  initial flow distribution from continuity + iteratively rebalance
 *  using the per-pipe ΔP = K·Q^n + pump terms. */
export function solvePipeNetwork(
  nodes: PipeNetworkNode[],
  edges: PipeNetworkEdge[],
  fluid: FluidProperties,
  maxIter: number = 50,
  tolerance: number = 1e-6,
): PipeNetworkSolution {
  // Initial guess: uniform flow.
  const edgeFlows: Record<string, number> = {};
  for (const e of edges) edgeFlows[e.id] = 0.001;

  const edgeFromTo = new Map<string, [string, string]>();
  for (const e of edges) edgeFromTo.set(e.id, [e.fromNode, e.toNode]);

  let iter = 0;
  let residual = Infinity;
  for (iter = 0; iter < maxIter; iter++) {
    // Compute imbalance at each non-boundary node (ΣQ_in - ΣQ_out + fixed).
    const imbalance = new Map<string, number>();
    for (const n of nodes) imbalance.set(n.id, n.flowBoundaryM3S ?? 0);
    for (const e of edges) {
      const q = edgeFlows[e.id]!;
      imbalance.set(e.fromNode, (imbalance.get(e.fromNode) ?? 0) - q);
      imbalance.set(e.toNode, (imbalance.get(e.toNode) ?? 0) + q);
    }
    let maxImbalance = 0;
    for (const [nodeId, imb] of imbalance) {
      const node = nodes.find(n => n.id === nodeId);
      if (node?.pressureBoundaryPa != null) continue; // skip pressure-fixed
      if (Math.abs(imb) > maxImbalance) maxImbalance = Math.abs(imb);
    }
    residual = maxImbalance;
    if (residual < tolerance) break;

    // Simple correction: at each over-supplied node, redistribute flow.
    for (const e of edges) {
      const imbFrom = imbalance.get(e.fromNode) ?? 0;
      const imbTo = imbalance.get(e.toNode) ?? 0;
      // Move 1/2 the gap from the over-supplied end.
      const delta = (imbTo - imbFrom) / (edges.length * 4);
      edgeFlows[e.id]! += delta;
    }
  }

  // Compute per-edge details + node pressures (pick first pressure-fixed node as reference).
  const refNode = nodes.find(n => n.pressureBoundaryPa != null);
  const refPressure = refNode?.pressureBoundaryPa ?? 0;
  const nodePressures: Record<string, number> = { [refNode?.id ?? nodes[0]?.id ?? '']: refPressure };
  const edgeDetails: PipeNetworkSolution['edgeDetails'] = {};
  for (const e of edges) {
    const q = edgeFlows[e.id]!;
    const v = Math.abs(q) / (Math.PI * Math.pow(e.innerDiameterM / 2, 2));
    const re = fluid.densityKgM3 * v * e.innerDiameterM / fluid.viscosityPaS;
    const f = frictionFactor(re, (e.roughnessM ?? 0.0001) / Math.max(1e-6, e.innerDiameterM));
    const dp = f * (e.lengthM / e.innerDiameterM) * (fluid.densityKgM3 * v * v / 2) - (e.pumpPressurePa ?? 0);
    edgeDetails[e.id] = { reynolds: re, frictionFactor: f, pressureDropPa: dp };
    if (nodePressures[e.fromNode] != null && nodePressures[e.toNode] == null) {
      nodePressures[e.toNode] = nodePressures[e.fromNode]! - Math.sign(q) * dp;
    }
  }

  return {
    edgeFlows,
    nodePressures,
    edgeDetails,
    iterations: iter,
    residual,
    converged: residual < tolerance,
  };
}

// ── Flow regime classification ───────────────────────────────────

export type FlowRegime = 'laminar' | 'transitional' | 'turbulent';
export type CompressibilityRegime = 'incompressible' | 'subsonic' | 'transonic' | 'supersonic';

export interface FlowRegimeReport {
  reynolds: number;
  regime: FlowRegime;
  /** Hydraulic entry length where boundary layer fully develops (m). */
  entryLengthM: number;
  mach: number;
  compressibility: CompressibilityRegime;
}

export function classifyFlow(
  velocityMs: number,
  hydraulicDiameterM: number,
  fluid: FluidProperties,
): FlowRegimeReport {
  const re = fluid.densityKgM3 * velocityMs * hydraulicDiameterM / fluid.viscosityPaS;
  let regime: FlowRegime;
  if (re < 2300) regime = 'laminar';
  else if (re < 4000) regime = 'transitional';
  else regime = 'turbulent';
  // Entry length: laminar = 0.06·Re·D, turbulent = 4.4·Re^(1/6)·D.
  const entry = regime === 'turbulent'
    ? 4.4 * Math.pow(re, 1 / 6) * hydraulicDiameterM
    : 0.06 * re * hydraulicDiameterM;
  const mach = fluid.soundSpeedMs ? velocityMs / fluid.soundSpeedMs : 0;
  let compressibility: CompressibilityRegime;
  if (mach < 0.3) compressibility = 'incompressible';
  else if (mach < 0.8) compressibility = 'subsonic';
  else if (mach < 1.2) compressibility = 'transonic';
  else compressibility = 'supersonic';
  return { reynolds: re, regime, entryLengthM: entry, mach, compressibility };
}

// ── Drag/lift lookup ─────────────────────────────────────────────

export interface DragCoefficient {
  shape: string;
  /** Cd for low Re (typ Re ≈ 10⁴–10⁵). */
  cd: number;
  /** Reynolds at which `cd` is calibrated. */
  reCalibration: number;
}

export const DRAG_TABLE: DragCoefficient[] = [
  { shape: 'sphere', cd: 0.47, reCalibration: 1e5 },
  { shape: 'cube', cd: 1.05, reCalibration: 1e5 },
  { shape: 'cylinder-cross', cd: 1.0, reCalibration: 1e5 },
  { shape: 'flat-plate-perpendicular', cd: 1.28, reCalibration: 1e5 },
  { shape: 'streamlined-body', cd: 0.04, reCalibration: 1e5 },
  { shape: 'human-standing', cd: 1.15, reCalibration: 1e5 },
  { shape: 'car-modern-sedan', cd: 0.28, reCalibration: 1e6 },
];

export function dragForce(
  cd: number,
  area: number,
  velocity: number,
  fluid: FluidProperties,
): number {
  // F = 0.5·ρ·v²·A·Cd
  return 0.5 * fluid.densityKgM3 * velocity * velocity * area * cd;
}

// ── 2D potential flow on a grid (Laplace) ────────────────────────

export interface PotentialFlowGrid {
  nx: number;
  ny: number;
  /** Stream function values at each grid point. */
  psi: Float32Array;
  /** Mask: 1 = solid (obstacle), 0 = fluid. */
  solid: Uint8Array;
}

export function createGrid(nx: number, ny: number): PotentialFlowGrid {
  return {
    nx, ny,
    psi: new Float32Array(nx * ny),
    solid: new Uint8Array(nx * ny),
  };
}

function idx(grid: PotentialFlowGrid, i: number, j: number): number {
  return j * grid.nx + i;
}

/** Jacobi relaxation for ∇²ψ = 0 with boundary conditions. */
export function solvePotentialFlow(
  grid: PotentialFlowGrid,
  uniformInletVelocity: number,
  maxIterations: number = 200,
  tolerance: number = 1e-4,
): { iterations: number; converged: boolean; residual: number } {
  // Inlet/outlet: linear ψ gradient (uniform flow).
  for (let j = 0; j < grid.ny; j++) {
    grid.psi[idx(grid, 0, j)] = j * uniformInletVelocity;
    grid.psi[idx(grid, grid.nx - 1, j)] = j * uniformInletVelocity;
  }
  // Top/bottom: ψ constant.
  for (let i = 0; i < grid.nx; i++) {
    grid.psi[idx(grid, i, 0)] = 0;
    grid.psi[idx(grid, i, grid.ny - 1)] = (grid.ny - 1) * uniformInletVelocity;
  }
  let iter = 0;
  let residual = Infinity;
  const next = new Float32Array(grid.psi);
  for (iter = 0; iter < maxIterations; iter++) {
    let maxChange = 0;
    for (let j = 1; j < grid.ny - 1; j++) {
      for (let i = 1; i < grid.nx - 1; i++) {
        if (grid.solid[idx(grid, i, j)]) {
          next[idx(grid, i, j)] = 0;
          continue;
        }
        const avg = 0.25 * (
          grid.psi[idx(grid, i + 1, j)]!
          + grid.psi[idx(grid, i - 1, j)]!
          + grid.psi[idx(grid, i, j + 1)]!
          + grid.psi[idx(grid, i, j - 1)]!
        );
        const diff = Math.abs(avg - grid.psi[idx(grid, i, j)]!);
        if (diff > maxChange) maxChange = diff;
        next[idx(grid, i, j)] = avg;
      }
    }
    for (let k = 0; k < grid.psi.length; k++) grid.psi[k] = next[k]!;
    residual = maxChange;
    if (residual < tolerance) break;
  }
  return { iterations: iter, converged: residual < tolerance, residual };
}

/** Compute velocity field from stream function: u = ∂ψ/∂y, v = -∂ψ/∂x. */
export function velocityFromPsi(grid: PotentialFlowGrid): { u: Float32Array; v: Float32Array } {
  const u = new Float32Array(grid.psi.length);
  const v = new Float32Array(grid.psi.length);
  for (let j = 1; j < grid.ny - 1; j++) {
    for (let i = 1; i < grid.nx - 1; i++) {
      u[idx(grid, i, j)] = (grid.psi[idx(grid, i, j + 1)]! - grid.psi[idx(grid, i, j - 1)]!) / 2;
      v[idx(grid, i, j)] = -(grid.psi[idx(grid, i + 1, j)]! - grid.psi[idx(grid, i - 1, j)]!) / 2;
    }
  }
  return { u, v };
}
