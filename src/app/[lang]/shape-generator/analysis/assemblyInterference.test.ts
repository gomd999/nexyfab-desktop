/**
 * assemblyInterference — geometry-coupled interference / clearance between two bodies,
 * verified against known box placements:
 *   separated:  no AABB overlap, no interference, clearance = the exact AABB gap
 *   overlapping: a vertex of one body is inside the other ⇒ interfering, clearance 0
 *   enclosed:   a small body inside a big one ⇒ all its vertices inside, interfering
 *   touching:   AABBs touch but no vertex strictly inside ⇒ not interfering (boundary)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { checkInterference } from './assemblyInterference';

const A = () => new THREE.BoxGeometry(20, 20, 20); // spans ±10
const B = () => new THREE.BoxGeometry(8, 8, 8);    // spans ±4

describe('assemblyInterference — clearance / interference (verified)', () => {
  it('reports clearance for two separated bodies', () => {
    const r = checkInterference(A(), B(), [0, 0, 0], [30, 0, 0]); // A maxX=10, B minX=26
    expect(r.interfering).toBe(false);
    expect(r.aabbOverlap).toBe(false);
    expect(r.minClearance).toBeCloseTo(16, 6);          // 26 − 10
    // clearance scales with separation
    const r2 = checkInterference(A(), B(), [0, 0, 0], [40, 0, 0]);
    expect(r2.minClearance).toBeCloseTo(26, 6);         // 36 − 10
  });

  it('detects partial overlap (corner penetration)', () => {
    const r = checkInterference(A(), B(), [0, 0, 0], [8, 0, 0]); // B x∈[4,12]
    expect(r.interfering).toBe(true);
    expect(r.verticesBInsideA).toBeGreaterThan(0);      // the x=4 corners are inside A
    expect(r.minClearance).toBe(0);
  });

  it('detects a fully-enclosed body', () => {
    const r = checkInterference(A(), B(), [0, 0, 0], [0, 0, 0]); // B centred inside A
    expect(r.interfering).toBe(true);
    expect(r.verticesBInsideA).toBe(8);                 // all 8 corners of the inner box
  });

  it('treats just-touching faces as a non-interfering boundary', () => {
    // A maxX=10; place B so its minX=10 (faces flush)
    const r = checkInterference(A(), B(), [0, 0, 0], [14, 0, 0]); // B x∈[10,18]
    expect(r.aabbOverlap).toBe(true);                   // AABBs touch
    expect(r.interfering).toBe(false);                  // no vertex strictly inside
    expect(r.minClearance).toBe(0);
  });

  it('is symmetric in the two bodies', () => {
    const ab = checkInterference(A(), B(), [0, 0, 0], [8, 0, 0]);
    const ba = checkInterference(B(), A(), [8, 0, 0], [0, 0, 0]);
    expect(ba.interfering).toBe(ab.interfering);
    expect(ba.verticesAInsideB).toBe(ab.verticesBInsideA); // roles swap
  });
});
