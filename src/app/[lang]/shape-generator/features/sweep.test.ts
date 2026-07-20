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
import { sweepFeature } from './sweep';
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

describe('sweep API', () => {
  it('exposes a twist param (guide-rail sweep remains unimplemented — documented limit)', () => {
    const keys = sweepFeature.params.map(p => p.key);
    expect(keys).toContain('twist');
  });
});
