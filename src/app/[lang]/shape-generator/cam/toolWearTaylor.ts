/**
 * toolWearTaylor.ts — Tool life prediction via Taylor's equation +
 * cumulative wear tracking.
 *
 * Taylor's classic relation: V · T^n = C, where:
 *   V = cutting speed (m/min),
 *   T = tool life (min),
 *   n = Taylor exponent (material/tool dependent, typically 0.1..0.3
 *       for HSS, 0.2..0.4 for carbide, 0.4..0.7 for ceramic),
 *   C = Taylor constant (V at T = 1 min).
 *
 * Extended equation (with feed + depth of cut):
 *     V · T^n · f^x · d^y = C'
 * with x ≈ 0.5, y ≈ 0.25 typical.
 *
 * What this module does:
 *
 *   - Predict T for a given V (or vice versa).
 *   - Accumulate wear across a job (job = list of cuts). Each cut
 *     consumes `1 / T_at_V` of the tool's life.
 *   - Warn when a tool exceeds 80% / 100% of its life.
 *   - Plot Taylor curve sample points for the UI.
 *
 * Designed for the CAM "remaining tool life" widget — the shop loads
 * a tool with N minutes of cumulative use, plans the next job, and
 * the panel warns if the tool would expire mid-job.
 */

export interface TaylorParams {
  /** Taylor exponent n. */
  n: number;
  /** Taylor constant C (m/min at T=1min). */
  C: number;
  /** Optional extended-equation feed exponent x. */
  feedExponent?: number;
  /** Optional extended-equation depth exponent y. */
  depthExponent?: number;
  /** Reference feed rate, mm/rev. */
  referenceFeed?: number;
  /** Reference depth of cut, mm. */
  referenceDepth?: number;
}

export interface CutEvent {
  /** Identifier (e.g. operation number). */
  id: string;
  /** Cutting speed, m/min. */
  speedMpm: number;
  /** Active cutting duration, min. */
  durationMin: number;
  /** Feed rate, mm/rev. */
  feedMmRev?: number;
  /** Depth of cut, mm. */
  depthMm?: number;
}

export interface WearState {
  /** 0..1+ (above 1 means past end-of-life). */
  cumulativeFraction: number;
  /** History of accumulated fractions after each cut. */
  history: Array<{ cutId: string; fraction: number; afterCumulative: number }>;
}

// ── Predictions ────────────────────────────────────────────────

/** Predict tool life T (min) given V (m/min). */
export function predictLifeFromSpeed(speedMpm: number, params: TaylorParams, feedMmRev?: number, depthMm?: number): number {
  if (speedMpm <= 0) return Infinity;
  let effectiveC = params.C;
  if (feedMmRev !== undefined && params.feedExponent !== undefined && params.referenceFeed !== undefined && feedMmRev > 0) {
    effectiveC *= Math.pow(params.referenceFeed / feedMmRev, params.feedExponent);
  }
  if (depthMm !== undefined && params.depthExponent !== undefined && params.referenceDepth !== undefined && depthMm > 0) {
    effectiveC *= Math.pow(params.referenceDepth / depthMm, params.depthExponent);
  }
  return Math.pow(effectiveC / speedMpm, 1 / params.n);
}

/** Predict optimal cutting speed for a desired life T (min). */
export function predictSpeedFromLife(lifeMin: number, params: TaylorParams): number {
  if (lifeMin <= 0) return Infinity;
  return params.C / Math.pow(lifeMin, params.n);
}

// ── Wear accumulation ──────────────────────────────────────────

export function accumulateWear(
  cuts: CutEvent[],
  params: TaylorParams,
  initialFraction: number = 0,
): WearState {
  let cum = Math.max(0, initialFraction);
  const history: WearState['history'] = [];
  for (const c of cuts) {
    const life = predictLifeFromSpeed(c.speedMpm, params, c.feedMmRev, c.depthMm);
    const fraction = life > 0 ? c.durationMin / life : Infinity;
    cum += fraction;
    history.push({ cutId: c.id, fraction, afterCumulative: cum });
  }
  return { cumulativeFraction: cum, history };
}

// ── Warnings ───────────────────────────────────────────────────

export type WearStatus = 'fresh' | 'normal' | 'worn' | 'expired';

export function statusOf(fraction: number): WearStatus {
  if (fraction < 0.2) return 'fresh';
  if (fraction < 0.8) return 'normal';
  if (fraction < 1.0) return 'worn';
  return 'expired';
}

export interface ExpiryEvent {
  cutId: string;
  /** Did the cut go past 100%? */
  passedEol: boolean;
  /** Fraction at end of this cut. */
  fractionAtEnd: number;
}

export function findExpiryInJob(state: WearState): ExpiryEvent | null {
  let prev = 0;
  for (const h of state.history) {
    if (prev < 1 && h.afterCumulative >= 1) {
      return { cutId: h.cutId, passedEol: true, fractionAtEnd: h.afterCumulative };
    }
    prev = h.afterCumulative;
  }
  return null;
}

// ── Sample curve for plotting ──────────────────────────────────

export interface CurvePoint {
  speedMpm: number;
  lifeMin: number;
}

export function sampleTaylorCurve(
  params: TaylorParams,
  speedRange: { min: number; max: number },
  samples: number,
): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    const v = speedRange.min + (speedRange.max - speedRange.min) * t;
    out.push({ speedMpm: v, lifeMin: predictLifeFromSpeed(v, params) });
  }
  return out;
}

// ── Built-in tool tables ──────────────────────────────────────

export const PARAMS_HSS_STEEL: TaylorParams = { n: 0.15, C: 35 };
export const PARAMS_CARBIDE_STEEL: TaylorParams = { n: 0.25, C: 100 };
export const PARAMS_CARBIDE_ALUMINUM: TaylorParams = { n: 0.30, C: 300 };
export const PARAMS_CERAMIC_STEEL: TaylorParams = { n: 0.55, C: 250 };

// ── Summary ────────────────────────────────────────────────────

export interface WearSummary {
  cutCount: number;
  cumulativeFraction: number;
  status: WearStatus;
  expiresInCutId?: string;
  remainingTimeMin: number;
}

export function summarize(state: WearState, params: TaylorParams, plannedSpeedMpm?: number): WearSummary {
  const remaining = Math.max(0, 1 - state.cumulativeFraction);
  let remainingTime = Infinity;
  if (plannedSpeedMpm && remaining > 0) {
    const lifeAtSpeed = predictLifeFromSpeed(plannedSpeedMpm, params);
    remainingTime = remaining * lifeAtSpeed;
  }
  const expiry = findExpiryInJob(state);
  const result: WearSummary = {
    cutCount: state.history.length,
    cumulativeFraction: state.cumulativeFraction,
    status: statusOf(state.cumulativeFraction),
    remainingTimeMin: remainingTime,
  };
  if (expiry) result.expiresInCutId = expiry.cutId;
  return result;
}
