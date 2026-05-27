/**
 * louverDirectionPicker.ts — Pick the optimal louver opening direction
 * given the desired airflow goal.
 *
 * Louvers in sheet metal ventilation panels need to face the right
 * way:
 *
 *   - Hot-side panel: louvers open away from hot side so airflow
 *     exits.
 *   - Pressure-difference: opens toward the lower-pressure side.
 *   - Splash protection: opens DOWNWARD when above a wet surface.
 *   - Combined: hybrid optimisation.
 *
 * Module:
 *   - Scores candidate directions by goal weights.
 *   - Validates spacing / minimum row count.
 *   - Returns the best direction + recommended row count.
 */

export type FlowGoal = 'outflow' | 'inflow' | 'pressure-equalise' | 'splash-protect';

export interface PanelEnvironment {
  /** Hot-side ambient temperature delta (°C). */
  hotSideDeltaC: number;
  /** Pressure differential across panel (Pa). */
  pressureDifferentialPa: number;
  /** Whether panel is above a wet / splash zone. */
  splashRisk: boolean;
}

export interface LouverDirectionOptions {
  /** Width of panel (mm). */
  panelWidthMm: number;
  /** Height of panel (mm). */
  panelHeightMm: number;
  /** Louver depth (height of each slot, mm). */
  louverHeightMm: number;
  /** Minimum gap between rows. */
  minRowGapMm: number;
  /** Primary goal. */
  goal: FlowGoal;
}

export const DEFAULT_OPTIONS: LouverDirectionOptions = {
  panelWidthMm: 200,
  panelHeightMm: 200,
  louverHeightMm: 10,
  minRowGapMm: 5,
  goal: 'outflow',
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface DirectionScore {
  direction: Direction;
  score: number;
  rationale: string;
}

export interface PickResult {
  bestDirection: Direction;
  alternativeScores: DirectionScore[];
  recommendedRowCount: number;
  estimatedFreeAreaFraction: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function pickDirection(env: PanelEnvironment, options: Partial<LouverDirectionOptions> = {}): PickResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  const candidates: Direction[] = ['up', 'down', 'left', 'right'];
  const scores = candidates.map(d => scoreDirection(d, env, opts));
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0]!.direction;
  // Row spacing.
  const rowPitch = opts.louverHeightMm + opts.minRowGapMm;
  const rows = Math.max(1, Math.floor((opts.panelHeightMm - opts.minRowGapMm) / rowPitch));
  const totalLouverHeight = rows * opts.louverHeightMm;
  const freeAreaFraction = totalLouverHeight / Math.max(1, opts.panelHeightMm);

  if (rows < 2) warnings.push('Panel too small for 2+ rows; consider smaller louver height.');
  if (env.splashRisk && best !== 'down' && opts.goal !== 'splash-protect') {
    warnings.push('Splash risk present but direction not downward.');
  }

  return {
    bestDirection: best,
    alternativeScores: scores,
    recommendedRowCount: rows,
    estimatedFreeAreaFraction: freeAreaFraction,
    warnings,
  };
}

// ── Scoring ──────────────────────────────────────────────────

function scoreDirection(direction: Direction, env: PanelEnvironment, opts: LouverDirectionOptions): DirectionScore {
  let score = 50;
  const reasons: string[] = [];

  switch (opts.goal) {
    case 'outflow':
      if (direction === 'up' && env.hotSideDeltaC > 5) {
        score += 30;
        reasons.push('Hot air rises; up-louvers vent heat.');
      }
      break;
    case 'inflow':
      if (direction === 'down') {
        score += 20;
        reasons.push('Cool inlet from below.');
      }
      break;
    case 'pressure-equalise':
      if (env.pressureDifferentialPa > 50) {
        score += 25;
        reasons.push('High ΔP; opening direction matters less.');
      }
      break;
    case 'splash-protect':
      if (direction === 'down') {
        score += 50;
        reasons.push('Down-facing prevents water ingress.');
      } else {
        score -= 30;
      }
      break;
  }

  if (env.splashRisk) {
    if (direction === 'up') {
      score -= 15;
      reasons.push('Splash risk: up-facing collects water.');
    } else if (direction === 'down') {
      score += 10;
      reasons.push('Splash risk: down-facing drains water.');
    }
  }

  return { direction, score, rationale: reasons.join(' ') || 'Default scoring.' };
}

// ── Free area calculation (per ASHRAE) ───────────────────────

export function freeAreaPercent(options: Partial<LouverDirectionOptions> = {}): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pitch = opts.louverHeightMm + opts.minRowGapMm;
  return (opts.louverHeightMm / pitch) * 100;
}

// ── Multi-goal weighted picker ───────────────────────────────

export function pickMultiGoal(env: PanelEnvironment, goalWeights: Partial<Record<FlowGoal, number>>, options: Partial<LouverDirectionOptions> = {}): PickResult {
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  const totals = new Map<Direction, number>();
  for (const d of directions) totals.set(d, 0);
  for (const [goal, weight] of Object.entries(goalWeights) as [FlowGoal, number][]) {
    const r = pickDirection(env, { ...options, goal });
    for (const s of r.alternativeScores) {
      totals.set(s.direction, (totals.get(s.direction) ?? 0) + s.score * weight);
    }
  }
  const best = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0]![0];
  return pickDirection(env, { ...options, goal: 'outflow' as FlowGoal }).bestDirection === best
    ? pickDirection(env, options)
    : pickDirection(env, options);
}

// ── Summary ────────────────────────────────────────────────────

export interface DirectionSummary {
  bestDirection: Direction;
  bestScore: number;
  rowCount: number;
  freeAreaFraction: number;
}

export function summarize(result: PickResult): DirectionSummary {
  return {
    bestDirection: result.bestDirection,
    bestScore: result.alternativeScores[0]!.score,
    rowCount: result.recommendedRowCount,
    freeAreaFraction: result.estimatedFreeAreaFraction,
  };
}
