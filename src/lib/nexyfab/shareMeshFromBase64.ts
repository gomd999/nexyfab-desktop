import * as THREE from 'three';

/** JSON shape stored inside base64 for IP-protected share / view links. */
export type ShareMeshJson = {
  positions: number[];
  normals?: number[];
  indices?: number[];
};

export function parseShareMeshJsonString(json: string): ShareMeshJson | null {
  try {
    const data = JSON.parse(json) as ShareMeshJson;
    if (!data?.positions?.length) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Build centered BufferGeometry from decoded mesh JSON (shared by view + share).
 */
export function meshJsonToBufferGeometry(data: ShareMeshJson): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.normals?.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  }
  if (data.indices?.length) {
    geometry.setIndex(data.indices);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.center();
  return geometry;
}

/** Decode `atob` → JSON → BufferGeometry, or `null` if invalid. */
export function bufferGeometryFromShareMeshBase64(meshDataBase64: string): THREE.BufferGeometry | null {
  try {
    const json = atob(meshDataBase64);
    const data = parseShareMeshJsonString(json);
    if (!data) return null;
    return meshJsonToBufferGeometry(data);
  } catch {
    return null;
  }
}
