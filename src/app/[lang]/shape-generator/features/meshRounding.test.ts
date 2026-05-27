import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { tryMeshFillet, tryMeshChamfer, fitAxisAlignedBox } from './meshRounding';
import { meshVolume } from './roundingGuard';

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.computeVertexNormals();
  return g;
}

function triCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

/** Watertight = every undirected edge is shared by exactly 2 triangles, after
 *  welding coincident vertices (marching/procedural meshes split positions). */
function isWatertight(g: THREE.BufferGeometry): boolean {
  const pos = g.attributes.position;
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const vid = new Map<string, number>();
  const canon = (i: number) => { const k = key(i); let v = vid.get(k); if (v === undefined) { v = vid.size; vid.set(k, v); } return v; };
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.length / 3; t++) {
    const a = canon(idx[t * 3]!), b = canon(idx[t * 3 + 1]!), c = canon(idx[t * 3 + 2]!);
    if (a === b || b === c || c === a) continue; // skip degenerate (e.g. lathe pole) triangles
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const ek = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(ek, (edges.get(ek) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) if (count !== 2) return false;
  return true;
}

describe('fitAxisAlignedBox', () => {
  it('recognises a box as box-like', () => {
    expect(fitAxisAlignedBox(makeBox()).boxLike).toBe(true);
  });

  it('rejects a cylinder (bbox fill ≈ π/4)', () => {
    const cyl = new THREE.CylinderGeometry(15, 15, 50, 48);
    cyl.computeVertexNormals();
    expect(fitAxisAlignedBox(cyl).boxLike).toBe(false);
  });

  it('captures half-extents + centre', () => {
    const fit = fitAxisAlignedBox(makeBox(60, 40, 30));
    expect(fit.half.x).toBeCloseTo(30, 3);
    expect(fit.half.y).toBeCloseTo(20, 3);
    expect(fit.half.z).toBeCloseTo(15, 3);
  });
});

describe('tryMeshFillet', () => {
  it('rounds a box: removes material, adds triangles', () => {
    const r = tryMeshFillet(makeBox(), 4)!;
    expect(r).not.toBeNull();
    const vol = meshVolume(r);
     
    console.info(`[meshFillet] r=4 vol=${vol.toFixed(0)} tris=${triCount(r)}`);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(60 * 40 * 30);          // material removed at edges
    expect(vol).toBeGreaterThan(60 * 40 * 30 * 0.9); // but only at edges
    expect(triCount(r)).toBeGreaterThan(50);  // far more than the 12-tri box
  });

  it('larger radius removes more material', () => {
    const small = meshVolume(tryMeshFillet(makeBox(), 2)!);
    const large = meshVolume(tryMeshFillet(makeBox(), 7)!);
    expect(large).toBeLessThan(small);
  });

  it('produces a watertight, manifold mesh', () => {
    expect(isWatertight(tryMeshFillet(makeBox(60, 40, 30), 4)!)).toBe(true);
    expect(isWatertight(tryMeshFillet(makeBox(20, 20, 20), 5)!)).toBe(true);
  });

  it('returns null for a non-box / non-cylinder (sphere)', () => {
    const sph = new THREE.SphereGeometry(20, 24, 24);
    sph.computeVertexNormals();
    expect(tryMeshFillet(sph, 3)).toBeNull();
  });

  it('returns null for radius ≥ smallest half-extent', () => {
    expect(tryMeshFillet(makeBox(60, 40, 30), 15)).toBeNull(); // half.z = 15
  });

  it('preserves outer bounding box (within a cell)', () => {
    const r = tryMeshFillet(makeBox(60, 40, 30), 4)!;
    r.computeBoundingBox();
    const bb = r.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeGreaterThan(58);
    expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(60.5);
  });
});

describe('tryMeshChamfer', () => {
  it('bevels a box: removes material, clean low-poly mesh', () => {
    const r = tryMeshChamfer(makeBox(), 4)!;
    const vol = meshVolume(r);
     
    console.info(`[meshChamfer] d=4 vol=${vol.toFixed(0)} tris=${triCount(r)} watertight=${isWatertight(r)}`);
    expect(vol).toBeLessThan(60 * 40 * 30);
    expect(vol).toBeGreaterThan(60 * 40 * 30 * 0.9);
    // Procedural chamfer: 6 face rects + 12 bevels + 8 corner tris = 44 tris.
    expect(triCount(r)).toBeGreaterThan(40);
    expect(triCount(r)).toBeLessThan(60);
  });

  it('produces a watertight, manifold mesh', () => {
    expect(isWatertight(tryMeshChamfer(makeBox(60, 40, 30), 4)!)).toBe(true);
    expect(isWatertight(tryMeshChamfer(makeBox(20, 20, 20), 3)!)).toBe(true);
  });

  it('removes more material than fillet of the same size (square vs rounded corner)', () => {
    const fillet = meshVolume(tryMeshFillet(makeBox(), 5)!);
    const chamfer = meshVolume(tryMeshChamfer(makeBox(), 5)!);
    // A 45° chamfer cuts a triangular wedge; a fillet leaves a quarter-round —
    // the fillet retains more material, so chamfer volume ≤ fillet volume.
    expect(chamfer).toBeLessThanOrEqual(fillet + 1e-6);
  });

  it('returns null for a non-box', () => {
    const sph = new THREE.SphereGeometry(20, 24, 24);
    sph.computeVertexNormals();
    expect(tryMeshChamfer(sph, 3)).toBeNull();
  });
});

describe('cylinder rounding (lathe)', () => {
  // THREE.CylinderGeometry is along Y; radius 15, height 50 → half-height 25.
  function makeCyl(r = 15, h = 50): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r, r, h, 64);
    g.computeVertexNormals();
    return g;
  }
  const fullVol = Math.PI * 15 * 15 * 50; // ≈ 35343

  it('fillet rounds a cylinder: watertight, removes rim material', () => {
    const r = tryMeshFillet(makeCyl(), 4)!;
    expect(r).not.toBeNull();
    const vol = meshVolume(r);
     
    console.info(`[cylFillet] r=4 vol=${vol.toFixed(0)} full=${fullVol.toFixed(0)} watertight=${isWatertight(r)}`);
    expect(isWatertight(r)).toBe(true);
    expect(vol).toBeLessThan(fullVol);
    expect(vol).toBeGreaterThan(fullVol * 0.9);
  });

  it('chamfer bevels a cylinder: watertight, removes rim material', () => {
    const r = tryMeshChamfer(makeCyl(), 4)!;
    const vol = meshVolume(r);
     
    console.info(`[cylChamfer] d=4 vol=${vol.toFixed(0)} watertight=${isWatertight(r)}`);
    expect(isWatertight(r)).toBe(true);
    expect(vol).toBeLessThan(fullVol);
    expect(vol).toBeGreaterThan(fullVol * 0.9);
  });

  it('preserves the outer radius and height', () => {
    const r = tryMeshFillet(makeCyl(15, 50), 4)!;
    r.computeBoundingBox();
    const bb = r.boundingBox!;
    expect((bb.max.x - bb.min.x) / 2).toBeCloseTo(15, 0); // radius preserved
    expect((bb.max.y - bb.min.y) / 2).toBeCloseTo(25, 0); // half-height preserved
  });

  it('detects a cylinder along X too', () => {
    const g = new THREE.CylinderGeometry(15, 15, 50, 64);
    g.rotateZ(Math.PI / 2); // axis → X
    g.computeVertexNormals();
    expect(tryMeshFillet(g, 4)).not.toBeNull();
  });

  it('larger fillet removes more rim material', () => {
    const small = meshVolume(tryMeshFillet(makeCyl(), 2)!);
    const large = meshVolume(tryMeshFillet(makeCyl(), 6)!);
    expect(large).toBeLessThan(small);
  });
});
