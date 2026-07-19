/**
 * W2-0 debt payoff — the STEP writer resolves upstream references.
 *
 * This is the output path a customer machines from. Reading the stale
 * `childExtrude` snapshot on a ref-mode tree meant a STEP file whose solid
 * was built from pre-edit dimensions while every other view of the model
 * showed the new ones.
 *
 * The child solid is a bbox approximation (Phase 1), so the depth shows up
 * as the Z extent of the CARTESIAN_POINT set. We assert on that rather
 * than on a substring, so the test tracks real geometry.
 */
import { describe, it, expect } from 'vitest';
import { writeFilletAsStep, previewFilletAnnotationMap } from './stepWriteFilletChamfer';
import { emitContextForTree } from '@/lib/cad/upstreamResolve';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import {
  buildFilletFeature,
  buildFilletFeatureRef,
  type FilletFeature,
} from '@/lib/cad/filletProfile';

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

const editDepth = (t: FeatureTree, depth: number): FeatureTree =>
  applyEdit(t, { type: 'set_payload', nodeId: 'f1', payload: box(depth) });

const filletOf = (t: FeatureTree) => t.nodes[1]!.payload as FilletFeature;

/** Max Z across every CARTESIAN_POINT in the STEP source. */
function maxZ(step: string): number {
  const re = /CARTESIAN_POINT\('',\(([-\d.E]+),([-\d.E]+),([-\d.E]+)\)\)/g;
  let max = -Infinity;
  let m: RegExpExecArray | null;
  while ((m = re.exec(step)) !== null) {
    const z = Number.parseFloat(m[3]!);
    if (Number.isFinite(z) && z > max) max = z;
  }
  if (max === -Infinity) throw new Error('no CARTESIAN_POINT found in STEP source');
  return max;
}

describe('writeFilletAsStep — child solid follows the upstream edit', () => {
  it('writes the NEW depth after an upstream change (10 -> 25)', () => {
    const before = refTree(10);
    expect(maxZ(writeFilletAsStep(filletOf(before), {
      emitContext: emitContextForTree(before),
    }))).toBe(10);

    const after = editDepth(before, 25);
    // The payload's embedded snapshot is still 10 — proving the writer is
    // no longer sourcing from it.
    expect(filletOf(after).childExtrude.depth).toBe(10);
    expect(maxZ(writeFilletAsStep(filletOf(after), {
      emitContext: emitContextForTree(after),
    }))).toBe(25);
  });

  it('refuses to write a ref-mode feature without a context (no silent stale B-rep)', () => {
    expect(() => writeFilletAsStep(filletOf(refTree(10)))).toThrow(
      /Refusing to fall back to the stale childExtrude snapshot/,
    );
  });

  it('previewFilletAnnotationMap resolves through the same path', () => {
    const after = editDepth(refTree(10), 25);
    // Ref mode without a context must refuse here too — the preview runs
    // the same child emission and would otherwise allocate ids against a
    // stale solid.
    expect(() => previewFilletAnnotationMap(filletOf(after))).toThrow(
      /Refusing to fall back/,
    );
    const map = previewFilletAnnotationMap(filletOf(after), {
      emitContext: emitContextForTree(after),
    });
    expect(map.shapeAspectEntityId).toBeGreaterThan(0);
  });

  it('legacy embedded features still write without a context, unchanged', () => {
    const legacy = buildFilletFeature(box(10), 2, 'all');
    expect(maxZ(writeFilletAsStep(legacy))).toBe(10);
  });
});
