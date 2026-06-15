/**
 * meshRoundingManifold — watertightness invariant for the shipped mesh rounding
 * (Track H, continuous hardening).
 *
 * The fuzz harness checks outputs are finite + non-empty; it does NOT check
 * topology. This property test pins the stronger bar the rounding ops must meet:
 * a chamfer / fillet of a box is a CLOSED MANIFOLD (watertight, every edge shared
 * by exactly two consistently-wound faces). It is exactly the gate a CSG-based
 * per-edge bevel failed (boundary edges) — keeping it here stops any future
 * regression to a non-watertight rounding implementation from shipping silently.
 *
 * Seeded PRNG over random box dimensions × distances; deterministic, headless.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tryMeshChamfer, tryMeshFillet } from './meshRounding';
import { analyzeTopology } from './meshTopology';

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeVertexNormals();
  return g;
}

function assertWatertight(g: THREE.BufferGeometry, ctx: string): void {
  const arr = g.attributes.position.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${ctx}: non-finite coord`);
  }
  const t = analyzeTopology(g);
  expect(t.boundaryEdgeCount, `${ctx}: ${t.boundaryEdgeCount} open boundary edges (not watertight)`).toBe(0);
  expect(t.windingFlipEdges.length, `${ctx}: ${t.windingFlipEdges.length} winding-flipped edges`).toBe(0);
  expect(t.isClosedManifold, `${ctx}: not a closed manifold`).toBe(true);
}

describe('mesh rounding watertightness invariant (Track H)', () => {
  it('chamfer + fillet of random boxes are always closed manifolds', () => {
    const rng = makeRng(0xBEEF);
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const w = 10 + rng() * 90;
      const h = 10 + rng() * 90;
      const d = 10 + rng() * 90;
      // distance below half the smallest extent (so the op is valid).
      const maxDist = Math.min(w, h, d) / 2;
      const dist = 0.5 + rng() * (maxDist - 1);

      const ch = tryMeshChamfer(box(w, h, d), dist);
      const fl = tryMeshFillet(box(w, h, d), dist);
      // Box-like inputs within range must produce geometry (not a null downgrade).
      expect(ch, `chamfer null for box ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)} d=${dist.toFixed(2)}`).toBeTruthy();
      expect(fl, `fillet null for box ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)} d=${dist.toFixed(2)}`).toBeTruthy();
      assertWatertight(ch!, `chamfer box ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)} d=${dist.toFixed(2)}`);
      assertWatertight(fl!, `fillet box ${w.toFixed(1)}×${h.toFixed(1)}×${d.toFixed(1)} d=${dist.toFixed(2)}`);
      checked++;
    }
    expect(checked).toBe(60);
  }, 60_000);
});
