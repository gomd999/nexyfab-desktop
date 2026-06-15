import { describe, it, expect } from 'vitest';
import {
  sampleIntersectionCurve,
  rollingBallSpine,
  tessellateFillet,
  type SurfaceSampler,
  type Vec3,
} from './surfaceIntersectionFillet';

/** Plane z=0 with normal +Z. */
const planeZ: SurfaceSampler = (u, v) => ({
  point: { x: u * 10 - 5, y: v * 10 - 5, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
});

/** Plane y=0 with normal +Y. */
const planeY: SurfaceSampler = (u, v) => ({
  point: { x: u * 10 - 5, y: 0, z: v * 10 - 5 },
  normal: { x: 0, y: 1, z: 0 },
});

describe('sampleIntersectionCurve', () => {
  it('produces a sample at every step', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY,
      { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 },
      10, 0.5,
    );
    expect(c.spinePoints).toHaveLength(10);
    expect(c.tangents).toHaveLength(10);
  });

  it('tangent ≈ X-axis when surfaces share x-line', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY,
      { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 },
      4, 0.5,
    );
    // For Z-plane (n=+Z) × Y-plane (n=+Y), cross ≈ -X.
    const tan = c.tangents[0]!;
    expect(Math.abs(tan.x)).toBeCloseTo(1, 1);
    expect(Math.abs(tan.y)).toBeLessThan(0.1);
    expect(Math.abs(tan.z)).toBeLessThan(0.1);
  });

  it('records both surface normals per sample', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY,
      { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 },
      4, 0.5,
    );
    expect(c.normalsA[0]!.z).toBe(1);
    expect(c.normalsB[0]!.y).toBe(1);
  });
});

describe('rollingBallSpine', () => {
  it('center offset = radius/cos(half-angle) from the foot point', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY,
      { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 },
      4, 0.5,
    );
    const r = 2;
    const spine = rollingBallSpine(c, r);
    // Perpendicular surfaces → normals at α=90°, half-angle 45°, offset =
    // r/cos(45°) = r·√2. (cos and sin coincide at 45°, which is exactly why
    // the old r/sin(α/2) bug stayed hidden until a non-90° dihedral.)
    const center = spine.centers[0]!;
    const mid = c.spinePoints[0]!;
    const dx = center.x - mid.x;
    const dy = center.y - mid.y;
    const dz = center.z - mid.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(r * Math.sqrt(2), 2);
  });

  it('foot points lie on BOTH surfaces at any dihedral angle (not just 90°)', () => {
    // The defining rolling-ball property: foot_A is on surface A, foot_B on
    // surface B, each at distance r from the centre. Hand-build curves whose
    // normals meet at non-90° angles — where the old r/sin(α/2) put the feet
    // off the faces (e.g. 3.66 mm adrift at 60°).
    const p = { x: 0, y: 0, z: 0 };
    const r = 5;
    for (const deg of [45, 60, 120, 150]) {
      const a = (deg * Math.PI) / 180;
      const nA = { x: 0, y: 0, z: 1 };
      const nB = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      const curve = { spinePoints: [p], tangents: [{ x: 0, y: 1, z: 0 }], normalsA: [nA], normalsB: [nB] };
      const s = rollingBallSpine(curve, r);
      const ctr = s.centers[0]!, fA = s.feetA[0]!, fB = s.feetB[0]!;
      // foot on plane (through p with that normal): (foot − p)·n = 0.
      expect(fA.x * nA.x + fA.y * nA.y + fA.z * nA.z).toBeCloseTo(0, 5);
      expect(fB.x * nB.x + fB.y * nB.y + fB.z * nB.z).toBeCloseTo(0, 5);
      // ball touches each surface at radius r.
      expect(Math.hypot(ctr.x - fA.x, ctr.y - fA.y, ctr.z - fA.z)).toBeCloseTo(r, 5);
      expect(Math.hypot(ctr.x - fB.x, ctr.y - fB.y, ctr.z - fB.z)).toBeCloseTo(r, 5);
    }
  });

  it('foot points distance r from center', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY,
      { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 },
      4, 0.5,
    );
    const r = 3;
    const spine = rollingBallSpine(c, r);
    const center = spine.centers[0]!;
    const fA = spine.feetA[0]!;
    const distA = Math.hypot(center.x - fA.x, center.y - fA.y, center.z - fA.z);
    expect(distA).toBeCloseTo(r, 4);
  });

  it('coincident normals → degenerate spine kept at intersection point', () => {
    const flat: SurfaceSampler = (u, v) => ({
      point: { x: u, y: v, z: 0 }, normal: { x: 0, y: 0, z: 1 },
    });
    const c = sampleIntersectionCurve(flat, flat, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 3, 0.5);
    const spine = rollingBallSpine(c, 1);
    // Degenerate: center = original spine point (no fillet).
    for (let i = 0; i < spine.centers.length; i++) {
      expect(spine.centers[i]).toEqual(c.spinePoints[i]);
    }
  });
});

