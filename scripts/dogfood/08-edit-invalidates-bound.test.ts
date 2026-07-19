/**
 * DOGFOOD 08 — the case filletProfile's own docstring flags:
 *
 *   "A later upstream edit can therefore invalidate the radius bound
 *    (e.g. shrinking depth below 2r). That is caught at emit time by the
 *    same bound checks inside the SCAD path"
 *
 * Build a valid fillet, then shrink the plate until the fillet is
 * geometrically impossible, and see what actually comes out.
 *
 * Also: what do the live *FromSketch bridges produce for a tree?
 */
import { describe, it } from 'vitest';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildFilletFeatureRef } from '@/lib/cad/filletProfile';
import { buildChamferFeatureRef } from '@/lib/cad/chamferProfile';
import { replayTree, type FeatureTree } from '@/lib/cad/featureTree';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import { filletFromSketch } from '@/lib/sketch/filletFromSketch';
import { linearPatternFromSketch } from '@/lib/sketch/patternFromSketch';
import type { SolverViewState } from '@/lib/sketch/solverToProfile';

function plate(depth: number, w = 120, h = 80): ExtrudeFeature {
  const pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: w * h } as never,
    new Map(withIds.map((p) => [p.id, p])),
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

describe('DOGFOOD 08 — edits that invalidate downstream bounds', () => {
  it('fillet r=8 edges=all on a 20mm plate, then thin the plate to 10mm', () => {
    const thick = plate(20);
    // r=8 < depth/2 = 10  → valid at build time
    const fillet = buildFilletFeatureRef('p', thick, 8, 'all');
    const tree: FeatureTree = {
      nodes: [
        { id: 'p', name: 'Plate', dependencies: [], payload: thick },
        { id: 'f', name: 'Fillet', dependencies: ['p'], payload: fillet },
      ],
    };
    console.log('BEFORE (depth 20, r 8):\n' + replayTree(tree).perNode.get('f'));

    // Now thin it to 10mm. r=8 > depth/2 = 5 → geometrically impossible.
    const thin = applyEdit(tree, { type: 'set_payload', nodeId: 'p', payload: { ...thick, depth: 10 } });
    let out = '';
    try {
      out = replayTree(thin).perNode.get('f')!;
      console.log('AFTER (depth 10, r 8) — NO ERROR RAISED:\n' + out);
      const m = /cube\(\[([^\]]*)\]\)/.exec(out);
      console.log('>>> emitted cube dims:', m?.[1]);
      console.log('>>> depth - 2r = 10 - 16 = -6  → a NEGATIVE-height cube');
    } catch (e) {
      console.log('AFTER — correctly rejected:', e instanceof Error ? e.message : String(e));
    }
  });

  it('same for chamfer distance', () => {
    const thick = plate(20);
    const ch = buildChamferFeatureRef('p', thick, 8, 'top');
    const tree: FeatureTree = {
      nodes: [
        { id: 'p', name: 'Plate', dependencies: [], payload: thick },
        { id: 'c', name: 'Chamfer', dependencies: ['p'], payload: ch },
      ],
    };
    const thin = applyEdit(tree, { type: 'set_payload', nodeId: 'p', payload: { ...thick, depth: 4 } });
    try {
      const out = replayTree(thin).perNode.get('c')!;
      console.log('chamfer d=8 on a 4mm plate — NO ERROR:\n' + out);
    } catch (e) {
      console.log('chamfer correctly rejected:', e instanceof Error ? e.message : String(e));
    }
  });

  it('shrink the PROFILE until the fillet radius exceeds it', () => {
    const big = plate(20, 120, 80);
    const fillet = buildFilletFeatureRef('p', big, 8, 'vertical');
    const tree: FeatureTree = {
      nodes: [
        { id: 'p', name: 'Plate', dependencies: [], payload: big },
        { id: 'f', name: 'Fillet', dependencies: ['p'], payload: fillet },
      ],
    };
    const tiny = plate(20, 10, 10); // r=8 on a 10x10 plate is impossible
    const edited = applyEdit(tree, { type: 'set_payload', nodeId: 'p', payload: tiny });
    try {
      const out = replayTree(edited).perNode.get('f')!;
      console.log('r=8 fillet on a 10x10 plate — NO ERROR:\n' + out);
      console.log('>>> 10 - 2*8 = -6 in both X and Y');
    } catch (e) {
      console.log('correctly rejected:', e instanceof Error ? e.message : String(e));
    }
  });

  it('what tree do the LIVE *FromSketch bridges actually build?', () => {
    const sketch: SolverViewState = {
      points: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 120, y: 0 },
        { id: 'c', x: 120, y: 80 }, { id: 'd', x: 0, y: 80 },
      ],
      lines: [
        { id: 'l1', p1: 'a', p2: 'b' }, { id: 'l2', p1: 'b', p2: 'c' },
        { id: 'l3', p1: 'c', p2: 'd' }, { id: 'l4', p1: 'd', p2: 'a' },
      ],
    };
    const f = filletFromSketch(sketch, { extrudeDepth: 10, radius: 8, edgeSelection: 'vertical' } as never);
    console.log('filletFromSketch =>', f.ok ? 'ok' : f.error);
    if (f.ok) console.log('  returns keys:', Object.keys(f));
    const p = linearPatternFromSketch(sketch, {
      child: { kind: 'extrude', depth: 10 } as never,
      count: 3, spacing: 30, direction: { x: 1, y: 0, z: 0 },
    } as never);
    console.log('linearPatternFromSketch =>', p.ok ? 'ok' : p.error);
    if (p.ok) console.log('  returns keys:', Object.keys(p));
    console.log('>>> neither returns a FeatureTree — they return a flat SCAD string.');
    console.log('>>> so the tree the user SAVES never contains the fillet/pattern dependency');
    console.log('>>> that W2-B promotion requires. W2-B is correct but unreachable from here.');
  });
});
