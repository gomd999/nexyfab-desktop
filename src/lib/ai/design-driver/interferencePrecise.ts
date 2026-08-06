/**
 * design-driver/interferencePrecise — WB-4b: NARROW-PHASE precise refinement
 * for the interference gate.
 *
 * WHY (문제): the interference gate's broad phase (`assemblyInterferences`,
 * src/lib/assembly/interference) is AXIS-ALIGNED BOUNDING BOX only. An AABB
 * overlap is CONSERVATIVE — it raises a FALSE POSITIVE whenever two parts'
 * bounding boxes overlap while their actual SOLIDS do not (a bracket cradling
 * a peg in its concavity, a rotated body's slack corners, …). The old gate
 * failed those valid designs (패키지 미산출).
 *
 * WHAT (해결): this module runs a REAL geometric intersection test on the
 * tessellated solids that `geometryGate.buildPartGeometry` already produced
 * (`BodyGeometry.poly` — a closed 2-manifold `Polyhedron` per body, verified
 * watertight by the geometry gate), transformed into the WORLD frame by the
 * SOLVED assembly pose (`PartInstance.position` + `.orientation`, 실측 배치).
 * The verdict is derived from executed geometry, never fabricated:
 *
 *   interfere(A,B) ⇔ some triangle of A's surface intersects some triangle of
 *   B's surface  (separating-axis theorem, exact for the tessellation)
 *                OR one solid fully CONTAINS the other with no surface crossing
 *   (point-in-mesh ray parity, exact for a closed manifold).
 *
 * The surface test alone would MISS pure containment (one body entirely inside
 * another, surfaces never crossing) → the containment guard closes that gap so
 * the precise engine never SILENTLY clears a real interference.
 *
 * SCOPE / 한계 (명시):
 *   - Runs only when BOTH parts have a fully-meshed set of bodies
 *     (`BodyGeometry.poly` non-null for every body). If ANY body of either
 *     part is unmeshable (feature kind featureMesh cannot tessellate), the
 *     precise engine reports `available:false` with the reason; the CALLER
 *     must then fall back to the conservative AABB verdict (근사 명시), NOT
 *     silently pass.
 *   - "Penetration depth" is NOT re-measured here (a signed-distance / boolean
 *     would be needed); the gate keeps reporting the broad-phase AABB
 *     interpenetration as a labelled bbox proxy. THIS module's contribution is
 *     the boolean does-it-really-collide verdict + a measured intersecting-
 *     triangle-pair count.
 */

import type { PartInstance } from '@/lib/assembly/assemblyState';
import { rotateVec } from '@/lib/assembly/mateSolver';
import { add, cross, dot, sub, type Vec3 } from '@/lib/sketch/sketchPlane';
import type { PartGeometry } from './geometryGate';
import type { PlanPart } from './types';

// ─── world-frame triangle soup ─────────────────────────────────────────────

export interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

interface TriWithBox extends Tri {
  min: Vec3;
  max: Vec3;
}

function triBox(t: Tri): { min: Vec3; max: Vec3 } {
  return {
    min: {
      x: Math.min(t.a.x, t.b.x, t.c.x),
      y: Math.min(t.a.y, t.b.y, t.c.y),
      z: Math.min(t.a.z, t.b.z, t.c.z),
    },
    max: {
      x: Math.max(t.a.x, t.b.x, t.c.x),
      y: Math.max(t.a.y, t.b.y, t.c.y),
      z: Math.max(t.a.z, t.b.z, t.c.z),
    },
  };
}

function boxesTouch(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }): boolean {
  return (
    a.min.x <= b.max.x && b.min.x <= a.max.x &&
    a.min.y <= b.max.y && b.min.y <= a.max.y &&
    a.min.z <= b.max.z && b.min.z <= a.max.z
  );
}

/**
 * World-frame triangle soup for a whole part: every body's `poly` fan-
 * triangulated, each vertex mapped feature-frame → part-frame (body.translate)
 * → world-frame (part pose), matching how `interference.ts::transformAabb`
 * composes the pose (world = position + R·partFramePoint).
 *
 * Returns `null` when any body of the part is unmeshed (poly === null) — the
 * signal for the caller to fall back to the AABB verdict.
 */
