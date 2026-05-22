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
  occtSweepHelix,
  occtBaseSolid,
  occtFilletBox,
  occtEdgeSignatures,
  occtFaceSignatures,
  occtExtrudeProfileOnFrame,
  occtExtrudeCircleOnFrame,
  occtRevolveProfileOnFrame,
  occtShellBox,
  occtLinearPattern,
  occtCircularPattern,
  occtMirror,
  occtBoxBooleanWithPrimitive,
  exportOcctStep,
  getShape,
} from '../features/occtEngine';
import { brepContourPoints } from '../sketch/extrudeProfile';
import { buildEdgeFinderFromSelection, buildEdgeFinderBySignature, buildFaceFinderBySignature } from '../features/topologyEdgeFinder';
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

  it('occtSweepHelix bbox spans match the mesh helix sweep', () => {
    // Helix B-rep is the path occtSweepProfile can't reach (true 3D spine).
    const box = new THREE.BoxGeometry(10, 10, 10); // hw=hh=5
    const meshHelix = sweepFeature.apply(box, { pathType: 2, length: 100, arcAngle: 90, arcRadius: 60, helixPitch: 20, helixTurns: 3 }) as THREE.BufferGeometry;
    const profile = [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }];
    const helixR = 5 * 1.5 + 20; // matches sweep.ts: max(hw,hh)*1.5 + 20
    resetShapeRegistry();
    const occt = occtSweepHelix(profile, 20, 3 * 20, helixR);
    expect(occt.handle).toBeTruthy();
    const mb = bboxOf(meshHelix), ob = bboxOf(occt.geometry);
    const span = (b: { min: THREE.Vector3; max: THREE.Vector3 }, ax: 'x' | 'y' | 'z') => b.max[ax] - b.min[ax];
    const tol = 10.0; // Frenet (mesh) vs OCCT helix frames differ; compare spans
    expect(Math.abs(span(ob, 'x') - span(mb, 'x'))).toBeLessThan(tol);
    expect(Math.abs(span(ob, 'y') - span(mb, 'y'))).toBeLessThan(tol);
    expect(Math.abs(span(ob, 'z') - span(mb, 'z'))).toBeLessThan(tol);
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
    // Washer Ø24 outer / Ø11 inner × t2.5 → π(12²−5.5²)·2.5 ≈ 893 mm³ (annular
    // ring along +Z, centred — fillet on the real ring, not its bbox cube).
    const washer = occtBaseSolid('washer', { outerDia: 24, innerDia: 11, thickness: 2.5 });
    expect(washer.handle).toBeTruthy();
    expect(meshVolume(washer.geometry)).toBeGreaterThan(820);
    expect(meshVolume(washer.geometry)).toBeLessThan(960);
    const wb = washer.geometry; wb.computeBoundingBox();
    expect(wb.boundingBox!.max.z - wb.boundingBox!.min.z).toBeLessThan(2.7); // thickness along Z
    expect(wb.boundingBox!.max.x - wb.boundingBox!.min.x).toBeGreaterThan(23); // Ø24 across
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

  it('occtEdgeSignatures enumerates a box (12 edges) and a signature finder rounds the matched edge', async () => {
    resetShapeRegistry();
    // 20×20×20 box B-rep (spans x,y,z ∈ [0,20]) with a registry handle.
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    expect(box.handle).toBeTruthy();
    const sigs = occtEdgeSignatures(box.handle);
    expect(sigs.length).toBe(12); // a box has exactly 12 edges

    // Target a vertical (±Z) edge; build a finder by matching its signature.
    const vert = sigs.find(s => Math.abs(s.dir[2]) > 0.99);
    expect(vert).toBeTruthy();
    const sel = {
      type: 'edge' as const,
      position: vert!.mid,
      length: vert!.length,
      normal: [1, 0, 0] as [number, number, number],
      direction: [0, 0, 1] as [number, number, number],
    };
    const finder = await buildEdgeFinderBySignature(sel, sigs);
    expect(finder).not.toBeNull();

    // Fillet the box (chained on its handle) with the matched finder → one edge.
    const host = { w: 20, h: 20, d: 20, cx: 0, cy: 0, cz: 0 };
    const one = occtFilletBox(host, 2, {}, box.handle, finder!);
    const volOne = meshVolume(one.geometry);
    resetShapeRegistry();
    const box2 = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    const all = occtFilletBox(host, 2, {}, box2.handle);
    const volAll = meshVolume(all.geometry);
    expect(volOne).toBeLessThan(8000);            // the matched edge WAS rounded
    expect(volOne).toBeGreaterThan(volAll + 20);  // …but only one, not all 12
  });

  it('occtFaceSignatures enumerates a box (6 faces) with 6 distinct outward normals', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    expect(box.handle).toBeTruthy();
    const faces = occtFaceSignatures(box.handle);
    expect(faces.length).toBe(6); // a box has exactly 6 faces
    // The 6 normals must cover the 6 axis directions (±X, ±Y, ±Z) — i.e. each
    // dominant-axis/sign combination appears once, confirming signed outward normals.
    const keys = new Set(faces.map(f => {
      const ax = [Math.abs(f.normal[0]), Math.abs(f.normal[1]), Math.abs(f.normal[2])];
      const dom = ax.indexOf(Math.max(...ax));
      return `${dom}${f.normal[dom] >= 0 ? '+' : '-'}`;
    }));
    expect(keys.size).toBe(6);
  });

  it('occtExtrudeProfileOnFrame (sketch-on-face): identity frame equals an XY extrude', () => {
    resetShapeRegistry();
    const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const r = occtExtrudeProfileOnFrame(square, 10, {
      origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1],
    });
    expect(r.handle).toBeTruthy();
    expect(meshVolume(r.geometry)).toBeGreaterThan(3900);
    expect(meshVolume(r.geometry)).toBeLessThan(4100); // 20×20×10
    const b = bboxOf(r.geometry);
    expect(Math.abs(b.min.z - 0)).toBeLessThan(0.5);   // extruded +Z from the plane
    expect(Math.abs(b.max.z - 10)).toBeLessThan(0.5);
  });

  it('occtExtrudeCircleOnFrame makes a cylinder boss on a face (along its normal)', () => {
    resetShapeRegistry();
    // Ø20 circle on a +Y-normal face, extruded 10 → cylinder grows along +Y.
    // Volume π·10²·10 ≈ 3141.6; the axis is +Y so the Y span ≈ 10.
    const r = occtExtrudeCircleOnFrame(10, 0, 0, 10, {
      origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1], normal: [0, 1, 0],
    });
    expect(r.handle).toBeTruthy();
    expect(meshVolume(r.geometry)).toBeGreaterThan(3000);
    expect(meshVolume(r.geometry)).toBeLessThan(3300);
    const b = bboxOf(r.geometry);
    expect(Math.abs(b.min.y - 0)).toBeLessThan(0.5);
    expect(Math.abs(b.max.y - 10)).toBeLessThan(0.5);
  });

  it('occtRevolveProfileOnFrame: identity frame matches the global Y-axis revolve', () => {
    resetShapeRegistry();
    // Same tube profile as the global revolve test: radius 10→20, height 0→30.
    // On an identity frame (v-axis = Y) it must revolve to the same ~28274 mm³.
    const profile = [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 10, y: 30 }];
    const r = occtRevolveProfileOnFrame(profile, {
      origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1],
    });
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(27000);
    expect(vol).toBeLessThan(29500);
  });

  it('occtExtrudeProfileOnFrame extrudes along a +Y face normal (tilted frame)', () => {
    resetShapeRegistry();
    // Face whose outward normal is +Y: the boss should grow in +Y, not +Z.
    const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
    const r = occtExtrudeProfileOnFrame(square, 10, {
      origin: [0, 0, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1], normal: [0, 1, 0],
    });
    expect(r.handle).toBeTruthy();
    expect(meshVolume(r.geometry)).toBeGreaterThan(3900);
    expect(meshVolume(r.geometry)).toBeLessThan(4100);
    const b = bboxOf(r.geometry);
    expect(Math.abs(b.min.y - 0)).toBeLessThan(0.5);   // extruded along +Y
    expect(Math.abs(b.max.y - 10)).toBeLessThan(0.5);
  });

  it('occtShellBox removes a signature-matched face (shell open on the picked face)', async () => {
    resetShapeRegistry();
    // 20-cube (x,y,z ∈ [0,20]) with a handle.
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    expect(box.handle).toBeTruthy();
    const faces = occtFaceSignatures(box.handle);
    // Pick the +Z (top) face and build a FaceFinder by matching its signature.
    const top = faces.find(f => f.normal[2] > 0.9);
    expect(top).toBeTruthy();
    const finder = await buildFaceFinderBySignature({ position: top!.center, normal: [0, 0, 1] }, faces);
    expect(finder).not.toBeNull();
    // Shell the box, opening exactly the matched top face.
    const shelled = occtShellBox({ w: 20, h: 20, d: 20, cx: 10, cy: 10, cz: 20 }, 2, 0, {}, box.handle, finder);
    expect(shelled.handle).toBeTruthy();
    const vol = meshVolume(shelled.geometry);
    expect(vol).toBeLessThan(8000);    // hollowed out (less than the solid cube)
    expect(vol).toBeGreaterThan(1000); // …but a real 2 mm shell remains
  });

  it('occtLinearPattern fuses N translated copies into one B-rep solid', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    // 3 disjoint 20-cubes (8000 each) spaced 60 along X → 24000 mm³, one handle.
    const r = occtLinearPattern(box.handle, 0, 3, 60);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(23000);
    expect(vol).toBeLessThan(25000);
  });

  it('occtCircularPattern fuses copies rotated about an axis', () => {
    resetShapeRegistry();
    // Cube offset from the Y axis (x ∈ [50,70]) so the 4 copies stay disjoint.
    const box = occtExtrudeProfile([{ x: 50, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 20 }, { x: 50, y: 20 }], 20);
    const r = occtCircularPattern(box.handle, 1, 4, 360); // 4 about +Y, 90° apart
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(30000);  // ~4 × 8000
    expect(vol).toBeLessThan(34000);
  });

  it('occtMirror fuses a solid with its reflection', () => {
    resetShapeRegistry();
    const box = occtExtrudeProfile([{ x: 5, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 20 }, { x: 5, y: 20 }], 20);
    // Box at x ∈ [5,25] mirrored across YZ → copy at x ∈ [−25,−5], disjoint → 16000.
    const r = occtMirror(box.handle, 0);
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    expect(vol).toBeGreaterThan(15000);
    expect(vol).toBeLessThan(17000);
  });

  it('exportOcctStep emits a TRUE B-rep STEP from a handle (not a tessellation)', async () => {
    resetShapeRegistry();
    // A linear-pattern solid (one of this session's new B-rep handles).
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 20);
    const pat = occtLinearPattern(box.handle, 0, 2, 60);
    expect(pat.handle).toBeTruthy();
    const step = await exportOcctStep(pat.handle);
    expect(step).toBeTruthy();
    expect(step!.length).toBeGreaterThan(500);
    // ISO-10303 (STEP) header + parametric B-rep solid entities — NOT the
    // faceted TRIANGULATED_FACE form that breaks in external CAD viewers.
    expect(step).toContain('ISO-10303');
    expect(step).toMatch(/MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CLOSED_SHELL/);
    expect(step).not.toContain('TRIANGULATED_FACE');
  });

  it('occtBoxBooleanWithPrimitive cone tool cuts a countersink B-rep (handle preserved)', () => {
    resetShapeRegistry();
    // 40-cube host (x,y,z ∈ [0,40], 64000 mm³) with a handle.
    const box = occtExtrudeProfile([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }], 40);
    expect(box.handle).toBeTruthy();
    // Subtract a cone (base Ø20, depth 10) centred on the +Y top face.
    const r = occtBoxBooleanWithPrimitive(
      'subtract',
      { w: 40, h: 40, d: 40, cx: 20, cy: 20, cz: 20 },
      { shape: 'cone', w: 20, h: 10, d: 20, cx: 20, cy: 40, cz: 20, rx: 0, ry: 0, rz: 0 },
      undefined,
      box.handle,
    );
    expect(r.handle).toBeTruthy();
    const vol = meshVolume(r.geometry);
    // Cone removed only a little material → just under the 64000 cube.
    expect(vol).toBeLessThan(64000);
    expect(vol).toBeGreaterThan(63000);
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
