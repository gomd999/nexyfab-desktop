import { describe, it, expect } from 'vitest';
import {
  evalCoonsPatch, tessellateCoonsPatch, lineCurve, bezierQuadCurve,
  type CoonsInput, type PatchPoint,
} from './coonsPatch';
import {
  evalNetworkSurface, tessellateNetworkSurface, type NetworkInput,
} from './networkSurface';
import {
  pointInTrimLoop, classifyTrim, filterTrimmedTriangles,
  offsetSurface, thickenSurface, type TrimLoop,
} from './surfaceTrimOffset';
import { knitSurfaces } from './surfaceKnit';
import { buildSurfaceFillet, type BlendStation } from './surfaceFillet';
import type { SurfaceMesh } from './nurbsSurface';

// ── Coons patch ─────────────────────────────────────────────────────

describe('Coons patch', () => {
  const flatInput: CoonsInput = {
    bottom: lineCurve({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }),
    top:    lineCurve({ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }),
    left:   lineCurve({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }),
    right:  lineCurve({ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }),
  };

  it('flat boundary produces flat patch', () => {
    const p = evalCoonsPatch(flatInput, 0.5, 0.5);
    expect(p.z).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(5, 5);
    expect(p.y).toBeCloseTo(5, 5);
  });

  it('corners match boundary endpoints', () => {
    expect(evalCoonsPatch(flatInput, 0, 0).x).toBe(0);
    expect(evalCoonsPatch(flatInput, 1, 1).x).toBe(10);
  });

  it('tessellate produces correct vertex grid', () => {
    const m = tessellateCoonsPatch(flatInput, 4, 4);
    expect(m.positions.length).toBe(5 * 5 * 3);
    expect(m.indices.length).toBe(4 * 4 * 6);
  });

  it('bezier curve passes through endpoints', () => {
    const c = bezierQuadCurve({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(c(0).x).toBe(0);
    expect(c(1).x).toBe(10);
  });
});

// ── Network surface ────────────────────────────────────────────────

describe('Network surface', () => {
  const net: NetworkInput = {
    uCurves: [
      lineCurve({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }),
      lineCurve({ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }),
    ],
    vCurves: [
      lineCurve({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }),
      lineCurve({ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }),
    ],
    vSamples: [0, 1],
    uSamples: [0, 1],
  };

  it('evaluates at corners', () => {
    const p = evalNetworkSurface(net, 0, 0);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('tessellates with right vertex count', () => {
    const m = tessellateNetworkSurface(net, 4, 4);
    expect(m.positions.length).toBe(5 * 5 * 3);
  });

  it('Gordon surface interpolates a CURVED network curve exactly (not just intersections)', () => {
    // u-curve at v=0 is an arch peaking at z=4; the surface must reproduce it
    // along v=0, not sag to z=2 like the old (U+V)/2 average did.
    const archZ = (u: number) => 4 * Math.sin(Math.PI * u);
    const curved: NetworkInput = {
      uCurves: [
        (u) => ({ x: 10 * u, y: 0, z: archZ(u) }),
        (u) => ({ x: 10 * u, y: 10, z: 0 }),
      ],
      vCurves: [
        (v) => ({ x: 0, y: 10 * v, z: 0 }),
        (v) => ({ x: 10, y: 10 * v, z: 0 }),
      ],
      vSamples: [0, 1], uSamples: [0, 1],
    };
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const p = evalNetworkSurface(curved, u, 0);
      expect(p.z).toBeCloseTo(archZ(u), 6); // on the arch curve, exact
      expect(p.x).toBeCloseTo(10 * u, 6);
    }
    // Peak is the full arch height, not half.
    expect(evalNetworkSurface(curved, 0.5, 0).z).toBeCloseTo(4, 6);
  });
});

// ── Trim / Offset ──────────────────────────────────────────────────

describe('Trim / Offset', () => {
  const loop: TrimLoop = {
    vertices: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
    retain: 'outside',
  };

  it('pointInTrimLoop detects interior', () => {
    const inside: TrimLoop = { ...loop, retain: 'inside' };
    expect(pointInTrimLoop(inside, [0.5, 0.5])).toBe(true);
    expect(pointInTrimLoop(inside, [0.1, 0.1])).toBe(false);
  });

  it('classifyTrim flags inside vertices as removed when retain=outside', () => {
    const mesh: SurfaceMesh = {
      positions: [0, 0, 0,  1, 0, 0,  0.5, 0.5, 0,  0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0.5, 0.5, 0, 1],
      indices: [0, 1, 2,  0, 2, 3],
    };
    const kept = classifyTrim(mesh, [loop]);
    expect(kept[2]).toBe(false); // (0.5, 0.5) is inside the loop → removed
  });

  it('filterTrimmedTriangles drops triangles with kept=false verts', () => {
    const mesh: SurfaceMesh = {
      positions: [0, 0, 0,  1, 0, 0,  0.5, 0.5, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0.5, 0.5],
      indices: [0, 1, 2],
    };
    const kept = [true, true, false];
    expect(filterTrimmedTriangles(mesh, kept)).toEqual([]);
  });

  it('offsetSurface moves verts along normal', () => {
    const mesh: SurfaceMesh = {
      positions: [0, 0, 0,  1, 0, 0,  0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    };
    const offset = offsetSurface(mesh, 2);
    expect(offset.positions[2]).toBe(2);
    expect(offset.positions[5]).toBe(2);
  });

  it('thickenSurface doubles vertex count + adds top triangles', () => {
    const mesh: SurfaceMesh = {
      positions: [0, 0, 0,  1, 0, 0,  0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    };
    const thick = thickenSurface(mesh, 2);
    expect(thick.positions.length).toBe(mesh.positions.length * 2);
    expect(thick.indices.length).toBe(mesh.indices.length * 2);
  });
});

// ── Knit ───────────────────────────────────────────────────────────

describe('Knit', () => {
  it('welds shared vertices across surfaces', () => {
    const a: SurfaceMesh = {
      positions: [0, 0, 0,  1, 0, 0,  0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    };
    const b: SurfaceMesh = {
      positions: [1, 0, 0,  1, 1, 0,  0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [0, 0, 1, 0, 0, 1],
      indices: [0, 1, 2],
    };
    const { report } = knitSurfaces([a, b]);
    expect(report.mergedVertices).toBeGreaterThanOrEqual(2); // (1,0,0) and (0,1,0)
    expect(report.finalVertexCount).toBeLessThan(6);
  });

  it('reports closed shell when every edge shared twice', () => {
    // A tetrahedron — 4 triangles forming a closed shell.
    const tetra: SurfaceMesh = {
      positions: [
        0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1,
      ],
      normals: new Array(12).fill(0),
      uvs: new Array(8).fill(0),
      indices: [
        0, 1, 2,
        0, 1, 3,
        1, 2, 3,
        0, 2, 3,
      ],
    };
    const { report } = knitSurfaces([tetra]);
    expect(report.isClosed).toBe(true);
    expect(report.boundaryEdges).toHaveLength(0);
  });
});

// ── Surface fillet ─────────────────────────────────────────────────

describe('Surface fillet', () => {
  const station = (p1: PatchPoint, p2: PatchPoint, t1: PatchPoint, t2: PatchPoint): BlendStation => ({
    pointA: p1, pointB: p2, tangentA: t1, tangentB: t2,
  });

  it('returns empty mesh for < 2 stations', () => {
    const r = buildSurfaceFillet({
      stations: [station({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 })],
    });
    expect(r.positions).toEqual([]);
    expect(r.indices).toEqual([]);
  });

  it('builds a strip for 2 stations', () => {
    const r = buildSurfaceFillet({
      stations: [
        station({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }),
        station({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }),
      ],
      crossSamples: 4,
    });
    // 2 stations × 5 cross samples = 10 verts.
    expect(r.positions.length).toBe(10 * 3);
    // 1 strip × 4 quads = 8 triangles.
    expect(r.indices.length).toBe(8 * 3);
  });

  it('honors crossSamples option', () => {
    const r = buildSurfaceFillet({
      stations: [
        station({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }),
        station({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }),
      ],
      crossSamples: 12,
    });
    expect(r.positions.length).toBe(2 * 13 * 3);
  });

  it('a 90° fillet cross-section is a true radius-R circular arc, G1 to both faces', () => {
    // Rolling-ball fillet of radius R between two perpendicular planes. Tangent
    // points (R,0) and (0,R); the arc is a quarter circle about (R,R). The
    // angle-based handle makes the cubic Bézier hug that circle (a fixed
    // 0.55·chord handle bulged ~12% past it).
    const R = 10;
    const st: BlendStation = {
      pointA: { x: R, y: 0, z: 0 }, pointB: { x: 0, y: R, z: 0 },
      tangentA: { x: -1, y: 0, z: 0 }, tangentB: { x: 0, y: -1, z: 0 },
    };
    const m = buildSurfaceFillet({ stations: [st, { ...st, pointA: { x: R, y: 0, z: 5 }, pointB: { x: 0, y: R, z: 5 } }], crossSamples: 32 });
    const pt = (k: number) => ({ x: m.positions[k * 3]!, y: m.positions[k * 3 + 1]!, z: m.positions[k * 3 + 2]! });
    // Every cross-section point lies on the radius-R circle about (R,R).
    for (let k = 0; k <= 32; k++) {
      const p = pt(k);
      expect(Math.hypot(p.x - R, p.y - R)).toBeCloseTo(R, 1); // within ~0.05
    }
    // C0 + G1: endpoints exact, start direction along tangentA.
    const c0 = pt(0), c1 = pt(1), cN = pt(32);
    expect(Math.hypot(c0.x - R, c0.y - 0)).toBeLessThan(1e-6);
    expect(Math.hypot(cN.x - 0, cN.y - R)).toBeLessThan(1e-6);
    const dir0 = { x: c1.x - c0.x, y: c1.y - c0.y };
    const dl = Math.hypot(dir0.x, dir0.y);
    expect(dir0.x / dl).toBeLessThan(-0.99); // leaves P0 along (−1,0) = tangentA
  });
});
