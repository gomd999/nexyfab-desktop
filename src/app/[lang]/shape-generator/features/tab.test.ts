import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyTab, tabFeature } from './tab';

function makePlate(w = 100, t = 1.0, d = 50): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, t, d);
  g.computeBoundingBox();
  return g;
}

describe('applyTab — flat in-plane edge protrusion', () => {
  it('adds vertices to the merged geometry', () => {
    const plate = makePlate();
    const before = plate.attributes.position.count;
    const tabbed = applyTab(plate, { width: 20, length: 10, position: 0.5, edgeIndex: 0 });
    expect(tabbed.attributes.position.count).toBeGreaterThan(before);
  });

  it('extends the bbox by exactly `length` outward on each edge', () => {
    const cases: { edgeIndex: number; axis: 'x' | 'z'; sign: 1 | -1 }[] = [
      { edgeIndex: 0, axis: 'z', sign: 1 },
      { edgeIndex: 1, axis: 'z', sign: -1 },
      { edgeIndex: 2, axis: 'x', sign: 1 },
      { edgeIndex: 3, axis: 'x', sign: -1 },
    ];
    for (const c of cases) {
      const plate = makePlate(100, 1, 50); // x ∈ [-50,50], z ∈ [-25,25]
      const tabbed = applyTab(plate, { width: 20, length: 10, position: 0.5, edgeIndex: c.edgeIndex });
      tabbed.computeBoundingBox();
      const bb = tabbed.boundingBox!;
      const base = c.axis === 'x' ? 50 : 25;
      const extent = c.sign === 1 ? bb.max[c.axis] : -bb.min[c.axis];
      expect(extent).toBeCloseTo(base + 10, 5);
      // The opposite side must be untouched.
      const opposite = c.sign === 1 ? -bb.min[c.axis] : bb.max[c.axis];
      expect(opposite).toBeCloseTo(base, 5);
    }
  });

  it('does NOT grow the sheet thickness (tab is in-plane, not a flange)', () => {
    const plate = makePlate(100, 1.5, 50);
    const tabbed = applyTab(plate, { width: 30, length: 15, position: 0.5, edgeIndex: 0 });
    tabbed.computeBoundingBox();
    const bb = tabbed.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeCloseTo(1.5, 5);
  });

  it('positions the tab along the edge and clamps it onto the edge', () => {
    const plate = makePlate(100, 1, 50);
    // position 0 → tab center clamped to -50 + width/2 = -40
    const tabbed = applyTab(plate, { width: 20, length: 10, position: 0, edgeIndex: 0 });
    tabbed.computeBoundingBox();
    // Find the X extent of vertices that sit beyond the original +Z edge.
    const pos = tabbed.attributes.position;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > 25 + 1e-6) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
      }
    }
    expect(minX).toBeCloseTo(-50, 5);
    expect(maxX).toBeCloseTo(-30, 5);
  });

  it('clamps width to the edge length', () => {
    const plate = makePlate(40, 1, 30);
    const tabbed = applyTab(plate, { width: 500, length: 5, position: 0.5, edgeIndex: 0 });
    tabbed.computeBoundingBox();
    const bb = tabbed.boundingBox!;
    // Tab width clamped to the 40mm edge → X extent unchanged.
    expect(bb.max.x - bb.min.x).toBeCloseTo(40, 5);
  });

  it('preserves the upstream bend history on userData', () => {
    const plate = makePlate();
    plate.userData = { __bendHistory: [{ angle: 90, radius: 1, position: 0.5, direction: 'up' }] };
    const tabbed = applyTab(plate, { width: 20, length: 10, position: 0.5, edgeIndex: 0 });
    expect((tabbed.userData as { __bendHistory?: unknown[] }).__bendHistory).toHaveLength(1);
  });

  it('merges even when the base has no uv channel (attribute alignment)', () => {
    const plate = makePlate();
    plate.deleteAttribute('uv');
    const tabbed = applyTab(plate, { width: 20, length: 10, position: 0.5, edgeIndex: 0 });
    expect(tabbed.attributes.position.count).toBeGreaterThan(0);
  });

  it('throws on invalid inputs', () => {
    const plate = makePlate();
    expect(() => applyTab(plate, { width: 0, length: 10, position: 0.5, edgeIndex: 0 })).toThrow();
    expect(() => applyTab(plate, { width: 10, length: 0, position: 0.5, edgeIndex: 0 })).toThrow();
    expect(() => applyTab(plate, { width: 10, length: 10, position: 0.5, edgeIndex: 9 })).toThrow();
    const zeroThick = new THREE.BoxGeometry(50, 0, 30);
    expect(() => applyTab(zeroThick, { width: 10, length: 10, position: 0.5, edgeIndex: 0 })).toThrow();
  });
});

describe('tabFeature — pipeline definition', () => {
  it('applies via the FeatureDefinition contract (percent position)', () => {
    const plate = makePlate();
    const out = tabFeature.apply(plate, { width: 20, length: 10, position: 50, edgeIndex: 0 });
    out.computeBoundingBox();
    expect(out.boundingBox!.max.z).toBeCloseTo(35, 5);
  });

  it('exposes editable params with matching defaults', () => {
    const keys = tabFeature.params.map(p => p.key);
    expect(keys).toEqual(['width', 'length', 'position', 'edgeIndex']);
  });
});
