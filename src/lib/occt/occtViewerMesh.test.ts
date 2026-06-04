// @vitest-environment node
/**
 * occtViewerMesh — OCCT B-rep → viewer buffers (K6). Pure packing tests always
 * run; real-OCCT tests skip without the wasm.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { polyhedronToMesh, polyhedronFeatureEdges, meshBounds, tessellateToMesh } from './occtViewerMesh';
import { loadOcctNode } from './nodeOcctLoader';
import type { Polyhedron } from '@/lib/cad/featureMesh';

// A unit tetrahedron (4 triangular faces) for pure tests.
const tetra: Polyhedron = {
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  faces: [
    { vertices: [0, 2, 1], normal: { x: 0, y: 0, z: -1 } },
    { vertices: [0, 1, 3], normal: { x: 0, y: -1, z: 0 } },
    { vertices: [0, 3, 2], normal: { x: -1, y: 0, z: 0 } },
    { vertices: [1, 2, 3], normal: { x: 0.577, y: 0.577, z: 0.577 } },
  ],
};

describe('polyhedronToMesh', () => {
  it('packs flat-shaded triangles (9 pos + 9 norm per face)', () => {
    const m = polyhedronToMesh(tetra);
    expect(m.triangleCount).toBe(4);
    expect(m.positions).toHaveLength(4 * 9);
    expect(m.normals).toHaveLength(4 * 9);
    // first triangle's 3 vertices all carry face 0's normal (flat shading)
    expect(m.normals.slice(0, 9)).toEqual([0, 0, -1, 0, 0, -1, 0, 0, -1]);
  });

  it('skips non-triangular faces', () => {
    const quad: Polyhedron = { vertices: tetra.vertices, faces: [{ vertices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: 1 } }] };
    expect(polyhedronToMesh(quad).triangleCount).toBe(0);
  });
});

describe('polyhedronFeatureEdges', () => {
  it('keeps the 6 sharp edges of a tetrahedron', () => {
    const e = polyhedronFeatureEdges(tetra);
    expect(e.length / 6).toBe(6); // a tetra has 6 edges, all sharp
  });
});

describe('meshBounds', () => {
  it('centres and sizes the box', () => {
    const b = meshBounds(tetra);
    expect(b.center).toEqual([0.5, 0.5, 0.5]);
    expect(b.size).toEqual([1, 1, 1]);
    expect(b.radius).toBeCloseTo(0.5 * Math.sqrt(3), 6);
  });

  it('is safe for an empty mesh', () => {
    expect(meshBounds({ vertices: [], faces: [] }).radius).toBe(0);
  });
});

describe('tessellateToMesh (real OCCT)', () => {
  let oc: Awaited<ReturnType<typeof loadOcctNode>>['oc'] = undefined;
  beforeAll(async () => {
    const r = await loadOcctNode();
    if (r.ok && r.oc) oc = r.oc;
    else console.warn(`[occt] viewer-mesh tests skipped — ${r.reason}`);
  }, 60_000);

  const mk = (name: string, ...a: unknown[]): any => new ((oc as any)[name])(...a);
  function boxShape(side: number, height: number): unknown {
    const poly = mk('BRepBuilderAPI_MakePolygon_1');
    for (const [x, y] of [[0, 0], [side, 0], [side, side], [0, side]]) poly.Add_1(mk('gp_Pnt_3', x, y, 0));
    poly.Close();
    const face = mk('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face();
    return mk('BRepPrimAPI_MakePrism_1', face, mk('gp_Vec_4', 0, 0, height), false, true).Shape();
  }

  it('produces viewer buffers for a box', () => {
    if (!oc) return;
    const mesh = tessellateToMesh(oc, boxShape(10, 5));
    expect(mesh.triangleCount).toBe(12);          // 6 quads → 12 triangles
    expect(mesh.positions).toHaveLength(12 * 9);
    expect(mesh.normals).toHaveLength(12 * 9);
    expect(mesh.edgeCount).toBe(12);              // a box has 12 feature edges
    expect(mesh.bounds.center[0]).toBeCloseTo(5, 6);
    expect(mesh.bounds.center[2]).toBeCloseTo(2.5, 6);
    expect(mesh.bounds.size).toEqual([10, 10, 5]);
  });

  it('a fully-filleted solid yields a rich mesh but almost no hard edges (smooth seams dropped)', () => {
    if (!oc) return;
    const box = boxShape(10, 5);
    mk('BRepMesh_IncrementalMesh_2', box, 0.1, false, 0.5, false);
    const fillet = mk('BRepFilletAPI_MakeFillet', box, 0);
    const exp = mk('TopExp_Explorer_2', box, (oc as any).TopAbs_ShapeEnum.TopAbs_EDGE, (oc as any).TopAbs_ShapeEnum.TopAbs_SHAPE);
    const seen = new Set<string>();
    while (exp.More()) {
      const e = (oc as any).TopoDS.Edge_1(exp.Current());
      const c = mk('BRepAdaptor_Curve_2', e);
      const p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
      const k = [p.X(), p.Y(), p.Z()].map((v: number) => Math.round(v * 100)).join(',');
      if (!seen.has(k)) { seen.add(k); fillet.Add_2(1, e); }
      exp.Next();
    }
    fillet.Build();
    const mesh = tessellateToMesh(oc, fillet.Shape(), 0.2);
    expect(mesh.triangleCount).toBeGreaterThan(12); // curved faces → many triangles
    // Filleting every edge removes all sharp creases, so the feature-edge
    // overlay is nearly empty even though the facet mesh is dense — exactly the
    // smooth-seam suppression a CAD viewer wants.
    expect(mesh.edgeCount).toBeLessThan(mesh.triangleCount / 4);
  });
});