describe('tessellateFillet', () => {
  it('returns empty mesh when spine too short', () => {
    const m = tessellateFillet({ centers: [], feetA: [], feetB: [], radius: 1 });
    expect(m.positions).toHaveLength(0);
    expect(m.indices).toHaveLength(0);
  });

  it('vertex count = (N) × (circleRes + 1)', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 5, 0.5,
    );
    const spine = rollingBallSpine(c, 2);
    const m = tessellateFillet(spine, 6);
    expect(m.positions.length / 3).toBe(5 * 7);
  });

  it('triangle count = 2 × circleRes × (N-1)', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 5, 0.5,
    );
    const spine = rollingBallSpine(c, 2);
    const m = tessellateFillet(spine, 6);
    expect(m.triangleCount).toBe(2 * 6 * (5 - 1));
  });

  it('all indices reference valid vertices', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 4, 0.5,
    );
    const spine = rollingBallSpine(c, 1);
    const m = tessellateFillet(spine, 4);
    const vCount = m.positions.length / 3;
    for (const i of m.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(vCount);
    }
  });

  it('foot points appear at strip ends', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 3, 0.5,
    );
    const spine = rollingBallSpine(c, 2);
    const m = tessellateFillet(spine, 4);
    const stride = 4 + 1;
    // Position[0] should equal feetA[0].
    const fA = spine.feetA[0]!;
    expect(m.positions[0]).toBeCloseTo(fA.x, 6);
    expect(m.positions[1]).toBeCloseTo(fA.y, 6);
    expect(m.positions[2]).toBeCloseTo(fA.z, 6);
    // Position[stride-1] should equal feetB[0].
    const fB = spine.feetB[0]!;
    const lastK = (stride - 1) * 3;
    expect(m.positions[lastK]).toBeCloseTo(fB.x, 6);
    expect(m.positions[lastK + 1]).toBeCloseTo(fB.y, 6);
    expect(m.positions[lastK + 2]).toBeCloseTo(fB.z, 6);
  });
});

describe('end-to-end on perpendicular planes', () => {
  it('produces a smooth fillet patch', () => {
    const c = sampleIntersectionCurve(
      planeZ, planeY, { u: 0.5, v: 0.5 }, { u: 0.5, v: 0.5 }, 12, 0.5,
    );
    const spine = rollingBallSpine(c, 2);
    const m = tessellateFillet(spine, 8);
    expect(m.triangleCount).toBeGreaterThan(50);
    // Every vertex should lie at distance ≤ r from its corresponding ball
    // center — this is the rolling-ball invariant.
    const stride = 9;
    let maxDist = 0;
    for (let i = 0; i < spine.centers.length; i++) {
      const ctr = spine.centers[i]!;
      for (let k = 0; k <= 8; k++) {
        const vIdx = i * stride + k;
        const dx = m.positions[vIdx * 3]! - ctr.x;
        const dy = m.positions[vIdx * 3 + 1]! - ctr.y;
        const dz = m.positions[vIdx * 3 + 2]! - ctr.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > maxDist) maxDist = d;
      }
    }
    // All vertices within ~r + 5% slop.
    expect(maxDist).toBeLessThan(2 * 1.05);
  });
});

// Required for top-level Vec3 import to be considered used in some
// TS configs.
const _vec3SanityCheck: Vec3 = { x: 0, y: 0, z: 0 };
void _vec3SanityCheck;
