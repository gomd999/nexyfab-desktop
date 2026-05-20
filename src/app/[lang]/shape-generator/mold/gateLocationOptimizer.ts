/**
 * gateLocationOptimizer.ts — Pick the injection gate location that
 * balances flow to all extremities of the cavity (minimises the spread
 * of flow-path lengths), so the cavity fills evenly and weld lines land
 * in benign places.
 *
 * Model: the cavity is represented by a set of "node" points (typically
 * the mesh nodes or a sampling of the cavity). A candidate gate location
 * is scored by the flow-length distribution from the gate to every node:
 *
 *   score = max_flow_length + λ · stddev(flow_lengths)
 *
 * Lower is better. We minimise both the longest path (fill time) and the
 * imbalance (stddev). Flow length here is straight-line distance (a
 * geodesic / mesh-distance upgrade is a follow-up).
 *
 * Candidate gates default to the node set itself (gate must be on the
 * part), but a custom candidate list can be supplied (e.g. only edges
 * where a gate is allowed).
 */

export interface Node2D { x: number; y: number; weight?: number }

export interface GateOptimizerInput {
  nodes: Node2D[];
  candidateGates?: Node2D[]; // default = nodes
  imbalancePenalty?: number; // λ, default 1.0
}

export interface GateScore {
  gate: Node2D;
  maxFlowLengthMm: number;
  meanFlowLengthMm: number;
  stdFlowLengthMm: number;
  score: number;
}

export interface GateOptimizerResult {
  best: GateScore | null;
  ranked: GateScore[];
  warnings: string[];
}

export function optimize(input: GateOptimizerInput): GateOptimizerResult {
  const warnings: string[] = [];
  if (input.nodes.length === 0) {
    return { best: null, ranked: [], warnings: ['No cavity nodes provided.'] };
  }
  const candidates = input.candidateGates && input.candidateGates.length > 0
    ? input.candidateGates
    : input.nodes;
  const lambda = input.imbalancePenalty ?? 1.0;

  const ranked: GateScore[] = candidates.map(gate => {
    const lengths = input.nodes.map(n => {
      const d = Math.hypot(n.x - gate.x, n.y - gate.y);
      return d * (n.weight ?? 1);
    });
    const max = Math.max(...lengths);
    const mean = lengths.reduce((s, v) => s + v, 0) / lengths.length;
    const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / lengths.length;
    const std = Math.sqrt(variance);
    return {
      gate,
      maxFlowLengthMm: max,
      meanFlowLengthMm: mean,
      stdFlowLengthMm: std,
      score: max + lambda * std,
    };
  });

  ranked.sort((a, b) => a.score - b.score);
  return { best: ranked[0] ?? null, ranked, warnings };
}

/** Flow-length ratio (max/min) — a balance indicator; 1.0 is perfectly balanced. */
export function balanceRatio(score: GateScore, nodes: Node2D[]): number {
  let min = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - score.gate.x, n.y - score.gate.y) * (n.weight ?? 1);
    if (d < min) min = d;
  }
  if (min < 1e-9) return Infinity;
  return score.maxFlowLengthMm / min;
}

/** Centroid of the cavity nodes — a quick heuristic gate guess. */
export function centroidGate(nodes: Node2D[]): Node2D {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  return { x: cx, y: cy };
}

export function summarize(r: GateOptimizerResult): { gate: Node2D | null; maxFlowLengthMm: number; score: number } {
  return {
    gate: r.best?.gate ?? null,
    maxFlowLengthMm: r.best?.maxFlowLengthMm ?? 0,
    score: r.best?.score ?? 0,
  };
}
