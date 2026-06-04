// @vitest-environment node
/**
 * occtTessellate — OCCT B-rep → welded Polyhedron → projectView HLR (K5).
 * Pure-helper tests always run; the real-OCCT tests skip if the wasm is absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { VertexWeld, triangleNormal, tessellateToPolyhedron } from './occtTessellate';
import { loadOcctNode } from './nodeOcctLoader';
import { polyhedronEdges } from '@/lib/cad/featureMesh';
import { projectPolyhedron } from '@/lib/drawing/projectView';

describe('VertexWeld', () => {
  it('merges coincident vertices and keeps distinct ones', () => {
    const w = new VertexWeld();
    const a = w.add({ x: 0, y: 0, z: 0 });
    const b = w.add({ x: 0, y: 0, z: 0 }); // coincident
    const c = w.add({ x: 1, y: 0, z: 0 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(w.vertices).toHaveLength(2);
  });

  it('welds within quantisation tolerance', () => {
    const w = new VertexWeld(1e4); // 1e-4 mm buckets
    const a = w.add({ x: 1, y: 1, z: 1 });
    const b = w.add({ x: 1.00001, y: 1, z: 1 }); // within a bucket
    expect(a).toBe(b);
  });
});

describe('triangleNormal', () => {
  it('is the unit normal by right-hand rule', () => {
    const n = triangleNormal({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(n.z).toBeCloseTo(1, 9);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9);
  });

  it('returns zero for a degenerate triangle', () => {
    const n = triangleNormal({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(Math.hypot(n.x, n.y, n.z)).toBe(0);
  });
});

describe('tessellateToPolyhedron (real OCCT)', () => {
  let oc: Awaited<ReturnType<typeof loadOcctNode>>['oc'] = undefined;
  beforeAll(async () => {
    const r = await loadOcctNode();
    if (r.ok && r.oc) oc = r.oc;
    else console.warn(`[occt] tessellate tests skipped — ${r.reason}`);
  }, 60_000);

  const mk = (name: string, ...a: unknown[]): any => new ((oc as any)[name])(...a);
  function boxShape(side: number, height: number): unknown {
    const poly = mk('BRepBuilderAPI_MakePolygon_1');
    for (const [x, y] of [[0, 0], [side, 0], [side, side], [0, side]]) poly.Add_1(mk('gp_Pnt_3', x, y, 0));
    poly.Close();
    const face = mk('BRepBuilderAPI_MakeFace_15', poly.Wire(), false).Face();
    return mk('BRepPrimAPI_MakePrism_1', face, mk('gp_Vec_4', 0, 0, height), false, true).Shape();
  }

  it('meshes a box into a closed manifold (Euler V−E+F=2)', () => {
    if (!oc) return;
    const poly = tessellateToPolyhedron(oc, boxShape(10, 5));
    expect(poly.faces.length).toBe(12); // 6 quads → 12 triangles
    const edges = polyhedronEdges(poly);
    // Every edge of a closed solid is shared by exactly two faces.
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
    const V = poly.vertices.length;
    const E = edges.length;
    const F = poly.faces.length;
    expect(V - E + F).toBe(2); // 8 − 18 + 12 = 2
  });

  it('all face normals point outward', () => {
    if (!oc) return;
    const poly = tessellateToPolyhedron(oc, boxShape(10, 5));
    const cx = 5, cy = 5, cz = 2.5;
    for (const f of poly.faces) {
      const v = poly.vertices[f.vertices[0]];
      const outward = (v.x - cx) * f.normal.x + (v.y - cy) * f.normal.y + (v.z - cz) * f.normal.z;
      expect(outward).toBeGreaterThan(0);
    }
  });

  it('projects to a clean outline — diagonal tessellation seams suppressed', () => {
    if (!oc) return;
    const poly = tessellateToPolyhedron(oc, boxShape(10, 5));
    const view = projectPolyhedron(poly, 'top'); // looking down −Z at the 10×10 cap
    // A 10×10 square outline: 4 visible segments, no interior diagonal.
    expect(view.visible.length).toBe(4);
    expect(view.bbox.maxX - view.bbox.minX).toBeCloseTo(10, 3);
    expect(view.bbox.maxY - view.bbox.minY).toBeCloseTo(10, 3);
  });

  it('tessellates a filleted solid that featureMesh cannot mesh (the K5 payoff)', () => {
    if (!oc) return;
    const box = boxShape(10, 5);
    mk('BRepMesh_IncrementalMesh_2', box, 0.1, false, 0.5, false);
    // Fillet all edges so the solid has curved faces, then tessellate + project.
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
    const poly = tessellateToPolyhedron(oc, fillet.Shape(), 0.2);
    expect(poly.faces.length).toBeGreaterThan(12); // curved faces → many triangles
    const view = projectPolyhedron(poly, 'front');
    expect(view.visible.length).toBeGreaterThan(0); // a drawable silhouette
  });
});
