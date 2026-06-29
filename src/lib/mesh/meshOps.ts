'use client';

/**
 * Client-side mesh operations for the organic (B) track. Meshes from Meshy /
 * Replicate (or any imported GLB/STL) can't be edited parametrically like CSG,
 * so control happens here in the browser: scale, fit-to-size, sit-flat, recenter,
 * measure, and STL export. All operations are non-destructive (return a NEW
 * geometry) and dependency-free (three + three/addons, already in the bundle).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

/** Merge every mesh in an Object3D into one BufferGeometry (world-transformed). */
function mergeObject(obj: THREE.Object3D): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  obj.updateMatrixWorld(true);
  obj.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // strip attributes that don't merge cleanly; keep position + normal
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      }
      if (g.index) g.toNonIndexed && geos.push(g.toNonIndexed()); else geos.push(g);
    }
  });
  if (geos.length === 0) return new THREE.BufferGeometry();
  // simple concat of non-indexed position/normal buffers
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    let n = g.getAttribute('normal');
    if (!n) { g.computeVertexNormals(); n = g.getAttribute('normal'); }
    pos.set(p.array as Float32Array, o * 3);
    nrm.set(n.array as Float32Array, o * 3);
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

/** Load a GLB (ArrayBuffer or URL) into a single merged BufferGeometry. */
export async function loadGlb(src: ArrayBuffer | string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  const gltf = await (typeof src === 'string'
    ? loader.loadAsync(src)
    : new Promise<{ scene: THREE.Object3D }>((res, rej) => loader.parse(src, '', g => res(g), rej)));
  const geo = mergeObject(gltf.scene);
  geo.computeVertexNormals();
  return geo;
}

/** Bounding-box dimensions (model units, treated as mm). */
export function dims(geo: THREE.BufferGeometry): { x: number; y: number; z: number } {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
}

/** Non-destructive per-axis scale. */
export function scaleGeometry(geo: THREE.BufferGeometry, sx: number, sy = sx, sz = sx): THREE.BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
  g.computeVertexNormals();
  return g;
}

/** Uniformly scale so the LARGEST dimension equals targetMm. */
export function fitToSize(geo: THREE.BufferGeometry, targetMm: number): THREE.BufferGeometry {
  const d = dims(geo);
  const largest = Math.max(d.x, d.y, d.z) || 1;
  return scaleGeometry(geo, targetMm / largest);
}

/** Drop the model so its lowest point sits at z=0 (a printable base) and centre
 *  it over the origin in X/Y. */
export function groundAndCenter(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -b.min.z));
  return g;
}

/** Export a geometry to a binary STL Blob (ready for download / quote / print). */
export function geometryToStl(geo: THREE.BufferGeometry): Blob {
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  const out = new STLExporter().parse(mesh, { binary: true }) as unknown as DataView;
  return new Blob([out.buffer as ArrayBuffer], { type: 'model/stl' });
}

/** Rough triangle count (for size/printability hints). */
export function triCount(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}
