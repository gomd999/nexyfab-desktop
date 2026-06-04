/**
 * occtTessellate — turn a real OCCT B-rep into a featureMesh Polyhedron (K5 of
 * ADR-014).
 *
 * This build of opencascade.js does NOT bind HLRBRep_Algo (exact hidden-line
 * removal), so K5 takes the robust route: tessellate the kernel solid and feed
 * it to the existing pure-TS HLR projector (lib/drawing/projectView). The payoff
 * is that ANY OCCT shape can now be drawn — an imported STEP part, a filleted /
 * chamfered solid, a precise boolean — not just the primitives featureMesh can
 * mesh itself.
 *
 * BRepMesh emits a separate node set per face, so we WELD coincident nodes into
 * one global vertex list: that turns the triangle soup into a manifold whose
 * shared edges projectView can classify (coplanar tessellation seams within a
 * flat face suppress; real silhouette / sharp edges survive). Triangle winding
 * is normalised to the face's outward orientation so front-face tests are
 * correct. Node/server/test-only.
 */

import type { Polyhedron, PolyFace } from '@/lib/cad/featureMesh';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { sub, cross, normalize, scale } from '@/lib/sketch/sketchPlane';
import type { OcctModule } from './nodeOcctLoader';

// ─── pure helpers (testable without OCCT) ───────────────────────────────────

/** Merge coincident vertices so a per-face triangle soup becomes a manifold. */
export class VertexWeld {
  readonly vertices: Vec3[] = [];
  private readonly index = new Map<string, number>();
  constructor(private readonly quant = 1e4) {}

  add(p: Vec3): number {
    const key = `${Math.round(p.x * this.quant)},${Math.round(p.y * this.quant)},${Math.round(p.z * this.quant)}`;
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    const i = this.vertices.length;
    this.vertices.push(p);
    this.index.set(key, i);
    return i;
  }
}

/** Unit normal of triangle (a,b,c); zero vector for a degenerate triangle. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n.x, n.y, n.z);
  return len < 1e-12 ? { x: 0, y: 0, z: 0 } : scale(n, 1 / len);
}

// ─── OCCT walk ──────────────────────────────────────────────────────────────

type Any = Record<string, (...args: unknown[]) => unknown>;
const inst = (oc: OcctModule, name: string, ...args: unknown[]): Any =>
  new (oc[name] as unknown as new (...a: unknown[]) => Any)(...args);

/**
 * Tessellate an OCCT shape into a welded Polyhedron. `deflection` is the chord
 * tolerance in mm (smaller = finer); curved faces approximate as triangles.
 */
export function tessellateToPolyhedron(oc: OcctModule, shape: unknown, deflection = 0.1): Polyhedron {
  // Mesh in place (mutates the shape's triangulation).
  inst(oc, 'BRepMesh_IncrementalMesh_2', shape, deflection, false, 0.5, false);

  const shapeEnum = oc.TopAbs_ShapeEnum as unknown as { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
  const orient = oc.TopAbs_Orientation as unknown as { TopAbs_REVERSED: unknown };
  const topoDS = oc.TopoDS as unknown as { Face_1: (s: unknown) => Any };
  const brepTool = oc.BRep_Tool as unknown as { Triangulation: (f: unknown, l: unknown) => Any };

  const weld = new VertexWeld();
  const faces: PolyFace[] = [];

  const exp = inst(oc, 'TopExp_Explorer_2', shape, shapeEnum.TopAbs_FACE, shapeEnum.TopAbs_SHAPE);
  while (exp.More()) {
    const face = topoDS.Face_1(exp.Current());
    const reversed = face.Orientation_1() === orient.TopAbs_REVERSED;
    const loc = inst(oc, 'TopLoc_Location_1');
    const handle = brepTool.Triangulation(face, loc);
    if (!handle.IsNull()) {
      const tri = handle.get() as Any;
      const trsf = loc.Transformation();
      const nbTri = tri.NbTriangles() as number;
      // local triangulation node index → global welded vertex index
      const globalOf = (localIdx: number): number => {
        const n = (tri.Node(localIdx) as Any).Transformed(trsf) as Any;
        return weld.add({ x: n.X() as number, y: n.Y() as number, z: n.Z() as number });
      };
      for (let t = 1; t <= nbTri; t++) {
        const tr = tri.Triangle(t) as Any;
        const ga = globalOf(tr.Value(1) as number);
        const gb = globalOf(tr.Value(2) as number);
        const gc = globalOf(tr.Value(3) as number);
        if (ga === gb || gb === gc || ga === gc) continue; // skip slivers
        const va = weld.vertices[ga];
        const vb = weld.vertices[gb];
        const vc = weld.vertices[gc];
        let normal = triangleNormal(va, vb, vc);
        let loop = [ga, gb, gc];
        if (reversed) {
          normal = scale(normal, -1);
          loop = [ga, gc, gb]; // keep loop CCW-from-outside, consistent with normal
        }
        faces.push({ vertices: loop, normal });
      }
    }
    exp.Next();
  }

  return { vertices: weld.vertices, faces };
}
