/**
 * weightDistributionLeveler.ts — Balance an assembly's weight
 * distribution across multiple support points (machine feet,
 * crane lift points, transport cradles).
 *
 * Given a centre-of-gravity and a set of supports, compute the
 * load on each support. Validate that no support exceeds capacity
 * and that loads stay positive (no "lift off").
 *
 * Module solves the equilibrium for the rigid body using static
 * equations:
 *
 *   Σ F_z = W                 (total weight = sum of support forces)
 *   Σ M_x = 0, Σ M_y = 0       (moment balance about COG)
 *
 * For 3 supports → uniquely solvable. For > 3 → over-determined
 * (statically indeterminate); use centre-projected weighting.
 */

export interface Vec2 { x: number; y: number }

export interface SupportPoint {
  id: string;
  position: Vec2;
  /** Maximum allowable load (N). */
  capacityN: number;
}

export interface BodyMass {
  totalWeightN: number;
  cog: Vec2;
}

export interface SupportLoad {
  id: string;
  loadN: number;
  /** Fraction of capacity. */
  utilisation: number;
  liftOff: boolean;
}

export interface LevelerResult {
  loads: SupportLoad[];
  overloadedSupports: string[];
  liftOffSupports: string[];
  /** Resulting CG offset from desired (mm). */
  residualMomentNm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function distributeLoad(body: BodyMass, supports: SupportPoint[]): LevelerResult {
  if (supports.length === 0) {
    return { loads: [], overloadedSupports: [], liftOffSupports: [], residualMomentNm: 0 };
  }
  if (supports.length === 1) {
    const loadN = body.totalWeightN;
    const u = loadN / Math.max(0.01, supports[0]!.capacityN);
    return {
      loads: [{ id: supports[0]!.id, loadN, utilisation: u, liftOff: false }],
      overloadedSupports: u > 1 ? [supports[0]!.id] : [],
      liftOffSupports: [],
      residualMomentNm: 0,
    };
  }

  // For ≥ 2 supports, distribute by inverse distance from COG.
  const distances = supports.map(s => Math.hypot(s.position.x - body.cog.x, s.position.y - body.cog.y));
  const weights = distances.map(d => 1 / (d + 0.01));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const loads: SupportLoad[] = supports.map((s, i) => {
    const loadN = (weights[i]! / totalWeight) * body.totalWeightN;
    return {
      id: s.id,
      loadN,
      utilisation: loadN / Math.max(0.01, s.capacityN),
      liftOff: loadN < 0,
    };
  });

  const overloaded = loads.filter(l => l.utilisation > 1).map(l => l.id);
  const liftOff = loads.filter(l => l.liftOff).map(l => l.id);
  // Residual moment: sum of (force × position_offset).
  let mx = 0, my = 0;
  for (let i = 0; i < supports.length; i++) {
    const s = supports[i]!;
    mx += loads[i]!.loadN * (s.position.x - body.cog.x);
    my += loads[i]!.loadN * (s.position.y - body.cog.y);
  }
  const residual = Math.hypot(mx, my);
  return { loads, overloadedSupports: overloaded, liftOffSupports: liftOff, residualMomentNm: residual };
}

// ── Three-support exact solution ─────────────────────────────

export function threeSupportExact(body: BodyMass, supports: [SupportPoint, SupportPoint, SupportPoint]): LevelerResult {
  // Solve linear system for force at each support.
  const [a, b, c] = supports;
  // Setup matrix A and vector r for [Fa Fb Fc]:
  //   Fa + Fb + Fc = W
  //   Fa·xa + Fb·xb + Fc·xc = W·xCog
  //   Fa·ya + Fb·yb + Fc·yc = W·yCog
  const matrix = [
    [1, 1, 1],
    [a.position.x, b.position.x, c.position.x],
    [a.position.y, b.position.y, c.position.y],
  ];
  const rhs = [body.totalWeightN, body.totalWeightN * body.cog.x, body.totalWeightN * body.cog.y];
  const F = solve3x3(matrix, rhs);
  if (!F) {
    // Singular — fall back to weighted distribution.
    return distributeLoad(body, supports);
  }
  const loads = supports.map((s, i) => ({
    id: s.id,
    loadN: F[i]!,
    utilisation: F[i]! / Math.max(0.01, s.capacityN),
    liftOff: F[i]! < 0,
  }));
  return {
    loads,
    overloadedSupports: loads.filter(l => l.utilisation > 1).map(l => l.id),
    liftOffSupports: loads.filter(l => l.liftOff).map(l => l.id),
    residualMomentNm: 0,
  };
}

function solve3x3(M: number[][], b: number[]): number[] | null {
  const det = M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!)
            - M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!)
            + M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!);
  if (Math.abs(det) < 1e-9) return null;
  const cramer = (col: number): number => {
    const m = M.map(row => row.slice());
    for (let i = 0; i < 3; i++) m[i]![col] = b[i]!;
    return (m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)
          - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)
          + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)) / det;
  };
  return [cramer(0), cramer(1), cramer(2)];
}

// ── Suggest reposition to fix lift-off ───────────────────────

export interface RebalanceSuggestion {
  supportId: string;
  proposedOffsetMm: number;
  rationale: string;
}

export function suggestRebalance(result: LevelerResult, body: BodyMass, supports: SupportPoint[]): RebalanceSuggestion[] {
  const out: RebalanceSuggestion[] = [];
  for (const id of result.liftOffSupports) {
    const s = supports.find(x => x.id === id);
    if (!s) continue;
    const dx = s.position.x - body.cog.x;
    const dy = s.position.y - body.cog.y;
    const dist = Math.hypot(dx, dy);
    out.push({
      supportId: id,
      proposedOffsetMm: dist * 0.3,
      rationale: `Move ${id} ${(dist * 0.3).toFixed(2)} mm toward COG to load it positive.`,
    });
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface LevelerSummary {
  supportCount: number;
  overloadedCount: number;
  liftOffCount: number;
  maxUtilisation: number;
}

export function summarize(result: LevelerResult): LevelerSummary {
  let maxU = 0;
  for (const l of result.loads) if (l.utilisation > maxU) maxU = l.utilisation;
  return {
    supportCount: result.loads.length,
    overloadedCount: result.overloadedSupports.length,
    liftOffCount: result.liftOffSupports.length,
    maxUtilisation: maxU,
  };
}
