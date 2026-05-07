import * as THREE from 'three';

/** Binary STL (little-endian) — shared by file download and ZIP bundle. */
export function buildBinaryStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.attributes.position;
  const triCount = pos.count / 3;

  const bufferSize = 84 + triCount * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const header = 'NexyFab Shape Generator - STL Export';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  view.setUint32(80, triCount, true);

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const offset = 84 + i * 50;
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);

    cb.subVectors(v2, v1);
    ab.subVectors(v0, v1);
    cb.cross(ab).normalize();

    view.setFloat32(offset, cb.x, true);
    view.setFloat32(offset + 4, cb.y, true);
    view.setFloat32(offset + 8, cb.z, true);

    for (let v = 0; v < 3; v++) {
      const vert = [v0, v1, v2][v];
      view.setFloat32(offset + 12 + v * 12, vert.x, true);
      view.setFloat32(offset + 12 + v * 12 + 4, vert.y, true);
      view.setFloat32(offset + 12 + v * 12 + 8, vert.z, true);
    }
    view.setUint16(offset + 48, 0, true);
  }

  return buffer;
}
