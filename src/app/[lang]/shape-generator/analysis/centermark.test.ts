import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  generateCentermarks,
  detectCircularFeatures,
  type CircularFeature,
} from './centermark';

const feat = (cx: number, cy: number, cz: number, r: number, axis: [number, number, number]): CircularFeature => ({
  center: new THREE.Vector3(cx, cy, cz),
  radius: r,
  axis: new THREE.Vector3(...axis),
});

describe('generateCentermarks', () => {
  it('emits a cross (horizontal + vertical) for one front-facing hole', () => {
    const hole = feat(0, 0, 0, 5, [0, 0, 1]); // axis along Z → faces front
    const lines = generateCentermarks([hole], 'front', 1);
    expect(lines).toHaveLength(2);
    expect(lines.every(l => l.type === 'center')).toBe(true);
  });

  it('skips features whose axis is perpendicular to the view (side-on)', () => {
    // Axis along X — appears as a slot from the front, not a circle.
    const hole = feat(0, 0, 0, 5, [1, 0, 0]);
    expect(generateCentermarks([hole], 'front', 1)).toHaveLength(0);
  });

  it('shows the SAME hole as circle in front view and as line in top view', () => {
    const hole = feat(10, 0, 0, 4, [0, 0, 1]); // Z-axis
    expect(generateCentermarks([hole], 'front', 1)).toHaveLength(2);
    expect(generateCentermarks([hole], 'top', 1)).toHaveLength(0);
  });

  it('extends the centerline past the radius for features ≥ Ø6mm (ISO 128)', () => {
    const big = feat(0, 0, 0, 5, [0, 0, 1]); // Ø10mm > threshold
    const small = feat(0, 0, 0, 2, [0, 0, 1]); // Ø4mm < threshold
    const linesBig = generateCentermarks([big], 'front', 1);
    const linesSmall = generateCentermarks([small], 'front', 1);
    // Big feature's horizontal line is longer than small's.
    const lenBig = Math.hypot(linesBig[0].x2 - linesBig[0].x1, linesBig[0].y2 - linesBig[0].y1);
    const lenSmall = Math.hypot(linesSmall[0].x2 - linesSmall[0].x1, linesSmall[0].y2 - linesSmall[0].y1);
    expect(lenBig).toBeGreaterThan(lenSmall);
  });

  it('emits 2 lines per feature for multiple holes', () => {
    const holes = [
      feat(10, 0, 0, 3, [0, 0, 1]),
      feat(-10, 0, 0, 3, [0, 0, 1]),
      feat(0, 10, 0, 3, [0, 0, 1]),
    ];
    expect(generateCentermarks(holes, 'front', 1)).toHaveLength(6);
  });

  it('scales the centerline length by the drawing scale factor', () => {
    const hole = feat(0, 0, 0, 5, [0, 0, 1]);
    const at1 = generateCentermarks([hole], 'front', 1);
    const at2 = generateCentermarks([hole], 'front', 2);
    const len1 = Math.hypot(at1[0].x2 - at1[0].x1, at1[0].y2 - at1[0].y1);
    const len2 = Math.hypot(at2[0].x2 - at2[0].x1, at2[0].y2 - at2[0].y1);
    expect(len2).toBeGreaterThan(len1);
  });
});

describe('detectCircularFeatures', () => {
  it('detects a clean planar ring (axis = +Y, radius 5)', () => {
    // Manually constructed: 24 points evenly spaced on a circle in the
    // XZ plane at y=10. This is what a clean B-Rep hole-cap face looks
    // like after tessellation, so detection contract is well-defined.
    const g = new THREE.BufferGeometry();
    const verts: number[] = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      verts.push(5 * Math.cos(a), 10, 5 * Math.sin(a));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const found = detectCircularFeatures(g);
    expect(found.length).toBeGreaterThan(0);
    const ring = found.find(f => Math.abs(f.axis.y) === 1);
    expect(ring).toBeDefined();
    expect(ring!.radius).toBeCloseTo(5, 1);
    expect(ring!.center.y).toBeCloseTo(10, 1);
  });

  it('returns empty array on geometry without a position attribute', () => {
    const empty = new THREE.BufferGeometry();
    expect(detectCircularFeatures(empty)).toEqual([]);
  });

  it('ignores point clusters smaller than minRingPoints', () => {
    // Only 4 vertices on a plane — below the minimum 8.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      1, 0, 0,
      0, 0, 1,
      -1, 0, 0,
      0, 0, -1,
    ], 3));
    expect(detectCircularFeatures(g)).toEqual([]);
  });

  it('rejects clusters with non-uniform radii (non-circular)', () => {
    // Square outline at y=0 — distances from centre vary (corners far).
    const g = new THREE.BufferGeometry();
    const verts: number[] = [];
    for (let i = 0; i < 12; i++) {
      // Alternating short / long radii → high std-dev.
      const r = i % 2 === 0 ? 5 : 8;
      const a = (i / 12) * Math.PI * 2;
      verts.push(r * Math.cos(a), 0, r * Math.sin(a));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    expect(detectCircularFeatures(g)).toEqual([]);
  });
});
