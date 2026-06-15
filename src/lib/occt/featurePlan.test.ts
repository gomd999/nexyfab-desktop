/**
 * featurePlan — feature tree → OCCT command IR (K1a, ADR-014).
 */
import { describe, it, expect } from 'vitest';
import { featureTreeToOcctPlan } from './featurePlan';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

function extrudeNode(id: string): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    depth: 5, direction: 'one_sided', mode: 'add',
  };
  return { id, name: id, dependencies: [], payload };
}

describe('featureTreeToOcctPlan', () => {
  it('extrude → a single build command, which is the final result', () => {
    const plan = featureTreeToOcctPlan({ nodes: [extrudeNode('e1')] });
    expect(plan.commands).toEqual([{ op: 'extrude', resultId: 'e1', feature: expect.any(Object) }]);
    expect(plan.finalResultId).toBe('e1');
    expect(plan.unsupported).toHaveLength(0);
  });

  it('boolean subtract: consumes its bodies; the boolean node is the final result', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('base'),
        extrudeNode('tool'),
        { id: 'cut', name: 'cut', dependencies: ['base', 'tool'], payload: { kind: 'boolean', op: 'difference', bodies: ['base', 'tool'] } },
      ],
    };
    const plan = featureTreeToOcctPlan(tree);
    const bool = plan.commands.find((c) => c.op === 'boolean');
    expect(bool).toMatchObject({ op: 'boolean', kind: 'subtract', base: 'base', tools: ['tool'], resultId: 'cut' });
    // base + tool are consumed → final result is the boolean.
    expect(plan.finalResultId).toBe('cut');
  });

  it('maps boolean op names (union/difference/intersection → union/subtract/intersect)', () => {
    const mk = (op: 'union' | 'difference' | 'intersection'): FeatureTree => ({
      nodes: [
        extrudeNode('a'), extrudeNode('b'),
        { id: 'r', name: 'r', dependencies: ['a', 'b'], payload: { kind: 'boolean', op, bodies: ['a', 'b'] } },
      ],
    });
    expect((featureTreeToOcctPlan(mk('union')).commands.find((c) => c.op === 'boolean') as { kind: string }).kind).toBe('union');
    expect((featureTreeToOcctPlan(mk('difference')).commands.find((c) => c.op === 'boolean') as { kind: string }).kind).toBe('subtract');
    expect((featureTreeToOcctPlan(mk('intersection')).commands.find((c) => c.op === 'boolean') as { kind: string }).kind).toBe('intersect');
  });

  it('fillet builds its inline childExtrude first, then fillets it', () => {
    const child: ExtrudeFeature = {
      kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      depth: 5, direction: 'one_sided', mode: 'add',
    };
    const tree: FeatureTree = {
      nodes: [{ id: 'f1', name: 'f1', dependencies: [], payload: { kind: 'fillet', childExtrude: child, radius: 2, edgeSelection: 'all' } }],
    };
    const plan = featureTreeToOcctPlan(tree);
    expect(plan.commands[0]).toMatchObject({ op: 'extrude', resultId: 'f1__body' });
    expect(plan.commands[1]).toMatchObject({ op: 'fillet', resultId: 'f1', target: 'f1__body', radius: 2, edgeIds: ['sel:all'] });
    expect(plan.finalResultId).toBe('f1');
  });

  it('flags unsupported kinds (sweep/pattern) for SCAD fallback, no OCCT result', () => {
    const tree: FeatureTree = {
      nodes: [
        extrudeNode('e1'),
        { id: 'lp', name: 'lp', dependencies: ['e1'], payload: { kind: 'linear_pattern', childScad: 'cube(1);', count: 3, direction: { x: 1, y: 0, z: 0 }, spacing: 5 } },
      ],
    };
    const plan = featureTreeToOcctPlan(tree);
    expect(plan.unsupported).toEqual([{ resultId: 'lp', kind: 'linear_pattern', reason: expect.stringMatching(/SCAD fallback/) }]);
    // lp produced no OCCT result → the extrude is the final OCCT solid.
    expect(plan.finalResultId).toBe('e1');
  });

  it('empty tree → empty plan', () => {
    const plan = featureTreeToOcctPlan({ nodes: [] });
    expect(plan.commands).toHaveLength(0);
    expect(plan.finalResultId).toBeNull();
  });
});
