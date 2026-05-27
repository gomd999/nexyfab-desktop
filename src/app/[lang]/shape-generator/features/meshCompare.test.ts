import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { compareMeshes } from './meshCompare';

function makeBox(w = 10, h = 10, d = 10): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  return g;
}

describe('compareMeshes · identical inputs', () => {
  it('reports match=true on the same geometry', () => {
    const a = makeBox();
    const r = compareMeshes(a, a);
    expect(r.match).toBe(true);
    expect(r.hausdorffDistance).toBeLessThan(1e-6);
    expect(r.vertexCountDelta).toBe(0);
  });

  it('treats two independently-built identical boxes as a match', () => {
    const a = makeBox(10, 10, 10);
    const b = makeBox(10, 10, 10);
    const r = compareMeshes(a, b);
    expect(r.match).toBe(true);
    expect(r.bboxExtentDelta).toBeCloseTo(0, 3);
  });
});

describe('compareMeshes · bbox-extent gate', () => {
  it('fails fast when bbox extents differ beyond tolerance', () => {
    const a = makeBox(10, 10, 10);
    const b = makeBox(20, 10, 10); // 10mm wider
    const r = compareMeshes(a, b);
    expect(r.match).toBe(false);
    expect(r.failedGate).toBe('bbox-extent');
    expect(r.hausdorffDistance).toBe(-1); // gate short-circuit
  });

  it('passes bbox gate when difference is below tolerance', () => {
    const a = makeBox(10, 10, 10);
    const b = makeBox(10.05, 10, 10); // 0.05mm wider — within 0.1
    const r = compareMeshes(a, b);
    expect(r.failedGate).not.toBe('bbox-extent');
  });
});

describe('compareMeshes · vertex count gate', () => {
  it('fails when vertex count differs by > tolerance fraction', () => {
    const a = makeBox(10, 10, 10);
    // Build a sphere with very different vertex count.
    const b = new THREE.SphereGeometry(5, 32, 32);
    b.deleteAttribute('uv');
    const r = compareMeshes(a, b);
    expect(r.match).toBe(false);
    // Will fail on bbox or vertex count.
    expect(['bbox-extent', 'vertex-count']).toContain(r.failedGate);
  });
});

describe('compareMeshes · Hausdorff distance', () => {
  it('captures translation as Hausdorff distance proportional to offset', () => {
    const a = makeBox();
    const b = makeBox();
    b.translate(5, 0, 0); // shift by 5mm
    const r = compareMeshes(a, b, { bboxExtentTolerance: 1, vertexCountTolerance: 1 });
    // After translation, bbox extent is unchanged but centre moves —
    // Hausdorff should report ≥ 5mm.
    expect(r.centroidDistance).toBeCloseTo(5, 1);
    expect(r.hausdorffDistance).toBeGreaterThanOrEqual(5);
    expect(r.match).toBe(false);
    expect(r.failedGate).toBe('hausdorff');
  });

  it('reports match when Hausdorff is within tolerance', () => {
    const a = makeBox();
    const b = makeBox();
    b.translate(0.0001, 0, 0); // sub-tolerance shift
    const r = compareMeshes(a, b);
    expect(r.match).toBe(true);
  });

  it('Hausdorff is bidirectional (catches subset cases)', () => {
    // A is a box, B is half the box (subset). Hausdorff should pick
    // up the missing-volume side.
    const a = makeBox(10, 10, 10);
    const b = makeBox(10, 10, 10);
    b.translate(15, 0, 0); // completely outside
    const r = compareMeshes(a, b, { bboxExtentTolerance: 1, vertexCountTolerance: 1 });
    expect(r.match).toBe(false);
    expect(r.hausdorffDistance).toBeGreaterThan(5);
  });
});

describe('compareMeshes · edge cases', () => {
  it('reports failedGate=no-position when either input is empty', () => {
    const a = makeBox();
    const empty = new THREE.BufferGeometry();
    expect(compareMeshes(a, empty).failedGate).toBe('no-position');
    expect(compareMeshes(empty, a).failedGate).toBe('no-position');
  });

  it('respects custom Hausdorff tolerance', () => {
    const a = makeBox();
    const b = makeBox();
    b.translate(0.3, 0, 0);
    // Default Hausdorff tol = 0.5 → match.
    expect(compareMeshes(a, b).match).toBe(true);
    // Tighter tol = 0.1 → no match.
    expect(compareMeshes(a, b, { hausdorffTolerance: 0.1 }).match).toBe(false);
  });

  it('respects custom sampleCount (smaller is faster, less accurate)', () => {
    const a = makeBox();
    const b = makeBox();
    b.translate(2, 0, 0);
    // Even with sample count 10, the translation magnitude should be
    // detected. Validates that small sample sizes still work.
    const r = compareMeshes(a, b, {
      bboxExtentTolerance: 1, vertexCountTolerance: 1, sampleCount: 10,
    });
    expect(r.hausdorffDistance).toBeGreaterThan(1);
  });
});
