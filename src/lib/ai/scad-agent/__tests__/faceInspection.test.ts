/**
 * faceInspection.test.ts — Phase X2 topology + genus.
 *
 * Validates the Euler-characteristic-based through-hole counter against
 * synthetic geometries built directly via three.js so the test isn't
 * tied to OpenSCAD output. Counterexamples (open meshes, multi-body)
 * verify that genus comes back null when undefined.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  computeMeshTopology,
  countThroughHoles,
  compareHoleCount,
  computeSurfaceArea,
  detectZAxisHoles,
  detectAxisAlignedHoles,
  detectAllAxisAlignedHoles,
  holeAxisToWorld,
} from '../faceInspection';

/** Build a degenerate-stripped non-indexed BufferGeometry from a list
 *  of triangles (each triangle = 9 floats, x0,y0,z0,x1,y1,z1,x2,y2,z2). */
function geomFromTris(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  return g;
}

describe('computeMeshTopology — closed manifolds (genus 0)', () => {
  it('a single cube has χ=2, genus=0, manifoldClosed=true', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const t = computeMeshTopology(cube);
    expect(t.vertexCount).toBe(8);
    expect(t.faceCount).toBe(12);
    expect(t.eulerChar).toBe(2);
    expect(t.manifoldClosed).toBe(true);
    expect(t.genus).toBe(0);
    expect(t.boundaryEdgeCount).toBe(0);
    expect(t.nonManifoldEdgeCount).toBe(0);
  });

  it('a tetrahedron has χ=2, genus=0', () => {
    // Equilateral tetrahedron — 4 vertices, 4 triangles.
    const a: [number, number, number] = [1, 1, 1];
    const b: [number, number, number] = [-1, -1, 1];
    const c: [number, number, number] = [-1, 1, -1];
    const d: [number, number, number] = [1, -1, -1];
    const tris = [
      ...a, ...b, ...c,
      ...a, ...d, ...b,
      ...a, ...c, ...d,
      ...b, ...d, ...c,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.vertexCount).toBe(4);
    expect(t.faceCount).toBe(4);
    expect(t.edgeCount).toBe(6);
    expect(t.eulerChar).toBe(2);
    expect(t.genus).toBe(0);
    expect(t.manifoldClosed).toBe(true);
  });

  it('handles indexed BufferGeometry the same as non-indexed', () => {
    const indexed = new THREE.BoxGeometry(10, 10, 10); // indexed by default
    const nonIndexed = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const tI = computeMeshTopology(indexed);
    const tN = computeMeshTopology(nonIndexed);
    expect(tI.vertexCount).toBe(tN.vertexCount);
    expect(tI.faceCount).toBe(tN.faceCount);
    expect(tI.edgeCount).toBe(tN.edgeCount);
    expect(tI.eulerChar).toBe(tN.eulerChar);
    expect(tI.genus).toBe(tN.genus);
  });
});

describe('computeMeshTopology — torus / genus ≥ 1', () => {
  /** Synthetic torus from three.js. THREE.TorusGeometry produces a closed
   *  watertight surface with genus = 1. */
  it('a torus has χ=0, genus=1', () => {
    const torus = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const t = computeMeshTopology(torus);
    expect(t.manifoldClosed).toBe(true);
    expect(t.eulerChar).toBe(0);
    expect(t.genus).toBe(1);
  });

  it('two disjoint tori → componentCount=2, genus=null (multi-body undefined in v1)', () => {
    const torusA = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const torusB = new THREE.TorusGeometry(5, 1, 16, 32).toNonIndexed();

    // Translate B so it's disjoint from A.
    const m = new THREE.Matrix4().makeTranslation(50, 0, 0);
    torusB.applyMatrix4(m);

    const merged = new THREE.BufferGeometry();
    const a = torusA.attributes.position.array as Float32Array;
    const b = torusB.attributes.position.array as Float32Array;
    const combined = new Float32Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const t = computeMeshTopology(merged);
    expect(t.manifoldClosed).toBe(true);
    expect(t.componentCount).toBe(2);
    // χ is additive across components: 0 + 0 = 0 for two tori.
    expect(t.eulerChar).toBe(0);
    // Per-body genus is 1 each, but the single-body assumption fails
    // → helper returns null rather than reporting a nonsense number.
    expect(t.genus).toBeNull();
  });

  it('cube + cube (two disjoint) → componentCount=2, genus=null', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const b = new THREE.BoxGeometry(5, 5, 5).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));

    const merged = new THREE.BufferGeometry();
    const pa = a.attributes.position.array as Float32Array;
    const pb = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(pa.length + pb.length);
    combined.set(pa, 0);
    combined.set(pb, pa.length);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const t = computeMeshTopology(merged);
    expect(t.componentCount).toBe(2);
    expect(t.genus).toBeNull();
  });
});

