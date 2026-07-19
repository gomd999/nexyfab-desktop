/**
 * DOGFOOD 07 — clean persistence matrix.
 * 06(b) conflated two failure causes; here every ref-mode feature gets a
 * real upstream node and a properly declared dependency, so the ONLY thing
 * being measured is: does this FeatureKind survive save -> load?
 */
import { describe, it } from 'vitest';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { buildHoleFeature } from '@/lib/cad/holeProfile';
import { buildFilletFeatureRef } from '@/lib/cad/filletProfile';
import { buildChamferFeatureRef } from '@/lib/cad/chamferProfile';
import { buildLinearPatternRef, buildCircularPatternRef } from '@/lib/cad/pattern';
import { buildRib } from '@/lib/cad/ribFeature';
import { validateTree, type FeatureTree, type FeaturePayload } from '@/lib/cad/featureTree';
import {
  serializeFeatureTree,
  deserializeFeatureTree,
  deserializeFeatureTreeWithPromotion,
} from '@/lib/cad/featureTreePersist';

function plate(depth = 10): ExtrudeFeature {
  const pts = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 80 }];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: 9600 } as never,
    new Map(withIds.map((p) => [p.id, p])),
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

describe('DOGFOOD 07 — FeatureKind persistence matrix', () => {
  it('all 12 declared kinds, each in a structurally valid tree', () => {
    const base = plate();
    const cases: Array<[string, FeaturePayload, string[]]> = [
      ['extrude', base, []],
      ['revolve', { kind: 'revolve', loop: [{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }], angleDegrees: 360, mode: 'add' } as never, []],
      ['sweep', { kind: 'sweep', profile: { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] }, path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], mode: 'add' } as never, []],
      ['loft', { kind: 'loft', sections: [{ profile: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }, z: 0 }, { profile: { points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }] }, z: 10 }], mode: 'add' } as never, []],
      ['hole', buildHoleFeature({ center: { x: 15, y: 15 }, holeType: 'drilled', diameter: 9, depth: 10 }), []],
      ['fillet', buildFilletFeatureRef('base', base, 8, 'vertical'), ['base']],
      ['chamfer', buildChamferFeatureRef('base', base, 2, 'top'), ['base']],
      ['linear_pattern', buildLinearPatternRef('base', { childScad: 'cube(1);', count: 3, spacing: 10, direction: { x: 1, y: 0, z: 0 } }), ['base']],
      ['circular_pattern', buildCircularPatternRef('base', { childScad: 'cube(1);', count: 6, axisOrigin: { x: 0, y: 0, z: 0 }, axisDirection: { x: 0, y: 0, z: 1 }, totalAngleDegrees: 360 }), ['base']],
      // NOTE (F15 follow-up): the original fixtures for these two were
      // invented — `rib` has no `centerline`/`mode` (it is start/end), and
      // `sweep_path.profile` is a bare point array, not a `{points}` wrapper
      // like `sweep`. The `as never` casts hid the mismatch, so their
      // "REJECTED" rows measured the fixtures, not the persistence layer.
      // Anchored to the real builder / real interface now.
      ['rib', buildRib({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, thickness: 3, height: 8 }), []],
      ['sweep_path', { kind: 'sweep_path', profile: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }] } as FeaturePayload, []],
      ['boolean', { kind: 'boolean', op: 'difference', bodies: ['base', 'other'] } as never, ['base', 'other']],
    ];

    console.log('KIND                SERIALIZE   DESERIALIZE');
    let ok = 0;
    for (const [name, payload, deps] of cases) {
      const tree: FeatureTree = {
        nodes: [
          { id: 'base', name: 'base', dependencies: [], payload: base },
          { id: 'other', name: 'other', dependencies: [], payload: base },
          { id: 'n', name, dependencies: deps, payload },
        ],
      };
      let structural = 'valid';
      try { validateTree(tree); } catch (e) { structural = 'TREE INVALID: ' + (e instanceof Error ? e.message : e); }
      if (structural !== 'valid') { console.log(`  ${name.padEnd(18)} ${structural}`); continue; }

      let ser = 'ok', des: string;
      let json = '';
      try { json = serializeFeatureTree(tree); } catch (e) { ser = 'THREW: ' + (e instanceof Error ? e.message : e); }
      if (ser !== 'ok') { console.log(`  ${name.padEnd(18)} ${ser}`); continue; }
      const back = deserializeFeatureTree(json);
      des = back.ok ? 'OK' : `REJECTED — ${back.message}`;
      if (back.ok) ok++;
      console.log(`  ${name.padEnd(18)} ${ser.padEnd(11)} ${des}`);
    }
    console.log(`\n>>> ${ok} of ${cases.length} declared FeatureKinds survive a save/load round trip.`);
  });

  it('W2-B promotion path on a legacy (embedded, no childId) fillet', () => {
    const base = plate();
    // Legacy shape: childExtrude embedded, NO childId, no dependency.
    const legacyFillet = { ...buildFilletFeatureRef('base', base, 8, 'vertical') } as Record<string, unknown>;
    delete legacyFillet.childId;
    const tree: FeatureTree = {
      nodes: [
        { id: 'base', name: 'base', dependencies: [], payload: base },
        { id: 'f', name: 'Fillet', dependencies: [], payload: legacyFillet as never },
      ],
    };
    const json = serializeFeatureTree(tree);
    const plain = deserializeFeatureTree(json);
    const promoted = deserializeFeatureTreeWithPromotion(json);
    console.log('legacy plain load ok?', plain.ok);
    console.log('legacy promotion result:', JSON.stringify(promoted, null, 2).slice(0, 900));
    if (promoted.ok) {
      const f = promoted.tree.nodes.find((n) => n.id === 'f')!;
      console.log('promoted fillet childId:', (f.payload as { childId?: string }).childId);
      console.log('promoted fillet dependencies:', f.dependencies);
      console.log('>>> if childId is set, an upstream edit now propagates; if not, it stays frozen.');
    }
  });
});

