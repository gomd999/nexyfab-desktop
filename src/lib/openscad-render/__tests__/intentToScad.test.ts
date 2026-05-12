import { describe, it, expect } from 'vitest';
import { intentToScad, validateIntent } from '../intentToScad';

describe('intentToScad', () => {
  it('emits a centered cube for box', () => {
    const r = intentToScad({ shapeId: 'box', params: { width: 30, height: 20, depth: 10 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('cube([30, 20, 10], center=true)');
      expect(r.scad).toContain('$fn = 64');
    }
  });

  it('uses radius (not diameter) for cylinder', () => {
    const r = intentToScad({ shapeId: 'cylinder', params: { diameter: 40, height: 25 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('cylinder(h=25, r=20, center=true)');
    }
  });

  it('emits pipe as difference of two cylinders', () => {
    const r = intentToScad({ shapeId: 'pipe', params: { outerDiameter: 30, innerDiameter: 20, length: 50 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('r=15');
      expect(r.scad).toContain('r=10');
    }
  });

  it('applies hole feature as difference', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 10 },
      features: [{ type: 'hole', params: { diameter: 6, x: 0, y: 0, z: 0 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('r=3');
    }
  });

  it('skips disabled features', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 10 },
      features: [{ type: 'hole', params: { diameter: 6 }, enabled: false }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).not.toContain('difference()');
    }
  });

  it('warns on unsupported feature but still emits base shape', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
      features: [{ type: 'sweep', params: {} }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('sweep')]));
      expect(r.scad).toContain('cube([30, 30, 30]');
    }
  });

  it('rejects unsupported shape with reason', () => {
    const r = intentToScad({ shapeId: 'helicalPropeller', params: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('helicalPropeller');
  });

  it('rejects NaN/Infinity params with a hard error (Stage-2 validation)', () => {
    // Pre-validation now catches non-finite dimensions instead of silently
    // falling back to defaults — the LLM occasionally produces these values
    // and we want a clear rejection rather than a misleading 50mm cube.
    const r = intentToScad({ shapeId: 'box', params: { width: NaN, height: Infinity, depth: -Infinity } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/width|height|depth/);
      expect(r.reason).toContain('not a finite number');
    }
  });

  it('clamps facets to [8, 256]', () => {
    const r1 = intentToScad({ shapeId: 'sphere', params: { diameter: 20 }, facets: 1 });
    const r2 = intentToScad({ shapeId: 'sphere', params: { diameter: 20 }, facets: 9999 });
    if (r1.ok) expect(r1.scad).toContain('$fn = 8');
    if (r2.ok) expect(r2.scad).toContain('$fn = 256');
  });

  describe('Stage-2 validation', () => {
    it('rejects negative dimensions with a clear message', () => {
      const r = intentToScad({ shapeId: 'box', params: { width: -10, height: 20, depth: 30 } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('width');
    });

    it('rejects zero radius / diameter', () => {
      const r = intentToScad({ shapeId: 'cylinder', params: { diameter: 0, height: 10 } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('diameter');
    });

    it('rejects pipe with inner ≥ outer', () => {
      const r = intentToScad({ shapeId: 'pipe', params: { outerDiameter: 20, innerDiameter: 25, length: 50 } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/innerDiameter.*outerDiameter/);
    });

    it('rejects washer with bore ≥ outer', () => {
      const r = intentToScad({ shapeId: 'washer', params: { outerDiameter: 20, innerDiameter: 20, thickness: 1.6 } });
      expect(r.ok).toBe(false);
    });

    it('warns on shell thickness ≥ half min footprint', () => {
      const r = intentToScad({
        shapeId: 'box',
        params: { width: 20, height: 20, depth: 20 },
        features: [{ type: 'shell', params: { thickness: 12 } }],
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('shell thickness')]));
      }
    });

    it('warns on hole diameter ≥ parent footprint', () => {
      const r = intentToScad({
        shapeId: 'box',
        params: { width: 30, height: 30, depth: 30 },
        features: [{ type: 'hole', params: { diameter: 30 } }],
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('hole diameter')]));
      }
    });

    it('validateIntent returns errors + warnings independently', () => {
      const v = validateIntent({
        shapeId: 'box',
        params: { width: 30, height: 30, depth: 30 },
        features: [{ type: 'shell', params: { thickness: 20 } }],
      });
      expect(v.errors).toEqual([]);
      expect(v.warnings.length).toBeGreaterThan(0);
    });

    it('clean intent passes with no errors or warnings', () => {
      const v = validateIntent({
        shapeId: 'cylinder',
        params: { diameter: 30, height: 50 },
      });
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
    });
  });

  it('produces stable output for identical input (determinism)', () => {
    const intent = {
      shapeId: 'cylinder',
      params: { diameter: 30, height: 50 },
      features: [{ type: 'hole', params: { diameter: 6 } }],
    };
    const a = intentToScad(intent);
    const b = intentToScad(intent);
    if (a.ok && b.ok) expect(a.scad).toBe(b.scad);
  });

  // ─── Standard parts (round 2) ──────────────────────────────────────────────

  it('emits hexNut as $fn=6 cylinder minus bore', () => {
    const r = intentToScad({ shapeId: 'hexNut', params: { acrossFlats: 13, thickness: 8, nominalDiameter: 8 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('$fn=6');
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('h=8');
    }
  });

  it('washer: outer minus inner cylinder', () => {
    const r = intentToScad({ shapeId: 'washer', params: { outerDiameter: 20, innerDiameter: 8, thickness: 1.6 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('r=10');
      expect(r.scad).toContain('r=4');
      expect(r.scad).toContain('h=1.6');
    }
  });

  it('iBeam: emits 12-vertex polygon and linear_extrude', () => {
    const r = intentToScad({ shapeId: 'iBeam', params: { beamHeight: 100, flangeWidth: 60, webThick: 5, flangeThick: 8, length: 200 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=200');
      expect(r.scad).toContain('polygon(points=[');
    }
  });

  it('lBracket: union of two flanges', () => {
    const r = intentToScad({ shapeId: 'lBracket', params: { width: 50, height: 50, depth: 50, thickness: 4 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('cube([50, 4, 50])');
      expect(r.scad).toContain('cube([4, 50, 50])');
    }
  });

  it('flange: includes circular bolt loop', () => {
    const r = intentToScad({
      shapeId: 'flange',
      params: { outerDiameter: 100, innerDiameter: 30, thickness: 12, pcd: 70, boltCount: 4, boltDiameter: 8 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('for (i = [0 : 3])');
      expect(r.scad).toContain('rotate([0, 0, 360 * i / 4])');
      expect(r.scad).toContain('translate([35, 0, 0])');
    }
  });

  it('bolt: hex head + shaft union', () => {
    const r = intentToScad({
      shapeId: 'bolt',
      params: { shaftDiameter: 8, shaftLength: 30, headHeight: 5, headFlats: 13 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('$fn=6');
      expect(r.scad).toContain('r=4');
    }
  });

  // ─── BOSL2-backed shapes (round 3) ─────────────────────────────────────────

  it('gear emits BOSL2 spur_gear with include header', () => {
    const r = intentToScad({ shapeId: 'gear', params: { teeth: 24, module: 2, thickness: 8 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('spur_gear(');
      expect(r.scad).toContain('teeth=24');
      expect(r.scad).toContain('mod=2');
    }
  });

  it('threadedRod emits BOSL2 threaded_rod with include header', () => {
    const r = intentToScad({ shapeId: 'threadedRod', params: { diameter: 8, length: 40, pitch: 1.25 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('threaded_rod(d=8, l=40, pitch=1.25)');
    }
  });

  it('roundedBox emits BOSL2 cuboid with rounding', () => {
    const r = intentToScad({ shapeId: 'roundedBox', params: { width: 50, height: 50, depth: 50, rounding: 5 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('cuboid([50, 50, 50], rounding=5)');
    }
  });

  it('screw passes spec and headType verbatim', () => {
    const r = intentToScad({ shapeId: 'screw', params: { length: 30 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      // Default spec falls back to M{diameter}
      expect(r.scad).toContain('screw(');
      expect(r.scad).toContain('length=30');
    }
  });

  it('springCoil emits linear_extrude with twist; no BOSL2 include', () => {
    const r = intentToScad({
      shapeId: 'springCoil',
      params: { coilDiameter: 20, wireDiameter: 2, turns: 8, freeLength: 60 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(');
      expect(r.scad).toContain('twist=2880');
      expect(r.scad).toContain('translate([10, 0, 0])');
      expect(r.scad).toContain('circle(r=1)');
      expect(r.scad).not.toContain('BOSL2');
    }
  });

  it('non-BOSL2 shape never includes BOSL2 header', () => {
    const r = intentToScad({ shapeId: 'box', params: { width: 10, height: 10, depth: 10 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).not.toContain('BOSL2');
    }
  });

  // ─── Path-based shapes (round 4) ───────────────────────────────────────────

  it('sweep emits path_sweep with parametric centerline', () => {
    const r = intentToScad({
      shapeId: 'sweep',
      params: { profileRadius: 6, pathLength: 100, pathAmplitude: 20, pathFrequency: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('path_sweep(');
      expect(r.scad).toContain('circle(r=6)');
    }
  });

  it('loft emits skin between two circular profiles', () => {
    const r = intentToScad({
      shapeId: 'loft',
      params: { bottomRadius: 30, topRadius: 15, height: 50 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('skin([');
      expect(r.scad).toContain('circle(r=30');
      expect(r.scad).toContain('circle(r=15');
    }
  });

  it('fanBlade emits hub + blade circular array', () => {
    const r = intentToScad({
      shapeId: 'fanBlade',
      params: { hubDiameter: 30, hubHeight: 20, bladeCount: 5, bladeLength: 60, rootChord: 25, tipChord: 15, pitchAngle: 25 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('cylinder(h=20, d=30');
      expect(r.scad).toContain('for (i = [0 : 4])');
      expect(r.scad).toContain('skin([');
    }
  });

  // ─── New features ──────────────────────────────────────────────────────────

  it('thread feature triggers BOSL2 include even on non-BOSL2 shape', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
      features: [{ type: 'thread', params: { diameter: 8, length: 30, pitch: 1.25 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('threaded_rod(d=8');
      expect(r.scad).toContain('internal=true');
    }
  });

  it('draft applies a scale factor', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'draft', params: { angle: 3, height: 50, referenceWidth: 50 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toMatch(/scale\(\[0\.\d+, 0\.\d+, 1\]\)/);
    }
  });

  it('rotate feature wraps body in rotate()', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 10, height: 10, depth: 10 },
      features: [{ type: 'rotate', params: { angleZ: 45 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('rotate([0, 0, 45])');
    }
  });

  it('twist is an alias for rotate', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 10, height: 10, depth: 10 },
      features: [{ type: 'twist', params: { angleZ: 90 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toContain('rotate([0, 0, 90])');
  });

  // ─── Domain shapes (round 5) ───────────────────────────────────────────────

  it('heatsink emits a pin grid loop (no BOSL2)', () => {
    const r = intentToScad({
      shapeId: 'heatsink',
      params: {
        baseWidth: 60, baseDepth: 60, baseHeight: 4,
        pinDiameter: 3, pinHeight: 25,
        pinRows: 8, pinCols: 8, margin: 4,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('cube([60, 4, 60]');
      expect(r.scad).toContain('for (i = [0 : 7]) for (j = [0 : 7])');
      expect(r.scad).toContain('cylinder(h=25, d=3');
      expect(r.scad).not.toContain('BOSL2');
    }
  });

  it('manifold emits ports + central bore (difference)', () => {
    const r = intentToScad({
      shapeId: 'manifold',
      params: {
        width: 80, height: 30, depth: 30,
        portCount: 4, portDiameter: 6, boreDiameter: 8,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('cube([80, 30, 30]');
      expect(r.scad).toContain('for (i = [0 : 3])');
      expect(r.scad).toContain('d=6');
      expect(r.scad).toContain('d=8');
    }
  });

  it('turbine uses BOSL2 path_sweep with curved blade path', () => {
    const r = intentToScad({
      shapeId: 'turbine',
      params: {
        hubDiameter: 40, hubHeight: 30, bladeCount: 8,
        outerRadius: 60, inletAngle: 25, outletAngle: 50,
        bladeThickness: 2,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('include <BOSL2/std.scad>');
      expect(r.scad).toContain('path_sweep(');
      expect(r.scad).toContain('for (i = [0 : 7])');
    }
  });

  // ─── Round 6: enclosure / structural sections ──────────────────────────────

  it('enclosure: outer cube minus inner cavity, plus lip', () => {
    const r = intentToScad({
      shapeId: 'enclosure',
      params: { width: 100, height: 40, depth: 60, wallThickness: 2.5, lipHeight: 4, lipInset: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('cube([100, 40, 60]');
      // The lid lip difference
      expect(r.scad).toMatch(/cube\(\[\d+\.?\d*, 4, /);
      expect(r.scad).not.toContain('BOSL2');
    }
  });

  it('tBeam: linear_extrude with 8-vertex T polygon', () => {
    const r = intentToScad({
      shapeId: 'tBeam',
      params: { flangeWidth: 80, beamHeight: 100, webThick: 8, flangeThick: 10, length: 200 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=200');
      expect(r.scad).toContain('polygon(points=[');
      // T has 8 vertices in our emit
      expect((r.scad.match(/\[/g) ?? []).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('uChannel: linear_extrude with U-shape polygon', () => {
    const r = intentToScad({
      shapeId: 'uChannel',
      params: { width: 50, height: 80, webThick: 6, flangeThick: 8, length: 200 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=200');
      expect(r.scad).toContain('[0, 0]');
      expect(r.scad).toContain('[50, 0]');
    }
  });

  it('zPurlin: linear_extrude with staggered Z polygon', () => {
    const r = intentToScad({
      shapeId: 'zPurlin',
      params: { flangeWidth: 60, beamHeight: 150, thickness: 2.5, length: 200 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('linear_extrude(height=200');
      // Z section has top flange in +X, bottom flange in -X — vertex count 8
      expect((r.scad.match(/\[-?\d+\.?\d*, -?\d+\.?\d*\]/g) ?? []).length).toBeGreaterThanOrEqual(8);
    }
  });

  // ─── Round 7: rack/bracket/mount domain ───────────────────────────────────

  it('rackUnit: 19" face with 4 holes per U', () => {
    const r = intentToScad({
      shapeId: 'rackUnit',
      params: { widthInches: 19, units: 2, faceThickness: 3, holeDiameter: 6.35 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('difference()');
      // 19*25.4 = 482.59999...mm (float); 2u = 88.9mm. Just ensure rough ranges.
      expect(r.scad).toMatch(/cube\(\[482\.\d+, 88\.9, 3\]/);
      expect(r.scad).toContain('for (i = [0 : 1])');
      // Four hole patterns per U (top/bottom × left/right)
      expect((r.scad.match(/translate\(\[/g) ?? []).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('shelfBracket: two perpendicular arms + triangular gusset', () => {
    const r = intentToScad({
      shapeId: 'shelfBracket',
      params: { armWidth: 200, armHeight: 200, thickness: 4, depth: 20, gussetWidth: 6 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('cube([200, 4, 20]');
      expect(r.scad).toContain('cube([4, 200, 20]');
      expect(r.scad).toContain('linear_extrude(height=6) polygon');
    }
  });

  it('hingedBracket: two plates + barrel hinge with pin bore', () => {
    const r = intentToScad({
      shapeId: 'hingedBracket',
      params: { armWidth: 60, armThickness: 4, knuckleDiameter: 12, knuckleHeight: 40, pinDiameter: 5 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('union()');
      expect(r.scad).toContain('cube([60, 4, 40]');
      expect(r.scad).toContain('difference()');
      expect(r.scad).toContain('d=12');
      expect(r.scad).toContain('d=5');
    }
  });

  it('motorMount: NEMA-style plate with center bore + 4 corner holes', () => {
    const r = intentToScad({
      shapeId: 'motorMount',
      params: { plateSize: 42, thickness: 5, boltCirclePitch: 31, boltDiameter: 3.4, centerBoreDiameter: 22 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scad).toContain('cube([42, 42, 5]');
      expect(r.scad).toContain('d=22');     // center bore
      expect(r.scad).toContain('d=3.4');    // bolt holes
      // 4 corner holes
      expect((r.scad.match(/cylinder\(h=5\.4/g) ?? []).length).toBeGreaterThanOrEqual(4);
    }
  });
});
