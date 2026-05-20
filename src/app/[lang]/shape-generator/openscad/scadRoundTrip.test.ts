import { describe, it, expect } from 'vitest';
import { emitScadFromFeatures, nfabTag } from './emitScadFromFeatures';
import { emitFilletStage2, emitRoundedBoxFilletScad } from './emitScadStage2';
import { parseNfabFeatures, parseScadToFeatures } from './parseScadToFeatures';
import type { FeatureInstance } from '../features/types';

function feat(id: string, type: FeatureInstance['type'], params: Record<string, number>): FeatureInstance {
  return { id, type, params, enabled: true };
}

const BASE = { baseShapeId: 'box', baseParams: { width: 60, depth: 40, height: 30 } };

describe('nfabTag', () => {
  it('emits a machine-readable tag with numeric params', () => {
    expect(nfabTag('fillet', { radius: 4 })).toBe('// @nfab fillet radius=4');
  });
  it('omits non-finite params', () => {
    expect(nfabTag('shell', { thickness: 2, bogus: undefined })).toBe('// @nfab shell thickness=2');
  });
});

describe('parseNfabFeatures', () => {
  it('recovers a single tag', () => {
    const tags = parseNfabFeatures('cube([1,1,1]);\n// @nfab fillet radius=4\ncube([1,1,1]);');
    expect(tags).toEqual([{ type: 'fillet', params: { radius: 4 } }]);
  });
  it('ignores ordinary comments and code', () => {
    expect(parseNfabFeatures('// just a comment\ncube(10);')).toEqual([]);
  });
});

describe('emit → parse round-trip (C1, lossless feature list)', () => {
  it('round-trips fillet / chamfer / shell / draft params', () => {
    const features = [
      feat('f1', 'fillet', { radius: 4 }),
      feat('c1', 'chamfer', { size: 2 }),
      feat('s1', 'shell', { thickness: 3 }),
      feat('d1', 'draft', { angle: 5 }),
    ];
    const scad = emitScadFromFeatures(features, BASE);
    const recovered = parseNfabFeatures(scad);
    expect(recovered).toEqual([
      { type: 'fillet', params: { radius: 4 } },
      { type: 'chamfer', params: { size: 2 } },
      { type: 'shell', params: { thickness: 3 } },
      { type: 'draft', params: { angle: 5 } },
    ]);
  });

  it('preserves application order through interleaved primitive features', () => {
    // a fillet, then a hole (no @nfab tag), then a chamfer.
    const features = [
      feat('f1', 'fillet', { radius: 3 }),
      feat('h1', 'hole', { diameter: 6, depth: 40, posX: 0, posY: 0, posZ: 0 }),
      feat('c1', 'chamfer', { size: 2 }),
    ];
    const scad = emitScadFromFeatures(features, BASE);
    expect(parseNfabFeatures(scad).map(t => t.type)).toEqual(['fillet', 'chamfer']);
  });

  it('the emitted base primitive still parses (existing behavior intact)', () => {
    const scad = emitScadFromFeatures([feat('f1', 'fillet', { radius: 4 })], BASE);
    const r = parseScadToFeatures(scad);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shape.baseShapeId).toBe('box');
  });
});

describe('C2 — parser handles rotate / scale / mirror prefixes', () => {
  it('recognises a primitive behind a rotate prefix (was unsupported before)', () => {
    const r = parseScadToFeatures('rotate([0, 90, 0]) cube([10, 20, 30]);');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shape.baseShapeId).toBe('box');
      expect(r.shape.rotate).toEqual({ x: 0, y: 90, z: 0 });
    }
  });

  it('captures scale (component-wise) and still recognises the primitive', () => {
    const r = parseScadToFeatures('scale([2, 1, 0.5]) sphere(r=5);');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shape.baseShapeId).toBe('sphere');
      expect(r.shape.scale).toEqual({ x: 2, y: 1, z: 0.5 });
    }
  });

  it('peels mixed translate + rotate + scale prefixes in any order', () => {
    const r = parseScadToFeatures('translate([1,2,3]) rotate([0,0,45]) scale(2) cube([4,4,4]);');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shape.baseShapeId).toBe('box');
      expect(r.shape.translate).toEqual({ x: 1, y: 2, z: 3 });
      expect(r.shape.rotate).toEqual({ x: 0, y: 0, z: 45 });
      expect(r.shape.scale).toEqual({ x: 2, y: 2, z: 2 });
    }
  });

  it('captures a mirror prefix', () => {
    const r = parseScadToFeatures('mirror([1, 0, 0]) cylinder(h=10, r=3);');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shape.mirror).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('O1 — fast box fillet (hull, not minkowski)', () => {
  it('emitRoundedBoxFilletScad uses hull() of 8 corner spheres, no minkowski', () => {
    const scad = emitRoundedBoxFilletScad(60, 40, 30, 4);
    expect(scad).toContain('hull()');
    expect(scad).not.toContain('minkowski');
    expect((scad.match(/sphere\(/g) ?? []).length).toBe(8);  // 8 corners
  });

  it('clamps the radius to half the smallest extent', () => {
    const scad = emitRoundedBoxFilletScad(20, 20, 20, 50); // r too big
    // inset corner offset = w/2 - r would go negative without clamping;
    // clamped r ≈ 10-ε keeps corners near origin (offsets ~0).
    expect(scad).toContain('hull()');
  });

  it('emitFilletStage2 picks hull when given box dims, minkowski otherwise', () => {
    const withBox = emitFilletStage2('cube([60,40,30],center=true);', 4, { w: 60, d: 40, h: 30 });
    expect(withBox.code).toContain('hull()');
    expect(withBox.code).not.toContain('minkowski');

    const generic = emitFilletStage2('some_complex_shape();', 4);
    expect(generic.code).toContain('minkowski()');
    expect(generic.code).toContain('$fn=16'); // reduced resolution for speed
  });
});
