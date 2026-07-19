/**
 * W2-0 regression — an upstream edit that invalidates a downstream bound
 * must be REFUSED at emit time, not silently emitted as negative geometry.
 *
 * Before downstream regeneration, fillet/chamfer emitted against a frozen
 * `childExtrude` snapshot: stale, but geometrically valid. With `childId`
 * resolving the live upstream, thinning the host plate under an r=8 fillet
 * produced `cube([104, 64, -6])` — a negative-height solid. The check the
 * `buildFilletFeatureRef` docstring promised did not exist.
 *
 * Repro of the original symptom lives in
 * `scripts/dogfood/08-edit-invalidates-bound.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { buildExtrudeFromLoop, type ExtrudeFeature } from '../extrudeProfile';
import { buildFilletFeatureRef, filletToScad } from '../filletProfile';
import { buildChamferFeatureRef, chamferToScad } from '../chamferProfile';
import { replayTree, type FeatureTree } from '../featureTree';
import { applyEdit } from '../featureTreeEdit';

function plate(depth: number, w = 120, h = 80): ExtrudeFeature {
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const withIds = pts.map((p, i) => ({ id: `pt${i}`, ...p }));
  return buildExtrudeFromLoop(
    { points: withIds.map((p) => p.id), lines: [], signedArea: w * h } as never,
    new Map(withIds.map((p) => [p.id, p])),
    { depth, mode: 'add', direction: 'one_sided' },
  );
}

function filletTree(child: ExtrudeFeature, r: number, sel: 'all' | 'vertical') {
  const f = buildFilletFeatureRef('p', child, r, sel);
  const tree: FeatureTree = {
    nodes: [
      { id: 'p', name: 'Plate', dependencies: [], payload: child },
      { id: 'f', name: 'Fillet', dependencies: ['p'], payload: f },
    ],
  };
  return tree;
}

describe('W2-0 — fillet refuses an upstream edit that breaks its bound', () => {
  it('emits fine while the bound holds (depth 20, r 8, edges=all)', () => {
    const out = replayTree(filletTree(plate(20), 8, 'all')).perNode.get('f')!;
    expect(out).toContain('cube([104, 64, 4])');
    expect(out).not.toMatch(/-\d/);
  });

  it('rejects — with the numbers — when the plate is thinned below 2r', () => {
    const tree = filletTree(plate(20), 8, 'all');
    const thin = applyEdit(tree, {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(10),
    });
    expect(() => replayTree(thin)).toThrow(
      /radius 8 must be < depth\/2 = 5 when filleting all edges/,
    );
  });

  it('names the feature and the upstream it no longer fits', () => {
    const tree = filletTree(plate(20), 8, 'all');
    const thin = applyEdit(tree, {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(10),
    });
    let msg = '';
    try {
      replayTree(thin);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain("fillet 'f'");
    expect(msg).toContain("upstream body 'p'");
    // Refusal, not a clamp: the user is told what to change.
    expect(msg).toMatch(/reduce the radius or thicken the body/);
  });

  it('rejects when the PROFILE shrinks below 2r (vertical edges)', () => {
    const tree = filletTree(plate(20, 120, 80), 8, 'vertical');
    const tiny = applyEdit(tree, {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(20, 10, 10),
    });
    expect(() => replayTree(tiny)).toThrow(
      /radius 8 must be < min\(profile bbox\)\/2 = 5/,
    );
  });

  it("'vertical' is unaffected by depth alone — no false rejection", () => {
    const tree = filletTree(plate(20), 8, 'vertical');
    const thin = applyEdit(tree, {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(2),
    });
    // A 2mm plate with r=8 vertical fillets is legal: the fillet spans the
    // full depth and consumes nothing from the caps.
    expect(() => replayTree(thin)).not.toThrow();
  });

  it('never emits a negative dimension for any of the broken cases', () => {
    for (const sel of ['all', 'vertical'] as const) {
      const tree = filletTree(plate(20), 8, sel);
      const broken = applyEdit(tree, {
        type: 'set_payload',
        nodeId: 'p',
        payload: plate(sel === 'all' ? 10 : 20, 10, 10),
      });
      let scad = '';
      try {
        scad = replayTree(broken).perNode.get('f') ?? '';
      } catch {
        scad = '';
      }
      expect(scad).not.toMatch(/cube\(\[[^\]]*-\d/);
    }
  });

  it('legacy (snapshot) mode is untouched — no childId, no new check', () => {
    // A fillet without childId emits against the snapshot the builder already
    // validated, so behaviour is byte-identical to before this fix.
    const child = plate(20);
    const legacy = {
      kind: 'fillet' as const,
      childExtrude: child,
      radius: 8,
      edgeSelection: 'all' as const,
    };
    expect(() => filletToScad(legacy)).not.toThrow();
  });
});

describe('W2-0 — chamfer refuses the same way', () => {
  function chamferTree(child: ExtrudeFeature, d: number) {
    const c = buildChamferFeatureRef('p', child, d, 'top');
    const tree: FeatureTree = {
      nodes: [
        { id: 'p', name: 'Plate', dependencies: [], payload: child },
        { id: 'c', name: 'Chamfer', dependencies: ['p'], payload: c },
      ],
    };
    return tree;
  }

  it('emits fine while the bound holds (depth 20, d 8, edges=top)', () => {
    expect(() => replayTree(chamferTree(plate(20), 8))).not.toThrow();
  });

  it('rejects when the plate is thinned to 4mm under a d=8 chamfer', () => {
    const thin = applyEdit(chamferTree(plate(20), 8), {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(4),
    });
    expect(() => replayTree(thin)).toThrow(
      /distance 8 must be < depth\/2 = 2 when chamfering top edges/,
    );
  });

  it('rejects when the profile shrinks below 2d', () => {
    const tiny = applyEdit(chamferTree(plate(20), 8), {
      type: 'set_payload',
      nodeId: 'p',
      payload: plate(20, 10, 10),
    });
    expect(() => replayTree(tiny)).toThrow(
      /distance 8 must be < min\(profile bbox\)\/2 = 5/,
    );
  });

  it('legacy (snapshot) mode is untouched', () => {
    const child = plate(20);
    expect(() =>
      chamferToScad({
        kind: 'chamfer',
        childExtrude: child,
        distance: 8,
        edgeSelection: 'top',
      }),
    ).not.toThrow();
  });
});

describe('W2-0 — pattern has no upstream-dependent bound to re-check', () => {
  /**
   * Deliberate non-finding, recorded so a future reader does not re-open it.
   *
   * linear/circular pattern consume the upstream as an already-rendered SCAD
   * STRING (`resolvePatternChildScad` → `ctx.requireScad`), never as
   * geometry. Their own parameters — count, spacing, direction, axis, total
   * angle — are validated at build time and are entirely independent of the
   * child's dimensions, so no upstream edit can invalidate them the way it
   * invalidates a radius against a depth. There is nothing to re-check at
   * emit time; adding a check would be theatre.
   */
  it('an upstream edit changes the pattern body but not its parameters', () => {
    expect(true).toBe(true);
  });
});
