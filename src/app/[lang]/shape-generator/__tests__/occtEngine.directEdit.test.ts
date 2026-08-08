/**
 * Direct editing Phase 1 — occtDeleteFaces (sew-and-cap defeaturing) and
 * occtOffsetFace (planar prism rebuild) against closed-form volume identities.
 *
 * Roadmap acceptance (solidworks-parity-roadmap Phase 1): remove a boss face
 * set from an IMPORTED solid (STEP round-trip through replicad's importSTEP —
 * the same kernel path a user upload takes) and offset a wall by an exact
 * amount, both as real B-rep.
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 (10 MB WASM init), like the sibling
 * OCCT suites.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  ensureOcctReady,
  resetShapeRegistry,
  registerShape,
  exportOcctStep,
  occtExtrudeProfile,
  occtExtrudeCircle,
  occtBooleanSolids,
  occtBaseSolid,
  occtDeleteFaces,
  occtOffsetFace,
  meshToSimplifiedBrepHandle,
} from '../features/occtEngine';

// W1-A (R0-0): default ON. This suite is the OCCT kernel's real-behaviour gate;
// leaving it opt-IN meant it never ran in CI. Measured cost of enabling: ~18s
// wall across the whole __tests__ dir. Set RUN_OCCT_FEASIBILITY=0 to opt out.
const ENABLED = process.env.RUN_OCCT_FEASIBILITY !== '0';
const describeMaybe = ENABLED ? describe : describe.skip;

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) return 0;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

/** Centered square profile, side s. */
const sq = (s: number) => [
  { x: -s / 2, y: -s / 2 },
  { x: s / 2, y: -s / 2 },
  { x: s / 2, y: s / 2 },
  { x: -s / 2, y: s / 2 },
];

type V3 = [number, number, number];
const sel = (position: V3, normal: V3) => ({ position, normal });

describeMaybe('occtDeleteFaces — sew-and-cap defeaturing', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 180_000);

  it('removes a 5-face boss set from a STEP round-trip IMPORTED solid (volume 16800 → 16000)', async () => {
    resetShapeRegistry();
    // Base 40×40×10 (z 0..10) + boss 10×10×8 on top (z 10..18).
    const base = occtExtrudeProfile(sq(40), 10, {}, 5); // z 0..10 (중심대칭 정렬 후 offset=+d/2)
    const boss = occtExtrudeProfile(sq(10), 8, {}, 14); // z 10..18
    const fused = occtBooleanSolids('union', base.handle, boss.handle);
    expect(fused.handle).toBeTruthy();
    expect(meshVolume(fused.geometry)).toBeCloseTo(16800, -1);

    // STEP round-trip = "imported solid" (same kernel path as a user upload).
    const stepText = await exportOcctStep(fused.handle);
    expect(stepText).toBeTruthy();
    const { importSTEP } = await import('replicad');
    const imported = await importSTEP(new Blob([stepText!]));
    const handle = registerShape(imported);

    const r = occtDeleteFaces(handle, [
      sel([0, 0, 18], [0, 0, 1]),    // boss top
      sel([5, 0, 14], [1, 0, 0]),    // boss +X wall
      sel([-5, 0, 14], [-1, 0, 0]),  // boss −X wall
      sel([0, 5, 14], [0, 1, 0]),    // boss +Y wall
      sel([0, -5, 14], [0, -1, 0]),  // boss −Y wall
    ]);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(Math.abs(vol - 16000)).toBeLessThan(16000 * 0.01);
    // Healed flat: nothing above z = 10 anymore.
    r.geometry.computeBoundingBox();
    expect(r.geometry.boundingBox!.max.z).toBeLessThan(10.5);
  });

  it('removes a through-hole with ONE wall-face pick (both end loops capped) — volume restored', () => {
    resetShapeRegistry();
    // 30×30×10 plate (z 0..10) − Ø8 hole through.
    const plate = occtExtrudeProfile(sq(30), 10, {}, 5); // z 0..10
    const drill = occtExtrudeCircle(4, 0, 0, 12, {}, 5); // z −1..11 (관통)
    const holed = occtBooleanSolids('subtract', plate.handle, drill.handle);
    expect(meshVolume(holed.geometry)).toBeCloseTo(9000 - Math.PI * 16 * 10, -1);

    const r = occtDeleteFaces(holed.handle, [
      // Click on the cylindrical wall (outward solid normal points to the axis).
      sel([4, 0, 5], [-1, 0, 0]),
    ]);
    expect(r.handle).toBeTruthy();
    expect(Math.abs(meshVolume(r.geometry) - 9000)).toBeLessThan(9000 * 0.01);
  });

  it('refuses to delete a plain box face (opening is not an interior loop)', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile(sq(20), 20, {}, 10); // z 0..20
    expect(() => occtDeleteFaces(box.handle, [sel([0, 0, 20], [0, 0, 1])]))
      .toThrow(/interior loop|open boundary/);
  });

  it('refuses an incomplete boss face set (walls without the top)', () => {
    resetShapeRegistry();
    const base = occtExtrudeProfile(sq(40), 10, {}, 5); // z 0..10 (중심대칭 정렬 후 offset=+d/2)
    const boss = occtExtrudeProfile(sq(10), 8, {}, 14); // z 10..18
    const fused = occtBooleanSolids('union', base.handle, boss.handle);
    expect(() => occtDeleteFaces(fused.handle, [
      sel([5, 0, 14], [1, 0, 0]),
      sel([-5, 0, 14], [-1, 0, 0]),
      sel([0, 5, 14], [0, 1, 0]),
      sel([0, -5, 14], [0, -1, 0]),
    ])).toThrow(/open boundary/);
  });

  it('mesh→B-rep bridge: deletes a boss from a TESSELLATED import (BoxGeometry merge path)', async () => {
    resetShapeRegistry();
    // Simulate an imported mesh: tessellate the fused B-rep, then bridge back
    // through importSTL + UnifySameDomain.
    const base = occtExtrudeProfile(sq(40), 10, {}, 5); // z 0..10 (중심대칭 정렬 후 offset=+d/2)
    const boss = occtExtrudeProfile(sq(10), 8, {}, 14); // z 10..18
    const fused = occtBooleanSolids('union', base.handle, boss.handle);
    const meshHandle = await meshToSimplifiedBrepHandle(fused.geometry);
    expect(meshHandle).toBeTruthy();
    const r = occtDeleteFaces(meshHandle!, [
      sel([0, 0, 18], [0, 0, 1]),
      sel([5, 0, 14], [1, 0, 0]),
      sel([-5, 0, 14], [-1, 0, 0]),
      sel([0, 5, 14], [0, 1, 0]),
      sel([0, -5, 14], [0, -1, 0]),
    ]);
    expect(r.handle).toBeTruthy();
    expect(Math.abs(meshVolume(r.geometry) - 16000)).toBeLessThan(16000 * 0.015);
  }, 60_000);
});

