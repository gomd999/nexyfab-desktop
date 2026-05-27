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
