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

  it('maps base-shape creation to a set_base_shape intent (+ follow-on features)', () => {
    expect(planIntentToFeatureEdits({ kind: 'create_cylinder', radius: 10, height: 20 }).intents)
      .toEqual([{ kind: 'set_base_shape', shapeId: 'cylinder', params: { diameter: 20, height: 20, innerDiameter: 0 } }]);
    expect(planIntentToFeatureEdits({ kind: 'create_box_with_fillet', size: { x: 50, y: 40, z: 30 }, filletRadius: 5 }).intents)
      .toEqual([
        { kind: 'set_base_shape', shapeId: 'box', params: { width: 50, height: 40, depth: 30 } },
        { kind: 'add_feature', featureType: 'fillet', params: { radius: 5 } },
      ]);
    expect(planIntentToFeatureEdits(null).intents).toEqual([]);
  });

  it('still maps unsupported create_* (assembly/grid/revolve) to nothing', () => {
    expect(planIntentToFeatureEdits({ kind: 'create_assembly_stack', partCount: 3, spacing: 10 }).intents).toEqual([]);
  });

  it('maps create_sketch_extrude to an add_sketch_extrude with a closed line profile', () => {
    const r = planIntentToFeatureEdits({
      kind: 'create_sketch_extrude',
      profile: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 20 }, { x: 0, y: 20 }],
      depth: 6, plane: 'xy', operation: 'add',
    });
    expect(r.intents).toHaveLength(1);
    const intent = r.intents[0]!;
    if (intent.kind !== 'add_sketch_extrude') throw new Error('expected add_sketch_extrude');
    const sd = intent.sketchData;
    expect(sd.profile.closed).toBe(true);
    expect(sd.profile.segments).toHaveLength(4); // 4 edges (last closes back to first)
    expect(sd.profile.segments[0]!.type).toBe('line');
    // closing edge: last point back to first
    expect(sd.profile.segments[3]!.points).toEqual([{ x: 0, y: 20 }, { x: 0, y: 0 }]);
    expect(sd.config.mode).toBe('extrude');
    expect(sd.config.depth).toBe(6);
    expect(sd.plane).toBe('xy');
  });

  it('maps build_part to [set_base_shape, add_feature, …] in order', () => {
    const r = planIntentToFeatureEdits({
      kind: 'build_part',
      base: { shapeId: 'box', params: { width: 50, height: 20, depth: 30 } },
      features: [{ type: 'hole', params: { diameter: 10 } }, { type: 'fillet', params: { radius: 2 } }],
    });
    expect(r.intents).toEqual([
      { kind: 'set_base_shape', shapeId: 'box', params: { width: 50, height: 20, depth: 30 } },
      { kind: 'add_feature', featureType: 'hole', params: { diameter: 10 } },
      { kind: 'add_feature', featureType: 'fillet', params: { radius: 2 } },
    ]);
  });

  it('maps assemble_parts to a set_assembly_parts edit', () => {
    const r = planIntentToFeatureEdits({
      kind: 'assemble_parts',
      parts: [
        { name: 'plate', shapeId: 'box', params: { width: 80, height: 5, depth: 80 }, position: [0, 0, 0] },
        { name: 'leg', shapeId: 'cylinder', params: { diameter: 10, height: 40 }, position: [30, -22, 30] },
      ],
    });
    expect(r.intents).toHaveLength(1);
    const intent = r.intents[0]!;
    if (intent.kind !== 'set_assembly_parts') throw new Error('expected set_assembly_parts');
    expect(intent.parts).toHaveLength(2);
    expect(intent.parts[0]!.shapeId).toBe('box');
    expect(intent.parts[1]!.shapeId).toBe('cylinder');
  });

  it('resolves update_last_param / remove_last against context (last feature)', () => {
    const ctx = { features: [{ id: 'f0', type: 'box' }, { id: 'f1', type: 'fillet' }] };
    expect(planIntentToFeatureEdits({ kind: 'update_last_param', paramKey: 'radius', value: 8 }, ctx).intents)
      .toEqual([{ kind: 'update_param', featureId: 'f1', paramKey: 'radius', value: 8 }]);
    expect(planIntentToFeatureEdits({ kind: 'remove_last' }, ctx).intents)
      .toEqual([{ kind: 'remove_feature', featureId: 'f1' }]);
    // No features → guidance, no intents.
    expect(planIntentToFeatureEdits({ kind: 'remove_last' }, { features: [] }).intents).toEqual([]);
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

  it('sends revision-bound persistent topology and part/feature identity to the AI', async () => {
    const fetchPlan = vi.fn(async (_text: string, context?: import('@/lib/ai/modelContext').AiModelContext) => {
      expect(context?.selectionContext).toMatchObject({
        projectRevision: 'model-deadbeef',
        assemblyPath: ['main', 'housing-1'],
        partInstanceId: 'housing-1',
        bodyId: 'body-1',
        featureId: 'extrude-1',
        units: 'mm',
      });
      expect(context?.selectionContext?.topology[0]).toMatchObject({
        kind: 'face', persistentRef: 'face:extrude-1:top', referenceQuality: 'persistent',
      });
      expect(context?.domainWorkspace).toEqual({ domain: 'building', experience: 'expert' });
      return null;
    });
    await resolveFeatureEditPrompt('perform an unusual operation', [], fetchPlan, {
      domainWorkspace: { domain: 'building', experience: 'expert' },
      selection: {
        type: 'face', normal: [0, 0, 1], position: [0, 0, 10], area: 100,
        triangleCount: 2, normalLabel: 'Top', triangleIndices: [0, 1],
        persistentId: 'face:extrude-1:top', partName: 'housing-1',
      },
      baseShape: 'box', projectRevision: 'model-deadbeef',
      assemblyPath: ['main', 'housing-1'], partInstanceId: 'housing-1',
      bodyId: 'body-1', featureId: 'extrude-1',
    });
    expect(fetchPlan).toHaveBeenCalledOnce();
  });
});
