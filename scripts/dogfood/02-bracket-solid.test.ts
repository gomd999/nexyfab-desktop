/**
 * DOGFOOD 02 — the bracket as an ACTUAL SOLID.
 *
 * 01 revealed that a naive feature order emits several disjoint top-level
 * bodies. Here we build it the way the IR intends (boolean difference) and
 * probe the seams:
 *   A) can fillet and chamfer coexist on one part?
 *   B) does the boolean-composed part round-trip through persistence?
 *   C) does an upstream edit reach through a boolean + pattern?
 *   D) does computeStats agree with the SCAD actually emitted?
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildFilletFeatureRef } from '@/lib/cad/filletProfile';
import { buildChamferFeatureRef } from '@/lib/cad/chamferProfile';
import { buildLinearPatternRef, linearPatternToScad } from '@/lib/cad/pattern';
import { buildHoleFeature, holeToScad } from '@/lib/cad/holeProfile';
import { replayTree, type FeatureTree, type FeatureNode } from '@/lib/cad/featureTree';
import { applyEdit } from '@/lib/cad/featureTreeEdit';
import { computeStats } from '@/lib/cad/featureTreeStats';
import {
  serializeFeatureTree,
  deserializeFeatureTree,
  deserializeFeatureTreeWithPromotion,
} from '@/lib/cad/featureTreePersist';

const W = 120, H = 80, T = 10;

function plate(depth = T, w = W): ExtrudeFeature {
  const pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: H }, { x: 0, y: H }];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  const pointById = new Map(withIds.map((p) => [p.id, p]));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: w * H } as never,
    pointById,
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

function seedHole(depth: number) {
  return buildHoleFeature({
    center: { x: 15, y: 15 }, holeType: 'drilled', diameter: 9, depth,
  });
}

/** Correctly-composed bracket: fillet(plate) MINUS pattern(hole). */
function solidBracket(base: ExtrudeFeature): FeatureTree {
  const fillet = buildFilletFeatureRef('extrude_plate', base, 8, 'vertical');
  const hole = seedHole(base.depth);
  const pat = buildLinearPatternRef('hole_seed', {
    childScad: holeToScad(hole),
    count: 4, spacing: 30, direction: { x: 1, y: 0, z: 0 },
  });
  const nodes: FeatureNode[] = [
    { id: 'extrude_plate', name: 'Plate', dependencies: [], payload: base },
    { id: 'fillet_corners', name: 'Corner fillet', dependencies: ['extrude_plate'], payload: fillet },
    { id: 'hole_seed', name: 'Hole seed', dependencies: [], payload: hole },
    { id: 'holes_row', name: 'Hole row', dependencies: ['hole_seed'], payload: pat },
    {
      id: 'cut',
      name: 'Drill holes',
      dependencies: ['fillet_corners', 'holes_row'],
      payload: { kind: 'boolean', op: 'difference', bodies: ['fillet_corners', 'holes_row'] },
    },
  ];
  return { nodes };
}

