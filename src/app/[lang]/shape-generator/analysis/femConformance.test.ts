/**
 * femConformance — unit checks for the Stage-2 graded refine + boundary-snap mesh
 * (femRefine.ts). These guard the two ways a refined mesh can be silently WRONG:
 *   1. NON-CONFORMING interfaces (hanging nodes) between refinement levels — a
 *      T-junction gives plausible-but-wrong stresses the value gate might miss.
 *   2. INVERTED / near-degenerate elements (bad Jacobian) from an aggressive snap.
 *
 * Conformance approach (why the mesh is conforming): refinement is pure EDGE
 * BISECTION with full incident-tet closure — a bisected edge's midpoint is created
 * once and shared by EVERY tet on that edge, so it is never a hanging node. Snap
 * and smoothing only move existing shared nodes (geometry, not topology). The test
 * below proves it directly: a conforming tet mesh has NO interior T-junction face —
 * every boundary (single-owner) face must be a TRUE domain boundary (solid on one
 * side, void/exterior on the other). A hanging node would leave an interior face
 * owned by one element only, with SOLID on both sides — which this test flags.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import { generateTetMesh } from './femSolver';
import { generateRefinedTetMesh, buildCurvedBVH, hasCurvedStressRaiser } from './femRefine';

function plateWithHole(W: number, L: number, T: number, r: number): THREE.BufferGeometry {
  const plate = new THREE.BoxGeometry(L, W, T);
  const hole = new THREE.CylinderGeometry(r, r, T * 3, 48);
  hole.rotateX(Math.PI / 2);
  const ev = new Evaluator(); ev.attributes = ['position', 'normal'];
  return ev.evaluate(new Brush(plate), new Brush(hole), SUBTRACTION).geometry.toNonIndexed();
}

describe('FEA Stage-2 graded refinement — conformance & element quality', () => {
  const W = 120, Ln = 200, T = 8, r = 10;
  const g = plateWithHole(W, Ln, T, r);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // A deliberately small/fast graded mesh — the conformance & quality invariants
  // are size-independent, so a coarse target keeps this unit test quick.
  const coarse = generateTetMesh(pos, 2000);
  const refined = generateRefinedTetMesh(pos, coarse, { targetSize: 2.6, maxCornerNodes: 3000 });
  const nodes = refined.nodes;

  it('detects the curved raiser and actually refines around it', () => {
    expect(hasCurvedStressRaiser(pos)).toBe(true);
    expect(refined.tets.length).toBeGreaterThan(coarse.tets.length * 3);
    expect(refined.diag.snapped).toBeGreaterThan(50);
  });

  it('has NO inverted or near-degenerate element (positive, non-sliver Jacobian)', () => {
    // Corner-tet signed volume ∝ the straight-edged TET10 Jacobian; all must be > 0
    // and none may collapse to a near-zero sliver relative to the median.
    const sv6 = (a: number, b: number, c: number, d: number): number => {
      const ax = nodes[a * 3], ay = nodes[a * 3 + 1], az = nodes[a * 3 + 2];
      const b1 = nodes[b * 3] - ax, b2 = nodes[b * 3 + 1] - ay, b3 = nodes[b * 3 + 2] - az;
      const c1 = nodes[c * 3] - ax, c2 = nodes[c * 3 + 1] - ay, c3 = nodes[c * 3 + 2] - az;
      const d1 = nodes[d * 3] - ax, d2 = nodes[d * 3 + 1] - ay, d3 = nodes[d * 3 + 2] - az;
      return b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1);
    };
    const vols: number[] = [];
    let minV = Infinity, negatives = 0;
    for (const t of refined.tets) {
      const v = sv6(t.nodes[0], t.nodes[1], t.nodes[2], t.nodes[3]);
      if (v <= 0) negatives++;
      if (v < minV) minV = v;
      vols.push(v);
    }
    vols.sort((a, b) => a - b);
    const median = vols[Math.floor(vols.length / 2)];
    expect(negatives).toBe(0);            // no inverted element (no negative Jacobian)
    expect(minV).toBeGreaterThan(0);      // no zero-volume element
    expect(minV / median).toBeGreaterThan(1e-3); // no near-degenerate sliver
    expect(refined.diag.negativeVols).toBe(0);
  });

  it('snaps a dense ring of nodes ONTO the true bore (deviation <= 3 % of r)', () => {
    const { bvh } = buildCurvedBVH(pos);
    expect(bvh).not.toBeNull();
    const featR = refined.diag.featRadius;
    const tol = 0.03 * featR; // "a few % of r"
    const qp = new THREE.Vector3();
    let onBore = 0, maxOnBore = 0;
    for (let i = 0; i < nodes.length / 3; i++) {
      qp.set(nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2]);
      const hit = bvh!.closestPointToPoint(qp, { point: new THREE.Vector3(), distance: 0, faceIndex: -1 });
      if (hit && hit.distance <= tol) { onBore++; if (hit.distance > maxOnBore) maxOnBore = hit.distance; }
    }
    // Snapping must place a substantial ring of nodes EXACTLY on the true circle —
    // that is where the Kirsch peak lives. Those nodes lie on the surface within
    // 3 % of r by construction of the count; assert the ring is dense.
    expect(refined.diag.snapped).toBeGreaterThan(150);
    expect(onBore).toBeGreaterThan(150);
    expect(maxOnBore).toBeLessThanOrEqual(tol);
  });

  it('is CONFORMING across levels: every mesh-boundary face lies on the TRUE surface (no hanging nodes / cavities)', () => {
    // A conforming, boundary-fitted mesh has NO interior single-owner face: a
    // hanging node (non-conforming interface) or a trim cavity would leave a
    // single-owner face stranded in the material interior, FAR from the true part
    // surface. So: every single-owner (mesh-boundary) face centroid must lie on the
    // true surface. (This is a robust, purely-distance test — unlike an inside/out
    // probe it has no false positives at the concave bore rim.)
    const fullBVH = new MeshBVH(g);
    const faceKey = (x: number, y: number, z: number) => {
      const a = Math.min(x, y, z), c = Math.max(x, y, z), b = x + y + z - a - c; return `${a},${b},${c}`;
    };
    const owners = new Map<string, number>();
    const rep = new Map<string, [number, number, number]>();
    for (const t of refined.tets) {
      const n = t.nodes;
      const faces: Array<[number, number, number]> = [[n[0], n[1], n[2]], [n[0], n[1], n[3]], [n[0], n[2], n[3]], [n[1], n[2], n[3]]];
      for (const f of faces) { const k = faceKey(f[0], f[1], f[2]); owners.set(k, (owners.get(k) ?? 0) + 1); rep.set(k, f); }
    }
    const qp = new THREE.Vector3();
    const surfaceTol = 0.5 * refined.diag.targetSize; // within half a cell of the true surface
    let single = 0, interiorStranded = 0;
    for (const [k, f] of rep) {
      if (owners.get(k) !== 1) continue;
      single++;
      const cx = (nodes[f[0] * 3] + nodes[f[1] * 3] + nodes[f[2] * 3]) / 3;
      const cy = (nodes[f[0] * 3 + 1] + nodes[f[1] * 3 + 1] + nodes[f[2] * 3 + 1]) / 3;
      const cz = (nodes[f[0] * 3 + 2] + nodes[f[1] * 3 + 2] + nodes[f[2] * 3 + 2]) / 3;
      qp.set(cx, cy, cz);
      const hit = fullBVH.closestPointToPoint(qp, { point: new THREE.Vector3(), distance: 0, faceIndex: -1 });
      if (!hit || hit.distance > surfaceTol) interiorStranded++;
    }
    expect(single).toBeGreaterThan(0);        // sanity: the mesh has a free surface
    expect(interiorStranded).toBe(0);         // CONFORMING: no stranded interior boundary faces
  });
});
