/**
 * planWithConfidence.test — lever B one-call hook for the DesignPlanner.
 *
 * The planner is a deterministic mock returning controlled DesignPlan
 * variations (real fixture plans, cloned + tweaked). No live LLM. Pins: runs=1
 * no-op; agreeing runs => high confidence; a disagreeing key field (feature
 * kind / principal dim) is flagged low-confidence and the medoid plan is chosen.
 */
import { describe, it, expect, vi } from 'vitest';
import { planWithConfidence, projectPlanFields } from './planWithConfidence';
import { lBracketPlan, steppedShaftPlan } from './fixturePlanner';
import type { DesignPlanner } from './planner';
import type { DesignBrief, DesignPlan } from './types';

const brief: DesignBrief = { id: 'b1', text: 'an L-bracket' };

/** A planner whose plan() replays the queued plans in order. */
function scriptedPlanner(...plans: DesignPlan[]): DesignPlanner {
  let i = 0;
  return {
    name: 'mock',
    async plan() {
      const p = plans[Math.min(i, plans.length - 1)];
      i++;
      return p;
    },
  };
}

const clone = (p: DesignPlan): DesignPlan => JSON.parse(JSON.stringify(p));

describe('planWithConfidence — runs=1 no-op', () => {
  it('calls plan once, confidence 1, no low-confidence fields', async () => {
    const planner = scriptedPlanner(lBracketPlan());
    const planSpy = vi.spyOn(planner, 'plan');
    const res = await planWithConfidence(planner, brief); // runs defaults to 1

    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(res.runsUsed).toBe(1);
    expect(res.lowConfidenceFields).toEqual([]);
    expect(Object.values(res.confidence).every((c) => c === 1)).toBe(true);
  });
});

describe('planWithConfidence — runs agree', () => {
  it('3 identical plans => confidence 1 everywhere', async () => {
    const planner = scriptedPlanner(lBracketPlan(), lBracketPlan(), lBracketPlan());
    const res = await planWithConfidence(planner, brief, { runs: 3 });
    expect(res.runsUsed).toBe(3);
    expect(res.lowConfidenceFields).toEqual([]);
    expect(res.confidence.partCount).toBe(1);
  });
});

describe('planWithConfidence — key field disagrees', () => {
  it('a dimension whose expected nominal disagrees across runs is flagged low-confidence, gate-eligible plan still returned', async () => {
    const base = lBracketPlan();
    const dimId = base.drawing.dimensions[0]?.id;
    expect(dimId).toBeTruthy();

    const variant = clone(base);
    // shift the first dimension's expected nominal well beyond 1% tolerance
    variant.drawing.dimensions[0].expected = (base.drawing.dimensions[0].expected ?? 10) * 2 + 5;

    const planner = scriptedPlanner(clone(base), variant, clone(base));
    const res = await planWithConfidence(planner, brief, { runs: 3, agreement: 0.8 });

    expect(res.confidence[`dim:${dimId}:expected`]).toBeCloseTo(2 / 3, 10);
    expect(res.lowConfidenceFields).toContain(`dim:${dimId}:expected`);
    // the medoid is one of the majority runs (the base plan)
    expect(res.plan.drawing.dimensions[0].expected).toBe(base.drawing.dimensions[0].expected);
  });

  it('an entirely different plan shape (feature kind + part id) disagrees on many fields', async () => {
    const bracket = lBracketPlan();
    const shaft = steppedShaftPlan();
    const planner = scriptedPlanner(bracket, shaft);
    const res = await planWithConfidence(planner, brief, { runs: 2 });
    // name differs => low confidence
    expect(res.confidence.name).toBe(0.5);
    expect(res.lowConfidenceFields).toContain('name');
  });
});

describe('projectPlanFields', () => {
  it('projects name, partCount, per-part feature kind, and per-dim expected', async () => {
    const proj = projectPlanFields(lBracketPlan());
    expect(proj.name).toBeDefined();
    expect(proj.partCount).toBeGreaterThanOrEqual(1);
    // at least one part:feature and one dim:expected key present
    expect(Object.keys(proj).some((k) => k.endsWith(':feature'))).toBe(true);
  });
});