describeMaybe('occtOffsetFace — planar prism rebuild', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 180_000);

  it('outward +5 on the top of a 20³ box → V = 20×20×25 (ΔV = area×d exactly)', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile(sq(20), 20, {}, 10); // z 0..20, V = 8000
    const r = occtOffsetFace(box.handle, sel([0, 0, 20], [0, 0, 1]), 5);
    expect(r.handle).toBeTruthy();
    expect(Math.abs(meshVolume(r.geometry) - 10000)).toBeLessThan(10000 * 0.005);
    r.geometry.computeBoundingBox();
    expect(r.geometry.boundingBox!.max.z).toBeCloseTo(25, 1);
  });

  it('inward −5 on a side wall → V = 15×20×20 (1 mm wall offset acceptance case scaled)', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile(sq(20), 20, {}, 10); // z 0..20
    const r = occtOffsetFace(box.handle, sel([10, 0, 10], [1, 0, 0]), -5);
    expect(r.handle).toBeTruthy();
    expect(Math.abs(meshVolume(r.geometry) - 6000)).toBeLessThan(6000 * 0.005);
  });

  it('roadmap acceptance: 1 mm wall offset on an imported (STEP round-trip) solid', async () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile(sq(20), 20, {}, 10); // z 0..20
    const stepText = await exportOcctStep(box.handle);
    const { importSTEP } = await import('replicad');
    const imported = await importSTEP(new Blob([stepText!]));
    const handle = registerShape(imported);
    const r = occtOffsetFace(handle, sel([10, 0, 10], [1, 0, 0]), 1);
    expect(r.handle).toBeTruthy();
    // 21 × 20 × 20 = 8400
    expect(Math.abs(meshVolume(r.geometry) - 8400)).toBeLessThan(8400 * 0.005);
  });

  it('refuses non-planar faces (cylinder side wall)', () => {
    resetShapeRegistry();
    const cyl = occtBaseSolid('cylinder', { diameter: 20, height: 20 });
    expect(cyl.handle).toBeTruthy();
    expect(() => occtOffsetFace(cyl.handle, sel([10, 0, 0], [1, 0, 0]), 2))
      .toThrow(/planar/);
  });

  it('refuses an inward offset that consumes the whole body', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile(sq(20), 20, {}, 10); // z 0..20
    expect(() => occtOffsetFace(box.handle, sel([0, 0, 20], [0, 0, 1]), -30))
      .toThrow(/consumed the entire body|empty/);
  });
});
