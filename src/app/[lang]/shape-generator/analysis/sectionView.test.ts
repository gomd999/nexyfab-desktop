import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateSectionView, sectionProjectionFor } from './sectionView';

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  g.computeBoundingBox();
  return g;
}

describe('generateSectionView · axis-aligned cut on a box', () => {
  it('produces outline segments when the plane cuts through the body', () => {
    const box = makeBox(60, 40, 30);
    const r = generateSectionView(box, { axis: 'z', offset: 0, label: 'A' });
    expect(r.outlineLines.length).toBeGreaterThan(0);
    // Outline lines should be marked visible (solid).
    expect(r.outlineLines.every(l => l.type === 'visible')).toBe(true);
  });

  it('emits no outline when the plane misses the body entirely', () => {
    const box = makeBox(60, 40, 30);
    // Box Z extent is [-15, 15]; cut at z=100 misses everything.
    const r = generateSectionView(box, { axis: 'z', offset: 100, label: 'A' });
    expect(r.outlineLines).toEqual([]);
    expect(r.hatchLines).toEqual([]);
  });

  it('emits parallel 45° hatch lines inside the section bbox', () => {
    const box = makeBox(60, 40, 30);
    const r = generateSectionView(box, { axis: 'y', offset: 0, label: 'B' });
    expect(r.hatchLines.length).toBeGreaterThan(2);
    // Every hatch line should have slope = 1 (45°, dy/dx = 1) within
    // float tolerance — that's the ANSI 31 general-purpose pattern.
    for (const h of r.hatchLines) {
      const dx = h.x2 - h.x1;
      const dy = h.y2 - h.y1;
      // Slope ≈ 1; non-degenerate (dx > 0).
      if (dx > 0.01) expect(Math.abs(dy / dx - 1)).toBeLessThan(0.05);
    }
  });

  it('hatch spacing scales with the `hatchSpacing` option', () => {
    const box = makeBox(60, 40, 30);
    const tight = generateSectionView(box, { axis: 'z', offset: 0, label: 'A' }, { hatchSpacing: 1 });
    const loose = generateSectionView(box, { axis: 'z', offset: 0, label: 'A' }, { hatchSpacing: 6 });
    expect(tight.hatchLines.length).toBeGreaterThan(loose.hatchLines.length);
  });

  it('title follows the SECTION X-X convention', () => {
    const r = generateSectionView(makeBox(), { axis: 'x', offset: 0, label: 'C' });
    expect(r.title).toBe('SECTION C-C');
  });

  it('label text contains the doubled letter (`C-C` not just `C`)', () => {
    const r = generateSectionView(makeBox(), { axis: 'x', offset: 0, label: 'C' });
    expect(r.texts[0].text).toBe('C-C');
  });
});

describe('sectionProjectionFor — default view picker', () => {
  it('x axis → right view (looking along +X)', () => {
    expect(sectionProjectionFor('x')).toBe('right');
  });
  it('y axis → top view (looking along +Y)', () => {
    expect(sectionProjectionFor('y')).toBe('top');
  });
  it('z axis → front view (looking along +Z)', () => {
    expect(sectionProjectionFor('z')).toBe('front');
  });
});

describe('generateSectionView · empty / degenerate inputs', () => {
  it('returns empty result for geometry without a position attribute', () => {
    const empty = new THREE.BufferGeometry();
    const r = generateSectionView(empty, { axis: 'x', offset: 0, label: 'A' });
    expect(r.outlineLines).toEqual([]);
    expect(r.hatchLines).toEqual([]);
    expect(r.title).toBe('SECTION A-A');
  });

  it('survives a plane that grazes the body surface (no infinite hatch)', () => {
    const box = makeBox(60, 40, 30);
    // Plane right at the body's max boundary — should not crash, may
    // emit a thin sliver of outline.
    const r = generateSectionView(box, { axis: 'y', offset: 20, label: 'A' });
    expect(Array.isArray(r.outlineLines)).toBe(true);
    expect(Array.isArray(r.hatchLines)).toBe(true);
  });
});

describe('generateSectionView · outline geometry is the true cross-section (verified)', () => {
  const outlineBBox = (lines: { x1: number; y1: number; x2: number; y2: number }[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of lines) {
      minX = Math.min(minX, l.x1, l.x2); maxX = Math.max(maxX, l.x1, l.x2);
      minY = Math.min(minY, l.y1, l.y2); maxY = Math.max(maxY, l.y1, l.y2);
    }
    return { w: maxX - minX, h: maxY - minY };
  };

  // A 20(X) × 30(Y) × 40(Z) box: the cut exposes the two axes orthogonal to the
  // plane normal, projected by sectionProjectionFor. ⊥X → Z×Y (40×30),
  // ⊥Y → X×Z (20×40), ⊥Z → X×Y (20×30).
  it.each([
    ['x', 40, 30],
    ['y', 20, 40],
    ['z', 20, 30],
  ] as ['x' | 'y' | 'z', number, number][])(
    'a box cut ⊥%s yields the correct %d×%d cross-section',
    (axis, w, h) => {
      const box = new THREE.BoxGeometry(20, 30, 40);
      const r = generateSectionView(box, { axis, offset: 0, label: 'A' });
      const b = outlineBBox(r.outlineLines);
      expect(b.w).toBeCloseTo(w, 0);
      expect(b.h).toBeCloseTo(h, 0);
    },
  );

  it('a cylinder cut ⊥ its axis is a circle of the right diameter; ⊥ side is a rectangle', () => {
    const cyl = new THREE.CylinderGeometry(10, 10, 40, 48); // R10, axis +Y
    const circle = outlineBBox(generateSectionView(cyl, { axis: 'y', offset: 0, label: 'A' }).outlineLines);
    expect(circle.w).toBeCloseTo(20, 0); // diameter
    expect(circle.h).toBeCloseTo(20, 0);
    const rect = outlineBBox(generateSectionView(cyl, { axis: 'x', offset: 0, label: 'B' }).outlineLines);
    // right-view projection of the X=0 slice: width = diameter (Z, 20),
    // height = cylinder length (Y, 40).
    expect(rect.w).toBeCloseTo(20, 0); // diameter
    expect(rect.h).toBeCloseTo(40, 0); // cylinder length
  });

  it('hatch is clipped to a round section — never spills into the bbox corners', () => {
    // ⊥Y cut of an axis-aligned cylinder is a circle of radius 10 centred on the
    // projected origin. A bbox fill would reach the corner (~14.1); a clipped
    // fill keeps every hatch endpoint within the circle.
    const cyl = new THREE.CylinderGeometry(10, 10, 40, 64);
    const r = generateSectionView(cyl, { axis: 'y', offset: 0, label: 'A' });
    expect(r.hatchLines.length).toBeGreaterThan(0);
    for (const h of r.hatchLines) {
      expect(Math.hypot(h.x1, h.y1)).toBeLessThanOrEqual(10.5);
      expect(Math.hypot(h.x2, h.y2)).toBeLessThanOrEqual(10.5);
      // still a 45° line
      expect((h.y2 - h.y1) - (h.x2 - h.x1)).toBeCloseTo(0, 4);
    }
  });
});
