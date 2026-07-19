/**
 * W2-0 debt payoff — featurePlan resolves upstream references.
 *
 * Before this track, a fillet node always contributed a synthetic
 * `<id>__body` extrude built from its embedded `childExtrude` snapshot. On
 * a ref-mode tree that snapshot goes stale the moment the upstream extrude
 * is edited, so the OCCT plan would build the OLD solid and fillet that —
 * a silently wrong B-rep, the worst failure mode in this file.
 *
 * These tests edit the upstream and pin the plan to the NEW parameters.
 */
import { describe, it, expect } from 'vitest';
import { featureTreeToOcctPlan } from './featurePlan';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildFilletFeature, buildFilletFeatureRef } from '@/lib/cad/filletProfile';

const box = (depth: number): ExtrudeFeature => ({
  kind: 'extrude',
  loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  depth,
  direction: 'one_sided',
  mode: 'add',
});

function refTree(depth: number): FeatureTree {
  const e = box(depth);
  const f1: FeatureNode = { id: 'f1', name: 'base', dependencies: [], payload: e };
  const f2: FeatureNode = {
    id: 'f2',
    name: 'round',
    dependencies: ['f1'],
    payload: buildFilletFeatureRef('f1', e, 2, 'all'),
  };
  return { nodes: [f1, f2] };
}

function legacyTree(depth: number): FeatureTree {
  const e = box(depth);
  const f1: FeatureNode = { id: 'f1', name: 'base', dependencies: [], payload: e };
  const f2: FeatureNode = {
    id: 'f2',
    name: 'round',
    dependencies: ['f1'],
    payload: buildFilletFeature(e, 2, 'all'),
  };
  return { nodes: [f1, f2] };
}

const editDepth = (t: FeatureTree, depth: number): FeatureTree =>
  applyEdit(t, { type: 'set_payload', nodeId: 'f1', payload: box(depth) });

const extrudeDepths = (plan: ReturnType<typeof featureTreeToOcctPlan>) =>
  plan.commands.filter((c) => c.op === 'extrude').map((c) => c.feature.depth);

describe('featurePlan — fillet body follows the upstream edit', () => {
  it('plans the NEW depth after an upstream change (10 -> 25)', () => {
    const plan = featureTreeToOcctPlan(editDepth(refTree(10), 25));
    // Exactly one extrude — the upstream node itself. Before this change
    // there were two, and the second one carried the stale depth 10.
    expect(extrudeDepths(plan)).toEqual([25]);
    expect(extrudeDepths(plan)).not.toContain(10);
  });

  it('targets the upstream node directly instead of a snapshot copy', () => {
    const plan = featureTreeToOcctPlan(refTree(10));
    const fillet = plan.commands.find((c) => c.op === 'fillet')!;
    expect(fillet.target).toBe('f1');
    expect(plan.commands.map((c) => c.resultId)).not.toContain('f2__body');
  });

  it('does not let the consumed upstream body win finalResultId', () => {
    expect(featureTreeToOcctPlan(refTree(10)).finalResultId).toBe('f2');
  });

  it('reports an empty embedded list for a fully parametric tree', () => {
    expect(featureTreeToOcctPlan(refTree(10)).embeddedChildNodes).toEqual([]);
  });
});

describe('featurePlan — legacy embedded trees are unchanged and reported', () => {
  it('still builds the synthetic __body extrude from the snapshot', () => {
    const plan = featureTreeToOcctPlan(legacyTree(10));
    const fillet = plan.commands.find((c) => c.op === 'fillet')!;
    expect(fillet.target).toBe('f2__body');
    expect(extrudeDepths(plan)).toEqual([10, 10]);
  });

  it('names the node whose body came from a stale snapshot', () => {
    expect(featureTreeToOcctPlan(legacyTree(10)).embeddedChildNodes).toEqual(['f2']);
    // Legacy mode genuinely does NOT follow the edit — pinned so the
    // difference between the two modes stays visible.
    const stale = featureTreeToOcctPlan(editDepth(legacyTree(10), 25));
    expect(extrudeDepths(stale)).toEqual([25, 10]);
    expect(stale.embeddedChildNodes).toEqual(['f2']);
  });
});
