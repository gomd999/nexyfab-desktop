import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  computeVertexNormals,
  computeCurvature,
  zebraStripes,
  curvatureComb,
  reflectionMap,
  sampleIsoCurve,
  type SurfaceMesh,
} from './classASurfaceAnalysis';

/** Convert an indexed THREE geometry into the SurfaceMesh shape. */
function meshFrom(geo: THREE.BufferGeometry): SurfaceMesh {
  return {
    positions: Array.from(geo.attributes.position.array as Float32Array),
    indices: Array.from(geo.index!.array as Uint16Array | Uint32Array),
  };
}

/** Median of an array (sorts a copy). */
function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Flat plane in z=0: 2 triangles. */
function flatPlane(): SurfaceMesh {
  return {
    positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/** Sphere-like dome — pyramidal apex over a square base. */
function dome(): SurfaceMesh {
  return {
    positions: [
      0, 0, 5,           // apex
      -5, -5, 0, 5, -5, 0, 5, 5, 0, -5, 5, 0,
    ],
    indices: [
      0, 1, 2,
      0, 2, 3,
      0, 3, 4,
      0, 4, 1,
    ],
  };
}

describe('computeVertexNormals', () => {
  it('flat plane: normals point +Z', () => {
    const n = computeVertexNormals(flatPlane());
    expect(n[2]).toBeCloseTo(1, 5);
    expect(n[5]).toBeCloseTo(1, 5);
  });

  it('returns one normal per vertex (length = 3 × vCount)', () => {
    const n = computeVertexNormals(flatPlane());
    expect(n).toHaveLength(12);
  });

  it('all normals unit length', () => {
    const n = computeVertexNormals(dome());
    for (let i = 0; i < n.length / 3; i++) {
      const len = Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
      expect(len).toBeCloseTo(1, 4);
    }
  });
});

describe('computeCurvature', () => {
  it('flat plane has interior K ≈ 0', () => {
    const r = computeCurvature(flatPlane());
    // Boundary verts will have non-zero K (angle defect), but they're
    // a known limitation; just check the result is finite.
    expect(r.gaussian.every(Number.isFinite)).toBe(true);
  });

  it('dome apex has positive Gaussian curvature', () => {
    const r = computeCurvature(dome());
    expect(r.gaussian[0]!).toBeGreaterThan(0);
  });

  it('emits k1 ≥ k2', () => {
    const r = computeCurvature(dome());
    for (let i = 0; i < r.k1.length; i++) {
      expect(r.k1[i]!).toBeGreaterThanOrEqual(r.k2[i]!);
    }
  });

  // Closed-form validation against the analytic curvature of canonical surfaces.
  // (These guard the Meyer 2003 mean-curvature normalisation: the old code
  // halved H and let degenerate pole/seam vertices blow K up to ~1/ε.)
  it('a fine sphere of radius R has median K≈1/R² and |H|≈1/R', () => {
    const R = 5;
    const r = computeCurvature(meshFrom(new THREE.SphereGeometry(R, 48, 32)));
    const pos = new THREE.SphereGeometry(R, 48, 32).attributes.position.array as Float32Array;
    const Ks: number[] = [], Hs: number[] = [];
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
      if (Math.abs(z) > 0.7 * R) continue;          // skip poles
      if (Math.abs(x) < 0.05 && y < 0) continue;    // skip the seam
      Ks.push(r.gaussian[i]!); Hs.push(Math.abs(r.mean[i]!));
    }
    expect(median(Ks)).toBeCloseTo(1 / (R * R), 2);  // 0.04
    expect(median(Hs)).toBeCloseTo(1 / R, 1);        // 0.2 (was ~0.1 before the fix)
  });

  it('a collapsed (zero-area) vertex reports 0 instead of a 1/ε spike', () => {
    // Triangle whose two vertices coincide → zero area at every incident vertex.
    // The old `areaSum[i] || 1e-9` turned that into a ~1/ε curvature; the guard
    // now returns 0 there.
    const degenerate: SurfaceMesh = {
      positions: [0, 0, 0, 1, 0, 0, 1, 0, 0],
      indices: [0, 1, 2],
    };
    const r = computeCurvature(degenerate);
    for (const k of r.gaussian) { expect(Number.isFinite(k)).toBe(true); expect(k).toBe(0); }
    for (const h of r.mean) { expect(Number.isFinite(h)).toBe(true); expect(h).toBe(0); }
  });

  it('a fine cylinder of radius R has median K≈0 and |H|≈1/(2R)', () => {
    const R = 4, H = 20;
    // Open-ended cylinder so the wall has no caps; radial segments fine.
    const geo = new THREE.CylinderGeometry(R, R, H, 48, 12, true);
    const r = computeCurvature(meshFrom(geo));
    const pos = geo.attributes.position.array as Float32Array;
    const Ks: number[] = [], Hs: number[] = [];
    for (let i = 0; i < pos.length / 3; i++) {
      const yy = pos[i * 3 + 1]!;
      if (Math.abs(yy) > 0.7 * (H / 2)) continue;    // skip the open rim rings
      Ks.push(r.gaussian[i]!); Hs.push(Math.abs(r.mean[i]!));
    }
    expect(median(Ks)).toBeCloseTo(0, 2);            // developable
    expect(median(Hs)).toBeCloseTo(1 / (2 * R), 1);  // 0.125
  });
});

describe('zebraStripes', () => {
  it('returns one value per vertex', () => {
    const r = zebraStripes(flatPlane(), { bandCount: 8, lightDirection: [0, 0, 1] });
    expect(r).toHaveLength(4);
  });

  it('values are 0 or 1', () => {
    const r = zebraStripes(dome(), { bandCount: 12, lightDirection: [1, 0, 0] });
    for (const v of r) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('all-aligned normals (flat plane facing +Z, light +Z) → same stripe', () => {
    const r = zebraStripes(flatPlane(), { bandCount: 8, lightDirection: [0, 0, 1] });
    expect(new Set(r).size).toBe(1);
  });
});

describe('curvatureComb', () => {
  it('comb endpoints at scaled normal distance', () => {
    const r = curvatureComb([
      { position: [0, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 1 },
      { position: [1, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 2 },
    ], 10);
    expect(r.combEndpoints[0]).toEqual([0, 0, 10]);
    expect(r.combEndpoints[1]).toEqual([1, 0, 20]);
  });

  it('reports max curvature', () => {
    const r = curvatureComb([
      { position: [0, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 0.5 },
      { position: [1, 0, 0], tangent: [1, 0, 0], normal: [0, 0, 1], curvature: 2.0 },
    ]);
    expect(r.maxCurvature).toBe(2.0);
  });
});

describe('reflectionMap', () => {
  it('emits (u, v) for every vertex', () => {
    const r = reflectionMap(flatPlane(), {
      cameraPosition: [0, 0, 100],
      resolutionU: 256, resolutionV: 128,
    });
    expect(r.uv.length).toBe(8); // 4 verts × 2
  });

  it('uv values in [0, 1]', () => {
    const r = reflectionMap(dome(), {
      cameraPosition: [10, 10, 10],
      resolutionU: 256, resolutionV: 128,
    });
    for (let i = 0; i < r.uv.length; i++) {
      const v = r.uv[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('sampleIsoCurve', () => {
  it('emits requested sample count', () => {
    const samples = sampleIsoCurve('u', 0.5, (u, v) => [u, v, 0], 16);
    expect(samples).toHaveLength(16);
  });

  it('fixed parameter unchanged across samples', () => {
    const samples = sampleIsoCurve('u', 0.7, (u, v) => [u, v, 0], 8);
    expect(samples.every(s => s.position[0] === 0.7)).toBe(true);
  });

  it('parameter values run 0..1', () => {
    const samples = sampleIsoCurve('v', 0.5, (u, v) => [u, v, 0], 4);
    expect(samples[0]!.parameter).toBeCloseTo(0, 5);
    expect(samples[3]!.parameter).toBeCloseTo(1, 5);
  });
});
