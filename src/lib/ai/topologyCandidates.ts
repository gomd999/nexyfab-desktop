// AI topology candidate system — produces alternative design candidates
// from a goal-spec (mass target, stiffness target, manufacturing process).
// Uses heuristic scoring (no FEA call) so candidate generation is sub-100ms;
// the user picks one and then a downstream FEA validates the choice.

export interface TopologyGoal {
  /** Reduce mass by this fraction (0..1). 0.3 = 30% lighter. */
  massReductionTarget: number;
  /** Allowed stiffness loss (0..1). 0.1 = up to 10% softer. */
  stiffnessTolerance: number;
  /** Manufacturing process — limits feasible feature types. */
  process: 'machining' | 'casting' | 'sheet' | 'fdm' | 'sla' | 'mim';
  /** Optional load-case descriptor — affects candidate ordering. */
  load?: { kind: 'bending' | 'torsion' | 'axial' | 'thermal'; magnitudeN?: number };
}

export interface TopologyCandidate {
  id: string;
  label: string;
  description: string;
  /** Estimated mass change (negative = lighter). */
  massDeltaPct: number;
  /** Estimated stiffness change (negative = softer). */
  stiffnessDeltaPct: number;
  /** Heuristic feasibility score 0..1 for the chosen process. */
  manufacturability: number;
  /** Composite score for sorting; higher = better tradeoff. */
  score: number;
  /** Hints for the SCAD/feature pipeline to materialize the candidate. */
  ops: TopologyOp[];
}

export type TopologyOp =
  | { kind: 'shell'; thicknessMm: number }
  | { kind: 'rib-grid'; rows: number; cols: number; thicknessMm: number }
  | { kind: 'lattice-infill'; cellMm: number; strutMm: number }
  | { kind: 'topology-cut'; pattern: 'iso' | 'organic' | 'tpms'; intensity: number }
  | { kind: 'fillet-stress-zones'; radiusMm: number }
  | { kind: 'pocket-array'; depthMm: number; ratio: number };

function manufacturabilityFor(op: TopologyOp, process: TopologyGoal['process']): number {
  switch (op.kind) {
    case 'shell':
      return process === 'casting' || process === 'fdm' ? 0.95 : process === 'sheet' ? 0.7 : 0.85;
    case 'rib-grid':
      return process === 'casting' ? 0.95 : process === 'machining' ? 0.6 : 0.8;
    case 'lattice-infill':
      return process === 'fdm' || process === 'sla' ? 0.98 : 0.2;
    case 'topology-cut':
      return op.pattern === 'tpms' && process === 'sla' ? 0.95 : op.pattern === 'organic' && process === 'fdm' ? 0.9 : 0.5;
    case 'fillet-stress-zones':
      return 0.95; // process-agnostic
    case 'pocket-array':
      return process === 'machining' ? 0.9 : 0.7;
  }
}

/**
 * Generate topology candidates for a given goal. Pure function — same input
 * always returns the same candidates. Designed for sub-100ms execution so
 * the UI can re-rank in real time as the user tweaks the goal sliders.
 */
export function generateTopologyCandidates(goal: TopologyGoal): TopologyCandidate[] {
  const candidates: Omit<TopologyCandidate, 'manufacturability' | 'score'>[] = [
    {
      id: 'shell',
      label: 'Uniform shell',
      description: 'Hollow the part with a uniform-thickness shell.',
      massDeltaPct: -goal.massReductionTarget * 100 * 0.8,
      stiffnessDeltaPct: -goal.massReductionTarget * 100 * 0.7,
      ops: [{ kind: 'shell', thicknessMm: 2.5 - goal.massReductionTarget * 1.0 }],
    },
    {
      id: 'rib-shell',
      label: 'Shell + internal ribs',
      description: 'Hollow shell reinforced by an internal rib grid for bending stiffness.',
      massDeltaPct: -goal.massReductionTarget * 100 * 0.65,
      stiffnessDeltaPct: -goal.massReductionTarget * 100 * 0.25,
      ops: [
        { kind: 'shell', thicknessMm: 2.0 },
        { kind: 'rib-grid', rows: 3, cols: 4, thicknessMm: 1.2 },
      ],
    },
    {
      id: 'lattice',
      label: 'Lattice infill',
      description: 'Replace solid bulk with a 3D lattice — only viable for additive manufacturing.',
      massDeltaPct: -goal.massReductionTarget * 100 * 0.95,
      stiffnessDeltaPct: -goal.massReductionTarget * 100 * 0.4,
      ops: [{ kind: 'lattice-infill', cellMm: 6, strutMm: 0.8 }],
    },
    {
      id: 'topology-organic',
      label: 'Organic topology cuts',
      description: 'Procedural cuts following stress-aligned paths.',
      massDeltaPct: -goal.massReductionTarget * 100 * 0.9,
      stiffnessDeltaPct: -goal.massReductionTarget * 100 * 0.5,
      ops: [
        { kind: 'topology-cut', pattern: 'organic', intensity: goal.massReductionTarget },
        { kind: 'fillet-stress-zones', radiusMm: 2 },
      ],
    },
    {
      id: 'pocketed',
      label: 'Pocket array',
      description: 'Repeating pockets on non-functional surfaces — machinable.',
      massDeltaPct: -goal.massReductionTarget * 100 * 0.55,
      stiffnessDeltaPct: -goal.massReductionTarget * 100 * 0.2,
      ops: [{ kind: 'pocket-array', depthMm: 4, ratio: goal.massReductionTarget }],
    },
  ];

  return candidates
    .map(c => {
      const mfg = c.ops.reduce((acc, op) => acc * manufacturabilityFor(op, goal.process), 1);
      // Reward candidates that hit the mass target AND keep stiffness loss
      // under the user's tolerance AND are manufacturable.
      const massHit = 1 - Math.abs(c.massDeltaPct / 100 + goal.massReductionTarget);
      const stiffnessPenalty = Math.max(0, -c.stiffnessDeltaPct / 100 - goal.stiffnessTolerance);
      const score = massHit * 0.4 + mfg * 0.4 - stiffnessPenalty * 0.3;
      return { ...c, manufacturability: mfg, score };
    })
    .sort((a, b) => b.score - a.score);
}
