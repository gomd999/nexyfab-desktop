/**
 * Agent budget guard — caps token / turn / tool-call usage and detects
 * wedged runs. Pure functions over BudgetState so the agent loop can stay
 * declarative.
 */
import type { BudgetState } from './types';

/**
 * Defaults sized for a typical "design a part" session: 5–8 model rounds
 * with a couple of tool calls each. Free plan should override down to
 * something like 4 rounds / 30k tokens to keep the AI cost predictable.
 */
export const BUDGET_DEFAULTS = {
  tokensCap: 80_000,
  turnsCap: 12,
  toolCallsCap: 30,
  /**
   * Stage 2 — vision is expensive (5–20× text-only), so cap separately
   * regardless of the general toolCallsCap. Pro default: 3 calls per
   * session. Free is gated upstream so this only matters for Pro+.
   */
  visionCallsCap: 3,
  /** Fail the loop after this many consecutive render errors. */
  wedgeRenderFailThreshold: 3,
  /** Warn callback fires once when remaining drops below this fraction. */
  warnAtRemainingPct: 0.2,
} as const;

export function makeInitialBudget(opts: {
  tokensCap?: number;
  turnsCap?: number;
  toolCallsCap?: number;
  visionCallsCap?: number;
} = {}): BudgetState {
  return {
    tokensUsed: 0,
    tokensCap: opts.tokensCap ?? BUDGET_DEFAULTS.tokensCap,
    turnsUsed: 0,
    turnsCap: opts.turnsCap ?? BUDGET_DEFAULTS.turnsCap,
    toolCallsUsed: 0,
    toolCallsCap: opts.toolCallsCap ?? BUDGET_DEFAULTS.toolCallsCap,
    visionCallsUsed: 0,
    visionCallsCap: opts.visionCallsCap ?? BUDGET_DEFAULTS.visionCallsCap,
    consecutiveRenderFails: 0,
  };
}

export interface BudgetCheck {
  /** True if any cap has been reached. */
  exhausted: boolean;
  /** Reason field stable across releases for telemetry. */
  reason?: 'tokens' | 'turns' | 'tool_calls' | 'vision_calls';
  /** Fraction remaining 0..1, useful for UI progress bars. */
  remainingPct: number;
}

export function checkBudget(b: BudgetState): BudgetCheck {
  const tokenPct = b.tokensUsed / b.tokensCap;
  const turnPct = b.turnsUsed / b.turnsCap;
  const toolPct = b.toolCallsUsed / b.toolCallsCap;
  const worstPct = Math.max(tokenPct, turnPct, toolPct);
  const remainingPct = Math.max(0, 1 - worstPct);

  if (b.tokensUsed >= b.tokensCap) {
    return { exhausted: true, reason: 'tokens', remainingPct: 0 };
  }
  if (b.turnsUsed >= b.turnsCap) {
    return { exhausted: true, reason: 'turns', remainingPct: 0 };
  }
  if (b.toolCallsUsed >= b.toolCallsCap) {
    return { exhausted: true, reason: 'tool_calls', remainingPct: 0 };
  }
  // Vision cap is checked at view_render call site (see runScadAgent),
  // not as a global exhaust gate — running out of vision shouldn't kill
  // the whole loop, just block further view_render calls.
  return { exhausted: false, remainingPct };
}

/**
 * Returns true if the agent has used up all its vision credits.
 * The view_render tool checks this and returns BUDGET_VISION instead of
 * actually calling the expensive vision API.
 */
export function isVisionBudgetExhausted(b: BudgetState): boolean {
  return b.visionCallsUsed >= b.visionCallsCap;
}

export function recordVisionCall(b: BudgetState): BudgetState {
  return { ...b, visionCallsUsed: b.visionCallsUsed + 1 };
}

export function isWedged(b: BudgetState): boolean {
  return b.consecutiveRenderFails >= BUDGET_DEFAULTS.wedgeRenderFailThreshold;
}

export function recordTurn(b: BudgetState, tokens: number): BudgetState {
  return { ...b, turnsUsed: b.turnsUsed + 1, tokensUsed: b.tokensUsed + tokens };
}

export function recordToolCall(b: BudgetState): BudgetState {
  return { ...b, toolCallsUsed: b.toolCallsUsed + 1 };
}

export function recordRenderResult(b: BudgetState, ok: boolean): BudgetState {
  return {
    ...b,
    consecutiveRenderFails: ok ? 0 : b.consecutiveRenderFails + 1,
  };
}
