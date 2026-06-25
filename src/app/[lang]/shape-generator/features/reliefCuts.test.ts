import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyBendRelief,
  applyCornerRelief,
  bendReliefFeature,
  cornerReliefFeature,
} from './reliefCuts';

function makePlate(w = 100, t = 2.0, d = 50): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, t, d);
  g.computeBoundingBox();
  return g;
}

/** Flat plate with a DECLARED bend on the history (legacy-shaped entry, no
 *  absolute line data) — bend relief locates the bend line from the history,
 *  and a legacy entry resolves exactly like the old position-fraction
 *  convention, so the closed-form volume identities below stay exact (the
 *  plate is still flat: reliefs are cut before folding). */
function plateWithDeclaredBend(
  w = 100, t = 2.0, d = 50, position = 0.5,
): THREE.BufferGeometry {
  const g = makePlate(w, t, d);
  g.userData = {
    __bendHistory: [{ angle: 90, radius: 2, position, direction: 'up' }],
  };
  return g;
}

/** Signed mesh volume via the divergence theorem (works for the
 *  non-indexed triangle soup three-bvh-csg produces). */
function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

describe('applyBendRelief — notch pair at bend-line ends', () => {
  it('rectangular: removes exactly 2 × (width × depth × thickness)', () => {
    // 100×2×50 plate: X is longest → position runs along X, the bend
    // line runs along Z, and the notches cut inward at the two Z edges.
    // The volume identity is layout-independent either way.
    const plate = plateWithDeclaredBend(100, 2, 50);
    const v0 = meshVolume(plate);
    const out = applyBendRelief(plate, { width: 4, depth: 6, position: 0.5, shape: 'rectangular' });
    const v1 = meshVolume(out);
    expect(v0 - v1).toBeCloseTo(2 * 4 * 6 * 2, 1);
  });

  it('obround: removes 2 × (w·(d−r) + πr²/2) × t within facet tolerance', () => {
    const plate = plateWithDeclaredBend(100, 2, 50);
    const v0 = meshVolume(plate);
    const w = 4, d = 6, t = 2, r = w / 2;
    const out = applyBendRelief(plate, { width: w, depth: d, position: 0.5, shape: 'obround' });
    const v1 = meshVolume(out);
    const exact = 2 * (w * (d - r) + (Math.PI * r * r) / 2) * t;
    // 32-segment cylinder ≈ 0.64% under the exact circle area.
    expect(Math.abs((v0 - v1) - exact) / exact).toBeLessThan(0.02);
  });

  it('keeps the sheet bbox (notches are interior to the blank outline)', () => {
    const plate = plateWithDeclaredBend(100, 2, 50);
    const out = applyBendRelief(plate, { width: 3, depth: 5, position: 0.5, shape: 'rectangular' });
    out.computeBoundingBox();
    const bb = out.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(100, 4);
    expect(bb.max.z - bb.min.z).toBeCloseTo(50, 4);
    expect(bb.max.y - bb.min.y).toBeCloseTo(2, 4);
  });

  it('cuts at the recorded bend position along the primary (longest) axis', () => {
    // Long in Z → primary axis Z, bend line along X, notches at x=±50.
    const plate = plateWithDeclaredBend(60, 2, 200, 0.25); // z ∈ [-100, 100]
    const out = applyBendRelief(plate, { width: 4, depth: 6, position: 0.25, shape: 'rectangular' });
    // Expect removed material near z = -100 + 200·0.25 = -50, at both X edges.
    // Verify by sampling: some vertex should now sit at the notch inner wall
    // (x = ±(30−6) = ±24) close to the bend line z=-50.
    const pos = out.attributes.position;
    let found = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getX(i)) - 24) < 1e-3 && Math.abs(pos.getZ(i) + 50) <= 2 + 1e-3) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('carries the upstream bend history through the cut', () => {
    const plate = plateWithDeclaredBend();
    const out = applyBendRelief(plate, { width: 3, depth: 5, position: 0.5, shape: 'rectangular' });
    expect((out.userData as { __bendHistory?: unknown[] }).__bendHistory).toHaveLength(1);
  });

  it('FAILS CLEAN with a descriptive error when the body has no bend to relieve', () => {
    const plate = makePlate(); // no __bendHistory — nothing to relieve
    expect(() =>
      applyBendRelief(plate, { width: 3, depth: 5, position: 0.5, shape: 'rectangular' }),
    ).toThrow(/requires a bend/i);
  });

  it('locates a v2 history entry by its ABSOLUTE bend line (lineAxis/linePos)', () => {
    // Declared line at z = -10 (fraction would say z = 0): the notch pair
    // must land on the recorded absolute coordinate, not the bbox fraction.
    const plate = makePlate(100, 2, 50);
    plate.userData = {
      __bendHistory: [{
        angle: 90, radius: 2, position: 0.3, direction: 'up',
        source: 'bend', lineAxis: 'z', linePos: -10, blankLength: 100, flatBefore: 40,
      }],
    };
    const out = applyBendRelief(plate, { width: 4, depth: 6, position: 0.3, shape: 'rectangular' });
    // lineAxis 'z' → the bend line runs along Z at x = −10 → the notch pair
    // cuts inward from the two Z edges, centred at x = −10. The inner notch
    // wall therefore sits at z = ±(25−6) = ±19 with x within the 4mm width.
    const pos = out.attributes.position;
    let found = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getZ(i)) - 19) < 1e-3 && Math.abs(pos.getX(i) + 10) <= 2 + 1e-3) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('selects the recorded bend NEAREST the requested position fraction', () => {
    // Two declared bends at 25% and 75% of a Z-long plate (z ∈ [-100, 100]).
    const plate = makePlate(60, 2, 200);
    plate.userData = {
      __bendHistory: [
        { angle: 90, radius: 2, position: 0.25, direction: 'up' },
        { angle: 90, radius: 2, position: 0.75, direction: 'up' },
      ],
    };
    const out = applyBendRelief(plate, { width: 4, depth: 6, position: 0.8, shape: 'rectangular' });
    // Nearest to 0.8 is the 75% bend → notches near z = +50, not z = -50.
    const pos = out.attributes.position;
    let nearUpper = false, nearLower = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(Math.abs(pos.getX(i)) - 24) < 1e-3) {
        if (Math.abs(pos.getZ(i) - 50) <= 2 + 1e-3) nearUpper = true;
        if (Math.abs(pos.getZ(i) + 50) <= 2 + 1e-3) nearLower = true;
      }
    }
    expect(nearUpper).toBe(true);
    expect(nearLower).toBe(false);
  });

  it('throws on invalid params and zero-thickness bodies', () => {
    const plate = plateWithDeclaredBend();
    expect(() => applyBendRelief(plate, { width: 0, depth: 5, position: 0.5, shape: 'rectangular' })).toThrow();
    expect(() => applyBendRelief(plate, { width: 3, depth: 0, position: 0.5, shape: 'rectangular' })).toThrow();
    const zeroThick = new THREE.BoxGeometry(50, 0, 30);
    zeroThick.userData = { __bendHistory: [{ angle: 90, radius: 1, position: 0.5, direction: 'up' }] };
    expect(() => applyBendRelief(zeroThick, { width: 3, depth: 5, position: 0.5, shape: 'rectangular' })).toThrow();
  });
});