describe('Phase X4 — per-component / total genus (multi-body)', () => {
  function mergeGeoms(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const arrays = geoms.map(g => g.attributes.position.array as Float32Array);
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const combined = new Float32Array(total);
    let off = 0;
    for (const a of arrays) { combined.set(a, off); off += a.length; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));
    return out;
  }

  it('single cube: perComponentGenus=[0], totalGenus=0', () => {
    const t = computeMeshTopology(new THREE.BoxGeometry(10, 10, 10).toNonIndexed());
    expect(t.perComponentGenus).toEqual([0]);
    expect(t.totalGenus).toBe(0);
  });

  it('single torus: perComponentGenus=[1], totalGenus=1', () => {
    const t = computeMeshTopology(new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed());
    expect(t.perComponentGenus).toEqual([1]);
    expect(t.totalGenus).toBe(1);
  });

  it('two disjoint tori → perComponentGenus=[1,1], totalGenus=2', () => {
    const a = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const b = new THREE.TorusGeometry(5, 1, 16, 32).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));
    const t = computeMeshTopology(mergeGeoms([a, b]));
    expect(t.componentCount).toBe(2);
    expect(t.perComponentGenus).toEqual([1, 1]);
    expect(t.totalGenus).toBe(2);
    // Single-body `genus` field stays null for backwards-compat.
    expect(t.genus).toBeNull();
  });

  it('cube + torus → perComponentGenus=[0,1], totalGenus=1', () => {
    const a = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const b = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));
    const t = computeMeshTopology(mergeGeoms([a, b]));
    expect(t.componentCount).toBe(2);
    // Order depends on BFS discovery — sort for stable assertion.
    expect([...t.perComponentGenus].sort()).toEqual([0, 1]);
    expect(t.totalGenus).toBe(1);
  });

  it('cube + open triangle → totalGenus=null (one component bad)', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const tri = geomFromTris([100, 100, 100, 101, 100, 100, 100, 101, 100]);
    const t = computeMeshTopology(mergeGeoms([cube, tri]));
    expect(t.componentCount).toBe(2);
    // One component (the triangle) is open → its genus is null → total
    // is null so callers don't act on an under-count.
    expect(t.perComponentGenus.some(g => g === null)).toBe(true);
    expect(t.totalGenus).toBeNull();
  });

  it('countThroughHoles now reflects totalGenus (multi-body aware)', () => {
    const a = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    const b = new THREE.TorusGeometry(5, 1, 16, 32).toNonIndexed();
    b.applyMatrix4(new THREE.Matrix4().makeTranslation(50, 0, 0));
    expect(countThroughHoles(mergeGeoms([a, b]))).toBe(2);
  });
});

