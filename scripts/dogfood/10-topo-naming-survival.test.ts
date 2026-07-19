/**
 * DOGFOOD 10 — W1-B/C claim: "위상 참조가 조용히 틀리지 않는다 — 애매하면 명시 거부".
 *
 * A designer selects an edge, fillets it, then edits the sketch upstream.
 * Does the selection still point at the SAME physical edge, or does it
 * silently slide onto a different one?
 */
import { describe, it } from 'vitest';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildExtrudeTopo, namesOf, edgeMidpoint } from '@/lib/cad/topoNaming';
import { nearestByMidpoint } from '@/lib/cad/edgeMatch';

function plate(depth: number, w: number, h: number): ExtrudeFeature {
  const pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: w * h } as never,
    new Map(withIds.map((p) => [p.id, p])),
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

describe('DOGFOOD 10 — topology naming survival', () => {
  it('edge names before / after an upstream resize', () => {
    const before = buildExtrudeTopo(plate(10, 120, 80));
    const after = buildExtrudeTopo(plate(25, 160, 80));
    const nb = namesOf(before, 'edge');
    const na = namesOf(after, 'edge');
    console.log('edges BEFORE (120x80x10):', nb);
    console.log('edges AFTER  (160x80x25):', na);
    console.log('names stable?', JSON.stringify(nb) === JSON.stringify(na));
    console.log('faces BEFORE:', namesOf(before, 'face'));
  });

  it('a selection resolved by MIDPOINT after a resize — does it slide?', () => {
    const before = buildExtrudeTopo(plate(10, 120, 80));
    const after = buildExtrudeTopo(plate(25, 160, 80));
    const pick = namesOf(before, 'edge')[0]!;
    const target = edgeMidpoint(before, pick)!;
    console.log('picked edge:', pick, 'midpoint:', JSON.stringify(target));

    const midsAfter = namesOf(after, 'edge').map((n) => edgeMidpoint(after, n)!);
    const m = nearestByMidpoint(midsAfter, target, 1e-6);
    console.log('nearestByMidpoint result:', JSON.stringify(m));
    const namesAfter = namesOf(after, 'edge');
    console.log('=> resolves to:', m.index >= 0 ? namesAfter[m.index] : '(no match)');
    console.log('>>> if it silently returns a DIFFERENT edge, W1-B/C has a hole;');
    console.log('>>> if it returns no-match / ambiguous, the refusal contract holds.');
  });

  it('deliberately ambiguous: a square plate where 4 edges are symmetric', () => {
    const topo = buildExtrudeTopo(plate(10, 80, 80));
    const mids = namesOf(topo, 'edge').map((n) => edgeMidpoint(topo, n)!);
    // A point equidistant from several edges.
    const target = { x: 40, y: 40, z: 5 };
    const m = nearestByMidpoint(mids, target as never, 1e-6);
    console.log('ambiguous pick =>', JSON.stringify(m));
    console.log('>>> does it report ambiguity, or just pick the first?');
  });
});
