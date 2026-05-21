/**
 * B-rep extrude (Phase 1) — occtExtrudeProfile produces a real replicad solid,
 * so a sketch extrude can START the B-rep chain. Verifies:
 *   - a box profile extrudes to the analytic volume + a non-null handle
 *   - an L-profile extrudes to the L volume, NOT its bounding box (proves it's
 *     a true B-rep solid, not the bbox illusion)
 *   - the returned handle chains into occtFilletBox (downstream fillet operates
 *     on the real solid)
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 (10 MB WASM init), like the sibling
 * OCCT tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  ensureOcctReady,
  resetShapeRegistry,
  occtExtrudeProfile,
  occtExtrudeCircle,
  occtExtrudeWithHoles,
  occtRevolveProfile,
  occtFilletBox,
  getShape,
} from '../features/occtEngine';
import { brepContourPoints } from '../sketch/extrudeProfile';
import type { SketchProfile } from '../sketch/types';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
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

describeMaybe('occtExtrudeProfile — B-rep chain start (Phase 1)', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  });

  it('extrudes a square profile to the analytic volume + returns a handle', () => {
    resetShapeRegistry();
    const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const r = occtExtrudeProfile(square, 10);
    expect(r.handle).toBeTruthy();
    expect(getShape(r.handle)).not.toBeNull();
    // 20 × 20 × 10 = 4000 mm³
    expect(meshVolume(r.geometry)).toBeGreaterThan(3900);
    expect(meshVolume(r.geometry)).toBeLessThan(4100);
  });

  it('extrudes an L-profile to the L volume — NOT its bounding box', () => {
    resetShapeRegistry();
    // L shape: 20×20 square minus the top-right 10×10 → area 300, vol 3000.
    // Its bounding box would extrude to 4000 — the discriminator.
    const lProfile = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 },
      { x: 10, y: 20 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const r = occtExtrudeProfile(lProfile, 10);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(2900);
    expect(vol).toBeLessThan(3100);          // true L volume
    expect(vol).toBeLessThan(3500);          // decisively NOT the 4000 bbox
  });

  it('B-rep cut: host extrude minus extruded tool = pocket volume (Phase 2)', () => {
    resetShapeRegistry();
    // Host 20×20×10 (4000) minus a 10×10×10 corner tool (1000) → 3000.
    const host = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 10);
    const tool = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 10);
    expect(host.handle).toBeTruthy();
    expect(tool.handle).toBeTruthy();
    const h = getShape(host.handle) as {
      cut: (o: unknown) => { mesh: (o?: { tolerance?: number; angularTolerance?: number }) => { vertices: number[]; triangles: number[]; normals: number[] } };
    };
    const cut = h.cut(getShape(tool.handle));
    const mesh = cut.mesh({ tolerance: 0.1, angularTolerance: 0.2 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(mesh.triangles, 1));
    const vol = meshVolume(g);
    expect(vol).toBeGreaterThan(2900);
    expect(vol).toBeLessThan(3100);
  });

  it('occtExtrudeWithHoles extrudes an outer contour minus inner holes', () => {
    resetShapeRegistry();
    // 50×30 plate (1500) minus one 10×10 hole (100) → area 1400, ×10 = 14000.
    const outer = [{ x: -25, y: -15 }, { x: 25, y: -15 }, { x: 25, y: 15 }, { x: -25, y: 15 }];
    const hole = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const r = occtExtrudeWithHoles(outer, [hole], 10);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(13800);
    expect(vol).toBeLessThan(14200);          // plate-minus-hole, not 15000
  });

  it('occtRevolveProfile revolves a profile 360° around Y into a solid of revolution', () => {
    resetShapeRegistry();
    // Rect radius 10→20, height 0→30, revolved about Y → tube.
    // Vol = π(20² − 10²)·30 = π·300·30 ≈ 28274 mm³.
    const profile = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 10, y: 30 }];
    const r = occtRevolveProfile(profile);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(27000);
    expect(vol).toBeLessThan(29500);
  });

  it('occtExtrudeCircle makes an exact cylinder of the analytic volume', () => {
    resetShapeRegistry();
    const r = occtExtrudeCircle(10, 0, 0, 5); // π·100·5 ≈ 1570.8 mm³
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(1500);
    expect(vol).toBeLessThan(1640);
  });

  it('brepContourPoints covers rect, skips circle + multi-contour (holes)', () => {
    // rect → 4 corner points (the common box/plate profile Phase 1 now reaches)
    const rect: SketchProfile = { closed: true, segments: [{ type: 'rect', points: [{ x: -10, y: -5 }, { x: 10, y: 5 }] }] };
    expect(brepContourPoints(rect)).toHaveLength(4);
    // single circle → null (handled by occtExtrudeCircle for an exact cylinder)
    const circle: SketchProfile = { closed: true, segments: [{ type: 'circle', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] }] };
    expect(brepContourPoints(circle)).toBeNull();
    // outer rect + circle hole → multi-contour → null (no single-contour B-rep)
    const withHole: SketchProfile = { closed: true, segments: [
      { type: 'rect', points: [{ x: -20, y: -20 }, { x: 20, y: 20 }] },
      { type: 'circle', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    ] };
    expect(brepContourPoints(withHole)).toBeNull();
  });

  it('the extrude handle chains into occtFilletBox (real downstream fillet)', () => {
    resetShapeRegistry();
    const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const ext = occtExtrudeProfile(square, 10);
    expect(ext.handle).toBeTruthy();
    // Chained host: occtFilletBox ignores the bbox arg and fillets the real
    // solid behind `ext.handle`. Rounding removes a little corner material.
    const filleted = occtFilletBox(
      { w: 20, h: 20, d: 10, cx: 0, cy: 0, cz: 0 },
      2,
      {},
      ext.handle,
    );
    expect(filleted.handle).toBeTruthy();
    const v = meshVolume(filleted.geometry);
    expect(v).toBeGreaterThan(3600);  // close to 4000…
    expect(v).toBeLessThan(4000);     // …but less, since fillet removed material
  });
});