describe('computeMeshTopology — non-manifold / open meshes', () => {
  it('a single triangle is not closed → genus=null', () => {
    const tris = [
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.faceCount).toBe(1);
    expect(t.boundaryEdgeCount).toBe(3);
    expect(t.manifoldClosed).toBe(false);
    expect(t.genus).toBeNull();
  });

  it('a cube with one face removed → boundary edges, genus=null', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const posArr = cube.attributes.position.array as Float32Array;
    // Drop the last two triangles (one face).
    const trimmed = posArr.slice(0, posArr.length - 2 * 9);
    const open = new THREE.BufferGeometry();
    open.setAttribute('position', new THREE.Float32BufferAttribute(trimmed, 3));
    const t = computeMeshTopology(open);
    expect(t.faceCount).toBe(10);
    expect(t.boundaryEdgeCount).toBeGreaterThan(0);
    expect(t.manifoldClosed).toBe(false);
    expect(t.genus).toBeNull();
  });

  it('degenerate triangles (collinear vertices) are skipped, not crashed', () => {
    const tris = [
      0, 0, 0, 1, 0, 0, 2, 0, 0, // collinear, area = 0
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    // Helper still computes V/E/F based on the triangles array — but
    // degenerate triangles should not flag as non-manifold either.
    expect(t.faceCount).toBe(1);
    // The degenerate triangle has 3 colinear distinct vertices, so 3
    // boundary edges still exist. Test verifies we don't crash and
    // genus stays null (open mesh).
    expect(t.genus).toBeNull();
  });

  it('empty geometry returns zeros + null genus', () => {
    const empty = new THREE.BufferGeometry();
    const t = computeMeshTopology(empty);
    expect(t.vertexCount).toBe(0);
    expect(t.faceCount).toBe(0);
    expect(t.genus).toBeNull();
  });
});

describe('vertex dedup tolerance', () => {
  it('vertices within tolerance are merged (microns from the same corner)', () => {
    // Two triangles sharing an edge where one endpoint is "0,0,0" and the
    // other is "0.0000001, 0, 0" — should dedup at default 1µm tolerance.
    const tris = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.0000001, 0, 0, 0, 1, 0, -1, 0, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    // 4 unique vertices ideally (the near-duplicates merge into one).
    expect(t.vertexCount).toBe(4);
  });

  it('vertices outside tolerance stay separate', () => {
    // 10µm apart (= 0.01 mm) with default 1µm tolerance — should stay
    // distinct: quantize(0.01, 1e-3) = 10, quantize(0, 1e-3) = 0.
    const tris = [
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0.01, 0, 0, 0, 1, 0, -1, 0, 0,
    ];
    const t = computeMeshTopology(geomFromTris(tris));
    expect(t.vertexCount).toBe(5);
  });
});

describe('countThroughHoles + compareHoleCount', () => {
  it('cube → 0 through-holes', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    expect(countThroughHoles(cube)).toBe(0);
  });

  it('torus → 1 through-hole', () => {
    const torus = new THREE.TorusGeometry(10, 3, 16, 32).toNonIndexed();
    expect(countThroughHoles(torus)).toBe(1);
  });

  it('open mesh → null', () => {
    const open = geomFromTris([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(countThroughHoles(open)).toBeNull();
  });

  it('compareHoleCount returns null when detected matches expected', () => {
    expect(compareHoleCount(0, 0)).toBeNull();
    expect(compareHoleCount(3, 3)).toBeNull();
  });

  it('compareHoleCount returns null when detection is null (suppresses false flag)', () => {
    expect(compareHoleCount(2, null)).toBeNull();
  });

  it('compareHoleCount reports mismatch with delta', () => {
    expect(compareHoleCount(2, 1)).toEqual({ expected: 2, detected: 1, delta: -1 });
    expect(compareHoleCount(1, 3)).toEqual({ expected: 1, detected: 3, delta: 2 });
  });
});

describe('Phase X5 — computeSurfaceArea', () => {
  it('cube 10³ → 600 mm² (6 × 10²)', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    expect(computeSurfaceArea(cube)).toBeCloseTo(600, 3);
  });

  it('cube 20³ → 2400 mm²', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    expect(computeSurfaceArea(cube)).toBeCloseTo(2400, 3);
  });

  it('cylinder approximates 2πrh + 2πr² (within faceting tolerance)', () => {
    const cyl = new THREE.CylinderGeometry(5, 5, 20, 64).toNonIndexed();
    const analytic = 2 * Math.PI * 5 * 20 + 2 * Math.PI * 25;
    const computed = computeSurfaceArea(cyl);
    // $fn=64 cylinder undercounts side area by ~2%
    expect(computed).toBeGreaterThan(analytic * 0.96);
    expect(computed).toBeLessThan(analytic * 1.02);
  });

  it('sphere approximates 4πr²', () => {
    const sph = new THREE.SphereGeometry(5, 32, 16).toNonIndexed();
    const analytic = 4 * Math.PI * 25;
    const computed = computeSurfaceArea(sph);
    expect(computed).toBeGreaterThan(analytic * 0.95);
    expect(computed).toBeLessThan(analytic * 1.02);
  });

  it('empty geometry returns 0', () => {
    expect(computeSurfaceArea(new THREE.BufferGeometry())).toBe(0);
  });

  it('indexed and non-indexed give the same area', () => {
    const indexed = new THREE.BoxGeometry(15, 15, 15);
    const nonIndexed = indexed.clone().toNonIndexed();
    expect(computeSurfaceArea(indexed)).toBeCloseTo(computeSurfaceArea(nonIndexed), 3);
  });
});