export function worldTriangles(
  part: PlanPart,
  geo: PartGeometry,
  pose: PartInstance,
): Tri[] | null {
  const geoBodies = new Map(geo.bodies.map((b) => [b.bodyId, b]));
  const tris: Tri[] = [];
  for (const body of part.bodies) {
    const bg = geoBodies.get(body.bodyId);
    if (!bg || !bg.poly) return null; // unmeshable body → precise unavailable
    const t = body.translate ?? { x: 0, y: 0, z: 0 };
    const toWorld = (v: Vec3): Vec3 =>
      add(pose.position, rotateVec({ x: v.x + t.x, y: v.y + t.y, z: v.z + t.z }, pose.orientation));
    for (const face of bg.poly.faces) {
      const idx = face.vertices;
      if (idx.length < 3) continue;
      const v0 = toWorld(bg.poly.vertices[idx[0]!]!);
      for (let i = 1; i < idx.length - 1; i++) {
        tris.push({
          a: v0,
          b: toWorld(bg.poly.vertices[idx[i]!]!),
          c: toWorld(bg.poly.vertices[idx[i + 1]!]!),
        });
      }
    }
  }
  return tris;
}

// ─── triangle–triangle intersection (SAT) ──────────────────────────────────

const EPS = 1e-10;

/**
 * Separating-axis-theorem triangle–triangle intersection (the same test the
 * viewer's narrow phase uses, ported off THREE to plain Vec3). Two triangles
 * intersect ⇔ NO candidate axis (each face normal + all 9 edge×edge crosses)
 * separates their projected intervals. Touching (shared edge/vertex) counts as
 * intersection — deliberate: a seated face is filtered upstream by contactTol,
 * so anything reaching here is a genuine overlap region.
 */
export function trianglesIntersect(t1: Tri, t2: Tri): boolean {
  const e1 = [sub(t1.b, t1.a), sub(t1.c, t1.b), sub(t1.a, t1.c)];
  const e2 = [sub(t2.b, t2.a), sub(t2.c, t2.b), sub(t2.a, t2.c)];
  const n1 = cross(e1[0]!, e1[1]!), n2 = cross(e2[0]!, e2[1]!);
  const axes: Vec3[] = [n1, n2];
  for (const a of e1) for (const b of e2) axes.push(cross(a, b));
  // The standard 3D triangle SAT axes collapse to the shared normal for
  // coplanar triangles. Add in-plane edge normals or disjoint coplanar
  // triangles with overlapping AABBs become false collisions.
  if (dot(cross(n1, n2), cross(n1, n2)) <= EPS * Math.max(dot(n1, n1) * dot(n2, n2), 1) && Math.abs(dot(n1, sub(t2.a, t1.a))) <= EPS * Math.max(Math.sqrt(dot(n1, n1)), 1)) {
    for (const edge of [...e1, ...e2]) axes.push(cross(n1, edge));
  }

  const v1 = [t1.a, t1.b, t1.c];
  const v2 = [t2.a, t2.b, t2.c];
  for (const axis of axes) {
    if (dot(axis, axis) < EPS) continue; // degenerate axis (parallel edges)
    let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
    for (const v of v1) { const d = dot(v, axis); if (d < min1) min1 = d; if (d > max1) max1 = d; }
    for (const v of v2) { const d = dot(v, axis); if (d < min2) min2 = d; if (d > max2) max2 = d; }
    if (max1 < min2 - EPS || max2 < min1 - EPS) return false; // separating axis
  }
  return true;
}

// ─── point-in-mesh (containment guard) ─────────────────────────────────────

/** Fixed slightly-skew ray dir — avoids axis-aligned face/edge coplanarity. */
const RAY_DIR: Vec3 = { x: 1, y: 0.0011, z: 0.0007 };

/** Möller–Trumbore: does the ray (orig, dir) cross triangle t at t-param > EPS? */
function rayHitsTri(orig: Vec3, dir: Vec3, t: Tri): boolean {
  const edge1 = sub(t.b, t.a);
  const edge2 = sub(t.c, t.a);
  const p = cross(dir, edge2);
  const det = dot(edge1, p);
  if (det > -EPS && det < EPS) return false; // ray parallel to triangle
  const inv = 1 / det;
  const tvec = sub(orig, t.a);
  const u = dot(tvec, p) * inv;
  if (u < 0 || u > 1) return false;
  const q = cross(tvec, edge1);
  const v = dot(dir, q) * inv;
  if (v < 0 || u + v > 1) return false;
  const tt = dot(edge2, q) * inv;
  return tt > EPS;
}

