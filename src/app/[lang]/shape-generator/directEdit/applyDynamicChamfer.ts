/**
 * applyDynamicChamfer.ts — Wave 2 Phase 3 Track E2.
 *
 * Mesh-level dynamic chamfer on a picked edge. Same shape as
 * `applyDynamicFillet.ts`; the difference is the cap geometry:
 *
 *   - Fillet inserts a quarter-circle of FILLET_SEGMENTS+1 vertices.
 *   - Chamfer inserts a SINGLE flat bevel — two new boundary points
 *     per edge endpoint, connected by a single quad (2 triangles).
 *
 * Performance budget (ADR-012 §8): ≤ 30ms p95 per drag-end apply.
 *
 * Phase 4: B-Rep dynamic chamfer via worker — see
 * `TODO: B-Rep dynamic chamfer via worker — Phase 4` below.
 *
 * Spec ambiguity resolved: same as fillet — non-planar adjacent
 * faces (curved edges) fall back to no-op + console.warn. The chord
 * approximation considered in the spec is rejected for the same
 * reason (visible polygonal cross-sections on cylindrical edges
 * are worse UX than a clean refusal).
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
  validateDynamicChamfer,
  type Vec3,
} from './dynamicEdgeMath';

const EDGE_MATCH_TOLERANCE_MM = 1e-3;
const PLANARITY_THRESHOLD_RAD = 0.05;

export interface ApplyDynamicChamferContext {
  warn?: (msg: string) => void;
}

export interface ApplyDynamicChamferResult {
  geometry: THREE.BufferGeometry;
  applied: boolean;
  addedVertexCount: number;
  elapsedMs: number;
}

export function applyDynamicChamfer(
  geometry: THREE.BufferGeometry,
  op: Extract<DirectEditOp, { kind: 'dynamicChamfer' }>,
  ctx: ApplyDynamicChamferContext = {},
): ApplyDynamicChamferResult {
  const t0 = performance.now();
  const warn = ctx.warn ?? ((m: string) => console.warn(`[directEdit] ${m}`));

  const posAttr = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) {
    warn('applyDynamicChamfer: geometry has no position attribute — no-op');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const decoded = decodeEdgeId(op.edgeId);
  if (!decoded) {
    warn(`applyDynamicChamfer: malformed edgeId=${op.edgeId} — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const edgeLen = edgeLength(decoded.a, decoded.b);
  if (edgeLen < EDGE_MATCH_TOLERANCE_MM) {
    warn('applyDynamicChamfer: degenerate edge (zero length) — no-op');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const positions = posAttr.array as Float32Array;
  const indexAttr = geometry.index;
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const tol2 = EDGE_MATCH_TOLERANCE_MM * EDGE_MATCH_TOLERANCE_MM;

  const triHasEndpoints = (t: number): boolean => {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
    let hitA = false, hitB = false;
    for (const v of [i0, i1, i2]) {
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
    warn(`applyDynamicChamfer: no triangle incident to edgeId=${op.edgeId} — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const facesById = new Map<string, number[]>();
  let coarseCount = 0;
  for (const t of adjacentTris) {
    const fid = getFaceFeatureId(geometry, t) ?? `__coarse_${coarseCount++}`;
    const list = facesById.get(fid) ?? [];
    list.push(t);
    facesById.set(fid, list);
  }
  if (facesById.size < 2) {
    warn(`applyDynamicChamfer: edge has only 1 adjacent face (boundary) — no-op. B-Rep round-trip pending (Phase 4).`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const faceGroups = Array.from(facesById.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2);

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
    for (const tn of triNormals) {
      const dot = Math.max(-1, Math.min(1, tn[0] * unit[0] + tn[1] * unit[1] + tn[2] * unit[2]));
      if (Math.acos(dot) > PLANARITY_THRESHOLD_RAD) return null;
    }
    return unit;
  };

  const n0 = computeFaceNormal(faceGroups[0]![1]);
  const n1 = computeFaceNormal(faceGroups[1]![1]);
  if (!n0 || !n1) {
    // TODO: B-Rep dynamic chamfer via worker — Phase 4.
    warn('applyDynamicChamfer: adjacent faces are non-planar (curved edge?) — no-op. B-Rep round-trip pending (Phase 4).');
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  const edgeDir: Vec3 = [
    (decoded.b[0] - decoded.a[0]) / edgeLen,
    (decoded.b[1] - decoded.a[1]) / edgeLen,
    (decoded.b[2] - decoded.a[2]) / edgeLen,
  ];
  const buildPerp = (n: Vec3): Vec3 => {
    const px = n[1] * edgeDir[2] - n[2] * edgeDir[1];
    const py = n[2] * edgeDir[0] - n[0] * edgeDir[2];
    const pz = n[0] * edgeDir[1] - n[1] * edgeDir[0];
    const plen = Math.hypot(px, py, pz) || 1;
    return [px / plen, py / plen, pz / plen];
  };
  let perp0 = buildPerp(n0);
  let perp1 = buildPerp(n1);

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
        const refx = vx - edgeMid[0], refy = vy - edgeMid[1], refz = vz - edgeMid[2];
        const dot = refx * perp[0] + refy * perp[1] + refz * perp[2];
        return dot < 0 ? [-perp[0], -perp[1], -perp[2]] : perp;
      }
    }
    return perp;
  };
  perp0 = orientPerp(perp0, faceGroups[0]![1]);
  perp1 = orientPerp(perp1, faceGroups[1]![1]);

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

  const validation = validateDynamicChamfer(op.distanceMm, {
    edgeLengthMm: edgeLen,
    shortestAdjacentFaceExtentMm: shortestExtent,
  });
  if (!validation.ok) {
    warn(`applyDynamicChamfer: refused (${validation.reason}, distance=${op.distanceMm}mm) — no-op`);
    return { geometry, applied: false, addedVertexCount: 0, elapsedMs: performance.now() - t0 };
  }

  // Build cap (single quad strip): two boundary points per endpoint.
  const d = op.distanceMm;
  const capA0: Vec3 = [
    decoded.a[0] + d * perp0[0],
    decoded.a[1] + d * perp0[1],
    decoded.a[2] + d * perp0[2],
  ];
  const capA1: Vec3 = [
    decoded.a[0] + d * perp1[0],
    decoded.a[1] + d * perp1[1],
    decoded.a[2] + d * perp1[2],
  ];
  const capB0: Vec3 = [
    decoded.b[0] + d * perp0[0],
    decoded.b[1] + d * perp0[1],
    decoded.b[2] + d * perp0[2],
  ];
  const capB1: Vec3 = [
    decoded.b[0] + d * perp1[0],
    decoded.b[1] + d * perp1[1],
    decoded.b[2] + d * perp1[2],
  ];

  // Emit: 4 new vertices, 2 triangles forming the chamfer quad.
  const srcVertCount = posAttr.count;
  const newVerts: Vec3[] = [capA0, capA1, capB0, capB1];
  const outPositions = new Float32Array((srcVertCount + newVerts.length) * 3);
  outPositions.set(positions);
  for (let i = 0; i < newVerts.length; i++) {
    const base = (srcVertCount + i) * 3;
    outPositions[base] = newVerts[i]![0];
    outPositions[base + 1] = newVerts[i]![1];
    outPositions[base + 2] = newVerts[i]![2];
  }

  const srcIndices: number[] = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i++) srcIndices.push(indexAttr.getX(i));
  } else {
    for (let i = 0; i < posAttr.count; i++) srcIndices.push(i);
  }
  const A0 = srcVertCount;
  const A1 = srcVertCount + 1;
  const B0 = srcVertCount + 2;
  const B1 = srcVertCount + 3;
  const newIndices = [...srcIndices,
    A0, A1, B1,
    A0, B1, B0,
  ];

  const out = geometry.clone();
  out.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  out.setIndex(newIndices);

  if (geometry.getAttribute(FACE_FEATURE_ID_ATTR)) {
    const srcAttr = geometry.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
    const srcArr = srcAttr.array as Uint32Array;
    const newAttr = new Uint32Array(srcVertCount + newVerts.length);
    newAttr.set(srcArr);
    const map = (out.userData?.nfabFeatureIdMap as Record<number, string> | undefined) ?? {};
    const used = Object.keys(map).map(Number);
    const nextId = used.length > 0 ? Math.max(...used) + 1 : 1;
    const newMap = { ...map, [nextId]: `__dynamicChamfer_${op.edgeId}` };
    out.userData = { ...out.userData, nfabFeatureIdMap: newMap };
    for (let i = srcVertCount; i < srcVertCount + newVerts.length; i++) {
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
    addedVertexCount: newVerts.length,
    elapsedMs: performance.now() - t0,
  };
}
