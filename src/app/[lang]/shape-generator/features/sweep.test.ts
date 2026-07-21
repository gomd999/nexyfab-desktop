/**
 * W5-A sweep tests — twist (section rotation interpolation) + path regressions.
 *
 * Pre-fix probe evidence (2026-07-21):
 *   - params were pathType/length/arcAngle/arcRadius/helixPitch/helixTurns —
 *     no twist and no guide rail,
 *   - straight sweep volume exact (20,000), arc sweep vs Pappus relErr 1.8e-4.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sweepFeature, computeGuideRailScales } from './sweep';
import { meshSignedVolume } from './loft';

function volumeOf(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.getIndex();
  let indices: number[];
  if (idx) {
    indices = [];
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i));
  } else {
    indices = Array.from({ length: pos.count }, (_, i) => i);
  }
  return Math.abs(meshSignedVolume(pos.array as ArrayLike<number>, indices));
}

// Section = bbox of the input geometry: 20×10 → hw=10, hh=5, area 200.
const box = new THREE.BoxGeometry(20, 10, 4);
const base = { pathType: 0, length: 100, arcAngle: 90, arcRadius: 60, helixPitch: 20, helixTurns: 3, twist: 0 };

describe('sweep — untwisted regressions', () => {
  it('straight: V = A·L = 20,000 exactly', () => {
    const g = sweepFeature.apply(box, { ...base }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    expect(Math.abs(v - 20000) / 20000).toBeLessThan(1e-6);
  });

  it('arc R60 90°: Pappus V = A·R·θ within 1e-3 (path discretization approximation)', () => {
    const g = sweepFeature.apply(box, { ...base, pathType: 1 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    const pappus = 200 * 60 * (Math.PI / 2);
    expect(Math.abs(v - pappus) / pappus).toBeLessThan(1e-3);
  });
});

describe('sweep — twist (W5-A)', () => {
  it('straight + 90° twist: end section is rotated 90° (half-extents swap)', () => {
    const g = sweepFeature.apply(box, { ...base, twist: 90 }) as THREE.BufferGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    let maxX = 0, maxY = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - 100) < 1e-3) {
        maxX = Math.max(maxX, Math.abs(pos.getX(i)));
        maxY = Math.max(maxY, Math.abs(pos.getY(i)));
      }
    }
    // Untwisted end ring is |x|≤10, |y|≤5; rotated 90° → |x|≤5, |y|≤10.
    expect(Math.abs(maxX - 5)).toBeLessThan(1e-3);
    expect(Math.abs(maxY - 10)).toBeLessThan(1e-3);
  });

  it('straight + 90° twist: mid-path section is rotated 45° (interpolated, not flipped)', () => {
    const g = sweepFeature.apply(box, { ...base, twist: 90 }) as THREE.BufferGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    let maxX = 0, maxY = 0, count = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - 50) < 1e-3) {
        maxX = Math.max(maxX, Math.abs(pos.getX(i)));
        maxY = Math.max(maxY, Math.abs(pos.getY(i)));
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
    // Corner (10,5) rotated 45°: max |x| = max |y| = (10+5)/√2 = 10.6066…
    const expected = 15 / Math.SQRT2;
    expect(Math.abs(maxX - expected)).toBeLessThan(1e-3);
    expect(Math.abs(maxY - expected)).toBeLessThan(1e-3);
  });

  it('straight + 90° twist: volume stays A·L within 1e-3 (twisted ruled approximation)', () => {
    const g = sweepFeature.apply(box, { ...base, twist: 90 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    console.log('[W5-A] straight+90° twist volume =', v, '(A·L 20000, relErr', Math.abs(v - 20000) / 20000, ')');
    // 64 stations of 1.406° each → ruled deficit ≈ 1e-4 of A·L.
    expect(Math.abs(v - 20000) / 20000).toBeLessThan(1e-3);
  });

  it('arc R60 90° + 90° twist: Pappus V = A·R·θ within 1% (approximation)', () => {
    const g = sweepFeature.apply(box, { ...base, pathType: 1, twist: 90 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    const pappus = 200 * 60 * (Math.PI / 2);
    console.log('[W5-A] arc+90° twist volume =', v, '(Pappus', pappus, ', relErr', Math.abs(v - pappus) / pappus, ')');
    expect(Math.abs(v - pappus) / pappus).toBeLessThan(0.01);
  });

  it('helix + 360° twist: V ≈ A·L_helix within 2% (approximation)', () => {
    const g = sweepFeature.apply(box, { ...base, pathType: 2, twist: 360 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    // helixR = max(10,5)·1.5+20 = 35; L = turns·√((2πR)² + pitch²).
    const L = 3 * Math.hypot(2 * Math.PI * 35, 20);
    const expected = 200 * L;
    console.log('[W5-A] helix+360° twist volume =', v, '(A·L', expected, ', relErr', Math.abs(v - expected) / expected, ')');
    expect(Math.abs(v - expected) / expected).toBeLessThan(0.02);
  });

  it('twist=0 keeps the original extrude path bit-for-bit shape family (regression)', () => {
    const g0 = sweepFeature.apply(box, { ...base }) as THREE.BufferGeometry;
    const gU = sweepFeature.apply(box, { pathType: 0, length: 100, arcAngle: 90, arcRadius: 60, helixPitch: 20, helixTurns: 3 }) as THREE.BufferGeometry;
    expect(volumeOf(g0)).toBeCloseTo(volumeOf(gU), 6);
  });
});

describe('sweep — guide rail (W5-A remainder)', () => {
  const A1 = 200; // 20×10 section

  it('(a) straight + linear converging guide 20→10mm = frustum V = h/3·(A1+A2+√(A1A2))', () => {
    const g = sweepFeature.apply(box, { ...base, guideMode: 1, guideStart: 20, guideEnd: 10 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    const A2 = A1 * 0.25; // k(1) = 10/20 = 0.5 → area ×0.25
    const frustum = (100 / 3) * (A1 + A2 + Math.sqrt(A1 * A2)); // 35000/3
    const relErr = Math.abs(v - frustum) / frustum;
    console.log('[W5-A guide] straight frustum volume =', v, '(theory', frustum, ', relErr', relErr, ')');
    // Linear-in-t vertices → planar lateral faces → geometrically exact;
    // residual is float32 vertex quantization only.
    expect(relErr).toBeLessThan(1e-6);
  });

  it('(b) constant-distance guide → volume matches the no-guide sweep (straight)', () => {
    const vBase = volumeOf(sweepFeature.apply(box, { ...base }) as THREE.BufferGeometry);
    const vGuide = volumeOf(sweepFeature.apply(box, { ...base, guideMode: 1, guideStart: 20, guideEnd: 20 }) as THREE.BufferGeometry);
    const relErr = Math.abs(vGuide - vBase) / vBase;
    console.log('[W5-A guide] constant-guide volume =', vGuide, '(no-guide', vBase, ', relErr', relErr, ')');
    expect(relErr).toBeLessThan(1e-6);
  });

  it('(b) API: constant-distance guide yields all-1 scales', () => {
    const spine = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
      { t: 1, position: { x: 0, y: 0, z: 100 }, tangent: { x: 0, y: 0, z: 1 } },
    ];
    const guide = [
      { t: 0, position: { x: 0, y: 20, z: 0 } },
      { t: 1, position: { x: 0, y: 20, z: 100 } },
    ];
    const res = computeGuideRailScales(spine, guide, 65);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scales).toHaveLength(65);
      for (const k of res.scales) expect(Math.abs(k - 1)).toBeLessThan(1e-12);
    }
  });

  it('(c) arc R60 90° + converging guide k:1→0.5: V = A1·R·θ·(1+k+k²)/3 within 1e-3', () => {
    const g = sweepFeature.apply(box, { ...base, pathType: 1, guideMode: 1, guideStart: 20, guideEnd: 10 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    // Section stays centered on the spine (uniform scale about the spine
    // point) → generalized Pappus V = R·∫A(θ)dθ = A1·R·θ·(1+k1+k1²)/3.
    const theory = A1 * 60 * (Math.PI / 2) * (1 + 0.5 + 0.25) / 3;
    const relErr = Math.abs(v - theory) / theory;
    console.log('[W5-A guide] arc+guide volume =', v, '(theory', theory, ', relErr', relErr, ')');
    // Gate 1e-3: 128-segment polygonal arc + RMF discretization.
    expect(relErr).toBeLessThan(1e-3);
  });

  it('guide + twist combine: straight + 90° twist + constant guide keeps V = A·L within 1e-3', () => {
    const g = sweepFeature.apply(box, { ...base, twist: 90, guideMode: 1, guideStart: 20, guideEnd: 20 }) as THREE.BufferGeometry;
    const v = volumeOf(g);
    const relErr = Math.abs(v - 20000) / 20000;
    console.log('[W5-A guide] twist90+constant-guide volume =', v, '(A·L 20000, relErr', relErr, ')');
    expect(relErr).toBeLessThan(1e-3);
  });

  it('(d) rejects zero/negative guide distances with a reason', () => {
    expect(() => sweepFeature.apply(box, { ...base, guideMode: 1, guideStart: 20, guideEnd: 0 }))
      .toThrow(/Sweep guide rail rejected: .*positive/);
    expect(() => sweepFeature.apply(box, { ...base, guideMode: 1, guideStart: -5, guideEnd: 20 }))
      .toThrow(/Sweep guide rail rejected/);
  });

  it('(d) API rejects a guide that crosses the spine (negative scale not representable)', () => {
    const spine = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
      { t: 1, position: { x: 0, y: 0, z: 100 }, tangent: { x: 0, y: 0, z: 1 } },
    ];
    const guide = [
      { t: 0, position: { x: 0, y: 20, z: 0 } },
      { t: 1, position: { x: 0, y: -19, z: 100 } },
    ];
    const res = computeGuideRailScales(spine, guide, 65);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/crosses the spine|touches the spine/);
  });

  it('(d) API rejects an out-of-plane guide offset (nearly parallel to the tangent)', () => {
    const spine = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
      { t: 1, position: { x: 0, y: 0, z: 100 }, tangent: { x: 0, y: 0, z: 1 } },
    ];
    // Offset (0, 5, 30) at every station: along-tangent 30 > 50% of in-plane 5.
    const guide = [
      { t: 0, position: { x: 0, y: 5, z: 30 } },
      { t: 1, position: { x: 0, y: 5, z: 130 } },
    ];
    const res = computeGuideRailScales(spine, guide, 65);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unreachable/);
  });

  it('(d) API rejects degenerate guides (<2 samples, guide on the spine)', () => {
    const spine = [
      { t: 0, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } },
      { t: 1, position: { x: 0, y: 0, z: 100 }, tangent: { x: 0, y: 0, z: 1 } },
    ];
    const single = computeGuideRailScales(spine, [{ t: 0, position: { x: 0, y: 20, z: 0 } }], 65);
    expect(single.ok).toBe(false);
    if (!single.ok) expect(single.reason).toMatch(/at least 2 samples/);
    const onSpine = computeGuideRailScales(spine, [
      { t: 0, position: { x: 0, y: 0, z: 0 } },
      { t: 1, position: { x: 0, y: 0, z: 100 } },
    ], 65);
    expect(onSpine.ok).toBe(false);
    if (!onSpine.ok) expect(onSpine.reason).toMatch(/touches the spine/);
  });

  it('guideMode=0 leaves the no-guide sweep bit-identical (regression pin)', () => {
    const g0 = sweepFeature.apply(box, { ...base }) as THREE.BufferGeometry;
    const g1 = sweepFeature.apply(box, { ...base, guideMode: 0, guideStart: 20, guideEnd: 10 }) as THREE.BufferGeometry;
    const p0 = g0.getAttribute('position') as THREE.BufferAttribute;
    const p1 = g1.getAttribute('position') as THREE.BufferAttribute;
    expect(p1.count).toBe(p0.count);
    let mismatches = 0;
    const a0 = p0.array as Float32Array;
    const a1 = p1.array as Float32Array;
    for (let i = 0; i < a0.length; i++) if (a0[i] !== a1[i]) mismatches++;
    expect(mismatches).toBe(0);
  });
});

describe('sweep API', () => {
  it('exposes twist + guide-rail params (W5-A complete)', () => {
    const keys = sweepFeature.params.map(p => p.key);
    expect(keys).toContain('twist');
    expect(keys).toContain('guideMode');
    expect(keys).toContain('guideStart');
    expect(keys).toContain('guideEnd');
  });
});