/** Ray-parity point-in-mesh — exact for a closed 2-manifold triangle soup. */
export function pointInMesh(p: Vec3, tris: ReadonlyArray<Tri>): boolean {
  let crossings = 0;
  for (const t of tris) if (rayHitsTri(p, RAY_DIR, t)) crossings++;
  return (crossings & 1) === 1;
}

// ─── precise pair verdict ──────────────────────────────────────────────────

export interface PreciseResult {
  /** True iff BOTH parts meshed and the exact test could execute. */
  available: boolean;
  /** Real surface/containment intersection verdict (meaningful iff available). */
  intersects: boolean;
  /** Measured count of intersecting triangle pairs (0 when cleared/containment). */
  triPairsIntersecting: number;
  trianglesA: number;
  trianglesB: number;
  /** True iff the verdict came from the containment guard (no surface crossing). */
  byContainment: boolean;
  /** Why the exact test could not run (present iff !available). */
  unavailableReason?: string;
}

export interface PreciseSeparationResult {
  available: boolean;
  intersects: boolean;
  minimumDistanceMm: number | null;
  trianglesA: number;
  trianglesB: number;
  unavailableReason?: string;
}

/** Exact Euclidean surface separation for the tessellated solids. This is
 * intentionally O(Ta*Tb): rotational CCD calls it only after its spatial AABB
 * interval pruning has reduced the candidate set. */
export function preciseSeparation(
  partA: PlanPart, geoA: PartGeometry, poseA: PartInstance,
  partB: PlanPart, geoB: PartGeometry, poseB: PartInstance,
): PreciseSeparationResult {
  const A=worldTriangles(partA,geoA,poseA),B=worldTriangles(partB,geoB,poseB);
  if(!A||!B)return{available:false,intersects:false,minimumDistanceMm:null,trianglesA:A?.length??0,trianglesB:B?.length??0,unavailableReason:`${!A?partA.partId:partB.partId}: collision mesh unavailable`};
  if(!A.length||!B.length)return{available:false,intersects:false,minimumDistanceMm:null,trianglesA:A.length,trianglesB:B.length,unavailableReason:'collision mesh contains no triangles'};
  let minimum=Infinity;
  for(const a of A)for(const b of B){if(boxesTouch(triBox(a),triBox(b))&&trianglesIntersect(a,b))return{available:true,intersects:true,minimumDistanceMm:0,trianglesA:A.length,trianglesB:B.length};minimum=Math.min(minimum,triangleDistance(a,b));}
  // Containment is possible only when the complete soups' bounds overlap.
  // This guard is mandatory here because, unlike preciseInterference(), the
  // separation API is deliberately called for already-separated candidates.
  const contained=boxesTouch(soupBox(A),soupBox(B))&&(pointInMesh(centroid(A[0]!),B)||pointInMesh(centroid(B[0]!),A));
  return{available:true,intersects:contained,minimumDistanceMm:contained?0:minimum,trianglesA:A.length,trianglesB:B.length};
}

function triangleDistance(a:Tri,b:Tri):number{
  let best=Infinity;
  for(const p of [a.a,a.b,a.c])best=Math.min(best,pointTriangleDistance(p,b));
  for(const p of [b.a,b.b,b.c])best=Math.min(best,pointTriangleDistance(p,a));
  const ae:[[Vec3,Vec3],[Vec3,Vec3],[Vec3,Vec3]]=[[a.a,a.b],[a.b,a.c],[a.c,a.a]],be:[[Vec3,Vec3],[Vec3,Vec3],[Vec3,Vec3]]=[[b.a,b.b],[b.b,b.c],[b.c,b.a]];
  for(const x of ae)for(const y of be)best=Math.min(best,segmentDistance(x[0],x[1],y[0],y[1]));
  return best;
}

