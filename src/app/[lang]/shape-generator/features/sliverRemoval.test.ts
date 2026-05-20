import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { detectSlivers, removeSlivers } from './sliverRemoval';

function geom(positions: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

describe('detectSlivers', () => {
  it('returns empty for a regular triangle (all 60°)', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0.5, 0.866, 0], [0, 1, 2]);
    expect(detectSlivers(g)).toEqual([]);
  });

  it('detects a triangle with one tiny angle', () => {
    // Long-thin triangle: angle at v2 is near 0°.
    const g = geom([0, 0, 0,  1, 0, 0,  0.5, 0.001, 0], [0, 1, 2]);
    expect(detectSlivers(g)).toContain(0);
  });

  it('respects custom angle threshold', () => {
    // 30° at one vertex — barely passes 5° default, fails 35° threshold.
    const g = geom(
      [0, 0, 0,  1, 0, 0,  0.5, 0.289, 0], // tan(30°)/2 ≈ 0.289
      [0, 1, 2],
    );
    expect(detectSlivers(g)).toEqual([]);
    expect(detectSlivers(g, { minAngleDeg: 35 })).toContain(0);
  });

  it('throws on non-indexed geometry', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]), 3));
    expect(() => detectSlivers(g)).toThrow();
  });
});

describe('removeSlivers', () => {
  it('does not change a clean mesh', () => {
    const g = geom([0, 0, 0,  1, 0, 0,  0.5, 0.866, 0], [0, 1, 2]);
    const r = removeSlivers(g);
    expect(r.report.slivers).toBe(0);
    expect(r.report.edgesCollapsed).toBe(0);
  });

  it('collapses a thin triangle into a degenerate (removed)', () => {
    // Tiny sliver with shortest edge 0.001 — well under default maxCollapse.
    const g = geom([0, 0, 0,  1, 0, 0,  0.0005, 0.001, 0], [0, 1, 2]);
    const r = removeSlivers(g);
    expect(r.report.slivers).toBeGreaterThanOrEqual(1);
    expect(r.report.finalTriangleCount).toBeLessThan(1);
  });

  it('preserves slivers whose shortest edge exceeds maxCollapseLength', () => {
    // Long sliver: vertices far apart, very narrow.
    const g = geom([0, 0, 0,  100, 0, 0,  50, 0.001, 0], [0, 1, 2]);
    const r = removeSlivers(g, { maxCollapseLength: 1 });
    expect(r.report.slivers).toBe(1);
    expect(r.report.edgesCollapsed).toBe(0); // no collapse — edges too long
  });
});
