/**
 * occtSurface.probe — Track S: surfacing on the OCCT kernel, verified against the
 * REAL replicad kernel. A filled surface must be a genuine B-rep face (a real
 * Geom surface type, exact tessellation) — not a tessellated approximation — and
 * kernel-backed lofted surfaces must participate in solid booleans.
 *
 * Gated by RUN_OCCT_FEASIBILITY=1 (10 MB WASM); runs in the occt-burnin job.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  ensureOcctReady, isOcctReady,
  occtFilledSurface, occtLoftProfiles, occtExtrudeProfile, occtBooleanSolids, occtKnitSolidFaces,
} from '../features/occtEngine';
import { meshVolume } from '../features/roundingGuard';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

describeMaybe('OCCT surfacing probe (Track S)', () => {
  beforeAll(async () => { await ensureOcctReady(); }, 60_000);

  it('the kernel is ready', () => { expect(isOcctReady()).toBe(true); });

  it('fills a curved 4-sided boundary into a REAL B-rep surface face', () => {
    // four boundary curves bulging in +Z → a non-planar (saddle-ish) patch.
    const boundary = [
      [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 3 }, { x: 10, y: 0, z: 0 }],   // bottom
      [{ x: 10, y: 0, z: 0 }, { x: 10, y: 5, z: 3 }, { x: 10, y: 10, z: 0 }], // right
      [{ x: 10, y: 10, z: 0 }, { x: 5, y: 10, z: 3 }, { x: 0, y: 10, z: 0 }], // top
      [{ x: 0, y: 10, z: 0 }, { x: 0, y: 5, z: 3 }, { x: 0, y: 0, z: 0 }],    // left
    ];
    const res = occtFilledSurface(boundary);

    expect(res.handle, 'a registry handle proves a real B-rep face was built').not.toBeNull();
    // A real kernel surface type — and NOT a plane, because the boundary is curved.
    expect(res.surfaceType).toBeTruthy();
    expect(res.surfaceType).not.toBe('PLANE');
    // Exact kernel tessellation: non-empty, all-finite, with real triangles.
    const pos = res.geometry.attributes.position;
    expect(pos.count).toBeGreaterThan(2);
    const arr = pos.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
    expect((res.geometry.index?.count ?? 0)).toBeGreaterThan(0);

    // The patch spans the boundary: its bbox covers the 10×10 footprint and the
    // +Z bulge, so it actually filled the curved boundary (not a degenerate sliver).
    res.geometry.computeBoundingBox();
    const bb = res.geometry.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeGreaterThan(8);
    expect(bb.max.y - bb.min.y).toBeGreaterThan(8);
    expect(bb.max.z - bb.min.z).toBeGreaterThan(1); // the curvature
  });

  it('a kernel-backed lofted surface yields a solid that BOOLEANS', () => {
    // loft two squares → a real B-rep prism solid.
    const sq = (s: number, z: number) => ({
      points: [{ x: -s, y: -s }, { x: s, y: -s }, { x: s, y: s }, { x: -s, y: s }, { x: -s, y: -s }],
      z,
    });
    const loft = occtLoftProfiles([sq(10, 0), sq(10, 20)]);
    expect(loft.handle).not.toBeNull();
    const loftVol = meshVolume(loft.geometry);
    expect(loftVol).toBeGreaterThan(0);

    // a smaller box solid as the boolean tool.
    const box = occtExtrudeProfile(
      [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }, { x: -5, y: -5 }],
      30,
    );
    expect(box.handle).not.toBeNull();

    // intersect: the lofted solid participates in a kernel boolean.
    const inter = occtBooleanSolids('intersect', loft.handle, box.handle);
    expect(inter.handle).not.toBeNull();
    const interVol = meshVolume(inter.geometry);
    expect(interVol).toBeGreaterThan(0);
    expect(interVol).toBeLessThan(loftVol); // the intersection removed material
  });

  it('KNITS faces into a watertight solid (sew round-trips by exact volume)', () => {
    // a real box B-rep → decompose to faces → sew them back into a solid.
    const box = occtExtrudeProfile(
      [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }],
      40,
    );
    expect(box.handle).not.toBeNull();

    const knit = occtKnitSolidFaces(box.handle);
    expect(knit.handle, 'a handle proves a watertight solid was sewn').not.toBeNull();
    expect(knit.faceCount).toBe(6);                 // a box has 6 faces
    // the sewn solid is exactly the original box: 20 × 20 × 40 = 16000.
    expect(knit.volume).not.toBeNull();
    expect(knit.volume!).toBeGreaterThan(16000 * 0.99);
    expect(knit.volume!).toBeLessThan(16000 * 1.01);
    expect(knit.geometry.attributes.position.count).toBeGreaterThan(0);
  });
});
