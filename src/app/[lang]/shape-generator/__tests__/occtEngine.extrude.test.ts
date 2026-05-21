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
  occtLoftProfiles,
  occtSweepProfile,
  occtBaseSolid,
  occtFilletBox,
  getShape,
} from '../features/occtEngine';
import { brepContourPoints } from '../sketch/extrudeProfile';
import { buildEdgeFinderFromSelection } from '../features/topologyEdgeFinder';
import { sweepFeature } from '../features/sweep';
import type { SketchProfile } from '../sketch/types';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

function bboxOf(geo: THREE.BufferGeometry): { min: THREE.Vector3; max: THREE.Vector3 } {
  geo.computeBoundingBox();
  return { min: geo.boundingBox!.min.clone(), max: geo.boundingBox!.max.clone() };
}

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

  it('occtLoftProfiles blends two stacked squares into a frustum solid', () => {
    resetShapeRegistry();
    // 20×20 square at z=0 lofted to a 10×10 square at z=30 → square frustum.
    // V = (h/3)(A1 + A2 + √(A1·A2)) = (30/3)(400 + 100 + 200) = 7000 mm³.
    const big = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const small = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const r = occtLoftProfiles([{ points: big, z: 0 }, { points: small, z: 30 }]);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(6500);
    expect(vol).toBeLessThan(7500);
  });

  it('occtLoftProfiles stackAxis Y stacks along +Y (matches the mesh loft orientation)', () => {
    resetShapeRegistry();
    // Big 20×20 at the −50 end, small 10×10 at the +50 end → 100 mm tall frustum.
    const big = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const small = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const r = occtLoftProfiles([{ points: big, z: -50 }, { points: small, z: 50 }], {}, 'Y');
    expect(r.handle).toBeTruthy();
    const pos = r.geometry.attributes.position;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let cy = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      cy += y;
    }
    cy /= pos.count;
    // The 100 mm stack must run along Y (not Z): Y span ≈ 100, X/Z spans ≈ 20.
    expect(maxY - minY).toBeGreaterThan(95);
    expect(maxY - minY).toBeLessThan(105);
    expect(maxX - minX).toBeLessThan(25);
    expect(maxZ - minZ).toBeLessThan(25);
    // Big end at −Y → more cross-section there → vertex centroid biased to −Y.
    expect(cy).toBeLessThan(0);
  });

  it('occtSweepProfile sweeps a square along a straight path into a bar', () => {
    resetShapeRegistry();
    // 10×10 profile swept 50 mm along a straight Z path → 10×10×50 bar = 5000 mm³.
    const profile = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const path = [{ x: 0, y: 0 }, { x: 0, y: 50 }];
    const r = occtSweepProfile(profile, path, 'XZ');
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(4700);
    expect(vol).toBeLessThan(5300);
  });

  it('occtSweepProfile bbox matches the mesh sweepFeature (straight + arc paths)', () => {
    // The sweep feature switches to the B-rep builder in OCCT mode, so the OCCT
    // sweep must occupy the same space as the mesh sweep (orientation match).
    const box = new THREE.BoxGeometry(10, 10, 10); // → hw=hh=5 cross-section
    const tol = 2.0; // mm — faceted vs analytic + tessellation slack

    // Straight: rect swept 100 mm along +Z.
    resetShapeRegistry();
    const meshStraight = sweepFeature.apply(box, { pathType: 0, length: 100, arcAngle: 90, arcRadius: 60, helixPitch: 20, helixTurns: 3 }) as THREE.BufferGeometry;
    const profile = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const occtStraight = occtSweepProfile(profile, [{ x: 0, y: 0 }, { x: 0, y: 100 }], 'XZ');
    expect(occtStraight.handle).toBeTruthy();
    const mb = bboxOf(meshStraight), ob = bboxOf(occtStraight.geometry);
    expect(Math.abs(ob.min.x - mb.min.x)).toBeLessThan(tol);
    expect(Math.abs(ob.max.x - mb.max.x)).toBeLessThan(tol);
    expect(Math.abs(ob.min.y - mb.min.y)).toBeLessThan(tol);
    expect(Math.abs(ob.max.y - mb.max.y)).toBeLessThan(tol);
    expect(Math.abs(ob.min.z - mb.min.z)).toBeLessThan(tol);
    expect(Math.abs(ob.max.z - mb.max.z)).toBeLessThan(tol);

    // Arc: 90° arc, R=60 → end point (60, 0, 60), bbox roughly x∈[0,60] z∈[0,60].
    resetShapeRegistry();
    const meshArc = sweepFeature.apply(box, { pathType: 1, length: 100, arcAngle: 90, arcRadius: 60, helixPitch: 20, helixTurns: 3 }) as THREE.BufferGeometry;
    const arcPath: { x: number; y: number }[] = [];
    for (let i = 0; i <= 32; i++) { const a = (i / 32) * (Math.PI / 2); arcPath.push({ x: 60 * Math.sin(a), y: 60 * (1 - Math.cos(a)) }); }
    const occtArc = occtSweepProfile(profile, arcPath, 'XZ');
    expect(occtArc.handle).toBeTruthy();
    const ma = bboxOf(meshArc), oa = bboxOf(occtArc.geometry);
    // Looser tol for the arc: Frenet (mesh) vs OCCT sweep frames differ slightly.
    const arcTol = 6.0;
    expect(Math.abs((oa.max.x - oa.min.x) - (ma.max.x - ma.min.x))).toBeLessThan(arcTol);
    expect(Math.abs((oa.max.z - oa.min.z) - (ma.max.z - ma.min.z))).toBeLessThan(arcTol);
    expect(Math.abs((oa.max.y - oa.min.y) - (ma.max.y - ma.min.y))).toBeLessThan(arcTol);
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

  it('occtBaseSolid builds cylinder/sphere B-rep bases (so the chain can start from the base)', () => {
    resetShapeRegistry();
    // Cylinder Ø40 × h50 → π·20²·50 ≈ 62832 mm³.
    const cyl = occtBaseSolid('cylinder', { diameter: 40, height: 50 });
    expect(cyl.handle).toBeTruthy();
    expect(meshVolume(cyl.geometry)).toBeGreaterThan(61000);
    expect(meshVolume(cyl.geometry)).toBeLessThan(64500);
    // Sphere Ø30 → 4/3·π·15³ ≈ 14137 mm³.
    const sph = occtBaseSolid('sphere', { diameter: 30 });
    expect(sph.handle).toBeTruthy();
    expect(meshVolume(sph.geometry)).toBeGreaterThan(13000);
    expect(meshVolume(sph.geometry)).toBeLessThan(15200);
    // Box is intentionally unsupported (bbox fallback already correct).
    expect(occtBaseSolid('box', { width: 20, height: 20, depth: 20 }).handle).toBeNull();
    // Pipe Ø60/Ø40 × L100 → π(30²−20²)·100 ≈ 157080 mm³ (tube, not bbox).
    const pipe = occtBaseSolid('pipe', { outerDiameter: 60, innerDiameter: 40, length: 100 });
    expect(pipe.handle).toBeTruthy();
    expect(meshVolume(pipe.geometry)).toBeGreaterThan(150000);
    expect(meshVolume(pipe.geometry)).toBeLessThan(164000);
    // Torus major Ø80 (R40) / tube Ø20 (r10) → 2π²·R·r² ≈ 78957 mm³ (donut, not
    // the 80×80×20 = 128000 bbox). The 32-gon profile under-fills slightly.
    const torus = occtBaseSolid('torus', { majorDiameter: 80, tubeDiameter: 20 });
    expect(torus.handle).toBeTruthy();
    expect(meshVolume(torus.geometry)).toBeGreaterThan(73000);
    expect(meshVolume(torus.geometry)).toBeLessThan(81000);
    // Disk Ø80 × t8 → π·40²·8 ≈ 40212 mm³ (thin cylinder).
    const disk = occtBaseSolid('disk', { diameter: 80, thickness: 8 });
    expect(disk.handle).toBeTruthy();
    expect(meshVolume(disk.geometry)).toBeGreaterThan(38000);
    expect(meshVolume(disk.geometry)).toBeLessThan(42000);
    // Cone Ø50 base, apex (top Ø0), h80 → (1/3)π·25²·80 ≈ 52360 mm³.
    const cone = occtBaseSolid('cone', { bottomDiameter: 50, topDiameter: 0, height: 80 });
    expect(cone.handle).toBeTruthy();
    expect(meshVolume(cone.geometry)).toBeGreaterThan(48000);
    expect(meshVolume(cone.geometry)).toBeLessThan(54000);
    // Frustum Ø50→Ø30, h80 → (1/3)π·80·(25²+25·15+15²) ≈ 102625 mm³.
    const frustum = occtBaseSolid('cone', { bottomDiameter: 50, topDiameter: 30, height: 80 });
    expect(frustum.handle).toBeTruthy();
    expect(meshVolume(frustum.geometry)).toBeGreaterThan(97000);
    expect(meshVolume(frustum.geometry)).toBeLessThan(107000);
  });

  it('a cylinder base handle chains into occtFilletBox (rounds the real cylinder, not its bbox)', () => {
    resetShapeRegistry();
    const cyl = occtBaseSolid('cylinder', { diameter: 40, height: 50 });
    expect(cyl.handle).toBeTruthy();
    // Chained fillet on the real cylinder solid; bbox arg is ignored on the
    // chained path. Result stays near the cylinder volume (62832), proving it
    // rounded the cylinder — NOT the 40×50×40 = 80000 bounding box.
    const filleted = occtFilletBox({ w: 40, h: 50, d: 40, cx: 0, cy: 0, cz: 0 }, 3, {}, cyl.handle);
    expect(filleted.handle).toBeTruthy();
    const v = meshVolume(filleted.geometry);
    expect(v).toBeGreaterThan(55000);
    expect(v).toBeLessThan(63000);   // ~cylinder, decisively below 80000 bbox
  });

  it('an EdgeFinder fillets only the picked edge — selective, not all 12 edges', async () => {
    // Fillet every edge of a 20-cube (no finder) → material gone from 12 edges.
    resetShapeRegistry();
    const host = { w: 20, h: 20, d: 20, cx: 0, cy: 0, cz: 0 };
    const all = occtFilletBox(host, 2, {});
    const volAll = meshVolume(all.geometry);
    // Same box, but a finder pinned to ONE vertical edge. The makeBaseBox path
    // centers the cube then translates z by -d/2, so it spans z∈[-20,0]; the
    // x=10,y=10 edge runs the full 20 mm height (midpoint (10,10,-10)).
    resetShapeRegistry();
    const finder = await buildEdgeFinderFromSelection({
      type: 'edge', position: [10, 10, -10], length: 20, normal: [1, 0, 0],
    });
    expect(finder).not.toBeNull();
    const one = occtFilletBox(host, 2, {}, null, finder!);
    const volOne = meshVolume(one.geometry);
    // Both removed material (below the 8000 box) but the single-edge fillet
    // removed strictly less — proof the finder narrowed it to one edge.
    expect(volAll).toBeLessThan(7990);
    expect(volOne).toBeLessThan(8000);
    expect(volOne).toBeGreaterThan(volAll + 20);
  });

  it('a scale-aware EdgeFinder follows the edge after the part grows (topological survival)', async () => {
    // Click the x=+10, y=+10 vertical edge of a 20-cube (spans z∈[-20,0] from the
    // makeBaseBox+translate), capturing the part bbox + edge direction.
    const sel: EdgeSelectionInfo = {
      type: 'edge',
      position: [10, 10, -10],
      length: 20,
      normal: [1, 0, 0],
      direction: [0, 0, 1],
      bbox: { min: [-10, -10, -20], max: [10, 10, 0] },
    };
    // The part is then edited to a 40-cube. Re-resolve with the NEW bbox: the
    // click point must remap to (20, 20, -20) — the grown box's matching edge.
    const finder = await buildEdgeFinderFromSelection(sel, {
      currentBbox: { min: [-20, -20, -40], max: [20, 20, 0] },
    });
    expect(finder).not.toBeNull();

    const bigBox = { w: 40, h: 40, d: 40, cx: 0, cy: 0, cz: 0 };
    resetShapeRegistry();
    const one = occtFilletBox(bigBox, 2, {}, null, finder!);
    const volOne = meshVolume(one.geometry);
    resetShapeRegistry();
    const all = occtFilletBox(bigBox, 2, {});
    const volAll = meshVolume(all.geometry);
    // Rounded exactly one edge of the GROWN cube: below the 64000 solid, but
    // more material left than rounding all 12 edges → the finder tracked it.
    expect(volOne).toBeLessThan(64000);
    expect(volOne).toBeGreaterThan(volAll + 100);
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
