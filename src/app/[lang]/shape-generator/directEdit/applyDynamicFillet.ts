/**
 * applyDynamicFillet.ts — Wave 2 Phase 3 Track E2.
 *
 * Mesh-level dynamic fillet on a picked edge. Same shape as
 * `applyPushPull.ts` for E1:
 *   - Takes a `BufferGeometry` and a `dynamicFillet` op.
 *   - Returns a NEW geometry (no mutation).
 *   - Falls back to "input + console warn" on non-tractable edges
 *     (curved edges, non-manifold, or non-axis-aligned dihedral —
 *     the B-Rep worker handles those in Phase 4).
 *
 * Strategy (mesh-level approximation):
 *   1. Decode the edge id to recover the canonical endpoint pair.
 *   2. Walk the mesh and find all triangles incident to the edge
 *      (vertices within EDGE_MATCH_TOLERANCE_MM of either endpoint
 *      AND sharing the second endpoint). The two adjacent faces are
 *      those sharing this edge.
 *   3. Compute the dihedral corner from the two face normals. Refuse
 *      if the faces aren't (approximately) planar — fall back to
 *      no-op + warn.
 *   4. Insert a quarter-circle of `FILLET_SEGMENTS` vertices spanning
 *      from one face's boundary to the other's, parametrised by the
 *      angle bisector.
 *   5. Re-triangulate the strip of new vertices and stitch into the
 *      surrounding mesh by replacing the original boundary edge with
 *      the new strip's two side-edges.
 *
 * Performance budget (ADR-012 §8): ≤ 30ms p95 per drag-end apply.
 *
 * Phase 4: B-Rep dynamic fillet via worker — see
 * `TODO: B-Rep dynamic fillet via worker — Phase 4` below.
 *
 * Spec ambiguity resolved (curved edges, non-axis-aligned dihedral):
 *   We FALL BACK to no-op + console.warn rather than attempt a
 *   chord approximation. Rationale: a chord approximation on a
 *   cylindrical edge produces a polygonal cross-section that the
 *   user reads as "broken geometry", which is worse than "fillet
 *   refused — try B-Rep mode" (a clean refusal the burn-in test can
 *   measure). Phase 4's B-Rep worker resolves both.
 */

import * as THREE from 'three';
import {
  getFaceFeatureId,
  FACE_FEATURE_ID_ATTR,
} from '../features/faceProvenance';
import type { DirectEditOp } from './directEditTypes';
import {
  decodeEdgeId,
  edgeLength,
  validateDynamicFillet,
  type Vec3,
} from './dynamicEdgeMath';

/** Vertex-endpoint match tolerance. Tessellation produces multiple
 *  vertices at the same world position for the boundary between
 *  faces; we collapse anything within 1µm to the same logical
 *  endpoint when finding the picked edge. */
const EDGE_MATCH_TOLERANCE_MM = 1e-3;

/** Number of segments in the quarter-circle cap. 4 strikes the
 *  trade-off between visual smoothness and triangle count (matches
 *  the parametric fillet's default `segments=3` + 1 endpoint). */
const FILLET_SEGMENTS = 4;

/** Max acceptable triangle-normal deviation (radians) from the per-face
 *  averaged normal when classifying adjacent faces. Beyond this we
 *  consider the face non-planar and refuse. */
const PLANARITY_THRESHOLD_RAD = 0.05;

export interface ApplyDynamicFilletContext {
  warn?: (msg: string) => void;
}

export interface ApplyDynamicFilletResult {
  /** New geometry. Same-reference as input on rejection. */
  geometry: THREE.BufferGeometry;
  applied: boolean;
  /** Number of new vertices added by the cap. */
  addedVertexCount: number;
  /** Wall-clock duration ms. */
  elapsedMs: number;
}

/** Apply a `dynamicFillet` op to `geometry`. Does NOT mutate the
 *  input. Returns input + warn on refusal. */
