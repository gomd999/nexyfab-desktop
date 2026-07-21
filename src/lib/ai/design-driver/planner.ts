/**
 * design-driver/planner — the injectable planning interface (WA-A).
 *
 * The LLM's role in the driver is CONFINED to this interface: brief in,
 * DesignPlan IR out. WA-A ships no LLM call (비용·비결정 — 실호출은 WA-D
 * 몫); tests inject the deterministic `fixturePlanner` or a `staticPlanner`.
 *
 * A planner that cannot produce an honest plan must THROW `PlannerError`
 * with the reason — the driver converts that into a stage:'plan' refusal.
 * Returning a guessed plan for an un-understood brief is forbidden
 * (날조 금지).
 */

import type { DesignBrief, DesignPlan } from './types';

export interface DesignPlanner {
  /** Human-readable planner identity (recorded nowhere yet — WA-E hooks). */
  readonly name: string;
  plan(brief: DesignBrief): DesignPlan | Promise<DesignPlan>;
}

export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

/** Wrap a fully-formed plan as a planner (test harness / replay). */
export function staticPlanner(plan: DesignPlan, name = 'static'): DesignPlanner {
  return { name, plan: () => plan };
}