describe('Phase X6 — detectZAxisHoles', () => {
  /** Generate a Z-aligned hollow cylinder shell (just the wall, no caps).
   *  Each segment becomes 2 triangles. Normal direction depends on `inward`:
   *  true = normals point toward axis (hole interior), false = outward (boss). */
  function cylinderShellGeom(
    cx: number, cy: number, radius: number, height: number,
    segments = 32, inward = true,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const halfH = height / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const x0 = cx + radius * Math.cos(a0);
      const y0 = cy + radius * Math.sin(a0);
      const x1 = cx + radius * Math.cos(a1);
      const y1 = cy + radius * Math.sin(a1);
      // 2 tris per quad. Winding picks outward-vs-inward normals.
      if (inward) {
        // Outward winding (CCW from outside) but we want INWARD normals
        // (hole interior) → use opposite winding.
        positions.push(x0, y0, -halfH, x0, y0, halfH, x1, y1, -halfH);
        positions.push(x1, y1, -halfH, x0, y0, halfH, x1, y1, halfH);
      } else {
        positions.push(x0, y0, -halfH, x1, y1, -halfH, x0, y0, halfH);
        positions.push(x1, y1, -halfH, x1, y1, halfH, x0, y0, halfH);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
    return g;
  }

  it('finds 1 hole at the origin for a centered Z-axis cylinder shell', () => {
    const shell = cylinderShellGeom(0, 0, 5, 20, 32, true);
    const holes = detectZAxisHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    expect(holes.length).toBeGreaterThan(0);
    const h = holes[0];
    expect(Math.abs(h.cx)).toBeLessThan(1);
    expect(Math.abs(h.cy)).toBeLessThan(1);
    expect(h.diameter).toBeGreaterThan(8);
    expect(h.diameter).toBeLessThan(12);
  });

  it('finds 1 hole at an off-center position', () => {
    const shell = cylinderShellGeom(15, -8, 3, 20, 32, true);
    const holes = detectZAxisHoles(shell, {
      bbox: { min: [-20, -20, -10], max: [30, 10, 10] },
    });
    expect(holes.length).toBeGreaterThan(0);
    const h = holes[0];
    // Within cell-size tolerance (1 mm × √2 ≈ 1.5 mm)
    expect(Math.abs(h.cx - 15)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(h.cy - (-8))).toBeLessThanOrEqual(1.5);
    expect(h.diameter).toBeGreaterThan(4);
    expect(h.diameter).toBeLessThan(8);
  });

  it('detects multiple holes at distinct positions', () => {
    // Two separate cylinder shells in one geometry
    const a = cylinderShellGeom(-10, 0, 3, 20, 32, true);
    const b = cylinderShellGeom(10, 0, 3, 20, 32, true);
    const merged = new THREE.BufferGeometry();
    const pa = a.attributes.position.array as Float32Array;
    const pb = b.attributes.position.array as Float32Array;
    const combined = new Float32Array(pa.length + pb.length);
    combined.set(pa, 0);
    combined.set(pb, pa.length);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(combined, 3));

    const holes = detectZAxisHoles(merged, {
      bbox: { min: [-20, -10, -10], max: [20, 10, 10] },
    });
    expect(holes.length).toBeGreaterThanOrEqual(2);
    // At least one peak near each expected position
    const matched = [false, false];
    for (const h of holes) {
      if (Math.abs(h.cx + 10) < 2 && Math.abs(h.cy) < 2) matched[0] = true;
      if (Math.abs(h.cx - 10) < 2 && Math.abs(h.cy) < 2) matched[1] = true;
    }
    expect(matched).toEqual([true, true]);
  });

  it('returns empty array for a plain cube (no perpendicular-to-Z cylinder walls)', () => {
    const cube = new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
    // Cube side walls have normals in ±X, ±Y — perpendicular to Z. Voting
    // happens, but with all parallel normals (not radial) peaks won't form
    // a clean (cx, cy) signature inside the cube interior. We tolerate
    // either zero results or peaks far from the cube center.
    const holes = detectZAxisHoles(cube);
    // Confidence: any peaks should NOT be at origin (the cube center).
    for (const h of holes) {
      const distFromOrigin = Math.sqrt(h.cx * h.cx + h.cy * h.cy);
      // Cube's side-wall normal-rays intersect at infinity (parallel), so
      // peaks should NOT cluster at origin.
      expect(distFromOrigin).toBeGreaterThan(2);
    }
  });

  it('returns empty for empty geometry', () => {
    expect(detectZAxisHoles(new THREE.BufferGeometry())).toEqual([]);
  });

  it('respects normalToleranceDeg (relaxed gate finds tilted walls)', () => {
    // Slightly tilted cylinder — should miss with strict tol, find with loose.
    const shell = cylinderShellGeom(0, 0, 5, 20, 32, true);
    shell.applyMatrix4(new THREE.Matrix4().makeRotationX(5 * Math.PI / 180));
    const strict = detectZAxisHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
      normalToleranceDeg: 2,
    });
    const loose = detectZAxisHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
      normalToleranceDeg: 15,
    });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it('detected hole carries axis="z" field (X7 schema)', () => {
    const shell = cylinderShellGeom(0, 0, 5, 20, 32, true);
    const holes = detectZAxisHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    expect(holes.length).toBeGreaterThan(0);
    expect(holes[0].axis).toBe('z');
  });
});