describe('applyCornerRelief — corner cutout', () => {
  it('square at inset 0 removes a quarter: (size/2)² × t', () => {
    const plate = makePlate(100, 2, 50);
    const v0 = meshVolume(plate);
    const out = applyCornerRelief(plate, { corner: 0, shape: 'square', size: 8, inset: 0 });
    const v1 = meshVolume(out);
    expect(v0 - v1).toBeCloseTo(4 * 4 * 2, 1);
  });

  it('circular at inset 0 removes a quarter circle: (πr²/4) × t', () => {
    const plate = makePlate(100, 2, 50);
    const v0 = meshVolume(plate);
    const r = 4;
    const out = applyCornerRelief(plate, { corner: 0, shape: 'circular', size: r * 2, inset: 0 });
    const v1 = meshVolume(out);
    const exact = (Math.PI * r * r) / 4 * 2;
    expect(Math.abs((v0 - v1) - exact) / exact).toBeLessThan(0.02);
  });

  it('cuts the requested corner only (all four corners)', () => {
    const corners: { corner: number; x: 1 | -1; z: 1 | -1 }[] = [
      { corner: 0, x: 1, z: 1 },
      { corner: 1, x: 1, z: -1 },
      { corner: 2, x: -1, z: 1 },
      { corner: 3, x: -1, z: -1 },
    ];
    for (const c of corners) {
      const plate = makePlate(100, 2, 50);
      const out = applyCornerRelief(plate, { corner: c.corner, shape: 'square', size: 8, inset: 0 });
      const pos = out.attributes.position;
      // The cut corner (x=±50, z=±25) must have no vertex exactly on it,
      // while the diagonally opposite corner stays intact.
      let onCutCorner = false, onOppositeCorner = false;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), pz = pos.getZ(i);
        if (Math.abs(px - c.x * 50) < 1e-4 && Math.abs(pz - c.z * 25) < 1e-4) onCutCorner = true;
        if (Math.abs(px + c.x * 50) < 1e-4 && Math.abs(pz + c.z * 25) < 1e-4) onOppositeCorner = true;
      }
      expect(onCutCorner, `corner ${c.corner} should be cut away`).toBe(false);
      expect(onOppositeCorner, `opposite corner of ${c.corner} should remain`).toBe(true);
    }
  });

  it('inset moves the cut inward (removes more material up to the full punch)', () => {
    const plate = makePlate(100, 2, 50);
    const v0 = meshVolume(plate);
    // Inset by r so the full circle is inside the sheet → removes πr²·t.
    const r = 4;
    const out = applyCornerRelief(plate, { corner: 0, shape: 'circular', size: r * 2, inset: r });
    const v1 = meshVolume(out);
    const exact = Math.PI * r * r * 2;
    expect(Math.abs((v0 - v1) - exact) / exact).toBeLessThan(0.02);
  });

  it('throws on invalid params', () => {
    const plate = makePlate();
    expect(() => applyCornerRelief(plate, { corner: 9, shape: 'circular', size: 4, inset: 0 })).toThrow();
    expect(() => applyCornerRelief(plate, { corner: 0, shape: 'circular', size: 0, inset: 0 })).toThrow();
  });
});

