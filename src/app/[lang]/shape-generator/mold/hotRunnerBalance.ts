/**
 * hotRunnerBalance.ts — Balance a hot-runner manifold so every drop
 * (nozzle) sees the same pressure drop and fills its cavity at the same
 * time — "natural" (geometric) balancing or diameter tuning.
 *
 * Flow in each branch is laminar-ish; pressure drop along a circular
 * channel (Hagen-Poiseuille) is:
 *
 *   Δp = 128 · μ · L · Q / (π · D⁴)
 *
 * For a manifold feeding N drops, naturally balanced layouts give every
 * drop an equal-length flow path. When lengths differ, we tune each
 * branch diameter so Δp is equal across drops at a common flow rate:
 *
 *   D_i = D_ref · (L_i / L_ref)^(1/4)
 *
 * (since Δp ∝ L / D⁴, equalising needs D⁴ ∝ L).
 */

export interface RunnerBranch {
  id: string;
  lengthMm: number;
  diameterMm: number;
}

export interface HotRunnerInput {
  branches: RunnerBranch[];
  meltViscosityPaS: number;   // apparent viscosity
  flowRateMm3PerS: number;    // per drop (assume equal target)
}

export interface BranchResult {
  id: string;
  pressureDropMpa: number;
  tunedDiameterMm: number;    // diameter to equalise Δp to the reference branch
}

export interface HotRunnerResult {
  branches: BranchResult[];
  maxPressureDropMpa: number;
  minPressureDropMpa: number;
  imbalancePercent: number;   // (max−min)/max
  naturallyBalanced: boolean; // all equal length
  warnings: string[];
}

export function analyze(input: HotRunnerInput): HotRunnerResult {
  const warnings: string[] = [];
  if (input.branches.length === 0) warnings.push('No branches provided.');
  if (input.meltViscosityPaS <= 0) warnings.push('Viscosity must be positive.');

  if (input.branches.length === 0) {
    return { branches: [], maxPressureDropMpa: 0, minPressureDropMpa: 0, imbalancePercent: 0, naturallyBalanced: true, warnings };
  }

  const drops = input.branches.map(b => ({ b, dp: pressureDrop(b, input.meltViscosityPaS, input.flowRateMm3PerS) }));

  // Reference = the branch with the largest Δp (others tuned UP in diameter to match its low Δp? )
  // Convention: tune every branch so its Δp matches the MIN-Δp branch (largest D),
  // i.e. open up restrictive branches. Reference = branch with min Δp.
  let refIdx = 0;
  drops.forEach((d, i) => { if (d.dp < drops[refIdx]!.dp) refIdx = i; });
  const ref = drops[refIdx]!;

  const branchResults: BranchResult[] = drops.map(d => {
    // For equal Δp at common Q: D_i⁴ ∝ L_i → D_i = D_ref·(L_i/L_ref)^(1/4) gives equal Δp/L,
    // but to equalise total Δp we need D_i = (128·μ·L_i·Q/(π·Δp_ref))^(1/4).
    const tuned = Math.pow((128 * input.meltViscosityPaS * d.b.lengthMm * input.flowRateMm3PerS * 1e-9) / (Math.PI * Math.max(1e-9, ref.dp * 1e6)), 0.25) * 1000;
    return { id: d.b.id, pressureDropMpa: d.dp, tunedDiameterMm: tuned };
  });

  const dps = branchResults.map(b => b.pressureDropMpa);
  const max = Math.max(...dps);
  const min = Math.min(...dps);
  const imbalance = max > 0 ? ((max - min) / max) * 100 : 0;

  const lengths = input.branches.map(b => b.lengthMm);
  const naturallyBalanced = lengths.every(l => Math.abs(l - lengths[0]!) < 1e-6)
    && input.branches.every(b => Math.abs(b.diameterMm - input.branches[0]!.diameterMm) < 1e-6);

  return {
    branches: branchResults,
    maxPressureDropMpa: max,
    minPressureDropMpa: min,
    imbalancePercent: imbalance,
    naturallyBalanced,
    warnings,
  };
}

/** Hagen-Poiseuille pressure drop in MPa for one branch. */
export function pressureDrop(branch: RunnerBranch, viscosityPaS: number, flowRateMm3PerS: number): number {
  const D = branch.diameterMm / 1000; // m
  const L = branch.lengthMm / 1000;   // m
  const Q = flowRateMm3PerS * 1e-9;   // m³/s
  if (D <= 0) return Infinity;
  const dpPa = (128 * viscosityPaS * L * Q) / (Math.PI * Math.pow(D, 4));
  return dpPa / 1e6; // MPa
}

/** Natural-balance check: are all flow-path lengths equal (geometric balance)? */
export function isNaturallyBalanced(branches: RunnerBranch[], tolMm: number = 0.5): boolean {
  if (branches.length === 0) return true;
  const l0 = branches[0]!.lengthMm;
  return branches.every(b => Math.abs(b.lengthMm - l0) <= tolMm);
}

export function summarize(r: HotRunnerResult): { branchCount: number; imbalancePercent: number; naturallyBalanced: boolean } {
  return { branchCount: r.branches.length, imbalancePercent: r.imbalancePercent, naturallyBalanced: r.naturallyBalanced };
}