describe('DOGFOOD 02 — bracket as a real solid', () => {
  it('A: can a chamfer be applied to a filleted body?', () => {
    const base = plate();
    const fillet = buildFilletFeatureRef('extrude_plate', base, 8, 'vertical');
    const chamfer = buildChamferFeatureRef('fillet_corners', base, 2, 'top');
    const tree: FeatureTree = {
      nodes: [
        { id: 'extrude_plate', name: 'Plate', dependencies: [], payload: base },
        { id: 'fillet_corners', name: 'Fillet', dependencies: ['extrude_plate'], payload: fillet },
        { id: 'chamfer_top', name: 'Chamfer', dependencies: ['fillet_corners'], payload: chamfer },
      ],
    };
    let msg = '(no error — it worked)';
    try {
      replayTree(tree);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    console.log('A: chamfer-on-fillet =>', msg);
  });

  it('A2: fillet + chamfer both on the plate — what does replay emit?', () => {
    const base = plate();
    const tree: FeatureTree = {
      nodes: [
        { id: 'extrude_plate', name: 'Plate', dependencies: [], payload: base },
        { id: 'f', name: 'Fillet', dependencies: ['extrude_plate'], payload: buildFilletFeatureRef('extrude_plate', base, 8, 'vertical') },
        { id: 'c', name: 'Chamfer', dependencies: ['extrude_plate'], payload: buildChamferFeatureRef('extrude_plate', base, 2, 'top') },
      ],
    };
    const r = replayTree(tree);
    console.log('A2 emittedOrder (top-level bodies):', r.emittedOrder);
    console.log('A2 full SCAD:\n' + r.scad);
    // Two top-level bodies = two overlapping solids, silently.
    expect(r.emittedOrder).toEqual(['f', 'c']);
  });

  // F15 부채 표식(자기소멸): 불리언이 든 트리는 **저장→로드가 불가능**하다 —
  // persist 검증기가 boolean 을 모른다(`node[N].payload.kind="boolean" is not a known
  // FeatureKind`). W2-A 가 hole·rib 이 boolean 으로 조립된다고 증명했으므로 그 트리도
  // 저장 불가다. 고쳐지면 이 테스트가 통과하며 붉어져 표식 제거를 강제한다.
  it.fails('B: boolean-composed bracket — SCAD, volume, persistence (F15 저장 불가)', () => {
    const base = plate();
    const tree = solidBracket(base);
    const r = replayTree(tree);
    console.log('B emittedOrder:', r.emittedOrder);
    console.log('B SCAD:\n' + r.scad);

    const stats = computeStats(tree);
    // Analytic: plate 120*80*10 = 96000
    //   minus 4 corner fillets r=8: 4*(64 - pi*64/4)*10 = 4*13.7325*10 = 549.3
    //   minus 4 holes d9 depth10: 4*pi*4.5^2*10 = 2544.7
    const analytic = 96000 - 549.3 - 2544.7;
    console.log('B computeStats.volume =', stats.volume, '| analytic ~', analytic);
    console.log('B bbox =', JSON.stringify(stats.bbox));

    const json = serializeFeatureTree(tree);
    const back = deserializeFeatureTree(json);
    console.log('B round-trip ok?', back.ok, back.ok ? '' : JSON.stringify(back));
    const promo = deserializeFeatureTreeWithPromotion(json);
    console.log('B promotion ok?', promo.ok, JSON.stringify(promo).slice(0, 300));
    expect(back.ok).toBe(true);
  });

  it('C: thickness 10 -> 25 through boolean + pattern', () => {
    const base = plate();
    const tree = solidBracket(base);
    const before = replayTree(tree);
    const edited = applyEdit(tree, {
      type: 'set_payload', nodeId: 'extrude_plate', payload: { ...base, depth: 25 },
    });
    const after = replayTree(edited);
    console.log('C cut BEFORE:\n' + before.perNode.get('cut'));
    console.log('C cut AFTER :\n' + after.perNode.get('cut'));
    const holeAfter = after.perNode.get('holes_row')!;
    console.log('C holes_row AFTER thickening:\n' + holeAfter);
    // The hole was built with depth = ORIGINAL thickness. After thickening the
    // plate to 25 the hole is still 10 deep — a blind hole where the user
    // expects a through hole. Nothing warns.
    console.log('C >>> does hole depth track plate thickness?',
      holeAfter.includes('h=25.01') ? 'YES' : 'NO — still h=10.01');
  });

  it('D: stats volume vs the SCAD that is actually emitted', () => {
    const base = plate();
    const tree = solidBracket(base);
    const r = replayTree(tree);
    const scad = r.scad;
    const holeCuts = (scad.match(/NEXYFAB:HOLE_CUT/g) ?? []).length;
    const forLoop = /for \(i = \[0 : (\d+)\]\)/.exec(scad);
    const instances = forLoop ? Number(forLoop[1]) + 1 : holeCuts;
    const stats = computeStats(tree);
    const oneHole = Math.PI * 4.5 * 4.5 * 10;
    console.log('D hole instances actually in SCAD:', instances);
    console.log('D stats.volume:', stats.volume);
    console.log('D plate volume:', 96000);
    console.log('D implied holes removed by stats:', (96000 - stats.volume) / oneHole);
    console.log('D one hole volume:', oneHole);
  });
});