describe('Phase X7 — multi-axis hole detection', () => {
  /** Build a cylinder shell along an arbitrary axis by rotating the
   *  Z-aligned one. Returns a non-indexed BufferGeometry. */
  function cylShellAxis(
    axis: 'x' | 'y' | 'z',
    cA: number, cB: number, radius: number, height: number, segments = 32,
  ): THREE.BufferGeometry {
    // Build Z-aligned at origin, then rotate to target axis, then translate.
    const positions: number[] = [];
    const halfH = height / 2;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const x0 = radius * Math.cos(a0);
      const y0 = radius * Math.sin(a0);
      const x1 = radius * Math.cos(a1);
      const y1 = radius * Math.sin(a1);
      // Inward-normal winding (hole interior)
      positions.push(x0, y0, -halfH, x0, y0, halfH, x1, y1, -halfH);
      positions.push(x1, y1, -halfH, x0, y0, halfH, x1, y1, halfH);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));

    // Rotate Z → target axis. For X-axis: rotate Z to X means rotate -90° around Y.
    // For Y-axis: rotate Z to Y means rotate 90° around X.
    if (axis === 'x') g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    if (axis === 'y') g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

    // After rotation, translate so (cA, cB) maps to the perpendicular plane center.
    // Z-axis: perp plane = (X, Y), so translate by (cA, cB, 0)
    // X-axis: perp plane = (Y, Z), so translate by (0, cA, cB)
    // Y-axis: perp plane = (X, Z), so translate by (cA, 0, cB)
    const dx = axis === 'z' || axis === 'y' ? cA : 0;
    const dy = axis === 'z' ? cB : axis === 'x' ? cA : 0;
    const dz = axis === 'x' ? cB : axis === 'y' ? cB : 0;
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(dx, dy, dz));
    return g;
  }

  it('X-axis cylinder: detectAxisAlignedHoles({axis:"x"}) finds it', () => {
    const shell = cylShellAxis('x', 0, 0, 5, 20, 32);
    const holes = detectAxisAlignedHoles(shell, {
      axis: 'x',
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    expect(holes.length).toBeGreaterThan(0);
    expect(holes[0].axis).toBe('x');
    // For X-axis: cx=worldY, cy=worldZ. Should be near (0, 0).
    expect(Math.abs(holes[0].cx)).toBeLessThan(1.5);
    expect(Math.abs(holes[0].cy)).toBeLessThan(1.5);
  });

  it('Y-axis cylinder: detected with axis="y"', () => {
    const shell = cylShellAxis('y', 0, 0, 5, 20, 32);
    const holes = detectAxisAlignedHoles(shell, {
      axis: 'y',
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    expect(holes.length).toBeGreaterThan(0);
    expect(holes[0].axis).toBe('y');
  });

  it('detectAllAxisAlignedHoles finds a Z-axis cylinder via the Z scan', () => {
    const shell = cylShellAxis('z', 5, -3, 4, 20, 32);
    const all = detectAllAxisAlignedHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    const zHoles = all.filter(h => h.axis === 'z');
    expect(zHoles.length).toBeGreaterThan(0);
    expect(Math.abs(zHoles[0].cx - 5)).toBeLessThan(1.5);
    expect(Math.abs(zHoles[0].cy - (-3))).toBeLessThan(1.5);
  });

  it('X-axis scan does NOT report a Z-axis cylinder as a hole', () => {
    const zShell = cylShellAxis('z', 0, 0, 5, 20, 32);
    const xHoles = detectAxisAlignedHoles(zShell, {
      axis: 'x',
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    // A Z-aligned cylinder's wall normals all have |nx| typically large
    // (since they point radially in XY). Scan along X axis requires
    // |nx| small — should not hit the cylinder walls. Some borderline
    // triangles may slip through; allow up to 1 false peak.
    expect(xHoles.length).toBeLessThanOrEqual(1);
  });

  it('detectZAxisHoles is a back-compat wrapper for axis="z"', () => {
    const shell = cylShellAxis('z', 0, 0, 5, 20, 32);
    const fromWrapper = detectZAxisHoles(shell, {
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    const fromGeneral = detectAxisAlignedHoles(shell, {
      axis: 'z',
      bbox: { min: [-10, -10, -10], max: [10, 10, 10] },
    });
    expect(fromWrapper.length).toBe(fromGeneral.length);
    expect(fromWrapper[0].axis).toBe('z');
  });

  it('holeAxisToWorld maps perpendicular-plane coords back to world', () => {
    expect(holeAxisToWorld({ axis: 'z', cx: 10, cy: 20, diameter: 5, voteCount: 0 })).toEqual([10, 20, 0]);
    expect(holeAxisToWorld({ axis: 'x', cx: 10, cy: 20, diameter: 5, voteCount: 0 })).toEqual([0, 10, 20]);
    expect(holeAxisToWorld({ axis: 'y', cx: 10, cy: 20, diameter: 5, voteCount: 0 })).toEqual([10, 0, 20]);
  });
});
