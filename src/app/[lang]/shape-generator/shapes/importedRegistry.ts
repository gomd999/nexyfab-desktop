/**
 * importedRegistry — bridge from imported mesh geometry (STL/STEP) to the
 * parametric part system.
 *
 * A PlacedPart references its geometry by `shapeId`, which is normally a
 * catalog key (box, cylinder, …). Imported meshes have no catalog entry, so we
 * register their BufferGeometry here under a synthetic `imported:<n>` id. Then
 * buildShapeResult() resolves that id back to the stored geometry — and from
 * that point an imported mesh behaves like any catalog part: it can be placed,
 * mated, balanced, and simulated.
 *
 * Keep this module dependency-light (THREE only) so shapes/index.ts can import
 * it without a cycle.
 */
import * as THREE from 'three';

const PREFIX = 'imported:';
const REGISTRY = new Map<string, THREE.BufferGeometry>();
let counter = 0;

export function isImportedShapeId(shapeId: string): boolean {
  return shapeId.startsWith(PREFIX);
}

/** Register an imported geometry and return its synthetic shapeId. The
 *  geometry is stored as-is (non-indexed triangle soup is fine). */
export function registerImportedGeometry(geo: THREE.BufferGeometry, name?: string): string {
  const id = `${PREFIX}${counter++}${name ? ':' + name.replace(/[^a-zA-Z0-9_-]/g, '') : ''}`;
  REGISTRY.set(id, geo);
  return id;
}

export function getImportedGeometry(shapeId: string): THREE.BufferGeometry | undefined {
  return REGISTRY.get(shapeId);
}

/** Test/cleanup hook. */
export function clearImportedRegistry(): void {
  REGISTRY.clear();
  counter = 0;
}

/** Signed mesh volume (mm³) via the divergence theorem — works on the
 *  non-indexed soup an imported mesh usually is. */
export function meshVolumeMm3(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(v);
}

/** Volumetric centroid (centre of mass of a uniform-density solid), in the
 *  geometry's local frame (mm). Uses signed tetrahedra from the origin —
 *  exact for a closed mesh, robust enough for a near-closed imported shell. */
export function meshCentroid(geo: THREE.BufferGeometry): THREE.Vector3 {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  const c = new THREE.Vector3();
  if (!pos) return c;
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  let vol6 = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); d.fromBufferAttribute(pos, i2);
    const v = a.dot(b.clone().cross(d)); // 6× signed tetra volume
    vol6 += v;
    c.x += (a.x + b.x + d.x) * v;
    c.y += (a.y + b.y + d.y) * v;
    c.z += (a.z + b.z + d.z) * v;
  }
  if (Math.abs(vol6) < 1e-9) {
    // Degenerate/open mesh → fall back to bbox centre.
    geo.computeBoundingBox();
    return geo.boundingBox ? geo.boundingBox.getCenter(new THREE.Vector3()) : c;
  }
  return c.multiplyScalar(1 / (4 * vol6));
}

/** Surface area (mm²) of a triangle mesh. */
export function meshAreaMm2(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return area;
}