// ── appended probe: what does the promotion REPORT say? ──
import { describe as d2, it as i2 } from 'vitest';
d2('DOGFOOD 07b — promotion report', () => {
  i2('legacy fillet whose childExtrude equals an existing node', () => {
    const base = plate();
    const legacy = { ...buildFilletFeatureRef('base', base, 8, 'vertical') } as Record<string, unknown>;
    delete legacy.childId;
    const tree: FeatureTree = {
      nodes: [
        { id: 'base', name: 'base', dependencies: [], payload: base },
        { id: 'f', name: 'Fillet', dependencies: [], payload: legacy as never },
      ],
    };
    const r = deserializeFeatureTreeWithPromotion(serializeFeatureTree(tree));
    if (!r.ok) { console.log('load failed', r.message); return; }
    console.log('PROMOTION REPORT:', JSON.stringify(r.promotion, null, 2));
    const f = r.tree.nodes.find((n) => n.id === 'f')!;
    console.log('childId after promotion:', (f.payload as { childId?: string }).childId);
    console.log('dependencies after promotion:', f.dependencies);
  });

  i2('same, but TWO identical extrudes exist (ambiguous)', () => {
    const base = plate();
    const legacy = { ...buildFilletFeatureRef('base', base, 8, 'vertical') } as Record<string, unknown>;
    delete legacy.childId;
    const tree: FeatureTree = {
      nodes: [
        { id: 'base', name: 'base', dependencies: [], payload: base },
        { id: 'twin', name: 'twin', dependencies: [], payload: plate() },
        { id: 'f', name: 'Fillet', dependencies: [], payload: legacy as never },
      ],
    };
    const r = deserializeFeatureTreeWithPromotion(serializeFeatureTree(tree));
    if (!r.ok) { console.log('load failed', r.message); return; }
    console.log('AMBIGUOUS PROMOTION REPORT:', JSON.stringify(r.promotion, null, 2));
  });
});