function pointTriangleDistance(p:Vec3,t:Tri):number{
  const ab=sub(t.b,t.a),ac=sub(t.c,t.a),ap=sub(p,t.a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return norm(ap);
  const bp=sub(p,t.b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return norm(bp);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return norm(sub(p,add(t.a,scale(ab,v))));}
  const cp=sub(p,t.c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return norm(cp);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return norm(sub(p,add(t.a,scale(ac,w))));}
  const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return norm(sub(p,add(t.b,scale(sub(t.c,t.b),w))));}
  const denom=1/(va+vb+vc),v=vb*denom,w=vc*denom;return norm(sub(p,add(t.a,add(scale(ab,v),scale(ac,w)))));
}
function segmentDistance(p1:Vec3,q1:Vec3,p2:Vec3,q2:Vec3):number{
  const d1=sub(q1,p1),d2=sub(q2,p2),r=sub(p1,p2),a=dot(d1,d1),e=dot(d2,d2),f=dot(d2,r);let s=0,t=0;
  if(a<=EPS&&e<=EPS)return norm(r);
  if(a<=EPS)t=clamp(f/e);else{const c=dot(d1,r);if(e<=EPS)s=clamp(-c/a);else{const b=dot(d1,d2),den=a*e-b*b;s=den!==0?clamp((b*f-c*e)/den):0;t=(b*s+f)/e;if(t<0){t=0;s=clamp(-c/a);}else if(t>1){t=1;s=clamp((b-c)/a);}}}
  return norm(sub(add(p1,scale(d1,s)),add(p2,scale(d2,t))));
}
const scale=(v:Vec3,s:number):Vec3=>({x:v.x*s,y:v.y*s,z:v.z*s});
const norm=(v:Vec3)=>Math.hypot(v.x,v.y,v.z);
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function soupBox(tris:ReadonlyArray<Tri>):{min:Vec3;max:Vec3}{const points=tris.flatMap(t=>[t.a,t.b,t.c]);return{min:{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),z:Math.min(...points.map(p=>p.z))},max:{x:Math.max(...points.map(p=>p.x)),y:Math.max(...points.map(p=>p.y)),z:Math.max(...points.map(p=>p.z))}};}

/**
 * Exact interference verdict for a candidate pair that already overlaps in
 * world-AABB. `geoA/geoB` and `poseA/poseB` are the meshed geometry and SOLVED
 * poses. `regionMin/Max` (optional) is the world-AABB overlap box used to skip
 * triangles far from the contested region.
 */
export function preciseInterference(
  partA: PlanPart,
  geoA: PartGeometry,
  poseA: PartInstance,
  partB: PlanPart,
  geoB: PartGeometry,
  poseB: PartInstance,
  region?: { min: Vec3; max: Vec3 },
): PreciseResult {
  const rawA = worldTriangles(partA, geoA, poseA);
  const rawB = worldTriangles(partB, geoB, poseB);
  if (!rawA || !rawB) {
    return {
      available: false,
      intersects: false,
      triPairsIntersecting: 0,
      trianglesA: rawA?.length ?? 0,
      trianglesB: rawB?.length ?? 0,
      byContainment: false,
      unavailableReason: `${!rawA ? partA.partId : partB.partId}: 일부 바디가 메시화 불가(featureMesh) — 정밀 교차 미실행`,
    };
  }

  // Attach per-triangle boxes; when a region is given, keep only triangles that
  // touch the contested overlap box (cheap prune, exactness preserved).
  const prep = (tris: Tri[]): TriWithBox[] => {
    const out: TriWithBox[] = [];
    for (const t of tris) {
      const bx = triBox(t);
      if (region && !boxesTouch(bx, region)) continue;
      out.push({ ...t, ...bx });
    }
    return out;
  };
  const A = prep(rawA);
  const B = prep(rawB);

  let triPairsIntersecting = 0;
  for (const ta of A) {
    for (const tb of B) {
      if (!boxesTouch(ta, tb)) continue;
      if (trianglesIntersect(ta, tb)) triPairsIntersecting++;
    }
  }
  if (triPairsIntersecting > 0) {
    return {
      available: true,
      intersects: true,
      triPairsIntersecting,
      trianglesA: rawA.length,
      trianglesB: rawB.length,
      byContainment: false,
    };
  }

  // No surface crossing → check full containment (one solid inside the other).
  // A single representative point per solid suffices for a connected body; use
  // a triangle centroid (guaranteed on the surface → nudge inward is not even
  // needed since parity counts strict crossings ahead of the point).
  const contained =
    (rawA.length > 0 && pointInMesh(centroid(rawA[0]!), rawB)) ||
    (rawB.length > 0 && pointInMesh(centroid(rawB[0]!), rawA));

  return {
    available: true,
    intersects: contained,
    triPairsIntersecting: 0,
    trianglesA: rawA.length,
    trianglesB: rawB.length,
    byContainment: contained,
  };
}

function centroid(t: Tri): Vec3 {
  return { x: (t.a.x + t.b.x + t.c.x) / 3, y: (t.a.y + t.b.y + t.c.y) / 3, z: (t.a.z + t.b.z + t.c.z) / 3 };
}
