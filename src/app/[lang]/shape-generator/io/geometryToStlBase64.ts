import type { BufferGeometry } from 'three';

/** Serializes indexed or non-indexed geometry to binary STL base64. */
export function geometryToStlBase64(geometry: BufferGeometry): string | null {
  const position = geometry.attributes.position;
  if (!position) return null;
  const positions = position.array as ArrayLike<number>;
  const indices = geometry.index?.array as ArrayLike<number> | undefined;
  const triangleCount = indices
    ? Math.floor(indices.length / 3)
    : Math.floor(positions.length / 9);
  if (triangleCount <= 0) return null;

  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = indices ? indices[triangle * 3] : triangle * 3;
    const b = indices ? indices[triangle * 3 + 1] : triangle * 3 + 1;
    const c = indices ? indices[triangle * 3 + 2] : triangle * 3 + 2;
    offset += 12; // STL normal is zero; consumers recompute it.
    for (const vertex of [a, b, c]) {
      const positionOffset = vertex * 3;
      view.setFloat32(offset, positions[positionOffset], true);
      view.setFloat32(offset + 4, positions[positionOffset + 1], true);
      view.setFloat32(offset + 8, positions[positionOffset + 2], true);
      offset += 12;
    }
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkBytes = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkBytes) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunkBytes)));
  }
  return typeof btoa === 'function' ? btoa(binary) : null;
}