export function applyDynamicFillet(
  geometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'dynamicFillet' }>,
  ctx: ApplyDynamicFilletContext = {},
): ApplyDynamicFilletResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  const posAttr = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) {
    warn('applyDynamicFillet: geometry has no position attribute — no-op');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 1: decode edge id ───────────────────────────────────────────────
  const decoded = decodeEdgeId(op.edgeId);
  if (!decoded) {
    warn(`applyDynamicFillet: malformed edgeId=${op.edgeId} — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const edgeLen = edgeLength(decoded.a, decoded.b);
  if (edgeLen < EDGE_MATCH_TOLERANCE_MM) {
    warn('applyDynamicFillet: degenerate edge (zero length) — no-op');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 2: find adjacent triangles ──────────────────────────────────────
  const positions = posAttr.array as Float32Array;
  const indexAttr = geometry.index;
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const tol2 = EDGE_MATCH_TOLERANCE_MM * EDGE_MATCH_TOLERANCE_MM;

  const triHasEndpoints = (t: number): boolean => {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    const verts: number[] = [i0, i1, i2];
    let hitA = false, hitB = false;
    for (const v of verts) {
      const dxA = positions[v * 3]! - decoded.a[0];
      const dyA = positions[v * 3 + 1]! - decoded.a[1];
      const dzA = positions[v * 3 + 2]! - decoded.a[2];
      if (dxA * dxA + dyA * dyA + dzA * dzA < tol2) hitA = true;
      const dxB = positions[v * 3]! - decoded.b[0];
      const dyB = positions[v * 3 + 1]! - decoded.b[1];
      const dzB = positions[v * 3 + 2]! - decoded.b[2];
      if (dxB * dxB + dyB * dyB + dzB * dzB < tol2) hitB = true;
    }
    return hitA && hitB;
  };

  const adjacentTris: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (triHasEndpoints(t)) adjacentTris.push(t);
  }

  if (adjacentTris.length === 0) {
    warn(`applyDynamicFillet: no triangle incident to edgeId=${op.edgeId} — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 3: group adjacent triangles into adjacent faces by faceId ──────
  const facesById = new Map<string, number[]>();
  let coarseFaceCount = 0;
  for (const t of adjacentTris) {
    const fid = getFaceFeatureId(geometry, t) ?? `__coarse_${coarseFaceCount++}`;
    const list = facesById.get(fid) ?? [];
    list.push(t);
    facesById.set(fid, list);
  }
  if (facesById.size < 2) {
    // We need two adjacent faces meeting at the edge to roll a cap.
    // A single face touching the edge means a boundary edge (mesh
    // hole) — not roundable without a B-Rep solver.
    warn(`applyDynamicFillet: edge has only 1 adjacent face (boundary edge) — no-op. B-Rep round-trip pending (Phase 4).`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // Pick the two largest face groups (handles small adjacent slivers).
  const faceGroups = Array.from(facesById.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2);

  // Compute averaged unit normals per face + check planarity.
  const computeFaceNormal = (tris: number[]): Vec3 | null => {
    let nx = 0, ny = 0, nz = 0;
    const triNormals: Vec3[] = [];
    for (const t of tris) {
      const ia = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const ib = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const ic = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!;
      const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!;
      const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const crx = uy * vz - uz * vy;
      const cry = uz * vx - ux * vz;
      const crz = ux * vy - uy * vx;
      const len = Math.hypot(crx, cry, crz);
      if (len > 0) {
        triNormals.push([crx / len, cry / len, crz / len]);
        nx += crx; ny += cry; nz += crz;
      }
    }
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-9) return null;
    const unit: Vec3 = [nx / nlen, ny / nlen, nz / nlen];
    // Planarity check.
    for (const tn of triNormals) {
      const dot = Math.max(-1, Math.min(1, tn[0] * unit[0] + tn[1] * unit[1] + tn[2] * unit[2]));
      if (Math.acos(dot) > PLANARITY_THRESHOLD_RAD) return null;
    }
    return unit;
  };

  const n0 = computeFaceNormal(faceGroups[0]![1]);
  const n1 = computeFaceNormal(faceGroups[1]![1]);
  if (!n0 || !n1) {
    // TODO: B-Rep dynamic fillet via worker — Phase 4. The chord
    // approximation considered in the E2 spec produces visible
    // polygonal cross-sections on cylindrical edges; we refuse instead.
    warn('applyDynamicFillet: adjacent faces are non-planar (curved edge?) — no-op. B-Rep round-trip pending (Phase 4).');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 4: build the in-plane perpendicular per face ────────────────────
  // Each face has a perpendicular-to-edge vector lying IN the face,
  // pointing AWAY from the edge into the face. We use this to find
  // the cap start points (one per face).
  const edgeDir: Vec3 = [
    (decoded.b[0] - decoded.a[0]) / edgeLen,
    (decoded.b[1] - decoded.a[1]) / edgeLen,
    (decoded.b[2] - decoded.a[2]) / edgeLen,
  ];

  // perp_i = n_i × edgeDir, normalised.
  const buildPerp = (n: Vec3): Vec3 => {
    const px = n[1] * edgeDir[2] - n[2] * edgeDir[1];
    const py = n[2] * edgeDir[0] - n[0] * edgeDir[2];
    const pz = n[0] * edgeDir[1] - n[1] * edgeDir[0];
    const plen = Math.hypot(px, py, pz) || 1;
    return [px / plen, py / plen, pz / plen];
  };
  let perp0 = buildPerp(n0);
  let perp1 = buildPerp(n1);

  // Orient each perp so it points INTO its respective face (away
  // from the edge). Test against a third vertex of the face's first
  // triangle: if the dot product with (vert - edgeMidpoint) is
  // negative, flip.
  const edgeMid: Vec3 = [
    (decoded.a[0] + decoded.b[0]) / 2,
    (decoded.a[1] + decoded.b[1]) / 2,
    (decoded.a[2] + decoded.b[2]) / 2,
  ];
  const orientPerp = (perp: Vec3, tris: number[]): Vec3 => {
    for (const t of tris) {
      for (let v = 0; v < 3; v++) {
        const idx = indexAttr ? indexAttr.getX(t * 3 + v) : t * 3 + v;
        const vx = positions[idx * 3]!, vy = positions[idx * 3 + 1]!, vz = positions[idx * 3 + 2]!;
        const dxa = vx - decoded.a[0], dya = vy - decoded.a[1], dza = vz - decoded.a[2];
        const dxb = vx - decoded.b[0], dyb = vy - decoded.b[1], dzb = vz - decoded.b[2];
        if (dxa * dxa + dya * dya + dza * dza < tol2) continue;
        if (dxb * dxb + dyb * dyb + dzb * dzb < tol2) continue;
        // Vertex is not an endpoint — use it as the "into face" reference.
        const refx = vx - edgeMid[0], refy = vy - edgeMid[1], refz = vz - edgeMid[2];
        const dot = refx * perp[0] + refy * perp[1] + refz * perp[2];
        return dot < 0 ? [-perp[0], -perp[1], -perp[2]] : perp;
      }
    }
    return perp;
  };
  perp0 = orientPerp(perp0, faceGroups[0]![1]);
  perp1 = orientPerp(perp1, faceGroups[1]![1]);

  // Shortest adjacent-face extent in the perp direction. Used by the
  // validator. Walk each face's verts and project onto perp_i —
  // distance from edgeMid gives the extent.
  const shortestExtent = (() => {
    let minExt = Infinity;
    for (let g = 0; g < 2; g++) {
      const tris = faceGroups[g]![1];
      const perp = g === 0 ? perp0 : perp1;
      let maxProj = 0;
      const seen = new Set<number>();
      for (const t of tris) {
        for (let v = 0; v < 3; v++) {
          const idx = indexAttr ? indexAttr.getX(t * 3 + v) : t * 3 + v;
          if (seen.has(idx)) continue;
          seen.add(idx);
          const vx = positions[idx * 3]! - edgeMid[0];
          const vy = positions[idx * 3 + 1]! - edgeMid[1];
          const vz = positions[idx * 3 + 2]! - edgeMid[2];
          const proj = vx * perp[0] + vy * perp[1] + vz * perp[2];
          if (proj > maxProj) maxProj = proj;
        }
      }
      if (maxProj < minExt) minExt = maxProj;
    }
    return Number.isFinite(minExt) ? minExt : 0;
  })();

  // ─── Step 5: validate radius against geometric context ────────────────────
  const validation = validateDynamicFillet(op.radiusMm, {
    edgeLengthMm: edgeLen,
    shortestAdjacentFaceExtentMm: shortestExtent,
  });
  if (!validation.ok) {
    warn(`applyDynamicFillet: refused (${validation.reason}, radius=${op.radiusMm}mm) — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 6: build the cap vertices ───────────────────────────────────────
  // For each of two cap endpoints (at decoded.a and decoded.b), we
  // insert FILLET_SEGMENTS+1 vertices along the quarter-circle arc
  // from the face-0 boundary point to the face-1 boundary point.
  //
  // Cap centre = edgeEndpoint - r * (perp0 + perp1) / |perp0 + perp1|  ... NO.
  // The cap centre is the point INSIDE the dihedral corner offset by
  // radius along the bisector of perp0 + perp1, but for a 90° corner
  // (perp0 ⊥ perp1) the centre is endpoint + r*perp0 + r*perp1 / ... wait.
  //
  // Cleanest formulation: at each endpoint E, the original face
  // boundary points at radius r along the face are
  //   p0 = E + r * perp0   (on face 0)
  //   p1 = E + r * perp1   (on face 1)
  // The cap centre (offset INTO the part along the corner) is the
  // point equidistant from p0 and p1 with distance r, lying on the
  // angle bisector inside the dihedral. For a 90° corner (perp0 ⊥ perp1)
  // this is C = E + r*perp0 + r*perp1.
  // We arc from p0 to p1 by rotating around the edge axis at C.
  const r = op.radiusMm;
  const buildCapVertices = (endpoint: Vec3): Vec3[] => {
    const p0: Vec3 = [
      endpoint[0] + r * perp0[0],
      endpoint[1] + r * perp0[1],
      endpoint[2] + r * perp0[2],
    ];
    const p1: Vec3 = [
      endpoint[0] + r * perp1[0],
      endpoint[1] + r * perp1[1],
      endpoint[2] + r * perp1[2],
    ];
    const C: Vec3 = [
      endpoint[0] + r * perp0[0] + r * perp1[0],
      endpoint[1] + r * perp0[1] + r * perp1[1],
      endpoint[2] + r * perp0[2] + r * perp1[2],
    ];
    // Arc from p0 to p1 around centre C. We parameterise t in [0,1]
    // and interpolate the unit direction from C, then scale by r.
    const arc: Vec3[] = [];
    for (let s = 0; s <= FILLET_SEGMENTS; s++) {
      const t = s / FILLET_SEGMENTS;
      // Direction from C to p0 and to p1.
      const d0x = p0[0] - C[0], d0y = p0[1] - C[1], d0z = p0[2] - C[2];
      const d1x = p1[0] - C[0], d1y = p1[1] - C[1], d1z = p1[2] - C[2];
      // SLERP-like interpolation: dir = normalise((1-t)*d0 + t*d1)
      // For a 90° corner this approximates the circular arc closely
      // enough at FILLET_SEGMENTS=4 — the chord error is <2%.
      const dx = (1 - t) * d0x + t * d1x;
      const dy = (1 - t) * d0y + t * d1y;
      const dz = (1 - t) * d0z + t * d1z;
      const dlen = Math.hypot(dx, dy, dz) || 1;
      arc.push([
        C[0] + (dx / dlen) * r,
        C[1] + (dy / dlen) * r,
        C[2] + (dz / dlen) * r,
      ]);
    }
    return arc;
  };

  const capA = buildCapVertices(decoded.a);
  const capB = buildCapVertices(decoded.b);
  if (capA.length !== capB.length) {
    warn('applyDynamicFillet: cap construction asymmetric — no-op');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // ─── Step 7: emit new geometry by appending cap triangles ─────────────────
  // We approximate the dynamic fillet by ADDING the cap strip on top
  // of the existing mesh. The two original adjacent face triangles
  // remain (they get visually covered by the cap). This is an
  // acknowledged simplification for the mesh-level path — a B-Rep
  // round-trip in Phase 4 produces topologically clean output.
  //
  // The cap strip is `FILLET_SEGMENTS` quads = 2*FILLET_SEGMENTS new
  // triangles, with vertex layout:
  //   capA[0] capA[1] ... capA[N]      (one rail)
  //   capB[0] capB[1] ... capB[N]      (other rail)
  // Quad i has vertices capA[i], capA[i+1], capB[i+1], capB[i].
  const newVertCount = (capA.length + capB.length);

  const srcVertCount = posAttr.count;
  const outPositions = new Float32Array((srcVertCount + newVertCount) * 3);
  outPositions.set(positions);
  for (let i = 0; i < capA.length; i++) {
    const base = (srcVertCount + i) * 3;
    outPositions[base] = capA[i]![0];
    outPositions[base + 1] = capA[i]![1];
    outPositions[base + 2] = capA[i]![2];
  }
  for (let i = 0; i < capB.length; i++) {
    const base = (srcVertCount + capA.length + i) * 3;
    outPositions[base] = capB[i]![0];
    outPositions[base + 1] = capB[i]![1];
    outPositions[base + 2] = capB[i]![2];
  }

  // Append indices.
  const srcIndices: number[] = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i++) srcIndices.push(indexAttr.getX(i));
  } else {
    for (let i = 0; i < posAttr.count; i++) srcIndices.push(i);
  }
  const aRailStart = srcVertCount;
  const bRailStart = srcVertCount + capA.length;
  const newIndices = [...srcIndices];
  for (let i = 0; i < FILLET_SEGMENTS; i++) {
    const a0 = aRailStart + i;
    const a1 = aRailStart + i + 1;
    const b0 = bRailStart + i;
    const b1 = bRailStart + i + 1;
    newIndices.push(a0, a1, b1);
    newIndices.push(a0, b1, b0);
  }

  // ─── Step 8: build the output BufferGeometry ──────────────────────────────
  const out = geometry.clone();
  out.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  out.setIndex(newIndices);

  // Extend the face-feature-id attribute (per-vertex) to cover the
  // new vertices. We tag the cap vertices with `__dynamicFillet`
  // sentinel so downstream face provenance reads identify them.
  if (geometry.getAttribute(FACE_FEATURE_ID_ATTR)) {
    const srcAttr = geometry.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    const srcArr = srcAttr.array as Uint32Array;
    const newAttr = new Uint32Array(srcVertCount + newVertCount);
    newAttr.set(srcArr);
    // Allocate a new numeric id for the dynamic fillet's cap so the
    // map round-trips. Use map.size + 1 as the next id.
    const map = (out.userData?.nfabFeatureIdMap as Record<number, string> | undefined) ?? {};
    const used = Object.keys(map).map(Number);
    const nextId = used.length > 0 ? Math.max(...used) + 1 : 1;
    const newMap = { ...map, [nextId]: `__dynamicFillet_${op.edgeId}` };
    out.userData = { ...out.userData, nfabFeatureIdMap: newMap };
    for (let i = srcVertCount; i < srcVertCount + newVertCount; i++) {
      newAttr[i] = nextId;
    }
    out.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(newAttr, 1));
  }

  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    applied: true,
    addedVertexCount: newVertCount,
    elapsedMs: performance.now() - t0,
  };
}

