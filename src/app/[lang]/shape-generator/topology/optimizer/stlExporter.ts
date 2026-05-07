import * as THREE from 'three';
import { downloadBlob } from '@/lib/platform';

/**
 * Export a Three.js BufferGeometry as a binary STL file and trigger a download.
 */
export async function exportSTL(
  geometry: THREE.BufferGeometry,
  filename: string = 'topology_result.stl'
): Promise<void> {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    throw new Error('Geometry has no position attribute');
  }

  // Ensure we have a non-indexed geometry for triangle iteration
  let geo = geometry;
  if (geometry.index !== null) {
    geo = geometry.toNonIndexed();
  }

  const positions = geo.getAttribute('position');
  const nTriangles = positions.count / 3;

  // Binary STL: 80-byte header + 4-byte triangle count + (50 bytes per triangle)
  const bufferSize = 80 + 4 + nTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes) - fill with zeros
  let offset = 0;
  const headerStr = 'Binary STL exported from NexyFab Topology Optimizer';
  for (let i = 0; i < 80; i++) {
    view.setUint8(offset + i, i < headerStr.length ? headerStr.charCodeAt(i) : 0);
  }
  offset += 80;

  // Triangle count
  view.setUint32(offset, nTriangles, true);
  offset += 4;

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (let i = 0; i < nTriangles; i++) {
    const i3 = i * 3;

    pA.fromBufferAttribute(positions, i3);
    pB.fromBufferAttribute(positions, i3 + 1);
    pC.fromBufferAttribute(positions, i3 + 2);

    // Compute face normal
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);
    cb.normalize();

    // Normal
    view.setFloat32(offset, cb.x, true); offset += 4;
    view.setFloat32(offset, cb.y, true); offset += 4;
    view.setFloat32(offset, cb.z, true); offset += 4;

    // Vertex 1
    view.setFloat32(offset, pA.x, true); offset += 4;
    view.setFloat32(offset, pA.y, true); offset += 4;
    view.setFloat32(offset, pA.z, true); offset += 4;

    // Vertex 2
    view.setFloat32(offset, pB.x, true); offset += 4;
    view.setFloat32(offset, pB.y, true); offset += 4;
    view.setFloat32(offset, pB.z, true); offset += 4;

    // Vertex 3
    view.setFloat32(offset, pC.x, true); offset += 4;
    view.setFloat32(offset, pC.y, true); offset += 4;
    view.setFloat32(offset, pC.z, true); offset += 4;

    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  await downloadBlob(filename, blob);
}
