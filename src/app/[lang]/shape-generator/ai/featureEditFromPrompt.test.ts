/**
 * featureEditFromPrompt — parser-first, LLM-fallback orchestration.
 * planIntentToFeatureEdit mapper + the orchestrator (fetch injected).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveFeatureEditPrompt } from './featureEditFromPrompt';
import { planIntentToFeatureEdits } from './planIntentToFeatureEdit';
import type { PlanIntent } from '@/lib/ai/featureTreePlanner';

describe('planIntentToFeatureEdits', () => {
  it('maps add_fillet_to_last / add_chamfer_to_last', () => {
    expect(planIntentToFeatureEdits({ kind: 'add_fillet_to_last', radius: 4 }).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'fillet', params: { radius: 4 } }]);
    expect(planIntentToFeatureEdits({ kind: 'add_chamfer_to_last', distance: 3 }).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'chamfer', params: { distance: 3 } }]);
  });

  it('maps a linear and a circular pattern', () => {
    expect(planIntentToFeatureEdits({ kind: 'add_pattern_to_last', patternKind: 'linear', count: 4, spacing: 20 }).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'linearPattern', params: { count: 4, spacing: 20 } }]);
    expect(planIntentToFeatureEdits({ kind: 'add_pattern_to_last', patternKind: 'circular', count: 6, angle: 360 }).intents)
      .toEqual([{ kind: 'add_feature', featureType: 'circularPattern', params: { count: 6, totalAngle: 360 } }]);
  });

  it('maps base-shape creation kinds to nothing (in-context edit only)', () => {
    expect(planIntentToFeatureEdits({ kind: 'create_cylinder', radius: 10, height: 20 }).intents).toEqual([]);
    expect(planIntentToFeatureEdits(null).intents).toEqual([]);
  });
});

describe('resolveFeatureEditPrompt', () => {
  it('uses the deterministic parser without calling the endpoint when it matches', async () => {
    const fetchPlan = vi.fn<(t: string) => Promise<PlanIntent | null>>();
    const r = await resolveFeatureEditPrompt('add a 5mm fillet', [], fetchPlan);
    expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'fillet', params: { radius: 5 } }]);
    expect(fetchPlan).not.toHaveBeenCalled(); // no escalation needed
  });

  it('escalates to the endpoint when the parser misses, mapping the PlanIntent', async () => {
    const fetchPlan = vi.fn<(t: string) => Promise<PlanIntent | null>>(
      async () => ({ kind: 'add_pattern_to_last', patternKind: 'linear', count: 3, spacing: 30 }),
    );
    const r = await resolveFeatureEditPrompt('repeat it three times across', [], fetchPlan);
    expect(fetchPlan).toHaveBeenCalledOnce();
    expect(r.intents).toEqual([{ kind: 'add_feature', featureType: 'linearPattern', params: { count: 3, spacing: 30 } }]);
    expect(r.explanation).toMatch(/AI/);
  });

  it('falls back to parser guidance when the endpoint returns an unmappable/no plan', async () => {
    const fetchPlan = vi.fn<(t: string) => Promise<PlanIntent | null>>(async () => null);
    const r = await resolveFeatureEditPrompt('do something weird', [], fetchPlan);
    expect(r.intents).toEqual([]);
    expect(r.explanation).toMatch(/Try:/);
  });

  it('is resilient to an endpoint error (returns guidance, never throws)', async () => {
    const fetchPlan = vi.fn<(t: string) => Promise<PlanIntent | null>>(async () => { throw new Error('network'); });
    const r = await resolveFeatureEditPrompt('xyzzy', [], fetchPlan);
    expect(r.intents).toEqual([]);
  });
});
