/**
 * W2-0 debt payoff — the AI planner emits REFERENCES, not copies.
 *
 * The planner is a producer, not a stale reader: every fillet it emitted
 * carried a `childExtrude` copy, so every AI-authored model was born
 * non-parametric. Editing the box afterwards left the fillet frozen.
 *
 * These tests apply the planner's own steps, then edit the upstream and
 * assert the emitted SCAD follows — the end-to-end property, not just the
 * presence of a field.
 */
import { describe, it, expect } from 'vitest';
import { planFromIntent } from './featureTreePlanner';
import {
  replayTree,
  validateTree,
  upstreamRefsOf,
  type FeatureTree,
  type FeatureNode,
} from '@/lib/cad/featureTree';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

const EMPTY: FeatureTree = { nodes: [] };

/** Apply every add_node step a plan produced, in order. */
function applyPlan(tree: FeatureTree, steps: ReadonlyArray<unknown>): FeatureTree {
  let t = tree;
  for (const step of steps as ReadonlyArray<{ type: string; node: FeatureNode }>) {
    // The planner speaks 'add_node'; the edit layer's op is 'insert_node'.
    if (step.type === 'add_node') t = applyEdit(t, { type: 'insert_node', node: step.node });
  }
  return t;
}

/** Core cube Z of an 'all' fillet body — tracks `depth - 2r`. */
function coreDepthOf(scad: string): number {
  const m = scad.match(/cube\(\[[\d.]+, [\d.]+, ([\d.]+)\]\)/);
  if (!m) throw new Error(`no core cube in:\n${scad}`);
  return Number(m[1]);
}

describe('featureTreePlanner — create_box_with_fillet emits a reference', () => {
  const plan = () =>
    planFromIntent(
      {
        kind: 'create_box_with_fillet',
        size: { x: 20, y: 20, z: 10 },
        filletRadius: 2,
      },
      EMPTY,
    );

  it('names the box by id and declares it as a dependency', () => {
    const tree = applyPlan(EMPTY, plan().steps);
    const fillet = tree.nodes[1]!;
    const refs = upstreamRefsOf(fillet.payload);
    expect(refs).toEqual([tree.nodes[0]!.id]);
    expect(fillet.dependencies).toContain(tree.nodes[0]!.id);
    // refs ⊆ dependencies is enforced here, not just asserted.
    expect(() => validateTree(tree)).not.toThrow();
  });

  it('regenerates the fillet when the planned box is later edited (10 -> 25)', () => {
    const tree = applyPlan(EMPTY, plan().steps);
    const boxNode = tree.nodes[0]!;
    const filletId = tree.nodes[1]!.id;

    expect(coreDepthOf(replayTree(tree).perNode.get(filletId)!)).toBe(10 - 4);

    const edited = applyEdit(tree, {
      type: 'set_payload',
      nodeId: boxNode.id,
      payload: { ...(boxNode.payload as ExtrudeFeature), depth: 25 },
    });
    // 21 = 25 - 2r. Before this change it stayed at 6 forever.
    expect(coreDepthOf(replayTree(edited).perNode.get(filletId)!)).toBe(25 - 4);
  });
});

describe('featureTreePlanner — add_fillet_to_last emits a reference', () => {
  it('regenerates the fillet when the parent extrude is edited', () => {
    const withBox = applyPlan(
      EMPTY,
      planFromIntent(
        { kind: 'create_box_with_holes', size: { x: 20, y: 20, z: 10 }, holes: [] },
        EMPTY,
      ).steps,
    );
    const tree = applyPlan(
      withBox,
      planFromIntent({ kind: 'add_fillet_to_last', radius: 2 }, withBox).steps,
    );

    const boxNode = tree.nodes[0]!;
    const filletId = tree.nodes[1]!.id;
    expect(upstreamRefsOf(tree.nodes[1]!.payload)).toEqual([boxNode.id]);
    expect(() => validateTree(tree)).not.toThrow();

    const edited = applyEdit(tree, {
      type: 'set_payload',
      nodeId: boxNode.id,
      payload: { ...(boxNode.payload as ExtrudeFeature), depth: 25 },
    });
    expect(coreDepthOf(replayTree(edited).perNode.get(filletId)!)).toBe(25 - 4);
  });
});