describe('feature definitions — pipeline contract', () => {
  it('bendReliefFeature applies with percent position + enum shape', () => {
    const plate = plateWithDeclaredBend(100, 2, 50);
    const v0 = meshVolume(plate);
    const out = bendReliefFeature.apply(plate, { width: 4, depth: 6, position: 50, shape: 0 });
    expect(meshVolume(out)).toBeLessThan(v0);
  });

  it('bendReliefFeature fails clean through the pipeline contract when no bend exists', () => {
    const plate = makePlate(100, 2, 50);
    expect(() => bendReliefFeature.apply(plate, { width: 4, depth: 6, position: 50, shape: 0 }))
      .toThrow(/requires a bend/i);
  });

  it('cornerReliefFeature applies with enum corner + shape', () => {
    const plate = makePlate(100, 2, 50);
    const v0 = meshVolume(plate);
    const out = cornerReliefFeature.apply(plate, { corner: 0, shape: 1, size: 8, inset: 0 });
    expect(meshVolume(out)).toBeLessThan(v0);
  });

  it('param keys match the wiring defaults used by the ribbon', () => {
    expect(bendReliefFeature.params.map(p => p.key)).toEqual(['width', 'depth', 'position', 'shape']);
    expect(cornerReliefFeature.params.map(p => p.key)).toEqual(['corner', 'shape', 'size', 'inset']);
  });
});
