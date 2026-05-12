/**
 * Synthetic large-assembly fixture (R3).
 *
 * Generates 1k+ part assemblies in code rather than checking in a 100MB
 * STEP file. Produces a `THREE.Group` with N child meshes laid out on a
 * grid — close enough to "real assembly" for perf measurement purposes
 * (memory pressure, render cost, traversal cost) without bloating the
 * repo.
 *
 * For STEP-format perf you'd export this group via stepExporter, but
 * note R2's finding: the general mesh path is currently rejected by
 * occt-import-js, so most large-assembly STEP perf must wait for the
 * exporter fix.
 */

import * as THREE from 'three';

export interface AssemblyFixture {
  group: THREE.Group;
  partCount: number;
  totalTriangles: number;
  bbox: THREE.Box3;
  /** Approximate memory in bytes (vertex buffers + index buffers). */
  approxMemoryBytes: number;
}

export interface FixtureOptions {
  /** Number of parts (default 1000). */
  count?: number;
  /** Triangles per part — controls the per-part complexity (default 12 = box). */
  trianglesPerPart?: number;
  /** Grid spacing between parts in mm (default 30). */
  spacing?: number;
}

/**
 * Build a synthetic assembly. Each part is a small mesh with the
 * requested triangle budget, positioned on a square grid. Mixes box,
 * cylinder, and sphere primitives so face counts are heterogeneous.
 */
export function buildLargeAssembly(opts: FixtureOptions = {}): AssemblyFixture {
  const count = opts.count ?? 1000;
  const trianglesPerPart = opts.trianglesPerPart ?? 12;
  const spacing = opts.spacing ?? 30;

  const side = Math.ceil(Math.sqrt(count));
  const group = new THREE.Group();

  let totalTriangles = 0;
  let approxMemoryBytes = 0;
  const bbox = new THREE.Box3();

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / side);
    const col = i % side;
    const x = (col - side / 2) * spacing;
    const z = (row - side / 2) * spacing;

    const kind = i % 3;
    let geo: THREE.BufferGeometry;
    if (kind === 0) {
      geo = new THREE.BoxGeometry(8, 8, 8); // 12 triangles
    } else if (kind === 1) {
      const segments = Math.max(3, Math.ceil(trianglesPerPart / 4));
      geo = new THREE.CylinderGeometry(4, 4, 12, segments);
    } else {
      const segments = Math.max(4, Math.ceil(Math.sqrt(trianglesPerPart)));
      geo = new THREE.SphereGeometry(5, segments, segments);
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    const mat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.name = `part_${i}`;
    group.add(mesh);

    const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    totalTriangles += tris;

    // Position attribute: 3 floats * 4 bytes = 12 bytes/vertex.
    const verts = geo.attributes.position.count;
    approxMemoryBytes += verts * 12;
    if (geo.attributes.normal) approxMemoryBytes += verts * 12;
    if (geo.index) approxMemoryBytes += geo.index.count * 4;

    if (geo.boundingBox) {
      const partBox = geo.boundingBox.clone().translate(mesh.position);
      bbox.union(partBox);
    }
  }

  return { group, partCount: count, totalTriangles, bbox, approxMemoryBytes };
}

/**
 * Smaller helper: just the heaviest mesh in the assembly merged into one
 * BufferGeometry. Useful for testing single-shape pipelines without the
 * scene-graph overhead.
 */
export async function buildLargeMergedGeometry(opts: FixtureOptions = {}): Promise<THREE.BufferGeometry> {
  const fixture = buildLargeAssembly(opts);
  const geometries: THREE.BufferGeometry[] = [];
  fixture.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const cloned = obj.geometry.clone();
      cloned.applyMatrix4(obj.matrix);
      geometries.push(cloned);
    }
  });
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('mergeGeometries returned null');
  merged.computeBoundingBox();
  return merged;
}
