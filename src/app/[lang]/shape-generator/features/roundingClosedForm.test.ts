/**
 * roundingClosedForm — verifies the mesh fillet/chamfer REMOVE the right amount of
 * material, against the closed-form volume (the existing tests only check a loose 90–100%
 * range and watertightness). Confirms the radius/size is applied as true rounding geometry,
 * not a crude inflate-intersect approximation.
 *
 *   fillet (rounded box, radius r):  removed = (1−π/4)·r²·Σ(L_edge − 2r) + 8·r³·(1−π/6)
 *       (each of the 12 edges loses the corner-square-minus-quarter-disc cross-section;
 *        each of the 8 corners loses the cube-corner-minus-eighth-sphere)
 *   chamfer (45°, size d):           edge term = (d²/2)·Σ(L_edge − 2d), plus 8 corner pieces
 *       each bounded by d³ ⇒ removed ∈ [edge term, edge term + 8d³]
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tryMeshFillet, tryMeshChamfer } from './meshRounding';
import { meshVolume } from './roundingGuard';

const W = 60, H = 40, D = 30;
const V0 = W * H * D;            // 72000
const sumEdges = 4 * (W + H + D); // total edge length = 520
const box = () => new THREE.BoxGeometry(W, H, D);

describe('fillet/chamfer — removed volume vs closed form (verified)', () => {
  it('fillet removes the rounded-box closed-form volume (within faceting)', () => {
    for (const r of [3, 5]) {
      const out = tryMeshFillet(box(), r);
      expect(out).not.toBeNull();
      const removed = V0 - meshVolume(out!);
      const closed = (1 - Math.PI / 4) * r * r * (sumEdges - 24 * r) + 8 * r ** 3 * (1 - Math.PI / 6);
      expect(removed / closed).toBeGreaterThan(0.92); // faceted RoundedBox ⇒ ±~8%
      expect(removed / closed).toBeLessThan(1.08);
    }
  });

  it('chamfer removes the edge prisms plus corner pieces (closed-form bounds)', () => {
    for (const d of [3, 5]) {
      const out = tryMeshChamfer(box(), d);
      expect(out).not.toBeNull();
      const removed = V0 - meshVolume(out!);
      const edgeTerm = (d * d / 2) * (sumEdges - 24 * d);  // 12 prisms, shortened at corners
      expect(removed).toBeGreaterThan(edgeTerm * 0.95);    // ≥ the edge prisms
      expect(removed).toBeLessThan(edgeTerm + 8 * d ** 3); // + 8 corner pieces, each < d³
    }
  });

  it('a chamfer of size s removes more than a fillet of the same size', () => {
    const fil = meshVolume(tryMeshFillet(box(), 5)!);
    const cham = meshVolume(tryMeshChamfer(box(), 5)!);
    expect(cham).toBeLessThan(fil); // chamfer cuts the full corner; the fillet keeps the arc
  });

  it('removed volume grows roughly with the square of the radius', () => {
    const r3 = V0 - meshVolume(tryMeshFillet(box(), 3)!);
    const r6 = V0 - meshVolume(tryMeshFillet(box(), 6)!);
    expect(r6 / r3).toBeGreaterThan(3);  // between linear and quadratic (r² edge term dominates)
    expect(r6 / r3).toBeLessThan(4.2);   // (6/3)² = 4, minus the linear corrections
  });
});
