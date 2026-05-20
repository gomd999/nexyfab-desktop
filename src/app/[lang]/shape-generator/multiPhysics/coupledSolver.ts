/**
 * coupledSolver.ts — Sequential multi-physics coupling.
 *
 * Real coupling needs simultaneous PDE solving (FSI, conjugate
 * heat transfer). NexyFab's preview tier offers *sequential* (or
 * "one-way") coupling: solve one domain, feed its result as a
 * load into the next, iterate to convergence.
 *
 * Three pre-baked workflows:
 *
 *   1. Thermal → Structural — temperature field → thermal-expansion
 *      load → stress.
 *   2. Fluid (pressure) → Structural — pressure on wetted surface
 *      → solid stress.
 *   3. Thermal → Fluid (buoyancy) → Structural — full chain (rare).
 *
 * The actual physics solvers live in the FEA module; this module
 * orchestrates the chain + manages residuals.
 */

export type Domain = 'thermal' | 'structural' | 'fluid';

export interface CoupledStep {
  domain: Domain;
  /** Input variable name read from the bus. */
  inputs: string[];
  /** Output variable names written to the bus. */
  outputs: string[];
  /** Solver function — caller-provided. */
  solve: (bus: PhysicsBus) => Promise<void>;
}

export interface PhysicsBus {
  /** Per-node scalar field — temperature (°C), pressure (Pa), etc. */
  scalars: Map<string, number[]>;
  /** Per-node 3-D vector field — displacement (mm), velocity (m/s). */
  vectors: Map<string, Array<[number, number, number]>>;
}

export interface CoupledWorkflow {
  name: string;
  steps: CoupledStep[];
  /** Convergence tolerance for residual norm. */
  tolerance: number;
  /** Max outer iterations. */
  maxIterations: number;
}

export interface CouplingResult {
  iterations: number;
  finalResidual: number;
  converged: boolean;
  history: Array<{ iter: number; residual: number }>;
}

/** Run a coupled simulation to convergence. */
export async function runCoupled(
  workflow: CoupledWorkflow,
  bus: PhysicsBus,
): Promise<CouplingResult> {
  const history: Array<{ iter: number; residual: number }> = [];
  let lastSnapshot = snapshot(bus);

  for (let iter = 0; iter < workflow.maxIterations; iter++) {
    for (const step of workflow.steps) {
      await step.solve(bus);
    }
    const newSnapshot = snapshot(bus);
    const residual = computeResidual(lastSnapshot, newSnapshot);
    history.push({ iter, residual });
    if (residual < workflow.tolerance) {
      return { iterations: iter + 1, finalResidual: residual, converged: true, history };
    }
    lastSnapshot = newSnapshot;
  }

  return {
    iterations: workflow.maxIterations,
    finalResidual: history[history.length - 1]?.residual ?? Infinity,
    converged: false,
    history,
  };
}

function snapshot(bus: PhysicsBus): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const [k, v] of bus.scalars) m.set(`s:${k}`, v.slice());
  for (const [k, v] of bus.vectors) {
    m.set(`v:${k}`, v.flat());
  }
  return m;
}

function computeResidual(a: Map<string, number[]>, b: Map<string, number[]>): number {
  let sumSq = 0;
  let count = 0;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;
    for (let i = 0; i < Math.min(va.length, vb.length); i++) {
      const d = va[i]! - vb[i]!;
      sumSq += d * d;
      count++;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sumSq / count);
}

/** Pre-built thermal → structural workflow. */
export function thermalStructuralWorkflow(
  thermalSolver: (bus: PhysicsBus) => Promise<void>,
  structuralSolver: (bus: PhysicsBus) => Promise<void>,
): CoupledWorkflow {
  return {
    name: 'thermal → structural',
    tolerance: 1e-4,
    maxIterations: 10,
    steps: [
      {
        domain: 'thermal',
        inputs: ['boundary-temp'],
        outputs: ['temperature'],
        solve: thermalSolver,
      },
      {
        domain: 'structural',
        inputs: ['temperature', 'mechanical-load'],
        outputs: ['displacement', 'stress'],
        solve: structuralSolver,
      },
    ],
  };
}

/** Pre-built fluid pressure → structural workflow. */
export function fluidStructuralWorkflow(
  fluidSolver: (bus: PhysicsBus) => Promise<void>,
  structuralSolver: (bus: PhysicsBus) => Promise<void>,
): CoupledWorkflow {
  return {
    name: 'fluid → structural',
    tolerance: 1e-4,
    maxIterations: 8,
    steps: [
      {
        domain: 'fluid',
        inputs: ['inlet-velocity', 'outlet-pressure'],
        outputs: ['pressure', 'wall-shear'],
        solve: fluidSolver,
      },
      {
        domain: 'structural',
        inputs: ['pressure', 'wall-shear'],
        outputs: ['displacement', 'stress'],
        solve: structuralSolver,
      },
    ],
  };
}
